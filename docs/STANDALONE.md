# The app as one file (portable copy)

`npm run build:portable` → `dist-portable/undepressable.html` (~1 MB): the
whole app — code, styles, the streaming libraries that normally load lazily —
in a single HTML file. `npm run build` also places it next to the web app
(`dist/undepressable.html`, listed in the signed `release.json`), and the
browser extension carries it too.

In the app: **Home → Pass the app on → Share the app… / Save the file.** The
web app hands out the copy it checked against this build's published release;
the portable copy hands out itself.

## Where it runs

| How it is opened | Works? |
|---|---|
| From disk in Chrome or Edge on a computer (`file://…`) | **Yes** (verified in Chromium) — camera, streaming, face-to-face and messenger pairing, recording (IndexedDB; `file://` has no OPFS) |
| From disk in Firefox or Safari | Not tested yet |
| Uploaded anywhere as `index.html` — a subfolder, an IPFS gateway, a phone's file-server app | **Yes** — a full mirror; routes live in the hash, so any path works, and its share links point at the mirror |
| Opened from the Files app on iPhone | No — iOS shows a preview, not a browser |
| Opened from a file manager on Android | Unreliable — Chrome often gets a `content://` address, which is not a secure context (no camera). Serve it instead (a file-server app, or any website) |

Verified in Chromium by `scripts/e2e/portable.mjs`: the handed-out file is
byte-identical to the release; two copies opened from disk pair and stream;
the viewer's recording verifies; a copy of the copy runs; a mirror under an
arbitrary path streams, and a viewer opening its share link joins.

## Why it matters

Taking down a website — or seizing its domain — does not stop a file that is
already on people's devices, and anyone can re-host it. A copy you received
from someone should still be checked: compare its SHA-256 with the
`undepressable.html` entry in a signed `release.json` (see
`docs/THREAT_MODEL.md`).

## Limits

- Tor Browser turns WebRTC off, so a copy opened in it shows the app but cannot
  stream. An onion site can still hand out the file for download; open it in
  a normal browser.

- No service worker: a mirror does not install as an app or cache itself;
  keep the file.
- Nothing updates it. That is the point — and also why you should replace it
  with a newer signed release now and then.
