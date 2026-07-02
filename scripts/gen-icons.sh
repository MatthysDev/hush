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

# Windows .ico (multi-resolution) — needs ImageMagick (`brew install imagemagick`).
if command -v magick >/dev/null 2>&1; then
  WIN="$(mktemp -d)"
  for sz in 16 24 32 48 64 128 256; do
    rsvg-convert -w $sz -h $sz "$SVG" -o "$WIN/icon-${sz}.png"
  done
  magick "$WIN"/icon-16.png "$WIN"/icon-24.png "$WIN"/icon-32.png "$WIN"/icon-48.png \
         "$WIN"/icon-64.png "$WIN"/icon-128.png "$WIN"/icon-256.png assets/icon.ico
  rm -rf "$WIN"
  echo "Generated assets/icon.icns + assets/icon.ico + assets/generated/*.png"
else
  echo "Generated assets/icon.icns + assets/generated/*.png (skipped .ico — no ImageMagick)"
fi
