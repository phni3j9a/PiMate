#!/bin/sh
# abducoをmusl静的リンクでビルドし、poc/bin/linux-<arch>/abduco に置く（Docker必須）。
# 再現性のため、abducoのコミットとAlpineイメージを固定する。
# 使い方: poc/abduco/build-linux-static.sh [amd64|arm64]
set -eu
ARCH="${1:-amd64}"
ABDUCO_COMMIT="8c32909a159aaa9484c82b71f05b7a73321eb491"
ALPINE="alpine:3.20"
here=$(cd "$(dirname "$0")" && pwd)
case "$ARCH" in amd64) node_arch=x64 ;; arm64) node_arch=arm64 ;; *) echo "unknown arch $ARCH" >&2; exit 1 ;; esac
out="$here/../bin/linux-$node_arch"
mkdir -p "$out"
docker run --rm --platform "linux/$ARCH" -v "$out:/out" -e HOST_UID="$(id -u)" -e HOST_GID="$(id -g)" "$ALPINE" sh -euc "
  apk add --no-cache build-base git >/dev/null
  git clone -q https://github.com/martanne/abduco.git /src && cd /src && git checkout -q $ABDUCO_COMMIT
  make -s CFLAGS='-std=c99 -Os -D_POSIX_C_SOURCE=200809L -D_XOPEN_SOURCE=700 -DNDEBUG -DVERSION=\"0.6-$ABDUCO_COMMIT\"' LDFLAGS='-static -s'
  install -m 0755 abduco /out/abduco
  cp LICENSE /out/LICENSE.abduco
  chown \$HOST_UID:\$HOST_GID /out/abduco /out/LICENSE.abduco
"
file "$out/abduco" 2>/dev/null || true
sha256sum "$out/abduco"
