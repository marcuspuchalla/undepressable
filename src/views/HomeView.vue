<template>
  <div class="h-full overflow-y-auto">
    <!-- Hero: the headline printed twice, in two inks, settling into register -->
    <section class="mx-auto max-w-6xl px-5 pt-9 pb-12 sm:px-8 lg:pt-20 lg:pb-20 grid gap-12 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)] lg:items-center">
      <div>
        <h1 class="hero-title font-display text-print" :class="{ settled }">
          <span class="sr-only">Live truth that can't be erased</span>
          <span class="hero-copies" aria-hidden="true">
            <span class="copy copy-pink">Live truth that can't be erased<sup class="footnote-mark">✳</sup></span>
            <span class="copy copy-aqua">Live truth that can't be erased<sup class="footnote-mark">✳</sup></span>
          </span>
        </h1>
        <a href="#erasable-footnote" class="sr-only focus:not-sr-only focus:inline-block focus:mt-2 text-sm text-ember">Footnote</a>

        <p class="mt-6 max-w-[36ch] text-lg leading-relaxed text-slate-300 sm:text-xl">
          Stream from your phone straight to people you trust. Each of them keeps a signed copy, so one seized phone or
          one takedown can't make the footage disappear.
        </p>

        <div class="mt-8 flex flex-col gap-3 sm:flex-row sm:max-w-lg">
          <RouterLink to="/stream" class="btn-emergency go-live text-base py-3.5 px-6 sm:flex-1">
            <span class="live-dot" aria-hidden="true" />
            Go live
          </RouterLink>
          <RouterLink to="/collect" class="btn-secondary text-base py-3.5 px-6 sm:flex-1">
            <svg class="w-5 h-5 mr-2 text-glow" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v1m6 11h2m-6 0h-2v4h2v-4zM6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
            Scan &amp; collect
          </RouterLink>
        </div>

        <div class="mt-5 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
          <span v-if="offline.canWorkOffline.value" class="inline-flex items-center gap-2" :class="offline.isOffline.value ? 'text-moss' : 'text-slate-400'">
            <span class="w-2 h-2 rounded-full" :class="offline.isOffline.value ? 'bg-moss' : 'bg-glow'" aria-hidden="true" />
            {{ offline.isOffline.value ? 'Offline and ready' : 'Works offline too' }}
          </span>
          <button
            v-if="offline.canInstall.value"
            class="font-semibold text-moss hover:underline underline-offset-4"
            title="Keeps working with no internet, and even if this website goes away"
            @click="offline.install()"
          >
            Install app
          </button>
          <button class="text-slate-400 hover:text-print underline-offset-4 hover:underline" @click="shareModal?.open()">
            Share this app
          </button>
        </div>

        <p v-if="offline.canWorkOffline.value && offline.persistence.value === 'best-effort'" class="mt-3 max-w-md text-xs leading-relaxed text-slate-500">
          This browser may clear the app and its recordings when space runs low. Installing the app, or recording once,
          asks it to keep them.
        </p>
      </div>

      <!-- One stream, many copies -->
      <figure class="copies-figure" :class="{ settled }">
        <div class="relative mx-auto aspect-[4/3.4] w-full max-w-[26rem]">
          <div v-for="(c, i) in copies" :key="c.where" class="print" :style="{ '--i': i }">
            <!-- Label on top, so every copy in the stack stays readable. -->
            <div class="flex items-baseline justify-between gap-3 px-1 pb-2.5">
              <span class="text-sm font-semibold text-print">{{ c.where }}</span>
              <span class="tabular-nums text-xs text-slate-400">signed {{ c.key }}</span>
            </div>
            <div class="print-frame" :class="i % 2 ? 'halftone-aqua' : 'halftone-pink'">
              <span v-if="i === copies.length - 1" class="print-live"><span class="live-dot" aria-hidden="true" />Live 00:42</span>
            </div>
          </div>
        </div>
        <figcaption class="mx-auto mt-6 max-w-[26rem] text-sm leading-relaxed text-slate-400">
          One stream, many copies. Each one is recorded and signed by the device that holds it, so anyone can check it
          was never altered.
        </figcaption>
      </figure>
    </section>

    <!-- When something gets in the way -->
    <section class="border-t border-line/70">
      <div class="mx-auto max-w-6xl px-5 py-12 sm:px-8 lg:py-16">
        <h2 class="text-2xl font-bold sm:text-3xl">When something gets in the way</h2>
        <ul class="mt-6 grid gap-x-10 sm:grid-cols-2">
          <li v-for="w in ways" :key="w.to" class="border-t border-line/70 first:border-t-0 sm:[&:nth-child(2)]:border-t-0">
            <RouterLink :to="w.to" class="group flex items-start gap-4 py-5">
              <span class="mt-0.5 flex h-10 w-10 flex-none items-center justify-center rounded-full border" :class="w.ring">
                <svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" :d="w.icon" /></svg>
              </span>
              <span>
                <span class="block text-sm text-slate-400">{{ w.when }}</span>
                <span class="block text-lg font-semibold text-print group-hover:underline underline-offset-4 decoration-2" :class="w.decoration">{{ w.action }}</span>
              </span>
            </RouterLink>
          </li>
        </ul>
      </div>
    </section>

    <!-- The flow — a real sequence, so it is numbered -->
    <section class="border-t border-line/70 bg-night/40">
      <div class="mx-auto max-w-6xl px-5 py-12 sm:px-8 lg:py-16">
        <div class="flex flex-wrap items-baseline justify-between gap-3">
          <h2 class="text-2xl font-bold sm:text-3xl">From one phone to many copies</h2>
          <RouterLink to="/guide" class="text-sm font-semibold text-glow hover:underline underline-offset-4">All the ways to use it</RouterLink>
        </div>
        <ol class="mt-8 grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
          <li v-for="(s, i) in steps" :key="s.title">
            <span class="step-number" :class="i === steps.length - 1 ? 'step-kept' : ''" aria-hidden="true">{{ i + 1 }}</span>
            <h3 class="mt-2 text-lg font-semibold">{{ s.title }}</h3>
            <p class="mt-1.5 text-sm leading-relaxed text-slate-400">{{ s.body }}</p>
          </li>
        </ol>
      </div>
    </section>

    <!-- The app spreads without any website: a tear-off ticket -->
    <section class="border-t border-line/70">
      <div class="mx-auto max-w-6xl px-5 py-12 sm:px-8 lg:py-16">
        <div class="ticket" data-testid="pass-app-on">
          <div class="max-w-2xl">
            <h2 class="text-2xl font-bold sm:text-3xl">Pass the app on</h2>
            <p class="mt-3 leading-relaxed text-slate-300">
              The whole app is a single file. Send it by AirDrop, Bluetooth, a messenger or a USB stick. It runs straight
              from the file in Chrome or Edge on a computer, and anyone can put it on a website or IPFS as a mirror. No
              website of ours is needed, so taking one down stops nothing.
            </p>
          </div>
          <div class="mt-6 flex flex-wrap gap-3">
            <button class="btn-primary py-2.5 px-5" :disabled="shareApp.busy.value" data-testid="share-app" @click="shareApp.share()">Share the app</button>
            <button class="btn-secondary py-2.5 px-5" :disabled="shareApp.busy.value" data-testid="save-app" @click="shareApp.download()">Save the file</button>
          </div>
          <p v-if="shareApp.note.value" class="mt-3 text-sm text-yellow-200">{{ shareApp.note.value }}</p>
        </div>
      </div>
    </section>

    <footer class="border-t border-line/70">
      <div class="mx-auto max-w-6xl px-5 py-10 sm:px-8 grid gap-6 text-sm leading-relaxed text-slate-400 md:grid-cols-[1fr_auto] md:items-start">
        <div class="max-w-2xl space-y-3">
          <p>
            Built for human-rights documentation, community accountability and public-interest reporting. It is designed
            to stop censorship and data loss, not to incite harm. Know your local laws and put safety first.
          </p>
          <p>
            Free and open source. The code, the threat model and every test:
            <a href="https://github.com/marcuspuchalla/undepressable" target="_blank" rel="noopener" class="font-semibold text-glow hover:underline underline-offset-4" data-testid="repo-link">github.com/marcuspuchalla/undepressable</a>.
            A desktop build with no browser limits comes from <code class="text-slate-300">npm run tauri:build</code>.
          </p>
        </div>
        <!-- Self-undercutting footnote: the irony the whole project lives with. -->
        <p id="erasable-footnote" class="max-w-xs border-l-2 border-ember/70 pl-4 text-slate-500">
          <span class="text-ember">✳</span> Assuming anyone still trusts their own eyes. In <cite class="not-italic">1984</cite>,
          rejecting “the evidence of your eyes and ears” was the Party's final, most essential command.
        </p>
      </div>
    </footer>

    <ShareModal ref="shareModal" />
  </div>
