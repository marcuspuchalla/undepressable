#!/bin/bash

# Package Tauri builds into dist folder

echo "Packaging Tauri builds..."

# Create dist directory if it doesn't exist
mkdir -p dist

APP_PATH="src-tauri/target/release/bundle/macos/P2P Emergency Stream.app"
ENTITLEMENTS_PATH="src-tauri/entitlements.plist"

# Sign the macOS app with entitlements before packaging
if [ -d "$APP_PATH" ]; then
    echo "Signing macOS app with entitlements..."
    codesign --force --deep --sign - --entitlements "$ENTITLEMENTS_PATH" "$APP_PATH"
    
    # Also copy entitlements into the app bundle for later use
    cp "$ENTITLEMENTS_PATH" "$APP_PATH/Contents/Resources/"
    echo "✓ Entitlements copied to app bundle"
fi

# Copy macOS DMG if it exists
if [ -f "src-tauri/target/release/bundle/dmg/P2P Emergency Stream_0.1.0_x64.dmg" ]; then
    cp "src-tauri/target/release/bundle/dmg/P2P Emergency Stream_0.1.0_x64.dmg" "dist/P2P-Emergency-Stream-macOS.dmg"
    echo "✓ macOS DMG copied to dist/P2P-Emergency-Stream-macOS.dmg"
fi

# Copy macOS .app if it exists
if [ -d "$APP_PATH" ]; then
    # Zip the .app for easier distribution
    cd "src-tauri/target/release/bundle/macos/"
    zip -r "../../../../../dist/P2P-Emergency-Stream-macOS.app.zip" "P2P Emergency Stream.app" -q
    cd "../../../../../"
    echo "✓ macOS App copied to dist/P2P-Emergency-Stream-macOS.app.zip"
fi

# Check for Windows builds
if [ -f "src-tauri/target/release/bundle/msi/P2P Emergency Stream_0.1.0_x64.msi" ]; then
    cp "src-tauri/target/release/bundle/msi/P2P Emergency Stream_0.1.0_x64.msi" "dist/P2P-Emergency-Stream-Windows.msi"
    echo "✓ Windows MSI copied to dist/P2P-Emergency-Stream-Windows.msi"
fi

if [ -f "src-tauri/target/release/bundle/nsis/P2P Emergency Stream_0.1.0_x64.exe" ]; then
    cp "src-tauri/target/release/bundle/nsis/P2P Emergency Stream_0.1.0_x64.exe" "dist/P2P-Emergency-Stream-Windows.exe"
    echo "✓ Windows EXE copied to dist/P2P-Emergency-Stream-Windows.exe"
fi

echo ""
echo "Done! Packaged files are in dist/"
ls -lh dist/*.dmg dist/*.zip 2>/dev/null || echo "No macOS packages found"
echo ""
echo "⚠️  IMPORTANT: If camera doesn't work after installing, run:"
echo "   ./scripts/sign-macos-app.sh"
