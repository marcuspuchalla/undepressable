// The twelve use cases as small animated SVG icons for the README
// (docs/img/use-cases/). Same identity as the app: line art printed in two inks
// — pink and aqua, a little off register, overlapping near white — on indigo
// paper; what moves is in one ink: pink for the live stream, lime for a copy
// kept and verified. Animated SVG rather than GIF: crisp, a few KB, and GitHub
// plays it. Run: node scripts/readme-icons.mjs
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const out = join(dirname(fileURLToPath(import.meta.url)), '../docs/img/use-cases')
mkdirSync(out, { recursive: true })

const PAPER = '#121530'
const RULE = '#2e3466'
const PINK = '#ff4fa0'
const AQUA = '#4fe0d9'
const LIME = '#b5e65a'

// --- drawing helpers (line art, drawn in currentColor) -----------------------
const phone = (x, y, s = 1) =>
  `<rect x="${x - 11 * s}" y="${y - 19 * s}" width="${22 * s}" height="${38 * s}" rx="${4 * s}"/><path d="M${x - 4 * s} ${y + 14 * s}h${8 * s}"/>`
const person = (x, y, s = 1) =>
  `<circle cx="${x}" cy="${y - 9 * s}" r="${6 * s}"/><path d="M${x - 12 * s} ${y + 14 * s}c0-9 ${5 * s}-14 ${12 * s}-14s${12 * s} 5 ${12 * s} 14"/>`
const house = (x, y) => `<path d="M${x - 18} ${y - 2}l18-16 18 16M${x - 13} ${y - 6}v24h26v-24"/>`
const globe = (x, y, r = 14) =>
  `<circle cx="${x}" cy="${y}" r="${r}"/><ellipse cx="${x}" cy="${y}" rx="${r * 0.45}" ry="${r}"/><path d="M${x - r} ${y}h${2 * r}"/>`
const file = (x, y) => `<path d="M${x - 9} ${y - 12}h12l6 6v18h-18z M${x + 3} ${y - 12}v6h6"/>`
const tower = (x, y) => `<path d="M${x} ${y - 20}v40M${x - 12} ${y + 20}l12-28 12 28M${x - 7} ${y + 6}h14"/><circle cx="${x}" cy="${y - 22}" r="3"/>`
const camera = (x, y) => `<rect x="${x - 18}" y="${y - 11}" width="28" height="22" rx="4"/><path d="M${x + 10} ${y - 4}l10-6v20l-10-6"/>`
const doc = (x, y) => `<path d="M${x - 18} ${y - 24}h24l12 12v36h-36z M${x + 6} ${y - 24}v12h12"/><path d="M${x - 11} ${y - 2}h22M${x - 11} ${y + 6}h22M${x - 11} ${y + 14}h14"/>`
const shield = (x, y) => `<path d="M${x} ${y - 26}l22 8v14c0 16-10 26-22 30-12-4-22-14-22-30v-14z"/>`
const line = (x1, y1, x2, y2) => `<path d="M${x1} ${y1}L${x2} ${y2}"/>`

// A pulse that travels a straight segment: a pink dot with a CSS keyframe.
let n = 0
function pulse(x1, y1, x2, y2, { dur = 1.6, delay = 0, color = PINK, r = 3.6 } = {}) {
  const id = `p${n++}`
  return {
    el: `<circle class="${id}" cx="${x1}" cy="${y1}" r="${r}" fill="${color}"/>`,
    css: `.${id}{animation:${id} ${dur}s ${delay}s infinite linear;opacity:0}@keyframes ${id}{0%{transform:translate(0,0);opacity:0}8%{opacity:1}88%{opacity:1}100%{transform:translate(${x2 - x1}px,${y2 - y1}px);opacity:0}}`,
  }
}