</template>

<script setup lang="ts">
import { useShareApp } from '../composables/useShareApp'
import { onMounted, ref } from 'vue'
import { useOffline } from '../composables/useOffline'
import ShareModal from '../components/ShareModal.vue'

const offline = useOffline()
const shareApp = useShareApp()
const shareModal = ref<InstanceType<typeof ShareModal>>()

// One orchestrated moment: on arrival the two inks slide into register and the
// copies fan out from the stack.
const settled = ref(false)
onMounted(() => requestAnimationFrame(() => requestAnimationFrame(() => (settled.value = true))))

// Illustrative: who might hold copies of one stream. The last one is live.
const copies = [
  { where: 'Home archive', key: '7c19 e04b' },
  { where: 'Maya, 2 km away', key: 'b82d 51f6' },
  { where: 'Your phone', key: '4f2a 91c0' },
]

const ways = [
  {
    when: 'No internet at all',
    action: 'Pair face to face',
    to: '/offline',
    ring: 'border-glow/40 text-glow',
    decoration: 'decoration-glow',
    icon: 'M18.364 5.636a9 9 0 010 12.728M5.636 18.364a9 9 0 010-12.728M12 12h.01M3 3l18 18',
  },
  {
    when: 'The servers are blocked',
    action: 'Pair by messenger',
    to: '/offline?over=internet',
    ring: 'border-glow/40 text-glow',
    decoration: 'decoration-glow',
    icon: 'M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z',
  },
  {
    when: "It won't connect",
    action: 'Check your network',
    to: '/network',
    ring: 'border-slate-500/50 text-slate-300',
    decoration: 'decoration-slate-400',
    icon: 'M8.111 16.404a5.5 5.5 0 017.778 0M12 20h.01m-7.08-7.071c3.904-3.905 10.236-3.905 14.141 0M1.394 9.393c5.857-5.857 15.355-5.857 21.213 0',
  },
  {
    when: 'Your phone might be taken',
    action: 'Keep a copy at home',
    to: '/archive',
    ring: 'border-moss/50 text-moss',
    decoration: 'decoration-moss',
    icon: 'M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6',
  },
]

