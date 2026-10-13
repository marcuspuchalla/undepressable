# Tauri Desktop App

Tauri wraps the web app in a native desktop application for Windows and macOS. This gives you:

- ✅ **Double-click to run** - No server needed
- ✅ **Full camera access** - No HTTPS restrictions
- ✅ **Full WebRTC support** - Native P2P connections
- ✅ **Standalone executable** - Single .exe (Windows) or .dmg (macOS)
- ✅ **Cross-platform** - Build for Windows on Mac, and vice versa

---

## Quick Start

### Development (with hot reload)

```bash
# Run the desktop app in development mode
npm run tauri:dev
```

This will:
1. Start the Vite dev server
2. Launch the Tauri desktop window
3. Enable hot reload when you change code

### Build Production Apps

```bash
# Build for current platform (macOS or Windows)
npm run tauri:build

# Build for macOS specifically
npm run tauri:build:mac

# Windows (must be done on Windows machine)
npm run tauri:build:win
```

Output locations:
- **macOS**: `dist/P2P-Emergency-Stream-macOS.dmg`
- **macOS App**: `dist/P2P-Emergency-Stream-macOS.app.zip`
- **Windows**: `dist/P2P-Emergency-Stream-Windows.exe` (must build on Windows)

---

## Build Outputs

### macOS (.dmg)
- **File**: `P2P-Emergency-Stream-macOS.dmg`
- **Size**: ~4 MB
- **Install**: Double-click DMG, drag to Applications
- **Requirements**: macOS 10.13+ (High Sierra or later)

### macOS (.app)
- **File**: `P2P-Emergency-Stream-macOS.app.zip`
- **Size**: ~3.6 MB
- **Install**: Unzip, double-click app
- **Note**: May need to right-click → Open first time (Gatekeeper)

### Windows (.exe)
- **File**: `P2P-Emergency-Stream-Windows.exe`
- **Size**: ~3-4 MB
- **Install**: Double-click EXE
- **Requirements**: Windows 10 or later

### Windows (.msi)
- **File**: `P2P-Emergency-Stream-Windows.msi`
- **Size**: ~3-4 MB
- **Install**: Double-click MSI, follow installer
- **Note**: Creates Start Menu shortcut

---

## How It Works

