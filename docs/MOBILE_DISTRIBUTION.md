# Mobile Distribution Without App Stores

Complete guide to running P2P Emergency Stream on iOS and Android without App Store/Google Play and without centralized servers.

---

## Executive Summary

| Platform | Method | Jailbreak? | Difficulty | Reliability |
|----------|--------|------------|------------|-------------|
| **iOS** | AltStore | No | Medium | High |
| **iOS** | Sideloadly | No | Easy | Medium |
| **iOS** | PWA (Safari) | No | Very Easy | High |
| **iOS** | TrollStore | Yes (or specific iOS) | Hard | Very High |
| **Android** | APK Sideload | No | Very Easy | Very High |
| **Android** | PWA (Chrome) | No | Very Easy | High |
| **Android** | F-Droid Repo | No | Easy | High |
| **Both** | Capacitor/Cordova | No | Medium | High |

---

## iOS Options

### Option 1: AltStore (Recommended for Non-Jailbroken)

AltStore is an alternative app store that uses your Apple ID to sign apps.

**How it works:**
- Uses free Apple developer provisioning (7-day app signing)
- Refreshes apps automatically when on same WiFi as computer
- No jailbreak required
- Works on iOS 12.2+

**Setup:**
1. Install AltServer on Mac/Windows: https://altstore.io/
2. Connect iPhone via USB
3. Install AltStore on iPhone
4. Sideload the P2P Stream IPA

**Pros:**
- ✅ Free, no Apple Developer account needed
- ✅ Auto-refresh via AltServer
- ✅ Works on most iOS versions

**Cons:**
- ❌ Apps expire after 7 days (need to refresh)
- ❌ Requires computer on same WiFi to refresh
- ❌ One-time setup is complex for non-technical users

**For Emergency Use:**
- Pre-install AltStore and P2P Stream before the event
- Apps keep working for 7 days without refresh
- For longer events, periodic WiFi sync needed

---

### Option 2: Sideloadly (Easiest for One-Time Install)

Sideloadly sideloads IPAs directly using your Apple ID.

**How it works:**
- Drag-and-drop IPA file
- Signs with your Apple ID
- Installs via USB

**Setup:**
1. Download Sideloadly: https://sideloadly.io/
2. Connect iPhone via USB
3. Drag P2P Stream IPA into Sideloadly
4. Enter Apple ID credentials
5. Install

**Pros:**
- ✅ Easiest method for single install
- ✅ No ongoing software needed
- ✅ Works on Windows/Mac/Linux

**Cons:**
- ❌ App expires after 7 days
- ❌ Must reinstall to refresh
- ❌ Requires computer and USB

**Best for:** One-time use, tech-savvy users

---

### Option 3: PWA (Safari Add to Home Screen)

The simplest option - add the web app to home screen.

**How it works:**
- Host app on any local server (laptop, phone with file server, portable router)
- User opens Safari to local URL
- Tap "Share" → "Add to Home Screen"
- Works like a native app

**Setup:**
```bash
# On a laptop that creates WiFi hotspot
npx serve -s dist -p 4400

# Or use file server app on phone
# Documents by Readdle (iOS) has built-in server
```

**Pros:**
- ✅ No installation needed
- ✅ Works immediately
- ✅ Camera and WebRTC work (HTTPS not required for local IPs)
- ✅ No expiration

**Cons:**
- ❌ Requires local network (WiFi hotspot)
- ❌ Safari prompts for camera each session
- ❌ Slightly less "native" feeling

**Best for:** Emergency scenarios, no preparation needed

---

### Option 4: TrollStore (Best for Jailbroken/Specific iOS)

TrollStore permanently installs apps with arbitrary entitlements.

**Requirements:**
- iOS 14.0 - 16.6.1 (or 17.0 for specific devices)
- Must install TrollStore first using specific exploits

**Pros:**
- ✅ Permanent installation (no re-signing)
- ✅ Full system permissions
- ✅ Works offline forever

**Cons:**
- ❌ Only works on specific iOS versions
- ❌ Complex initial setup
- ❌ Security implications

**Best for:** Activists with jailbroken phones or compatible iOS versions

---

### Option 5: Apple Developer Enterprise (Not Recommended)

$299/year enterprise certificate allows unlimited app distribution.

**Why not recommended:**
- Apple actively revokes certificates used for non-enterprise purposes
- High cost
- Requires D-U-N-S number and business verification

---

## Android Options

### Option 1: APK Sideloading (Easiest)

Android allows direct APK installation from any source.

**How it works:**
1. Enable "Unknown Sources" in Settings
2. Transfer APK file (Bluetooth, AirDrop, USB, Signal)
3. Tap APK to install

