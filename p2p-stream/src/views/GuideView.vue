<template>
  <div class="h-full overflow-y-auto">
    <section class="organic-veil px-5 pt-8 pb-4 text-center">
      <p class="text-xs uppercase tracking-[0.2em] text-glow/80 mb-3">Field guide</p>
      <h1 class="font-display font-black text-slate-50 text-3xl sm:text-4xl mb-3">Ways to use it</h1>
      <p class="text-slate-400 max-w-md mx-auto text-sm leading-relaxed">
        The same app fits a one-to-one hand-off or a whole crowd. Pick the shape that matches your situation — every
        watcher still keeps their own signed copy.
      </p>
    </section>

    <div class="px-4 pb-8 space-y-4">
      <article v-for="uc in cases" :key="uc.n" class="card">
        <div class="flex items-center gap-2 mb-3">
          <span class="font-mono text-[11px] text-slate-500">USE CASE {{ uc.n }}</span>
          <span class="h-px flex-1 bg-line" />
          <span
            class="font-mono text-[10px] px-1.5 py-0.5 rounded"
            :class="STATUS[uc.status].class"
          >{{ STATUS[uc.status].label }}</span>
        </div>

        <!-- retro technical topology diagram -->
        <div class="rounded-xl border border-line bg-black/30 p-3 mb-3 overflow-x-auto">
          <div class="min-w-[300px]" v-html="uc.svg" />
        </div>

        <h2 class="font-display font-bold text-lg text-slate-100 mb-1">{{ uc.title }}</h2>
        <p class="text-sm text-slate-400 leading-relaxed">{{ uc.body }}</p>

        <!-- step-by-step walkthrough (collapsed by default) -->
        <div v-if="walks[uc.n]" class="mt-3 border-t border-line pt-3">
          <button
            class="flex items-center gap-2 text-sm font-medium text-glow"
            :aria-expanded="expanded.has(uc.n)"
            @click="toggle(uc.n)"
          >
            <svg
              class="w-4 h-4 transition-transform"
              :class="expanded.has(uc.n) ? 'rotate-90' : ''"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            ><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" /></svg>
            {{ expanded.has(uc.n) ? 'Hide the walkthrough' : 'Show me how, step by step' }}
          </button>

          <div v-if="expanded.has(uc.n)" class="mt-3 space-y-4">
            <!-- platform selector -->
            <div>
              <p class="text-[11px] uppercase tracking-wide text-slate-500 mb-1.5">I’m using</p>
              <div class="inline-flex rounded-lg border border-line overflow-hidden">
                <button
                  v-for="p in PLATFORMS"
                  :key="p.id"
                  class="px-3 py-1.5 text-xs font-medium transition-colors"
                  :class="platform === p.id ? 'bg-glow/15 text-glow' : 'text-slate-400 hover:text-slate-200'"
                  @click="platform = p.id"
                >{{ p.label }}</button>
              </div>
            </div>

            <!-- open the app (platform-specific) -->
            <div>
              <h3 class="text-sm font-semibold text-slate-100 mb-1.5">Open the app</h3>
              <ol class="list-decimal list-inside space-y-1 text-sm text-slate-400 marker:text-slate-600">
                <li v-for="(s, i) in openApp[platform]" :key="i">{{ s }}</li>
              </ol>
            </div>

            <!-- platform caveat -->
            <p
              v-if="walks[uc.n].caveat?.[platform]"
              class="text-xs text-slate-300 bg-glow/5 border border-glow/20 rounded-lg px-3 py-2 leading-relaxed"
            >{{ walks[uc.n].caveat?.[platform] }}</p>

            <!-- role-based steps -->
            <div v-for="role in walks[uc.n].roles" :key="role.who">
              <h3 class="text-sm font-semibold text-slate-100 mb-1.5">{{ role.who }}</h3>
              <ol class="list-decimal list-inside space-y-1 text-sm text-slate-400 marker:text-slate-600">
                <li v-for="(s, i) in role.steps" :key="i">{{ s }}</li>
              </ol>
            </div>
          </div>
        </div>
      </article>

      <p class="text-xs text-slate-500 text-center px-6 leading-relaxed">
        Diagrams are simplified. “Signed copy” means each recording is hashed and signed so it can be proven unaltered
        — see <RouterLink to="/recordings" class="text-glow">Recordings</RouterLink>.
      </p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import { RouterLink } from 'vue-router'

