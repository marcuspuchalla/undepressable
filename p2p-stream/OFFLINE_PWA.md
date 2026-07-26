# Offline-First PWA Setup

Complete guide to making the P2P Emergency Stream app work 100% offline after initial installation.

---

## The Goal

**Install once, use forever - no server needed.**

```
┌─────────────────────────────────────────────────────────────────┐
│                    AFTER PWA INSTALLATION                        │
│                                                                  │
│   ┌─────────────┐              ┌─────────────┐                  │
│   │   Phone A   │◄────────────►│   Phone B   │                  │
│   │  (Streamer) │   P2P over   │  (Collector)│                  │
│   │             │   WiFi       │             │                  │
│   │ • PWA code  │   Direct     │ • PWA code  │                  │
│   │   cached    │◄────────────►│   cached    │                  │
│   │ • Camera    │   WebRTC     │ • Camera    │                  │
│   │ • OPFS      │              │ • OPFS      │                  │
│   │   storage   │              │   storage   │                  │
│   └─────────────┘              └─────────────┘                  │
│                                                                  │
│   ❌ No internet needed                                         │
│   ❌ No server needed                                           │
│   ❌ No domain name                                             │
│   ✅ Just WiFi hotspot (optional, can use local discovery)     │
└─────────────────────────────────────────────────────────────────┘
```

---

## How It Works

### 1. Service Worker Caches Everything

When you first open the PWA, a Service Worker:
- Downloads all JavaScript, CSS, HTML files
- Caches them locally on the phone
- Stores them for 1 year (or until updated)

```javascript
// This happens automatically
workbox.precaching.precacheAndRoute([
  '/index.html',
  '/assets/index-xxx.js',
  '/assets/index-xxx.css',
  // ... everything
]);
```

### 2. Cache-First Strategy

After caching, the app loads **entirely from local storage**:

```
User opens app
     ↓
Service Worker intercepts request
     ↓
Serves from cache (offline!)
     ↓
App runs without network
```

### 3. P2P signalling with no internet

> **Correction (2026-07-26).** This section previously claimed peers discover
> each other via "mDNS/Bonjour" and that "BitTorrent DHT works over local
> network". Both were false. Browsers expose no mDNS, no UDP broadcast and no
> local scanning to JavaScript, and Trystero's torrent strategy reaches the DHT
> through remote `wss://` trackers. With no internet, **room codes cannot
> connect anyone** — the relay that would introduce the two devices is
> unreachable. See [`docs/OFFLINE_AND_PROXIMITY.md`](docs/OFFLINE_AND_PROXIMITY.md).

What genuinely works with no internet is `/offline`: the two devices swap the
WebRTC handshake by hand, as QR codes, and then talk directly over the local
network.

```
Phone A shares a hotspot (no internet)
     ↓
Phone B joins that hotspot
     ↓
A opens /offline → "I'm filming"  → shows an offer QR
B opens /offline → "I'm receiving" → scans it, shows an answer QR
A scans the answer
     ↓
WebRTC connection established directly — no server, no relay
```

Caching the app shell (above) is still what makes this possible at all: install
the PWA or APK **while you still have internet**, so the app is on the device
and running from a secure origin when the network is gone.

---

## Setup Instructions

### Method 1: One Phone Creates Hotspot (Simplest)

**Requirements:**
- 2+ phones with the PWA installed
- One phone can create WiFi hotspot

**Steps:**

1. **Install PWA on all phones first** (when you have internet or local server):
   ```
   a) Open Safari/Chrome to the PWA URL
   b) Tap "Share" → "Add to Home Screen"
   c) Open the installed app once (to trigger caching)
   d) Verify it says "Can Work Offline"
   ```

2. **At the event (no internet):**
   ```
   Phone A: Settings → Personal Hotspot → ON
            (Set simple password: 12345678)
   
   Phone B/C/D: WiFi Settings → Connect to Phone A's hotspot
   
   All phones: Open P2P Stream app (from home screen)
   
   Streamer: Tap "Start Streaming" → Share 6-digit code
   Collectors: Tap "Scan & Collect" → Enter code
   ```

3. **Done!** Streaming works over local WiFi without any server.

