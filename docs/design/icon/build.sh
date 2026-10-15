#!/usr/bin/env bash
# Regenerate apps/mobile/assets/images/{icon,android-icon-*,splash-icon,favicon}.png
# from the SVG masters in this folder. Needs google-chrome (or CHROME=...) and python3 + Pillow.
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
out=$(cd "$here/../../../apps/mobile/assets/images" && pwd)
chrome=${CHROME:-google-chrome}
tmp=$(mktemp -d); trap 'rm -rf "$tmp"' EXIT

# render <svg> <out.png> <W> <H> [viewBox] [bg RRGGBBAA]
render() {
  local svg="$tmp/$(basename "$2").svg"
  if [ -n "${5:-}" ]; then sed "0,/viewBox=\"[^\"]*\"/s//viewBox=\"$5\"/" "$1" > "$svg"; else cp "$1" "$svg"; fi
  printf '<html><head><style>html,body{margin:0;background:transparent}img{display:block;width:%spx;height:%spx}</style></head><body><img src="file://%s"></body></html>' "$3" "$4" "$svg" > "$tmp/p.html"
  "$chrome" --headless=new --disable-gpu --hide-scrollbars --default-background-color="${6:-00000000}" \
    --force-device-scale-factor=1 --window-size="$3,$4" --screenshot="$2" "file://$tmp/p.html" >/dev/null 2>&1
}

render "$here/pimate-icon.svg"            "$out/android-icon-foreground.png" 512 512
render "$here/pimate-icon-monochrome.svg" "$out/android-icon-monochrome.png" 432 432
render "$here/pimate-icon.svg"            "$out/icon.png"        1024 1024 "18 18 72 72" ffffffff
render "$here/pimate-icon.svg"            "$out/splash-icon.png" 228 213  "26.1 27 57.8 54"
render "$here/pimate-icon.svg"            "$out/favicon.png"     48 48    "29 28 52 52"
python3 - "$out" <<'PY'
import sys
from PIL import Image
d = sys.argv[1]
Image.new("RGBA", (512, 512), (255, 255, 255, 255)).save(f"{d}/android-icon-background.png", optimize=True)
for n in ["icon", "android-icon-foreground", "android-icon-monochrome", "splash-icon", "favicon"]:
    Image.open(f"{d}/{n}.png").convert("RGBA").save(f"{d}/{n}.png", optimize=True)
PY