function icon(name, title, art, moving = [], extraCss = '') {
  const parts = moving.map((m) => (typeof m === 'string' ? { el: m, css: '' } : m))
  const css = `
    .art{fill:none;stroke-width:3.2;stroke-linecap:round;stroke-linejoin:round}
    .ink{mix-blend-mode:screen}
    ${parts.map((p) => p.css).join('\n')}
    ${extraCss}
    @media (prefers-reduced-motion:reduce){*{animation:none!important}}`
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 160" width="160" height="160" role="img" aria-label="${title}">
  <title>${title}</title>
  <style>${css.replace(/\s+/g, ' ')}</style>
  <rect x="1" y="1" width="158" height="158" rx="22" fill="${PAPER}" stroke="${RULE}" stroke-width="2"/>
  <g class="art ink" stroke="${PINK}" transform="translate(-1.3 -0.7)">${art}</g>
  <g class="art ink" stroke="${AQUA}" transform="translate(1.3 0.7)">${art}</g>
  ${parts.map((p) => p.el).join('\n  ')}
</svg>
`
  writeFileSync(join(out, `${name}.svg`), svg)
  return name
}

// --- the twelve ---------------------------------------------------------------
const made = []

made.push(icon('01-one-to-one', 'One to one: the stream goes straight to one trusted person',
  phone(38, 82) + person(124, 84) + `<path d="M56 82h46" stroke-dasharray="2 7"/>`,
  [pulse(56, 82, 104, 82)]))

{
  const a = pulse(44, 80, 78, 50, { dur: 2 }), b = pulse(44, 80, 78, 110, { dur: 2 })
  const c = pulse(90, 50, 124, 34, { dur: 2, delay: 1 }), d = pulse(90, 50, 124, 66, { dur: 2, delay: 1 })
  const e = pulse(90, 110, 124, 94, { dur: 2, delay: 1 }), f = pulse(90, 110, 124, 126, { dur: 2, delay: 1 })
  made.push(icon('02-one-to-many', 'One to many: viewers pass the stream on, so the phone uploads only a little',
    phone(30, 80, 0.8) + `<circle cx="84" cy="50" r="7"/><circle cx="84" cy="110" r="7"/>` +
      [34, 66, 94, 126].map((y) => `<circle cx="132" cy="${y}" r="6"/>`).join('') +
      line(40, 76, 77, 52) + line(40, 84, 77, 108) + line(91, 48, 126, 35) + line(91, 53, 126, 65) + line(91, 107, 126, 95) + line(91, 113, 126, 125),
    [a, b, c, d, e, f]))
}

made.push(icon('03-hotspot', 'Your personal hotspot: the picture keeps flowing when the internet is cut',
  phone(80, 104) + globe(128, 34, 12) + `<path d="M118 24l20 20M138 24l-20 20" stroke-width="3.6"/>`,
  [
    `<path class="w1" d="M66 74a20 20 0 0 1 28 0" fill="none" stroke="${AQUA}" stroke-width="3.4" stroke-linecap="round"/>`,
    `<path class="w2" d="M58 64a32 32 0 0 1 44 0" fill="none" stroke="${AQUA}" stroke-width="3.4" stroke-linecap="round"/>`,
    `<path class="w3" d="M50 54a44 44 0 0 1 60 0" fill="none" stroke="${AQUA}" stroke-width="3.4" stroke-linecap="round"/>`,
  ],
  `.w1,.w2,.w3{opacity:.15;animation:wave 1.8s infinite ease-out}.w2{animation-delay:.3s}.w3{animation-delay:.6s}@keyframes wave{0%,100%{opacity:.15}30%{opacity:1}}`))

made.push(icon('04-safe-place', 'Relay to a safe place: a friend’s phone forwards the stream to a home computer',
  phone(28, 98, 0.8) + phone(80, 98, 0.8) + house(132, 96) + `<path d="M42 98h24M94 98h22" stroke-dasharray="2 6"/>`,
  [pulse(42, 98, 66, 98, { dur: 2 }), pulse(94, 98, 118, 98, { dur: 2, delay: 1 }),
    `<rect class="win" x="127" y="98" width="10" height="10" rx="2" fill="${LIME}"/>`],
  `.win{opacity:.2;animation:win 2s infinite}@keyframes win{0%,55%{opacity:.2}75%,90%{opacity:1}100%{opacity:.2}}`))

{
  const pts = [[24, 112], [56, 64], [86, 104], [114, 56], [138, 96]]
  const hops = pts.slice(1).map(([x, y], i) => pulse(pts[i][0], pts[i][1], x, y, { dur: 0.7 * 4, delay: i * 0.7 }))
  made.push(icon('05-off-grid', 'Off-grid chains: phones pass the stream hand to hand with no internet',
    pts.map(([x, y]) => `<circle cx="${x}" cy="${y}" r="8"/>`).join('') + pts.slice(1).map(([x, y], i) => line(pts[i][0], pts[i][1], x, y)).join(''),
    hops))
}

made.push(icon('06-website-blocked', 'When the website is blocked: the one-file app passes from phone to phone',
  globe(80, 36, 14) + `<path d="M66 22l28 28M94 22l-28 28" stroke-width="3.6"/>` + phone(36, 110, 0.8) + phone(124, 110, 0.8),
  [`<g class="hop"><path d="M71 94h12l6 6v18h-18z" fill="${PAPER}" stroke="${PINK}" stroke-width="3" stroke-linejoin="round"/></g>`],
  `.hop{animation:hop 2.4s infinite ease-in-out}@keyframes hop{0%{transform:translate(-36px,10px);opacity:0}15%{opacity:1}50%{transform:translate(0,-12px)}85%{opacity:1}100%{transform:translate(36px,10px);opacity:0}}`))

made.push(icon('07-amplify', 'Amplify: any device pushes the stream to a broadcast server, for everyone',
  phone(36, 104, 0.8) + tower(112, 96) + `<path d="M50 104h44" stroke-dasharray="2 6"/>`,
  [pulse(50, 104, 94, 104, { dur: 1.8 }),
    `<path class="r1" d="M126 62a20 20 0 0 1 0 22M98 62a20 20 0 0 0 0 22" fill="none" stroke="${PINK}" stroke-width="3" stroke-linecap="round"/>`,
    `<path class="r2" d="M134 54a32 32 0 0 1 0 38M90 54a32 32 0 0 0 0 38" fill="none" stroke="${PINK}" stroke-width="3" stroke-linecap="round"/>`],
  `.r1,.r2{opacity:.15;animation:r 1.8s infinite}.r2{animation-delay:.35s}@keyframes r{0%,100%{opacity:.15}40%{opacity:1}}`))

made.push(icon('08-evidence', 'Evidence that holds up: signed, sealed and timestamped recordings',
  shield(80, 82) + `<rect x="68" y="80" width="24" height="18" rx="3"/><path d="M73 80v-6a7 7 0 0 1 14 0v6"/>`,
  [`<path class="tick" d="M60 122l12 10 26-24" fill="none" stroke="${LIME}" stroke-width="5" stroke-linecap="round" stroke-linejoin="round" pathLength="1"/>`],
  `.tick{stroke-dasharray:1;stroke-dashoffset:1;animation:tick 2.4s infinite}@keyframes tick{0%,30%{stroke-dashoffset:1}60%,90%{stroke-dashoffset:0}100%{stroke-dashoffset:1}}`))

{
  const ticks = [0, 1, 2].map((i) => pulse(58, 80, 104, 80, { dur: 1.5, delay: i * 0.5, color: PINK, r: 3 }))
  made.push(icon('09-checks-back', 'Every copy checks back to the camera: the phone signs its picture twice a second',
    camera(42, 80) + `<rect x="106" y="58" width="34" height="44" rx="4"/><path d="M106 70h34M106 90h34"/>`,
    [...ticks, `<circle class="ok" cx="123" cy="80" r="5" fill="${LIME}"/>`],
    `.ok{animation:ok .5s infinite}@keyframes ok{0%,100%{opacity:.3}50%{opacity:1}}`))
}

made.push(icon('10-throttled', 'When the network is throttled: a smaller picture, then sound only, then back',
  `<path d="M30 128h100"/>`,
  [
    `<rect class="big" x="34" y="44" width="92" height="62" rx="6" fill="none" stroke="${AQUA}" stroke-width="3.4"/>`,
    `<rect class="small" x="58" y="60" width="44" height="30" rx="5" fill="none" stroke="${AQUA}" stroke-width="3.4"/>`,
    `<g class="sound" fill="none" stroke="${PINK}" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"><path d="M60 68h10l12-10v34l-12-10H60z"/><path d="M92 66a14 14 0 0 1 0 18M100 58a26 26 0 0 1 0 34"/></g>`,
  ],
  `.big,.small,.sound{opacity:0}.big{animation:s1 4.5s infinite}.small{animation:s2 4.5s infinite}.sound{animation:s3 4.5s infinite}
   @keyframes s1{0%,28%{opacity:1}33%,95%{opacity:0}100%{opacity:1}}@keyframes s2{0%,30%{opacity:0}35%,61%{opacity:1}66%,100%{opacity:0}}@keyframes s3{0%,63%{opacity:0}68%,93%{opacity:1}98%,100%{opacity:0}}`))