---

### Method 2: Bootstrap from Laptop

**Requirements:**
- 1 laptop
- 1+ phones
- USB cable or AirDrop/Bluetooth for file transfer

**Steps:**

1. **On laptop, build and serve:**
   ```bash
   # In p2p-stream folder
   npm run build
   
   # Serve the dist folder
   npx serve -s dist -p 4400
   ```

2. **Create WiFi hotspot from laptop:**
   - macOS: System Settings → Sharing → Internet Sharing
   - Windows: Mobile Hotspot settings

3. **Phones connect to laptop hotspot:**
   - Open Safari/Chrome
   - Go to `http://laptop-ip:4400`
   - Tap "Add to Home Screen"
   - Open the installed app

4. **(Optional) Disconnect laptop:**
   - The PWA is now cached on phones
   - Phones can create their own hotspot for streaming
   - Laptop no longer needed

---

### Method 3: File Server App (No Laptop)

**Requirements:**
- iOS: "Documents by Readdle" (free) or similar
- Android: "MiXplorer" or similar

**Steps:**

1. **Transfer the PWA files to one phone:**
   - Download `dist` folder to phone via:
     - AirDrop (iOS)
     - Nearby Share (Android)
     - Bluetooth
     - USB cable

2. **Use file server app:**
   ```
   Documents by Readdle (iOS):
   - Open app → My Files → ... → WiFi Transfer → Start Server
   - Shows URL like: http://192.168.1.5:8080
   
   MiXplorer (Android):
   - Open app → Menu → HTTP Server → Start
   - Shows URL like: http://192.168.1.5:8080
   ```

