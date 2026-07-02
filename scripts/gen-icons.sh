#!/usr/bin/env bash
# Regenerate all raster icons from the single SVG source (assets/icon.svg):
#   - assets/icon.icns          (macOS app icon, referenced by electron-builder)
#   - assets/generated/*.png    (README / website / previews)
# Requires: librsvg (rsvg-convert) + iconutil (ships with macOS).
#   brew install librsvg
set -euo pipefail
cd "$(dirname "$0")/.."

SVG=assets/icon.svg
mkdir -p assets/generated

for sz in 256 512 1024; do
  rsvg-convert -w $sz -h $sz "$SVG" -o "assets/generated/icon-${sz}.png"
done

ICO="$(mktemp -d)/hush.iconset"; mkdir -p "$ICO"
for sz in 16 32 128 256 512; do
  rsvg-convert -w $sz          -h $sz          "$SVG" -o "$ICO/icon_${sz}x${sz}.png"
  rsvg-convert -w $((sz*2))    -h $((sz*2))    "$SVG" -o "$ICO/icon_${sz}x${sz}@2x.png"
done
iconutil -c icns "$ICO" -o assets/icon.icns
rm -rf "$ICO"
echo "Generated assets/icon.icns + assets/generated/*.png"