made.push(icon('11-one-record', 'Many copies, one record: copies from several viewers laid on one clock',
  `<path d="M24 52h40M80 52h56M24 76h70M108 76h28M24 100h18M58 100h78"/>`,
  [`<rect class="merge" x="24" y="120" width="112" height="10" rx="5" fill="${LIME}"/>`],
  `.merge{transform-origin:24px 125px;animation:m 3s infinite ease-in-out}@keyframes m{0%,15%{transform:scaleX(0)}70%,90%{transform:scaleX(1)}100%{transform:scaleX(0)}}`))

made.push(icon('12-checks-itself', 'Evidence that checks itself: every bundle carries verify.html',
  doc(74, 78),
  [`<g class="lens" fill="none" stroke="${AQUA}" stroke-width="3.4" stroke-linecap="round"><circle cx="0" cy="0" r="12"/><path d="M9 9l12 12"/></g>`,
    `<circle class="pass" cx="114" cy="118" r="15" fill="${LIME}"/><path class="pass" d="M107 118l5 5 10-10" fill="none" stroke="${PAPER}" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"/>`],
  `.lens{animation:lens 3s infinite ease-in-out}@keyframes lens{0%{transform:translate(58px,60px)}25%{transform:translate(88px,70px)}50%{transform:translate(62px,92px)}75%,100%{transform:translate(90px,96px)}}
   .pass{opacity:0;animation:pass 3s infinite}@keyframes pass{0%,70%{opacity:0}78%,96%{opacity:1}100%{opacity:0}}`))

console.log(`wrote ${made.length} icons to docs/img/use-cases/`)