3. **Other phones:**
   - Connect to same WiFi (or phone's hotspot)
   - Open the URL in browser
   - Add to Home Screen

---

## Verifying Offline Functionality

### Check if PWA is Cached

1. Open the app from home screen
2. Look for the status badge:
   - ✅ "Can Work Offline" = Fully cached
   - ⚠️ "Online" = Not yet cached, refresh page

3. Test offline:
   - Enable Airplane Mode
   - Open the app again
   - It should still work!

### Check Service Worker

On the phone (connected to Mac/PC with Safari DevTools):
```javascript
// In Safari DevTools console
navigator.serviceWorker.ready.then(reg => {
  console.log('Service Worker active:', reg.active);
});

// Check cache
caches.open('workbox-precache').then(cache => {
  cache.keys().then(keys => {
    console.log('Cached files:', keys.length);
  });
});
```

---

## Technical Details

### What Gets Cached

The Service Worker precaches:
- `index.html` (main page)
- `*.js` (all JavaScript bundles)
- `*.css` (all stylesheets)
- `*.png`, `*.svg` (icons and images)
- Dynamic imports (Trystero strategies loaded on demand)

### Cache Strategy

```javascript
// From vite.config.ts
workbox: {
  // Cache navigation requests
  navigateFallback: '/index.html',
  
  // Cache everything aggressively
  runtimeCaching: [
    {
      urlPattern: ({ request }) => 
        request.destination === 'script' ||
        request.destination === 'style' ||
        request.destination === 'document',
      handler: 'CacheFirst',  // Try cache first, fall back to network
      options: {
        cacheName: 'static-assets',
        expiration: {
          maxAgeSeconds: 365 * 24 * 60 * 60  // 1 year
        }
      }
    }
  ]
}
```

### Storage Used

| Component | Size | Persistent? |
|-----------|------|-------------|
| PWA Code | ~350 KB | Yes (cached) |
| IndexedDB (metadata) | ~10 KB per recording | Yes |
| OPFS (video chunks) | ~1 GB+ possible | Yes |
| Service Worker | ~5 KB | Yes |

**Total:** About 400 KB for the app itself, plus storage for recordings.

---

## Limitations & Solutions

### iOS Safari

**Limitation:** iOS clears Service Worker cache if app not used for 7 days.

**Solution:**
- Open the app once a week
- Or use the app during the event (cache renewed on use)
- For critical events, reinstall the day before

### Storage Quotas

**Limitation:** Mobile browsers limit storage.

**Check available:**
```javascript
navigator.storage.estimate().then(estimate => {
  console.log(`Available: ${(estimate.quota / 1e9).toFixed(2)} GB`);
  console.log(`Used: ${(estimate.usage / 1e9).toFixed(2)} GB`);
});
```

**Typical limits:**
- iOS Safari: ~1-2 GB
- Android Chrome: ~6-10 GB
- Desktop browsers: Unlimited (user prompt)

---

## Complete Offline Workflow

### Pre-Event (When You Have Access to Files)

1. **Build the app:**
   ```bash
   npm run build
   ```

2. **Copy files to multiple distribution methods:**
   ```
   dist/ folder:
   ├── index.html          ← Main entry point
   ├── assets/             ← JS, CSS, icons
   ├── manifest.webmanifest
   └── registerSW.js
   ```

3. **Distribute to participants:**
   - Share `dist` folder via:
     - Signal/Wire encrypted message
     - USB drives
     - AirDrop/Nearby Share
     - SD cards

4. **Each participant installs:**
   - Set up local server or connect to bootstrap hotspot
   - Install PWA (Add to Home Screen)
   - Open once to cache
   - Verify "Can Work Offline" appears

### During Event (100% Offline)

1. **Streamer creates hotspot**
2. **Collectors join hotspot**
3. **Open installed PWA** (no server needed!)
4. **Stream directly P2P**

### Post-Event

1. **Recordings saved locally** on each collector phone
2. **Export via:**
   - Share sheet
   - AirDrop/Nearby Share
   - Upload when internet available
   - Physical transfer (USB, SD card)

---

## Troubleshooting

### "App shows 'Online' not 'Can Work Offline'"

**Cause:** Service Worker hasn't cached yet.

**Fix:**
1. Refresh the page
2. Wait 10 seconds
3. Check again
4. If still not cached, check DevTools → Application → Service Workers

### "App works, but camera doesn't on local network"

**Cause:** Some browsers require HTTPS even for local IPs on iOS.

**Fix:**
- Use `localhost` (if testing on same device)
- Or use a local HTTPS proxy
- Or use the native app version (Tauri/Capacitor)

### "Cache cleared, app won't open offline"

**Cause:** iOS storage management cleared the cache.

**Fix:**
- Reinstall the PWA while on the local server
- Or use the Tauri desktop app version

---

## Comparison: PWA vs Native App

| Feature | PWA (Offline) | Tauri Native | Capacitor Mobile |
|---------|---------------|--------------|------------------|
| **Install** | Add to Home Screen | Double-click .exe/.dmg | Sideload IPA/APK |
| **Size** | ~350 KB | ~5-15 MB | ~10-30 MB |
| **Offline after install** | ✅ Yes | ✅ Yes | ✅ Yes |
| **Camera on local network** | ⚠️ Sometimes* | ✅ Yes | ✅ Yes |
| **Works without any prep** | ❌ Needs initial server | ✅ Yes | ✅ Yes |
| **Updates** | Automatic (when online) | Manual reinstall | Manual reinstall |
| **iOS persistence** | 7 days without use | Permanent | Permanent |

*iOS Safari sometimes requires HTTPS even for local IPs. Use native apps for guaranteed camera access.

---

## Recommended Strategy

**For maximum reliability:**

1. **Primary:** Install PWA before event (works offline after)
2. **Backup:** Tauri desktop app on laptops
3. **Emergency:** Bootstrap from any phone with file server app
4. **Nuclear option:** Share the standalone HTML file, everyone opens in browser

**For iOS specifically:**
- PWA works great for everything except guaranteed camera access
- If camera fails, use Sideloadly to install native version day before event
- Or use laptop with Tauri as backup streamer/collector

---

## Summary

**Yes, you can make it 100% serverless after installation!**

The PWA:
1. ✅ Caches all code locally (Service Worker)
2. ✅ Works offline forever (1-year cache)
3. ✅ Streams P2P over local WiFi (no internet)
4. ✅ Stores recordings locally (OPFS + IndexedDB)
5. ✅ Can be bootstrapped from any phone with file server app

**The only requirement:** One-time access to serve the files for installation. After that, it's completely self-contained.