// --- tiny SVG toolkit for the node-link topology diagrams (retro technical look) ---
const W = 520
const H = 150
function person(x: number, y: number, label: string, color: string) {
  return `
    <circle cx="${x}" cy="${y - 10}" r="7" fill="none" stroke="${color}" stroke-width="1.6"/>
    <path d="M${x - 9} ${y + 14} q9 -16 9 -16 q0 0 9 16" fill="none" stroke="${color}" stroke-width="1.6"/>
    <text x="${x}" y="${y + 30}" text-anchor="middle" font-family="ui-monospace,monospace" font-size="11" fill="#9fb0d0">${label}</text>`
}
function home(x: number, y: number, label: string, color: string) {
  return `
    <path d="M${x - 11} ${y + 2} l11 -11 l11 11 v11 h-22 z" fill="none" stroke="${color}" stroke-width="1.6"/>
    <rect x="${x - 3}" y="${y + 6}" width="6" height="7" fill="none" stroke="${color}" stroke-width="1.2"/>
    <text x="${x}" y="${y + 30}" text-anchor="middle" font-family="ui-monospace,monospace" font-size="11" fill="#9fb0d0">${label}</text>`
}
function link(x1: number, y1: number, x2: number, y2: number, color: string, dashed = false, label = '') {
  const mx = (x1 + x2) / 2
  const my = (y1 + y2) / 2
  return `
    <defs><marker id="a${x1}${y1}${x2}${y2}" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
      <path d="M0 0 L6 3 L0 6 z" fill="${color}"/></marker></defs>
    <line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${color}" stroke-width="1.6"
      ${dashed ? 'stroke-dasharray="4 3"' : ''} marker-end="url(#a${x1}${y1}${x2}${y2})"/>
    ${label ? `<text x="${mx}" y="${my - 6}" text-anchor="middle" font-family="ui-monospace,monospace" font-size="9" fill="#7dd3fc">${label}</text>` : ''}`
}
const EMBER = '#fb7185'
const GLOW = '#7dd3fc'
const MOSS = '#6ee7b7'
const svg = (inner: string, h = H) => `<svg viewBox="0 0 ${W} ${h}" width="100%" style="max-width:520px;display:block;margin:auto">${inner}</svg>`
// Small caption helper — keeps label text out of the node/arrow geometry.
function note(x: number, y: number, text: string, color: string, size = 9) {
  return `<text x="${x}" y="${y}" text-anchor="middle" font-family="ui-monospace,monospace" font-size="${size}" fill="${color}">${text}</text>`
}

type Status = 'now' | 'partial' | 'planned'
const STATUS: Record<Status, { label: string; class: string }> = {
  now: { label: 'WORKS NOW', class: 'bg-moss/10 text-moss' },
  partial: { label: 'PARTLY NOW', class: 'bg-glow/10 text-glow' },
  planned: { label: 'PLANNED', class: 'bg-slate-500/10 text-slate-400' },
}