```
┌─────────────────────────────────────────────────────────────────┐
│                    TAURI DESKTOP APP                            │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  Native Window (macOS/Windows)                          │  │
│  │  ┌──────────────────────────────────────────────────┐   │  │
│  │  │  WebView (WebKit on macOS, Edge on Windows)      │   │  │
│  │  │  ┌──────────────────────────────────────────┐    │   │  │
│  │  │  │  Your Vue App                            │    │   │  │
│  │  │  │  ┌─────────┐ ┌─────────┐ ┌─────────┐    │    │   │  │
│  │  │  │  │ Camera  │ │ WebRTC  │ │ OPFS    │    │    │   │  │
│  │  │  │  │ Access  │ │ P2P     │ │ Storage │    │    │   │  │
│  │  │  │  └─────────┘ └─────────┘ └─────────┘    │    │   │  │
│  │  │  └──────────────────────────────────────────┘    │   │  │
│  │  └──────────────────────────────────────────────────┘   │  │
│  └──────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

Tauri uses the system's native WebView:
- **macOS**: WKWebView (WebKit) - Same as Safari
- **Windows**: WebView2 (Edge/Chromium) - Same as Edge

This means:
- Camera, WebRTC, and all web APIs work exactly like in browsers
- No HTTPS restrictions (it's a native app!)
- Access to native APIs if needed (file system, notifications, etc.)

---

## Building for Different Platforms

### macOS (on macOS)

```bash
npm run tauri:build
```

This creates:
- `.dmg` file - Disk image for distribution
- `.app` bundle - Direct application bundle

### Windows (on Windows)

You need to build on a Windows machine:

1. Install prerequisites on Windows:
   - Node.js
   - Rust (https://rustup.rs/)
   - Visual Studio Build Tools

2. Clone the repository:
   ```powershell
   git clone <repo-url>
   ```

3. Install dependencies:
   ```powershell
   npm install
   ```

4. Build:
   ```powershell
   npm run tauri:build
   ```

Output will be in:
- `src-tauri/target/release/bundle/nsis/*.exe`
- `src-tauri/target/release/bundle/msi/*.msi`

### Cross-Platform Build (CI/CD)

For automated builds on all platforms, use GitHub Actions:

```yaml
# .github/workflows/release.yml
name: Release
on:
  push:
    tags:
      - 'v*'

jobs:
  build:
    strategy:
      matrix:
        platform: [macos-latest, windows-latest]
    runs-on: ${{ matrix.platform }}
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: 20
      - uses: dtolnay/rust-action@stable
      - run: npm install
      - run: npm run tauri:build
      - uses: actions/upload-artifact@v3
        with:
          name: ${{ matrix.platform }}-build
          path: src-tauri/target/release/bundle
```

---

## Distribution

### For End Users

**macOS:**
1. Download `.dmg` file
2. Double-click to mount
3. Drag app to Applications folder
4. First launch: Right-click → Open (bypass Gatekeeper)

**Windows:**
1. Download `.exe` or `.msi` file
2. Double-click to run/install
3. Windows Defender may warn - click "More info" → "Run anyway"

### Security Warnings

**macOS: "App is damaged and can't be opened"**

This is Gatekeeper blocking unsigned apps. Fix:
```bash
# Remove quarantine attribute
xattr -cr "/Applications/Undepressable.app"

# Or right-click the app → Open (first time only)
```

**Windows: "Windows protected your PC"**

Click "More info" → "Run anyway" (for unsigned builds).

**To avoid these warnings** (optional):
- macOS: Code sign with Apple Developer certificate ($99/year)
- Windows: Code sign with trusted certificate ($200+/year)

For emergency/activist use, unsigned builds are fine - users just need to bypass the warnings.

---

## Troubleshooting

### Camera not working

1. Check macOS System Settings → Privacy & Security → Camera
2. Make sure "Undepressable" is allowed
3. Restart the app

### Build fails

**Error: Permission shell:allow-open not found**
- Fixed: Removed invalid permissions from capabilities

**Error: Invalid category**
- Fixed: Changed to "SocialNetworking"

**Port already in use**
- Vite will automatically try another port (4401, etc.)
- Tauri will use whatever port Vite opens

### Rust compilation errors

Make sure you have:
```bash
# Rust installed
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh

# For macOS development - no additional targets needed

# For Windows cross-compilation (advanced)
rustup target add x86_64-pc-windows-msvc
```

---

## Comparison: PWA vs Native App

| Feature | PWA | Tauri Native |
|---------|-----|--------------|
| **Install** | Add to Home Screen | Double-click .exe/.dmg |
| **Size** | ~350 KB | ~4 MB |
| **Camera** | ⚠️ Requires HTTPS/local IP | ✅ Works immediately |
| **WebRTC** | ⚠️ Requires secure context | ✅ Works immediately |
| **Offline** | ✅ Yes (after install) | ✅ Yes |
| **Updates** | Automatic | Manual reinstall |
| **iOS Support** | ✅ Safari PWA | ❌ Not supported |
| **Distribution** | Web server / File server | File download |

**Recommendation:**
- **Mobile**: Use PWA (iOS/Android)
- **Desktop**: Use Tauri native app (macOS/Windows)
- **Emergency**: Have both options ready

---

## Configuration

### Window Settings

Edit `src-tauri/tauri.conf.json`:

```json
{
  "app": {
    "windows": [{
      "title": "Undepressable",
      "width": 1024,
      "height": 768,
      "minWidth": 800,
      "minHeight": 600,
      "resizable": true,
      "fullscreen": false
    }]
  }
}
```

### Icons

Replace files in `src-tauri/icons/`:
- `icon.icns` - macOS app icon
- `icon.ico` - Windows app icon
- `32x32.png`, `128x128.png` - Various sizes

Generate from a single PNG:
```bash
npm run tauri icon /path/to/icon.png
```

---

## Summary

**To build for macOS (on Mac):**
```bash
npm run tauri:build
# Output: dist/P2P-Emergency-Stream-macOS.dmg
```

**To build for Windows (on Windows):**
```powershell
npm run tauri:build
# Output: dist/P2P-Emergency-Stream-Windows.exe
```

**For development:**
```bash
npm run tauri:dev
```

Tauri gives you the best of both worlds:
- **Web technology** for the UI (Vue, TypeScript, CSS)
- **Native performance** and capabilities
- **Easy distribution** as .exe and .dmg
- **No browser restrictions** on camera and WebRTC

For emergency scenarios where you need a guaranteed-working solution:
1. Build the Tauri app
2. Distribute the .exe/.dmg files
3. Users double-click and it just works
4. No internet, no server, no HTTPS required