**Setup:**
```bash
# Build Android APK with Capacitor
npm install @capacitor/core @capacitor/cli
npx cap add android
npx cap sync
npx cap build android

# Or use Tauri's Android support (coming soon)
```

**Pros:**
- ✅ Extremely easy
- ✅ No expiration
- ✅ Works on all Android devices
- ✅ Can be done entirely offline

**Cons:**
- ❌ Users must enable "Unknown Sources"
- ❌ Google Play Protect may warn (can be disabled)

**Best for:** Universal Android distribution

---

### Option 2: PWA (Chrome Add to Home Screen)

Same as iOS - add to home screen from Chrome.

**Pros:**
- ✅ No APK needed
- ✅ Auto-updates
- ✅ Camera works on local network

**Cons:**
- ❌ Chrome prompts for permissions
- ❌ Needs local server

---

### Option 3: F-Droid Repository

F-Droid is an alternative app store for open-source apps.

**How it works:**
- Add custom F-Droid repository URL
- App appears in F-Droid client
- Auto-updates

**Setup:**
1. Host F-Droid repo on GitHub Pages or local server
2. Users add repo URL to F-Droid app
3. App available for install

**Pros:**
- ✅ Trusted by privacy community
- ✅ Auto-updates
- ✅ No Google Play needed

**Cons:**
- ❌ Users must install F-Droid first
- ❌ Repo needs hosting

**Best for:** Privacy-conscious Android users

---

### Option 4: Internal App Sharing (Temporary)

Google Play Console allows internal sharing without review.

**Pros:**
- ✅ Distributed via Google Play infrastructure
- ✅ Up to 100 testers

**Cons:**
- ❌ Requires Google Play Console account ($25)
- ❌ Google can see the app
- ❌ Limited to 100 users

**Not recommended** for censorship-resistant scenarios

---

## Cross-Platform Solutions

### Option 1: Capacitor (Recommended)

Capacitor wraps web apps as native mobile apps.

**Setup:**
```bash
# Install Capacitor
npm install @capacitor/core @capacitor/cli
npm install @capacitor/camera @capacitor/filesystem

# Add platforms
npx cap add ios
npx cap add android

# Build web app
npm run build

# Sync to native projects
npx cap sync

# Open in Xcode/Android Studio
npx cap open ios
npx cap open android
```

**Distribution:**
- **iOS**: Build IPA in Xcode, distribute via AltStore/Sideloadly
- **Android**: Build APK in Android Studio, sideload

**Pros:**
- ✅ Native app feel
- ✅ Full camera/WebRTC access
- ✅ Can add native plugins
- ✅ Same codebase as web

**Cons:**
- ❌ Requires Xcode (Mac) for iOS builds
- ❌ App store restrictions still apply if you use App Store

---

### Option 2: Ionic Portals (Enterprise)

Similar to Capacitor but with enterprise features.

**Not recommended** for this use case due to complexity and cost.

---

## Comparison Matrix

### For iOS Users

| Method | Prep Time | User Skill | Works Offline | Permanence |
|--------|-----------|------------|---------------|------------|
| PWA (Local Server) | None | Low | Yes | Until cache cleared |
| AltStore | 30 min | Medium | Yes* | 7 days |
| Sideloadly | 10 min | Medium | Yes | 7 days |
| TrollStore | 1 hour | High | Yes | Permanent |

*Requires periodic refresh

### For Android Users

| Method | Prep Time | User Skill | Works Offline | Permanence |
|--------|-----------|------------|---------------|------------|
| APK Sideload | None | Low | Yes | Permanent |
| PWA | None | Low | Yes | Until cache cleared |
| F-Droid | 15 min | Medium | Yes | Permanent |

---

## Recommended Emergency Workflow

### Scenario: Phone confiscation risk, no internet

**Preparation (Before Event):**

1. **Build all versions:**
   ```bash
   # Capacitor iOS (build on Mac)
   npx cap build ios --release
   
   # Capacitor Android
   npx cap build android --release
   
   # Or use Tauri for desktop backup
   npm run tauri:build
   ```

2. **Distribute to participants:**
   - iOS users: Install AltStore + app (or learn Sideloadly)
   - Android users: Install APK
   - Desktop users: Keep .exe/.dmg ready

3. **Create offline package:**
   - Zip file with:
     - PWA files (dist folder)
     - Standalone HTML
     - APK file
     - IPA file
     - Instructions PDF

**During Event:**

1. **If phones have apps installed:**
   - Open native app
   - Create WiFi hotspot
   - Stream directly

2. **If phones don't have apps:**
   - Person A creates hotspot
   - Person B runs local server (laptop or file server app)
   - Others connect to hotspot
   - Open PWA in browser
   - Add to home screen for convenience

3. **If no computers:**
   - Use "Documents by Readdle" or similar file server app
   - Host PWA from one phone
   - Others connect and stream

