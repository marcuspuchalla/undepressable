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
            :class="uc.status === 'now' ? 'bg-moss/10 text-moss' : 'bg-slate-500/10 text-slate-400'"
          >{{ uc.status === 'now' ? 'WORKS NOW' : 'PLANNED' }}</span>
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

const cases = [
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
    body: 'Share the room code with a group. Everyone who joins sees the same live stream and keeps their own independent recording, so there is no single copy to seize. You can see how many are watching and recording.',
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
    body: 'A friend watches nearby while their always-on home computer sits in the same room and archives the recording. If a phone at the scene is taken, the footage is already saved somewhere safe. Any trusted device left running can be the archive.',
    svg: svg(
      person(70, 62, 'You', EMBER) +
        link(100, 52, 205, 52, GLOW, false, 'live') +
        person(235, 62, 'Friend', GLOW) +
        link(265, 52, 395, 52, MOSS, false, 'forwarded') +
        home(435, 54, 'Home PC', MOSS) +
        note(235, 118, 'phone can be seized', '#fb7185') +
        note(435, 100, 'copy is safe here', '#6ee7b7'),
      132,
    ),
  },
  {
    n: '05',
    status: 'planned',
    title: 'Off-grid mesh (planned, native app)',
    body: 'When Wi-Fi and mobile data are both jammed, a future native build could fall back to a phone-to-phone mesh that pairs over Bluetooth and carries video over device-to-device Wi-Fi (Android Nearby Connections / iOS MultipeerConnectivity). Bluetooth alone is too slow for video, so this needs the native app — not the web version.',
    svg: svg(
      person(80, 62, 'You', EMBER) +
        link(108, 52, 222, 52, '#64748b', true, 'BT pair') +
        person(250, 62, 'F1', GLOW) +
        link(278, 52, 402, 52, MOSS, true, 'wi-fi direct') +
        person(430, 62, 'F2', GLOW) +
        note(255, 118, 'no internet · no access point', '#64748b'),
      132,
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
  ],
  android: [
    'Open undepressable in Chrome on your Android phone.',
    'Accept Chrome’s “Install app” prompt (or menu → “Add to Home screen”).',
    'Launch it from your app drawer. Allow the camera and microphone if it asks.',
  ],
  desktop: [
    'Open undepressable in Chrome, Edge or Firefox.',
    'Optional: click the install icon in the address bar to run it in its own window.',
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
          'If it doesn’t connect, the status card says why. A VPN on one side and mobile data on the other usually need a relay: tap “Set up a relay” (one side is enough, and it travels inside your link).',
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
    ],
  },
  '05': {
    caveat: {
      ios: 'Planned for the native iPhone app (MultipeerConnectivity). The web version can’t do this yet.',
      android: 'Planned for the native Android app (Nearby Connections / Wi-Fi Aware). The web version can’t do this yet.',
      desktop: 'Not applicable — this is a phone-to-phone mode for when there’s no network at all.',
    },
    roles: [
      {
        who: 'How it will work (not built yet)',
        steps: [
          'Install the native app — not the web version.',
          'Open it near the people you’re streaming to.',
          'It pairs with nearby phones over Bluetooth, then carries the video over device-to-device Wi-Fi.',
          'No internet and no Wi-Fi router needed. Bluetooth alone is too slow for video, which is why this needs the native build.',
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