const cases: { n: string; status: Status; title: string; body: string; svg: string }[] = [
  {
    n: '01',
    status: 'now',
    title: 'One to one',
    body: 'Hand your stream to a single trusted person. Your phone connects directly to theirs over an encrypted peer-to-peer link — nothing passes through a server. They watch and record a copy.',
    svg: svg(
      person(95, 60, 'You', EMBER) +
        link(125, 50, 395, 50, GLOW, false, 'live + recorded') +
        person(425, 60, 'Friend', GLOW),
      110,
    ),
  },
  {
    n: '02',
    status: 'now',
    title: 'One to many',
    body: 'Share the room code with a group. Everyone who joins sees the same live stream and keeps their own independent recording, so there is no single copy to seize. You can see how many are watching and recording. Past a couple of viewers, watchers pass the stream on to each other, so your phone’s upload stays small however many join.',
    svg: svg(
      person(80, 80, 'You', EMBER) +
        link(110, 66, 300, 42, GLOW) +
        link(110, 80, 300, 80, GLOW) +
        link(110, 94, 300, 118, GLOW) +
        person(330, 42, 'F1', GLOW) +
        person(330, 80, 'F2', GLOW) +
        person(330, 118, 'F3', GLOW),
      158,
    ),
  },
  {
    n: '03',
    status: 'now',
    title: 'Your personal hotspot (survives the internet dropping)',
    body: 'Friends near you join your phone’s personal hotspot. The video travels locally between phones, so once you are connected, the stream to the people around you keeps running even if your mobile internet is cut or jammed. Starting from scratch with no internet at all is different: room codes need the internet to introduce you, so use “Pair face to face” — swap two short codes (by QR, or as text over AirDrop / Nearby Share) with each person, as many as you like.',
    svg: svg(
      // internet uplink (may drop) — sits above the local-hotspot box
      note(115, 22, 'internet ✕', '#64748b') +
        link(115, 28, 115, 44, '#64748b', true, '') +
        // the local hotspot: everything inside keeps working with no internet
        `<rect x="40" y="46" width="380" height="116" rx="10" fill="none" stroke="${GLOW}" stroke-width="1.2" stroke-dasharray="5 4"/>` +
        note(112, 63, 'local hotspot', GLOW, 10) +
        person(115, 104, 'You', EMBER) +
        link(145, 96, 317, 82, GLOW) +
        link(145, 112, 317, 124, GLOW) +
        person(345, 82, 'F1', GLOW) +
        person(345, 126, 'F2', GLOW) +
        note(230, 184, 'local video keeps flowing even if the uplink drops', '#64748b'),
      196,
    ),
  },
  {
    n: '04',
    status: 'now',
    title: 'Relay to a safe place',
    body: 'A friend watches nearby and their phone forwards the stream to an always-on device at home, which records it. If a phone at the scene is taken, the footage is already saved somewhere safe. What a phone recorded while it could not reach home follows later — and with no internet at all, recordings can be handed to someone leaving the scene, or sent as a file over AirDrop, Quick Share or Bluetooth. Every copy is checked against its signature when it arrives.',
    svg: svg(
      person(70, 62, 'You', EMBER) +
        link(100, 52, 205, 52, GLOW, false, 'live') +
        person(235, 62, 'Friend', GLOW) +
        link(265, 52, 395, 52, MOSS, false, 'forwarded') +
        home(435, 54, 'Home PC', MOSS) +
        note(235, 118, 'phone can be seized', '#fb7185') +
        note(435, 100, 'copy is safe here', '#6ee7b7') +
        note(335, 140, 'later: recordings, checked on arrival', '#64748b'),
      152,
    ),
  },
  {
    n: '05',
    status: 'partial',
    title: 'Off-grid mesh',
    body: 'No internet and no mobile data at all. Works now: phones on one hotspot pair face to face, and any viewer can “Share onward”, so the picture passes from phone to phone to people out of the filming phone’s reach, while each keeps a signed copy. Recordings can be handed from phone to phone the same way, checked on arrival. Planned for native apps: finding each other over Bluetooth and sending video over direct phone-to-phone Wi-Fi, with no hotspot at all.',
    svg: svg(
      `<rect x="40" y="30" width="440" height="90" rx="10" fill="none" stroke="${GLOW}" stroke-width="1.2" stroke-dasharray="5 4"/>` +
        note(100, 46, 'one hotspot', GLOW, 10) +
        person(90, 78, 'You', EMBER) +
        link(118, 68, 222, 68, GLOW, false, 'code-paired') +
        person(250, 78, 'F1', GLOW) +
        link(278, 68, 402, 68, GLOW, false, 'share onward') +
        person(430, 78, 'F2', GLOW) +
        note(260, 140, 'planned (native): Bluetooth pairing + Wi-Fi Direct, no hotspot', '#64748b'),
      152,
    ),
  },
  {
    n: '06',
    status: 'now',
    title: 'When the website is blocked or seized',
    body: 'The whole app is one file. Pass it on by AirDrop, Bluetooth, a messenger or a USB stick: it opens straight from the file on a computer, and anyone can put it on any website or IPFS as a mirror. Installed copies never update silently — an update must be signed by the developers, and an unsigned one (as a new owner of the domain would publish) raises a warning instead. And if the servers that introduce devices are blocked, pair by messenger: two codes over Signal or SMS, no server at all.',
    svg: svg(
      `<rect x="54" y="40" width="30" height="38" rx="3" fill="none" stroke="${EMBER}" stroke-width="1.6"/>` +
        note(69, 64, 'html', EMBER, 9) +
        note(69, 104, 'one file', '#9fb0d0', 11) +
        link(96, 58, 196, 40, GLOW, false, 'AirDrop / USB') +
        link(96, 62, 196, 96, GLOW, false, 'messenger') +
        person(226, 50, 'F1', GLOW) +
        person(226, 106, 'F2', GLOW) +
        link(256, 40, 386, 58, MOSS, true, 'upload') +
        home(426, 50, 'mirror', MOSS) +
        note(300, 150, 'no website needed · updates must be signed', '#64748b'),
      162,
    ),
  },
  {
    n: '07',
    status: 'now',
    title: 'Reach everyone: amplify',
    body: 'Peer-to-peer reaches people with the app and the code. To reach everyone, any device can push the stream to a broadcast server (WHIP — your own MediaMTX, Owncast, Cloudflare Stream…), which shows it on the open web, no app needed. It does not have to be you: someone watching from a country where the server is reachable can amplify for you, so your phone uploads one stream.',
    svg: svg(
      person(60, 62, 'You', EMBER) +
        link(88, 52, 186, 52, GLOW, false, 'p2p') +
        person(214, 62, 'Friend', GLOW) +
        note(214, 110, 'abroad', '#64748b') +
        link(242, 52, 330, 52, MOSS, false, 'WHIP') +
        home(360, 54, 'server', MOSS) +
        link(384, 48, 470, 30, MOSS, true) +
        link(384, 56, 470, 56, MOSS, true) +
        link(384, 64, 470, 82, MOSS, true) +
        note(440, 110, 'anyone, any browser', '#6ee7b7'),
      132,
    ),
  },
  {
    n: '08',
    status: 'now',
    title: 'Evidence that holds up — even if your phone is taken',
    body: 'Every recording is signed, so any change shows. Sealed recordings are also encrypted as they are recorded: whoever takes the phone cannot watch them or see who is in them — sealed to your home archive, not even the phone can. Friends can carry sealed copies to safety and check they are intact without seeing them. And a timestamp anchored in Bitcoin proves the recording existed by a given time.',
    svg: svg(
      person(60, 62, 'You', EMBER) +
        `<rect x="92" y="44" width="22" height="18" rx="3" fill="none" stroke="#fbbf24" stroke-width="1.5"/>` +
        note(103, 82, 'sealed', '#fbbf24', 9) +
        link(122, 52, 222, 52, GLOW, true, 'carried') +
        person(250, 62, 'Friend', GLOW) +
        note(250, 110, "can't open it", '#64748b') +
        link(278, 52, 386, 52, MOSS, false, 'opened') +
        home(420, 54, 'home', MOSS) +
        note(420, 110, 'timestamped', '#6ee7b7'),
      132,
    ),
  },
  {
    n: '09',
    status: 'now',
    title: 'Every copy checks back to the camera',
    body: 'While you stream, your phone signs a small fingerprint of its picture twice a second, with a key made for this stream only — the share link carries it. Every viewer keeps those signatures with their copy. Later, anyone holding a copy can check it against them: does it show what your camera showed, second by second, and where does it not (a cut, a swap)? It works even when your phone and your own recording are gone.',
    svg: svg(
      person(60, 62, 'You', EMBER) +
        note(60, 110, 'signs each second', '#fbbf24', 9) +
        link(88, 40, 196, 28, GLOW, false) +
        link(88, 62, 196, 84, GLOW, false) +
        person(224, 38, 'Viewer', GLOW) +
        person(224, 96, 'Viewer', GLOW) +
        link(252, 30, 360, 54, MOSS, true) +
        link(252, 88, 360, 58, MOSS, true) +
        note(410, 50, 'copy ✓ matches', '#6ee7b7') +
        note(410, 70, 'the camera', '#6ee7b7'),
      132,
    ),
  },
  {
    n: '10',
    status: 'now',
    title: 'When the network is throttled',
    body: 'Slowing mobile data to a crawl is a quieter way to stop a stream than cutting it. Each viewer’s connection is measured all the time: when it gets slow, that viewer gets a smaller picture; when it is too slow for any picture, sound only — and their copy keeps recording. The picture comes back by itself when the connection recovers. Viewers on good connections keep the full picture.',
    svg: svg(
      person(60, 84, 'You', EMBER) +
        link(88, 76, 222, 28, MOSS, false) +
        link(88, 80, 222, 80, GLOW, true) +
        link(88, 84, 222, 130, '#fbbf24', true) +
        person(250, 32, 'Wi-Fi', MOSS) +
        person(250, 84, '3G', GLOW) +
        person(250, 136, 'throttled', '#fbbf24') +
        note(390, 30, 'full picture · recording', MOSS, 10) +
        note(390, 82, 'small picture · recording', GLOW, 10) +
        note(390, 134, 'sound only · recording', '#fbbf24', 10),
      176,
    ),
  },
]

