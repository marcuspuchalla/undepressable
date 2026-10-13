# Ways to use it

The twelve use cases from the app's own guide (Home → *Ways to use it*), with
the step-by-step walkthrough the app shows for each one on an iPhone, an
Android phone and a computer. The short version is in the
[README](../README.md#ways-to-use-it); what each use case resists and what it
does not is in [THREAT_MODEL.md](THREAT_MODEL.md).

Status: ✅ works now · 🟡 partly now · ⬜ planned.

> Generated from `src/views/GuideView.vue` by `npm run docs:use-cases` — the app
> and this file say the same thing. Edit the guide, then regenerate.

## Contents

- [01. One to one](#01-one-to-one) — ✅ works now
- [02. One to many](#02-one-to-many) — ✅ works now
- [03. Your personal hotspot (survives the internet dropping)](#03-your-personal-hotspot-survives-the-internet-dropping) — ✅ works now
- [04. Relay to a safe place](#04-relay-to-a-safe-place) — ✅ works now
- [05. Off-grid mesh](#05-off-grid-mesh) — 🟡 partly now
- [06. When the website is blocked or seized](#06-when-the-website-is-blocked-or-seized) — ✅ works now
- [07. Reach everyone: amplify](#07-reach-everyone-amplify) — ✅ works now
- [08. Evidence that holds up — even if your phone is taken](#08-evidence-that-holds-up--even-if-your-phone-is-taken) — ✅ works now
- [09. Every copy checks back to the camera](#09-every-copy-checks-back-to-the-camera) — ✅ works now
- [10. When the network is throttled](#10-when-the-network-is-throttled) — ✅ works now
- [11. Many copies, one record](#11-many-copies-one-record) — ✅ works now
- [12. Evidence that checks itself](#12-evidence-that-checks-itself) — ✅ works now

## Open the app

The same first steps for every use case.

**iPhone**

1. Open undepressable in Safari on your iPhone.
2. Tap the Share button, then “Add to Home Screen”, so it opens full-screen like a normal app.
3. Launch it from your Home Screen. Allow the camera and microphone if it asks.
4. Do this while you have internet: afterwards it opens with no connection at all — even if the website is gone.

**Android**

1. Open undepressable in Chrome on your Android phone.
2. Accept Chrome’s “Install app” prompt (or menu → “Add to Home screen”).
3. Launch it from your app drawer. Allow the camera and microphone if it asks.
4. Do this while you have internet: afterwards it opens with no connection at all — even if the website is gone.

**Computer**

1. Open undepressable in Chrome, Edge or Firefox.
2. Optional: click the install icon in the address bar to run it in its own window — it then opens with no connection, even if the website is gone. (There is also a browser-extension build that carries its own copy of the app.)
3. Allow the camera and microphone if it asks (only needed if this device will stream).

## 01. One to one

*✅ works now*

Hand your stream to a single trusted person. Your phone connects directly to theirs over an encrypted peer-to-peer link — nothing passes through a server. They watch and record a copy.

**You — share your stream**

1. Go to the Stream tab.
2. A room code, a link and a QR code appear.
3. Send the link to your trusted person, or let them scan the QR.
4. You’re live. Tap the red button to stop when you’re done.

**Them — watch and keep a copy**

1. Go to the Collect tab.
2. Scan your QR, paste your link, or type the room code.
3. Their device starts watching and automatically records a signed copy.
4. The copy stays under Recordings, even if the connection drops.
5. If it doesn’t connect, the status card says why. A VPN on one side and mobile data on the other usually need a relay: tap “Set up a relay” (one side is enough, and it travels inside your link). No relay of your own? The app can test free public ones on your network and use those that answer.
6. If the network blocks the servers that introduce devices, the card offers “Pair by messenger”: swap two codes over any chat app instead of the room code.

## 02. One to many

*✅ works now*

Share the room code with a group. Everyone who joins sees the same live stream and keeps their own independent recording, so there is no single copy to seize. You can see how many are watching and recording. Past a couple of viewers, watchers pass the stream on to each other, so your phone’s upload stays small however many join.

**You — broadcast to the group**

1. Go to the Stream tab and share the one room code or QR with everyone.
2. The counters at the top show how many people are watching and recording.
3. Tap the red button to stop when you’re done.

**Everyone watching**

1. Go to Collect and scan the QR or enter the code.
2. Each person keeps their own independent signed recording — there is no single copy to seize.

## 03. Your personal hotspot (survives the internet dropping)

*✅ works now*

Friends near you join your phone’s personal hotspot. The video travels locally between phones, so once you are connected, the stream to the people around you keeps running even if your mobile internet is cut or jammed. Starting from scratch with no internet at all is different: room codes need the internet to introduce you, so use “Pair face to face” — swap two short codes (by QR, or as text over AirDrop / Nearby Share) with each person, as many as you like.

> **iPhone:** iPhone hotspot: Settings → Personal Hotspot → “Allow Others to Join”. Note: an iPhone hotspot can keep the phones that join it apart from each other — the hotspot phone itself can always reach them. So make the filming phone (or the viewer’s) the hotspot, rather than a third phone.
>
> **Android:** Android hotspot: Settings → Network & internet → Hotspot & tethering → Wi-Fi hotspot. Android usually lets connected phones reach each other directly.
>
> **Computer:** A laptop can share a local network too, but at a scene a phone’s Personal Hotspot is the usual setup — pick iPhone or Android above for the exact steps.

**You — host the local stream**

1. Turn on your phone’s Personal Hotspot (see the note above for your phone).
2. Have the people near you join your hotspot’s Wi-Fi.
3. Go to Stream and share the room code or QR.
4. The video now travels phone-to-phone over the hotspot, so it keeps running even if your mobile internet is cut or jammed.

**Each watcher**

1. Join the host’s hotspot Wi-Fi first.
2. Go to Collect and scan the QR or type the code — this still needs a little internet to introduce the two devices.
3. If the internet is gone completely, use “Pair face to face” instead: scan the filming phone’s code (or paste it if they sent it as text), then let them read your reply. The filming phone can add several viewers this way, and sees who is recording a copy.
4. Out of range, or the hotspot is full? Someone already watching taps “Share onward” and you pair with them instead.

## 04. Relay to a safe place

*✅ works now*

A friend watches nearby and their phone forwards the stream to an always-on device at home, which records it. If a phone at the scene is taken, the footage is already saved somewhere safe. What a phone recorded while it could not reach home follows later — and with no internet at all, recordings can be handed to someone leaving the scene, or sent as a file over AirDrop, Quick Share or Bluetooth. Every copy is checked against its signature when it arrives.

> **iPhone:** A spare iPhone or iPad can be the archive, but keep the app open, on power, and set Auto-Lock to Never so it doesn’t sleep.
>
> **Android:** A spare Android phone or tablet can be the archive, but keep the app open, on power, and the screen timeout long so it doesn’t sleep.
>
> **Computer:** A home computer is the best archive — it stays on, online, and out of reach at the scene.

**At home, before you leave — set up the archive**

1. On the device that stays safe at home, open “Set up a home archive” from the Home screen.
2. Leave it open and online. It shows a pairing QR and an 8-character code.

**On the phone you take with you — pair once**

1. While you still have a good connection, scan the home archive’s QR (or open its link).
2. You’ll see “Home archive paired”. That’s it — nothing else to do at the scene.

**At the scene**

1. Use Collect as usual — scan the streamer’s code and watch.
2. Your phone quietly forwards what it’s watching to your home device, which records and saves it. The Collect screen shows “forwarding ✓” — or says why it can’t reach home.
3. If your phone is taken, the footage is already safe at home.

**Afterwards — anything that didn’t make it home**

1. Back online: Recordings → “Send to home now” (the home device must have its Home archive screen open). Only what is missing is sent, and each second is checked at home.
2. No internet: Recordings → share icon → AirDrop, Quick Share, Bluetooth or a USB stick. On the other device: Recordings → Import checks it.

## 05. Off-grid mesh

*🟡 partly now*

No internet and no mobile data at all. Works now: phones on one hotspot pair face to face, and any viewer can “Share onward”, so the picture passes from phone to phone to people out of the filming phone’s reach, while each keeps a signed copy. Recordings can be handed from phone to phone the same way, checked on arrival. Planned for native apps: finding each other over Bluetooth and sending video over direct phone-to-phone Wi-Fi, with no hotspot at all.

> **iPhone:** Works now in the app over a Personal Hotspot. Pairing over Bluetooth and video over direct phone-to-phone Wi-Fi (no hotspot) are planned for a native iPhone app.
>
> **Android:** Works now in the app over a hotspot. Pairing over Bluetooth and video over Wi-Fi Direct (no hotspot) are planned for a native Android app.
>
> **Computer:** A laptop can take part in a chain like a phone — join the same hotspot.

**The person filming**

1. Turn on your Personal Hotspot and have the people next to you join it (or all join one phone’s hotspot).
2. Open “Pair face to face” → I’m filming, and pair with one or two people nearby: they read your code, you read their reply.

**Someone watching who can pass it on**

1. Pair with the filming phone: “Pair face to face” → I’m receiving.
2. Tap “Share onward”. People further away pair with you the same way and get the picture through you.
3. If you lose the filming phone and pair again, the people watching through you stay paired and get the picture back.

**Getting footage out**

1. On any paired link, “Hand over my recordings” copies every signed recording on this device to the other one — give it to someone who is leaving.
2. Or: Recordings → share icon → AirDrop, Quick Share, Bluetooth. The receiver checks it under Recordings → Import.
3. Once any phone is back online with a paired home archive: Recordings → “Send to home now”.

## 06. When the website is blocked or seized

*✅ works now*

The whole app is one file. Pass it on by AirDrop, Bluetooth, a messenger or a USB stick: it opens straight from the file on a computer, and anyone can put it on any website or IPFS as a mirror. Installed copies never update silently — an update must be signed by the developers, and an unsigned one (as a new owner of the domain would publish) raises a warning instead. And if the servers that introduce devices are blocked, pair by messenger: two codes over Signal or SMS, no server at all.

> **iPhone:** An iPhone cannot run the app from a file (Files only previews it). Keep the installed app, or open a mirror someone hosts.
>
> **Android:** Opening the file from a file manager is unreliable on Android (no camera). Open a mirror, or serve the file with a file-server app.
>
> **Computer:** Chrome and Edge run the file straight from disk — camera, streaming and recording included. (Tor Browser turns WebRTC off, so it can show the app but not stream.)

**Keep and pass on the app**

1. Home → “Pass the app on” → Share the app… (AirDrop, Bluetooth, messenger) or Save the file.
2. On a computer, open the file in Chrome or Edge. Or upload it anywhere as index.html — a subfolder, IPFS, anyone’s website — and share that address: it is a full mirror.
3. The browser extension is another copy the website cannot change.

**If the app warns about an unsigned update**

1. Don’t install it: the website may have been taken over.
2. Before closing the app, save or send your recordings, and keep a copy of the app from a source you trust.
3. Network → “This copy of the app” shows the build and fingerprint to compare with published releases.

**If the network looks for WebRTC itself**

1. Network → “Blend in with ordinary web traffic”. It needs a turns: relay on port 443 (yours, or one you were given) — the card says whether one is set up.
2. From then on the app sends nothing but TLS to port 443: media through the relay, discovery over WSS, no STUN, no direct connections. Slower, and the relay carries everything.
3. What a watcher can still see — hostnames, the shape of a live stream — is in docs/TRAFFIC.md. Put the relay behind a name that means nothing.

**If devices can’t find each other (“can’t reach any discovery server”)**

1. Open “Pair by messenger” (Home, or the button on the status card).
2. Send your invite code over Signal, WhatsApp, SMS or e-mail; paste the reply code they send back within a few minutes.
3. The video goes straight between the devices — or through your relay; no discovery server is involved.

## 07. Reach everyone: amplify

*✅ works now*

Peer-to-peer reaches people with the app and the code. To reach everyone, any device can push the stream to a broadcast server (WHIP — your own MediaMTX, Owncast, Cloudflare Stream…), which shows it on the open web, no app needed. It does not have to be you: someone watching from a country where the server is reachable can amplify for you, so your phone uploads one stream.

> **Computer:** A computer on a good connection is the best amplifier: it re-sends the stream once to the server, which serves everyone else.

**Whoever runs the broadcast server**

1. Set up a WHIP ingest — e.g. MediaMTX (open source, one binary) or a hosted service — and note its WHIP address and token.
2. Give the address and token only to the people who should publish to it.

**The amplifier (you, or a friend watching)**

1. While streaming: open the share sheet → “Amplify — broadcast to a server”. While watching: the same panel under the player.
2. Paste the WHIP address and token → Start broadcasting. It reconnects by itself if the connection drops.
3. The server sees the video — use one you trust. “Always use the relay” (Network) hides your address from it.

## 08. Evidence that holds up — even if your phone is taken

*✅ works now*

Every recording is signed, so any change shows. Sealed recordings are also encrypted as they are recorded: whoever takes the phone cannot watch them or see who is in them — sealed to your home archive, not even the phone can. Friends can carry sealed copies to safety and check they are intact without seeing them. And a timestamp anchored in Bitcoin proves the recording existed by a given time.

**Before you go**

1. Pair the phone with your home archive by scanning its QR code (the link carries the archive’s sealing key).
2. Recordings → Protect recordings → “Seal to my home archive”. Optionally “Lock with a passphrase” too, so you can open them yourself.
3. Optionally “Timestamp recordings automatically” — or leave it off where contacting public servers could draw attention.

**Afterwards**

1. Send recordings home (Recordings → Send to home now), hand them to a friend, or share them as files. Sealed copies stay sealed on the way; everyone can check they are intact.
2. At home they open automatically and are checked second by second.
3. Timestamp them if you haven’t (the ⏱ button); after a few hours “Check now” shows the Bitcoin block. Evidence files then include root.txt and root.txt.ots for the standard “ots verify”.

## 09. Every copy checks back to the camera

*✅ works now*

While you stream, your phone signs a small fingerprint of its picture twice a second, with a key made for this stream only — the share link carries it. Every viewer keeps those signatures with their copy. Later, anyone holding a copy can check it against them: does it show what your camera showed, second by second, and where does it not (a cut, a swap)? It works even when your phone and your own recording are gone.

**The person filming**

1. Nothing to switch on: the share sheet says “Twice a second this phone signs a fingerprint of its picture” and shows the start of the key.
2. Share the link (not just the code) where you can: it carries the key, so viewers only accept signatures made with it. Posting the link publicly also shows later which key was yours.

**Viewers**

1. Join through the link. Under the player: “✓ The filming phone signs its picture twice a second — N kept with your copy”.
2. Your copy carries the signatures wherever it goes: to your home archive, to friends, in evidence files.

**Anyone checking a copy later**

1. Recordings → “🎥 Check against the filmer”. The copy is played through quickly and compared with every signed second.
2. “✓ Shows what the filming phone’s camera showed: 58 of 60 signed moments match (key 3fa2…)” — and, if some do not, at which times. Compare the key with the one in the stream’s link.
3. A match means the same picture, not the same bytes: it survives re-encoding, and a picture that hardly changed says less (the result says so).

## 10. When the network is throttled

*✅ works now*

Slowing mobile data to a crawl is a quieter way to stop a stream than cutting it. Each viewer’s connection is measured all the time: when it gets slow, that viewer gets a smaller picture; when it is too slow for any picture, sound only — and their copy keeps recording. The picture comes back by itself when the connection recovers. Viewers on good connections keep the full picture.

**The person filming**

1. Nothing to do. On the camera screen “🐢 1 slow link: 1 sound only” shows who is getting less, and why.
2. If everyone is slow, your own upload is the bottleneck: fewer direct viewers help — let viewers relay to each other (they do by default).

**Watching on a slow connection**

1. A smaller picture, or “🔊 Sound only — the connection is too slow for the picture right now”. Your copy keeps recording either way.
2. Don’t reconnect: the picture comes back by itself when the connection allows.

## 11. Many copies, one record

*✅ works now*

Every viewer records on their own, so when one phone is taken or drops out, the others’ copies have their gaps at different moments. Bring the copies to one device — the home archive, a laptop — and Combine copies lays them on the filmer’s clock: together they cover more than any single copy. Play them through as one, or render one signed video whose record names every copy it was made from, and which still checks out against the filmer.

**Gathering the copies**

1. Copies reach one device the usual ways: the home archive records what phones watch and receives what they recorded alone; friends hand recordings over or share evidence files; Import them.
2. Recordings → “Combine copies” appears as soon as one stream has more than one copy there. Copies are grouped by the filmer’s key (or by room, for copies without the filmer’s signatures).

**Combining**

1. “Check every copy against the filmer” aligns each copy exactly; until then they are placed by when the filmer’s signals arrived, or by device clocks (shown next to each copy).
2. The bar shows what the copies cover together, and the gaps nobody covers. “Play through” plays them as one; “Render one video” records that into one signed video (in real time — keep the screen open).
3. The rendered video shows “rendered from N copies”. Its record names every copy’s signed root and key; “Save combined record” bundles it with every copy, and importing that elsewhere brings all of them.

## 12. Evidence that checks itself

*✅ works now*

An evidence bundle must outlive this website and this app. Every bundle therefore carries verify.html: one small page, built from the same code, that checks the recording on any computer — the signature over every second, the filmer’s signed moments, a timestamp, a combined record’s sources — with nothing uploaded anywhere. Double-click it. The README next to it says how to check with nothing but standard tools.

**Whoever receives a bundle**

1. Unzip it. Double-click verify.html — it opens in the browser, from disk. Choose the .zip, or the video together with evidence.json.
2. Read the result: “Unaltered: all N seconds match the signature”, then whether the picture matches what the filming device signed, and where it does not.
3. For a combined record, check each copy under sources/ the same way. For a timestamp, run ots verify root.txt.ots with the OpenTimestamps client.

**If even that is gone**

1. README.txt in the bundle spells out the check with standard tools: SHA-256 each second, rebuild the Merkle root, verify the Ed25519 signature.
