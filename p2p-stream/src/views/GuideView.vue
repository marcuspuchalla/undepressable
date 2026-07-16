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
      </article>

      <p class="text-xs text-slate-500 text-center px-6 leading-relaxed">
        Diagrams are simplified. “Signed copy” means each recording is hashed and signed so it can be proven unaltered
        — see <RouterLink to="/recordings" class="text-glow">Recordings</RouterLink>.
      </p>
    </div>
  </div>
</template>

<script setup lang="ts">
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
const svg = (inner: string) => `<svg viewBox="0 0 ${W} ${H}" width="100%" style="max-width:520px;display:block;margin:auto">${inner}</svg>`

const cases = [
  {
    n: '01',
    status: 'now',
    title: 'One to one',
    body: 'Hand your stream to a single trusted person. Your phone connects directly to theirs over an encrypted peer-to-peer link — nothing passes through a server. They watch and record a copy.',
    svg: svg(
      person(90, 70, 'You', EMBER) +
        link(120, 60, 400, 60, GLOW, false, 'live + recorded') +
        person(430, 70, 'Friend', GLOW),
    ),
  },
  {
    n: '02',
    status: 'now',
    title: 'One to many',
    body: 'Share the room code with a group. Everyone who joins sees the same live stream and keeps their own independent recording, so there is no single copy to seize. You can see how many are watching and recording.',
    svg: svg(
      person(80, 75, 'You', EMBER) +
        link(110, 55, 300, 30, GLOW) +
        link(110, 70, 300, 70, GLOW) +
        link(110, 85, 300, 112, GLOW) +
        person(330, 40, 'F1', GLOW) +
        person(330, 80, 'F2', GLOW) +
        person(330, 120, 'F3', GLOW),
    ),
  },
  {
    n: '03',
    status: 'now',
    title: 'Your personal hotspot (survives the internet dropping)',
    body: 'Friends near you join your phone’s personal hotspot. The video travels locally between phones, so even if your mobile internet is cut or jammed, the stream to the people around you keeps running. Pair over QR for a fully offline start.',
    svg: svg(
      `<rect x="30" y="18" width="330" height="118" rx="10" fill="none" stroke="${GLOW}" stroke-width="1.2" stroke-dasharray="5 4"/>
       <text x="45" y="34" font-family="ui-monospace,monospace" font-size="10" fill="#7dd3fc">personal hotspot (local)</text>` +
        person(90, 85, 'You', EMBER) +
        link(120, 75, 250, 55, GLOW) +
        link(120, 90, 250, 110, GLOW) +
        person(280, 65, 'F1', GLOW) +
        person(280, 118, 'F2', GLOW) +
        link(90, 55, 90, 26, '#64748b', true, '') +
        `<text x="90" y="20" text-anchor="middle" font-family="ui-monospace,monospace" font-size="9" fill="#64748b">internet</text>` +
        `<text x="200" y="150" text-anchor="middle" font-family="ui-monospace,monospace" font-size="10" fill="#64748b">uplink may drop ✕ — local stream continues</text>`,
    ),
  },
  {
    n: '04',
    status: 'now',
    title: 'Relay to a safe place',
    body: 'A friend watches nearby while their always-on home computer sits in the same room and archives the recording. If a phone at the scene is taken, the footage is already saved somewhere safe. Any trusted device left running can be the archive.',
    svg: svg(
      person(70, 70, 'You', EMBER) +
        link(100, 60, 210, 60, GLOW, false, 'live') +
        person(240, 70, 'Friend', GLOW) +
        link(270, 60, 400, 60, MOSS, false, 'forwarded') +
        home(440, 62, 'Home PC', MOSS) +
        `<text x="240" y="128" text-anchor="middle" font-family="ui-monospace,monospace" font-size="9" fill="#fb7185">phone can be seized</text>
         <text x="440" y="112" text-anchor="middle" font-family="ui-monospace,monospace" font-size="9" fill="#6ee7b7">copy is safe here</text>`,
    ),
  },
  {
    n: '05',
    status: 'planned',
    title: 'Off-grid mesh (planned, native app)',
    body: 'When Wi-Fi and mobile data are both jammed, a future native build could fall back to a phone-to-phone mesh that pairs over Bluetooth and carries video over device-to-device Wi-Fi (Android Nearby Connections / iOS MultipeerConnectivity). Bluetooth alone is too slow for video, so this needs the native app — not the web version.',
    svg: svg(
      person(90, 70, 'You', EMBER) +
        link(120, 60, 240, 60, '#64748b', true, 'BT pair') +
        link(240, 62, 360, 62, MOSS, true, 'wifi-direct video') +
        person(270, 70, 'F1', GLOW) +
        person(400, 70, 'F2', GLOW) +
        `<text x="240" y="128" text-anchor="middle" font-family="ui-monospace,monospace" font-size="10" fill="#64748b">no internet · no access point</text>`,
    ),
  },
]
</script>