// --- per-use-case walkthroughs, tailored to the reader's platform ---
type Platform = 'ios' | 'android' | 'desktop'
const PLATFORMS: { id: Platform; label: string }[] = [
  { id: 'ios', label: 'iPhone' },
  { id: 'android', label: 'Android' },
  { id: 'desktop', label: 'Computer' },
]
const PLAT_KEY = 'undepressable_guide_platform'
const platform = ref<Platform>(
  ((): Platform => {
    const s = localStorage.getItem(PLAT_KEY)
    return s === 'ios' || s === 'android' || s === 'desktop' ? s : 'android'
  })(),
)
watch(platform, (p) => {
  try {
    localStorage.setItem(PLAT_KEY, p)
  } catch {
    /* storage blocked */
  }
})

// How you open/install the app — the same across every use case.
const openApp: Record<Platform, string[]> = {
  ios: [
    'Open undepressable in Safari on your iPhone.',
    'Tap the Share button, then “Add to Home Screen”, so it opens full-screen like a normal app.',
    'Launch it from your Home Screen. Allow the camera and microphone if it asks.',
    'Do this while you have internet: afterwards it opens with no connection at all — even if the website is gone.',
  ],
  android: [
    'Open undepressable in Chrome on your Android phone.',
    'Accept Chrome’s “Install app” prompt (or menu → “Add to Home screen”).',
    'Launch it from your app drawer. Allow the camera and microphone if it asks.',
    'Do this while you have internet: afterwards it opens with no connection at all — even if the website is gone.',
  ],
  desktop: [
    'Open undepressable in Chrome, Edge or Firefox.',
    'Optional: click the install icon in the address bar to run it in its own window — it then opens with no connection, even if the website is gone. (There is also a browser-extension build that carries its own copy of the app.)',
    'Allow the camera and microphone if it asks (only needed if this device will stream).',
  ],
}

