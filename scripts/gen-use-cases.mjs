// docs/USE_CASES.md from the app's own guide (src/views/GuideView.vue):
// the twelve use cases, their status, and the step-by-step walkthroughs the
// app shows for each platform. Run with `npm run docs:use-cases`; edit the
// guide, not the generated file.
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath, pathToFileURL } from 'node:url'
import ts from 'typescript'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const sfc = readFileSync(join(root, 'src/views/GuideView.vue'), 'utf8')
const script = sfc.match(/<script setup lang="ts">([\s\S]*?)<\/script>/)?.[1]
if (!script) throw new Error('GuideView.vue: no <script setup> block')

// The guide's data, evaluated outside Vue: imports dropped, the few runtime
// bits it touches at load stubbed, the data exported.
const source =
  'const ref = (v) => ({ value: v }); const watch = () => {}; const localStorage = { getItem: () => null, setItem: () => {} };\n' +
  script.replace(/^import .*$/gm, '') +
  '\nexport { cases, walks, openApp, PLATFORMS }\n'
const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText
const tmp = join(mkdtempSync(join(tmpdir(), 'und-guide-')), 'guide.mjs')
writeFileSync(tmp, js)
const { cases, walks, openApp, PLATFORMS } = await import(pathToFileURL(tmp).href)

const STATUS = { now: '✅ works now', partial: '🟡 partly now', planned: '⬜ planned' }
const slug = (s) => s.toLowerCase().replace(/[^\w\s-]/g, '').replace(/\s/g, '-')
const heading = (uc) => `${uc.n}. ${uc.title}`
const out = []
out.push('# Ways to use it')
out.push('')
out.push(
  'The twelve use cases from the app\'s own guide (Home → *Ways to use it*), with',
  'the step-by-step walkthrough the app shows for each one on an iPhone, an',
  'Android phone and a computer. The short version is in the',
  '[README](../README.md#ways-to-use-it); what each use case resists and what it',
  'does not is in [THREAT_MODEL.md](THREAT_MODEL.md).',
  '',
  `Status: ${Object.values(STATUS).join(' · ')}.`,
  '',
  '> Generated from `src/views/GuideView.vue` by `npm run docs:use-cases` — the app',
  '> and this file say the same thing. Edit the guide, then regenerate.',
  '',
)
out.push('## Contents', '')
for (const uc of cases) out.push(`- [${heading(uc)}](#${slug(heading(uc))}) — ${STATUS[uc.status]}`)
out.push('', '## Open the app', '', 'The same first steps for every use case.', '')
for (const p of PLATFORMS) {
  out.push(`**${p.label}**`, '')
  openApp[p.id].forEach((s, i) => out.push(`${i + 1}. ${s}`))
  out.push('')
}
for (const uc of cases) {
  out.push(`## ${heading(uc)}`, '', `*${STATUS[uc.status]}*`, '', uc.body, '')
  const walk = walks[uc.n]
  if (!walk) continue
  if (walk.caveat) {
    for (const p of PLATFORMS) {
      const c = walk.caveat[p.id]
      if (c) out.push(`> **${p.label}:** ${c}`, '>')
    }
    out.pop()
    out.push('')
  }
  for (const role of walk.roles) {
    out.push(`**${role.who}**`, '')
    role.steps.forEach((s, i) => out.push(`${i + 1}. ${s}`))
    out.push('')
  }
}
const target = join(root, 'docs/USE_CASES.md')
writeFileSync(target, out.join('\n').replace(/\n{3,}/g, '\n\n'))
console.log(`${target}: ${cases.length} use cases, ${Object.keys(walks).length} walkthroughs`)
