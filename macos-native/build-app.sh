#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

echo "▸ Compiling HandOSCNative (Release)..."
swift build -c release

BIN_PATH="$(swift build -c release --show-bin-path)/HandOSCNative"
APP_DIR="build/HandOSC Native.app"

rm -rf "$APP_DIR"
mkdir -p "$APP_DIR/Contents/MacOS"
mkdir -p "$APP_DIR/Contents/Resources"

cp "$BIN_PATH" "$APP_DIR/Contents/MacOS/HandOSCNative"
cp "Info.plist" "$APP_DIR/Contents/Info.plist"
if [ -d "Resources/AuroraFox" ]; then
    cp -R "Resources/AuroraFox" "$APP_DIR/Contents/Resources/AuroraFox"
fi

# Strip extended attributes (Finder info/resource forks) before signing
xattr -cr "$APP_DIR"

# Ad-hoc codesign so macOS TCC camera permissions bind cleanly to the app bundle
codesign --force --deep --sign - "$APP_DIR"

echo "✓ Built native macOS app: $(pwd)/$APP_DIR"
echo "  Binary size: $(du -h "$APP_DIR/Contents/MacOS/HandOSCNative" | cut -f1)"