---

## Technical Deep Dive: WebRTC on Local Networks

### How P2P Works Without Internet

```
┌─────────────────────────────────────────────────────────────────┐
│                    WIFI HOTSPOT (No Internet)                    │
│                                                                  │
│   ┌──────────┐         ┌──────────┐         ┌──────────┐       │
│   │ Streamer │◄───────►│ BitTorrent│◄───────►│ Collector│       │
│   │  Phone   │  DHT    │   DHT    │  DHT    │  Phone   │       │
│   └──────────┘         └──────────┘         └──────────┘       │
│         │                                        │              │
│         └────────────┬───────────────────────────┘              │
│                   WebRTC                                       │
│              (Direct P2P Connection)                           │
└─────────────────────────────────────────────────────────────────┘
```

**Key Points:**
- BitTorrent DHT works over local network (mDNS)
- WebRTC can use local ICE candidates only
- No internet or external servers needed
- Works as long as devices are on same WiFi

### Signaling Over Local Network

Trystero supports local discovery:
- Uses mDNS/Bonjour for peer discovery
- Falls back to local WebSocket if needed
- Can work entirely offline

---

## Building Mobile Apps

### Prerequisites

**For iOS:**
- macOS computer
- Xcode (free from App Store)
- Apple ID (free)

**For Android:**
- Any computer (Windows/Mac/Linux)
- Android Studio (free)
- Java SDK

### Build Instructions

#### iOS with Capacitor

```bash
# 1. Install dependencies
npm install @capacitor/core @capacitor/cli
npx cap add ios

# 2. Configure
# Edit ios/App/App/capacitor.config.json

# 3. Build
npm run build
npx cap sync ios

# 4. Open in Xcode
npx cap open ios

# 5. In Xcode:
# - Select your team (Apple ID)
# - Product → Archive
# - Distribute App → Ad Hoc
# - Export IPA file
```

#### Android with Capacitor

```bash
# 1. Install dependencies
npm install @capacitor/core @capacitor/cli
npx cap add android

# 2. Build
npm run build
npx cap sync android

# 3. Open in Android Studio
npx cap open android

# 4. In Android Studio:
# - Build → Build Bundle(s) / APK(s) → Build APK
# - Or Build → Generate Signed Bundle/APK
# - Locate .apk file in app/release/
```

---

## Distribution Methods Without Internet

### Method 1: Local WiFi File Transfer

1. Create WiFi hotspot (no internet needed)
2. Use file sharing apps:
   - **iOS to iOS**: AirDrop (works without internet)
   - **Android to Android**: Nearby Share
   - **Cross-platform**: LocalSend, Snapdrop

### Method 2: Bluetooth Transfer

- Send APK/IPA files directly
- Slow but works completely offline
- No infrastructure needed

### Method 3: USB/SD Card

- Copy files to USB drive or SD card
- Physical handoff
- Most reliable for high-security scenarios

### Method 4: QR Code with Embedded Data

For very small apps (< 3KB), you could encode the entire app in a QR code.

Our app is too large (~350 KB), but you could encode:
- URL to local server
- Configuration data
- Short instructions

---

## Security Considerations

### Code Signing

Without App Store signing, users must trust the app manually.

**Mitigations:**
- Publish checksums (SHA-256) of official builds
- Build from open source (users can verify)
- Community signing (multiple trusted people build and compare)

### Malware Risks

Sideloading bypasses App Store review:

**Protections:**
- Only download from trusted sources
- Verify checksums
- Open source allows code audit

---

## Summary

### Best Options by Scenario

| Scenario | Recommended Approach |
|----------|---------------------|
| **Emergency, no prep** | PWA via local WiFi hotspot |
| **Emergency, 1-day prep** | Android APK sideload + iOS PWA |
| **Planned event** | AltStore (iOS) + APK (Android) |
| **High-security, offline** | TrollStore (iOS) + APK (Android) |
| **Mixed devices** | Capacitor native apps + sideloading |

### Easiest for Non-Technical Users

1. **Android**: APK sideload (just tap file, enable unknown sources)
2. **iOS**: PWA via local server (no install, just open URL)
3. **Desktop**: Tauri app (double-click .exe/.dmg)

### Most Robust for Activists

1. Pre-install native apps (Capacitor) before event
2. Have PWA as backup on local server
3. Distribute files via Bluetooth/AirDrop if needed
4. Test entire workflow before event

---

## Resources

- **AltStore**: https://altstore.io/
- **Sideloadly**: https://sideloadly.io/
- **TrollStore**: https://github.com/opa334/TrollStore
- **Capacitor**: https://capacitorjs.com/
- **F-Droid**: https://f-droid.org/
- **LocalSend**: https://localsend.org/ (file transfer)