const steps = [
  { title: 'Start a stream', body: 'You get a short code and a QR. No account, and no server of ours in between.' },
  { title: 'People you trust join', body: 'They scan the QR or type the code. Anyone who arrives late still gets the live picture.' },
  { title: 'Everyone keeps a copy', body: 'Each device records and signs its own copy. You see how many are watching and recording.' },
  { title: 'The record outlives the moment', body: 'If your phone is taken, the footage already lives on theirs.' },
]
</script>

<style scoped>
/* The headline, printed twice: pink and aqua copies in additive light. Where
   they overlap the type reads near white; at the edges each ink shows. */
.hero-title {
  font-weight: 800;
  font-stretch: 78%;
  font-size: clamp(3.1rem, 13vw, 6.75rem);
  line-height: 0.92;
  letter-spacing: -0.008em;
}

.hero-copies {
  display: inline-grid;
}

.copy {
  grid-area: 1 / 1;
  mix-blend-mode: screen;
  transition: transform 1100ms cubic-bezier(0.2, 0.8, 0.2, 1);
}

.copy-pink {
  color: theme("colors.ember");
  transform: translate(-0.09em, -0.04em);
}

.copy-aqua {
  color: theme("colors.glow");
  transform: translate(0.09em, 0.04em);
}

.settled .copy-pink {
  transform: translate(-0.018em, -0.01em);
}

