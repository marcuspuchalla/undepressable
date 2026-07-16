#!/bin/bash

# Sign the macOS app with proper entitlements for camera access

APP_PATH="/Applications/P2P Emergency Stream.app"
ENTITLEMENTS_PATH="${BASH_SOURCE%/*}/../src-tauri/entitlements.plist"

# If run from the app bundle itself, find entitlements differently
if [ ! -f "$ENTITLEMENTS_PATH" ]; then
    # Try to find entitlements in the app bundle
    ENTITLEMENTS_PATH="$APP_PATH/Contents/Resources/entitlements.plist"
fi

# If still not found, create minimal entitlements
if [ ! -f "$ENTITLEMENTS_PATH" ]; then
    echo "Creating temporary entitlements file..."
    TEMP_ENTITLEMENTS=$(mktemp)
    cat > "$TEMP_ENTITLEMENTS" << 'EOF'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>com.apple.security.app-sandbox</key>
    <true/>
    <key>com.apple.security.device.camera</key>
    <true/>
    <key>com.apple.security.device.microphone</key>
    <true/>
    <key>com.apple.security.network.server</key>
    <true/>
    <key>com.apple.security.network.client</key>
    <true/>
    <key>com.apple.security.files.user-selected.read-write</key>
    <true/>
    <key>com.apple.security.cs.allow-jit</key>
    <true/>
    <key>com.apple.security.cs.allow-unsigned-executable-memory</key>
    <true/>
</dict>
</plist>
EOF
    ENTITLEMENTS_PATH="$TEMP_ENTITLEMENTS"
fi

echo "Signing P2P Emergency Stream app..."
echo "App path: $APP_PATH"
echo "Entitlements: $ENTITLEMENTS_PATH"

# Remove quarantine attribute
echo "Removing quarantine attribute..."
xattr -cr "$APP_PATH" 2>/dev/null || true

# Sign the app with entitlements
echo "Signing with entitlements..."
codesign --force --deep --sign - --entitlements "$ENTITLEMENTS_PATH" "$APP_PATH"

# Verify signing
echo ""
echo "Verifying signature..."
codesign -dv --entitlements - "$APP_PATH" 2>&1 | head -20

echo ""
echo "✅ Done! The app should now have camera access."
echo "Try running it again and click 'Start Streaming'"

# Cleanup temp file
if [ -n "$TEMP_ENTITLEMENTS" ] && [ -f "$TEMP_ENTITLEMENTS" ]; then
    rm "$TEMP_ENTITLEMENTS"
fi
