#!/usr/bin/env bash
set -euo pipefail
# Never use shell tracing here: signing material must stay out of logs.
set +x
cd "$(dirname "$0")/.."
APP_DIR="$PWD"
REPO_DIR="$(cd ../.. && pwd -P)"
export ANDROID_HOME="${ANDROID_HOME:-$HOME/Android/Sdk}"
export ANDROID_SDK_ROOT="$ANDROID_HOME"
SIGNING_DIR="${PIMATE_SIGNING_DIR:-$HOME/.config/pimate-release}"
mkdir -p "$SIGNING_DIR"
SIGNING_DIR="$(cd "$SIGNING_DIR" && pwd -P)"
case "$SIGNING_DIR/" in "$REPO_DIR/"*) echo 'Signing directory must be outside the repository' >&2; exit 1;; esac
chmod 700 "$SIGNING_DIR"
export PIMATE_SIGNING_PROPERTIES="$SIGNING_DIR/signing.properties"
KEYSTORE="$SIGNING_DIR/pimate-release.jks"
if [[ ! -f "$PIMATE_SIGNING_PROPERTIES" && ! -f "$KEYSTORE" ]]; then
  umask 077
  export PIMATE_KEY_PASSWORD
  PIMATE_KEY_PASSWORD="$(node -e 'process.stdout.write(require("node:crypto").randomBytes(32).toString("hex"))')"
  keytool -genkeypair -keystore "$KEYSTORE" -storetype JKS -alias pimate-release \
    -keyalg RSA -keysize 3072 -validity 10000 -dname 'CN=PiMate, O=PiMate' \
    -storepass:env PIMATE_KEY_PASSWORD -keypass:env PIMATE_KEY_PASSWORD >/dev/null 2>&1
  # Escape paths for Java properties; Gradle reads this file as UTF-8.
  KEYSTORE="$KEYSTORE" node <<'NODE'
const fs = require('node:fs');
const escape = value => value.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/\r/g, '\\r');
fs.writeFileSync(process.env.PIMATE_SIGNING_PROPERTIES,
  `storeFile=${escape(process.env.KEYSTORE)}\nstorePassword=${process.env.PIMATE_KEY_PASSWORD}\nkeyAlias=pimate-release\nkeyPassword=${process.env.PIMATE_KEY_PASSWORD}\n`, { mode: 0o600 });
NODE
  unset PIMATE_KEY_PASSWORD
  echo "Created release signing key in $SIGNING_DIR — back up this directory securely."
elif [[ ! -f "$PIMATE_SIGNING_PROPERTIES" || ! -f "$KEYSTORE" ]]; then
  echo 'Incomplete signing directory; restore the existing key and properties from backup. No key was replaced.' >&2
  exit 1
fi
chmod 600 "$PIMATE_SIGNING_PROPERTIES" "$KEYSTORE"
[[ -d "$ANDROID_HOME/platforms" ]] || { echo "Android SDK missing at $ANDROID_HOME" >&2; exit 1; }
# CI avoids interactive prompts. Native files are disposable; app.config.js remains the source of truth.
CI=1 npx expo prebuild --platform android --clean --no-install
(
  cd android
  ./gradlew --no-daemon --max-workers "${PIMATE_GRADLE_WORKERS:-2}" \
    --init-script "$APP_DIR/scripts/release-signing.gradle" :app:assembleRelease
)
VERSION="$(node -p 'require("./app.json").expo.version')"
mkdir -p dist
APK="$APP_DIR/dist/pimate-$VERSION.apk"
cp android/app/build/outputs/apk/release/app-release.apk "$APK"
APKSIGNER="$(find "$ANDROID_HOME/build-tools" -mindepth 2 -maxdepth 2 -name apksigner | sort -V | tail -1)"
"$APKSIGNER" verify --verbose --print-certs "$APK"
sha256sum "$APK"
echo "APK: $APK"