interface Role {
  who: string
  steps: string[]
}
interface Walk {
  roles: Role[]
  caveat?: Partial<Record<Platform, string>>
}

const walks: Record<string, Walk> = {
  '01': {
    roles: [
      {
        who: 'You — share your stream',
        steps: [
          'Go to the Stream tab.',
          'A room code, a link and a QR code appear.',
          'Send the link to your trusted person, or let them scan the QR.',
          'You’re live. Tap the red button to stop when you’re done.',
        ],
      },
      {
        who: 'Them — watch and keep a copy',
        steps: [
          'Go to the Collect tab.',
          'Scan your QR, paste your link, or type the room code.',
          'Their device starts watching and automatically records a signed copy.',
          'The copy stays under Recordings, even if the connection drops.',
          'If it doesn’t connect, the status card says why. A VPN on one side and mobile data on the other usually need a relay: tap “Set up a relay” (one side is enough, and it travels inside your link). No relay of your own? The app can test free public ones on your network and use those that answer.',
          'If the network blocks the servers that introduce devices, the card offers “Pair by messenger”: swap two codes over any chat app instead of the room code.',
        ],
      },
    ],
  },
  '02': {
    roles: [
      {
        who: 'You — broadcast to the group',
        steps: [
          'Go to the Stream tab and share the one room code or QR with everyone.',
          'The counters at the top show how many people are watching and recording.',
          'Tap the red button to stop when you’re done.',
        ],
      },
      {
        who: 'Everyone watching',
        steps: [
          'Go to Collect and scan the QR or enter the code.',
          'Each person keeps their own independent signed recording — there is no single copy to seize.',
        ],
      },
    ],
  },
  '03': {
    caveat: {
      ios: 'iPhone hotspot: Settings → Personal Hotspot → “Allow Others to Join”. Note: an iPhone hotspot can keep the phones that join it apart from each other — the hotspot phone itself can always reach them. So make the filming phone (or the viewer’s) the hotspot, rather than a third phone.',
      android: 'Android hotspot: Settings → Network & internet → Hotspot & tethering → Wi-Fi hotspot. Android usually lets connected phones reach each other directly.',
      desktop: 'A laptop can share a local network too, but at a scene a phone’s Personal Hotspot is the usual setup — pick iPhone or Android above for the exact steps.',
    },
    roles: [
      {
        who: 'You — host the local stream',
        steps: [
          'Turn on your phone’s Personal Hotspot (see the note above for your phone).',
          'Have the people near you join your hotspot’s Wi-Fi.',
          'Go to Stream and share the room code or QR.',
          'The video now travels phone-to-phone over the hotspot, so it keeps running even if your mobile internet is cut or jammed.',
        ],
      },
      {
        who: 'Each watcher',
        steps: [
          'Join the host’s hotspot Wi-Fi first.',
          'Go to Collect and scan the QR or type the code — this still needs a little internet to introduce the two devices.',
          'If the internet is gone completely, use “Pair face to face” instead: scan the filming phone’s code (or paste it if they sent it as text), then let them read your reply. The filming phone can add several viewers this way, and sees who is recording a copy.',
          'Out of range, or the hotspot is full? Someone already watching taps “Share onward” and you pair with them instead.',
        ],
      },
    ],
  },
  '04': {
    caveat: {
      desktop: 'A home computer is the best archive — it stays on, online, and out of reach at the scene.',
      ios: 'A spare iPhone or iPad can be the archive, but keep the app open, on power, and set Auto-Lock to Never so it doesn’t sleep.',
      android: 'A spare Android phone or tablet can be the archive, but keep the app open, on power, and the screen timeout long so it doesn’t sleep.',
    },
    roles: [
      {
        who: 'At home, before you leave — set up the archive',
        steps: [
          'On the device that stays safe at home, open “Set up a home archive” from the Home screen.',
          'Leave it open and online. It shows a pairing QR and an 8-character code.',
        ],
      },
      {
        who: 'On the phone you take with you — pair once',
        steps: [
          'While you still have a good connection, scan the home archive’s QR (or open its link).',
          'You’ll see “Home archive paired”. That’s it — nothing else to do at the scene.',
        ],
      },
      {
        who: 'At the scene',
        steps: [
          'Use Collect as usual — scan the streamer’s code and watch.',
          'Your phone quietly forwards what it’s watching to your home device, which records and saves it. The Collect screen shows “forwarding ✓” — or says why it can’t reach home.',
          'If your phone is taken, the footage is already safe at home.',
        ],
      },
      {
        who: 'Afterwards — anything that didn’t make it home',
        steps: [
          'Back online: Recordings → “Send to home now” (the home device must have its Home archive screen open). Only what is missing is sent, and each second is checked at home.',
          'No internet: Recordings → share icon → AirDrop, Quick Share, Bluetooth or a USB stick. On the other device: Recordings → Import checks it.',
        ],
      },
    ],
  },
  '05': {
    caveat: {
      ios: 'Works now in the app over a Personal Hotspot. Pairing over Bluetooth and video over direct phone-to-phone Wi-Fi (no hotspot) are planned for a native iPhone app.',
      android: 'Works now in the app over a hotspot. Pairing over Bluetooth and video over Wi-Fi Direct (no hotspot) are planned for a native Android app.',
      desktop: 'A laptop can take part in a chain like a phone — join the same hotspot.',
    },
    roles: [
      {
        who: 'The person filming',
        steps: [
          'Turn on your Personal Hotspot and have the people next to you join it (or all join one phone’s hotspot).',
          'Open “Pair face to face” → I’m filming, and pair with one or two people nearby: they read your code, you read their reply.',
        ],
      },
      {
        who: 'Someone watching who can pass it on',
        steps: [
          'Pair with the filming phone: “Pair face to face” → I’m receiving.',
          'Tap “Share onward”. People further away pair with you the same way and get the picture through you.',
          'If you lose the filming phone and pair again, the people watching through you stay paired and get the picture back.',
        ],
      },
      {
        who: 'Getting footage out',
        steps: [
          'On any paired link, “Hand over my recordings” copies every signed recording on this device to the other one — give it to someone who is leaving.',
          'Or: Recordings → share icon → AirDrop, Quick Share, Bluetooth. The receiver checks it under Recordings → Import.',
          'Once any phone is back online with a paired home archive: Recordings → “Send to home now”.',
        ],
      },
    ],
  },
  '06': {
    caveat: {
      ios: 'An iPhone cannot run the app from a file (Files only previews it). Keep the installed app, or open a mirror someone hosts.',
      android: 'Opening the file from a file manager is unreliable on Android (no camera). Open a mirror, or serve the file with a file-server app.',
      desktop: 'Chrome and Edge run the file straight from disk — camera, streaming and recording included. (Tor Browser turns WebRTC off, so it can show the app but not stream.)',
    },
    roles: [
      {
        who: 'Keep and pass on the app',
        steps: [
          'Home → “Pass the app on” → Share the app… (AirDrop, Bluetooth, messenger) or Save the file.',
          'On a computer, open the file in Chrome or Edge. Or upload it anywhere as index.html — a subfolder, IPFS, anyone’s website — and share that address: it is a full mirror.',
          'The browser extension is another copy the website cannot change.',
        ],
      },
      {
        who: 'If the app warns about an unsigned update',
        steps: [
          'Don’t install it: the website may have been taken over.',
          'Before closing the app, save or send your recordings, and keep a copy of the app from a source you trust.',
          'Network → “This copy of the app” shows the build and fingerprint to compare with published releases.',
        ],
      },
      {
        who: 'If the network looks for WebRTC itself',
        steps: [
          'Network → “Blend in with ordinary web traffic”. It needs a turns: relay on port 443 (yours, or one you were given) — the card says whether one is set up.',
          'From then on the app sends nothing but TLS to port 443: media through the relay, discovery over WSS, no STUN, no direct connections. Slower, and the relay carries everything.',
          'What a watcher can still see — hostnames, the shape of a live stream — is in docs/TRAFFIC.md. Put the relay behind a name that means nothing.',
        ],
      },
      {
        who: 'If devices can’t find each other (“can’t reach any discovery server”)',
        steps: [
          'Open “Pair by messenger” (Home, or the button on the status card).',
          'Send your invite code over Signal, WhatsApp, SMS or e-mail; paste the reply code they send back within a few minutes.',
          'The video goes straight between the devices — or through your relay; no discovery server is involved.',
        ],
      },
    ],
  },
  '07': {
    caveat: {
      desktop: 'A computer on a good connection is the best amplifier: it re-sends the stream once to the server, which serves everyone else.',
    },
    roles: [
      {
        who: 'Whoever runs the broadcast server',
        steps: [
          'Set up a WHIP ingest — e.g. MediaMTX (open source, one binary) or a hosted service — and note its WHIP address and token.',
          'Give the address and token only to the people who should publish to it.',
        ],
      },
      {
        who: 'The amplifier (you, or a friend watching)',
        steps: [
          'While streaming: open the share sheet → “Amplify — broadcast to a server”. While watching: the same panel under the player.',
          'Paste the WHIP address and token → Start broadcasting. It reconnects by itself if the connection drops.',
          'The server sees the video — use one you trust. “Always use the relay” (Network) hides your address from it.',
        ],
      },
    ],
  },
  '08': {
    roles: [
      {
        who: 'Before you go',
        steps: [
          'Pair the phone with your home archive by scanning its QR code (the link carries the archive’s sealing key).',
          'Recordings → Protect recordings → “Seal to my home archive”. Optionally “Lock with a passphrase” too, so you can open them yourself.',
          'Optionally “Timestamp recordings automatically” — or leave it off where contacting public servers could draw attention.',
        ],
      },
      {
        who: 'Afterwards',
        steps: [
          'Send recordings home (Recordings → Send to home now), hand them to a friend, or share them as files. Sealed copies stay sealed on the way; everyone can check they are intact.',
          'At home they open automatically and are checked second by second.',
          'Timestamp them if you haven’t (the ⏱ button); after a few hours “Check now” shows the Bitcoin block. Evidence files then include root.txt and root.txt.ots for the standard “ots verify”.',
        ],
      },
    ],
  },
  '09': {
    roles: [
      {
        who: 'The person filming',
        steps: [
          'Nothing to switch on: the share sheet says “Twice a second this phone signs a fingerprint of its picture” and shows the start of the key.',
          'Share the link (not just the code) where you can: it carries the key, so viewers only accept signatures made with it. Posting the link publicly also shows later which key was yours.',
        ],
      },
      {
        who: 'Viewers',
        steps: [
          'Join through the link. Under the player: “✓ The filming phone signs its picture twice a second — N kept with your copy”.',
          'Your copy carries the signatures wherever it goes: to your home archive, to friends, in evidence files.',
        ],
      },
      {
        who: 'Anyone checking a copy later',
        steps: [
          'Recordings → “🎥 Check against the filmer”. The copy is played through quickly and compared with every signed second.',
          '“✓ Shows what the filming phone’s camera showed: 58 of 60 signed moments match (key 3fa2…)” — and, if some do not, at which times. Compare the key with the one in the stream’s link.',
          'A match means the same picture, not the same bytes: it survives re-encoding, and a picture that hardly changed says less (the result says so).',
        ],
      },
    ],
  },
  '10': {
    roles: [
      {
        who: 'The person filming',
        steps: [
          'Nothing to do. On the camera screen “🐢 1 slow link: 1 sound only” shows who is getting less, and why.',
          'If everyone is slow, your own upload is the bottleneck: fewer direct viewers help — let viewers relay to each other (they do by default).',
        ],
      },
      {
        who: 'Watching on a slow connection',
        steps: [
          'A smaller picture, or “🔊 Sound only — the connection is too slow for the picture right now”. Your copy keeps recording either way.',
          'Don’t reconnect: the picture comes back by itself when the connection allows.',
        ],
      },
    ],
  },
}

const expanded = ref<Set<string>>(new Set())
function toggle(n: string) {
  const s = new Set(expanded.value)
  if (s.has(n)) s.delete(n)
  else s.add(n)
  expanded.value = s
}
</script>