.settled .copy-aqua {
  transform: translate(0.018em, 0.01em);
}

.footnote-mark {
  margin-left: 0.06em;
  top: -1.1em;
  font-size: 0.32em;
  font-weight: 400;
  font-stretch: 100%;
}

.go-live {
  box-shadow: theme("boxShadow.print");
}

.live-dot {
  width: 0.6rem;
  height: 0.6rem;
  margin-right: 0.6rem;
  border-radius: 9999px;
  background: currentColor;
  animation: live 1.6s ease-in-out infinite;
}

@keyframes live {
  50% {
    opacity: 0.35;
  }
}

/* The stack of copies: each a print, a little askew. */
.print {
  position: absolute;
  inset: auto 0 0 0;
  margin: 0 auto;
  width: 82%;
  padding: 0.7rem 0.7rem 0.8rem;
  border-radius: 0.6rem;
  background: theme("colors.haze");
  border: 1px solid theme("colors.line");
  box-shadow: theme("boxShadow.print");
  transform: translate(0, 0) rotate(0deg);
  transition: transform 1100ms cubic-bezier(0.2, 0.8, 0.2, 1);
  transition-delay: calc(var(--i) * 90ms);
}

.settled .print:nth-child(1) {
  transform: translate(-9%, -48%) rotate(-5deg);
}

.settled .print:nth-child(2) {
  transform: translate(8%, -24%) rotate(3.5deg);
}

.settled .print:nth-child(3) {
  transform: translate(-2%, 0) rotate(-1deg);
}

.print-frame {
  position: relative;
  aspect-ratio: 16 / 9;
  border-radius: 0.35rem;
  background-color: theme("colors.ink");
  overflow: hidden;
}

/* A crude printed "scene" under the dots: a horizon of figures. */
.print-frame::before {
  content: "";
  position: absolute;
  inset: 0;
  background:
    radial-gradient(circle at 18% 62%, theme("colors.ink") 0 9%, transparent 9.5%),
    radial-gradient(circle at 34% 58%, theme("colors.ink") 0 8%, transparent 8.5%),
    radial-gradient(circle at 52% 64%, theme("colors.ink") 0 10%, transparent 10.5%),
    radial-gradient(circle at 70% 57%, theme("colors.ink") 0 8.5%, transparent 9%),
    radial-gradient(circle at 86% 63%, theme("colors.ink") 0 9%, transparent 9.5%),
    linear-gradient(to top, theme("colors.ink") 0 28%, transparent 28%);
}

.print-live {
  position: absolute;
  top: 0.5rem;
  left: 0.5rem;
  display: inline-flex;
  align-items: center;
  padding: 0.15rem 0.5rem;
  border-radius: 9999px;
  background: theme("colors.ember");
  color: theme("colors.ink");
  font-size: 0.72rem;
  font-weight: 700;
}

.print-live .live-dot {
  width: 0.45rem;
  height: 0.45rem;
  margin-right: 0.35rem;
}

.step-number {
  display: block;
  font-size: 3.25rem;
  font-weight: 800;
  font-stretch: 75%;
  line-height: 1;
  color: transparent;
  -webkit-text-stroke: 1.5px theme("colors.glow");
}

.step-kept {
  -webkit-text-stroke-color: theme("colors.moss");
}

/* A ticket with a perforated tear-off edge. */
.ticket {
  position: relative;
  padding: 1.75rem 1.5rem 1.75rem 2.25rem;
  border-radius: 1rem;
  background: theme("colors.night");
  border: 1px solid theme("colors.line");
}

.ticket::before {
  content: "";
  position: absolute;
  top: 1rem;
  bottom: 1rem;
  left: 0.9rem;
  border-left: 2px dashed theme("colors.ember");
  opacity: 0.75;
}

@media (min-width: 640px) {
  .ticket {
    padding: 2.25rem 2.25rem 2.25rem 3.25rem;
  }

  .ticket::before {
    left: 1.4rem;
  }
}

@media (prefers-reduced-motion: reduce) {
  .copy,
  .print {
    transition: none;
  }

  .live-dot {
    animation: none;
  }
}
</style>
