#!/usr/bin/env bash
# Build, sign with the stable Apple Development identity, install into /Applications,
# and relaunch. Signing with the SAME identity each time keeps macOS TCC grants
# (Accessibility + Input Monitoring) across rebuilds — no re-granting needed.
set -euo pipefail
cd "$(dirname "$0")/.."

ID="${HUSH_SIGN_IDENTITY:-Apple Development: ducrocq.matthys@gmail.com (D7PYS9GMVZ)}"

npm run pack

osascript -e 'quit app "Hush"' 2>/dev/null || true
pkill -f "Hush.app/Contents/MacOS/Hush" 2>/dev/null || true
sleep 1

rm -rf "/Applications/Hush.app"
cp -R "release/mac-arm64/Hush.app" "/Applications/Hush.app"
codesign --force --deep --sign "$ID" "/Applications/Hush.app"
echo "Signed:"; codesign -dvv "/Applications/Hush.app" 2>&1 | grep -E 'Authority=Apple Development' | head -1

open "/Applications/Hush.app"
echo "Installed + signed + launched."
