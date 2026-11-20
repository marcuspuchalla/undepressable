// The status page: this month's usage per relay, in the app's colours.
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export function renderPage({ verdicts, errors, lastPoll, providers }) {
  const rows = verdicts
    .map((v) => {
      const p = providers.find((x) => x.id === v.id);
      const pct = Math.min(100, (v.usedGB / v.limitGB) * 100);
      const state = !p.configured ? 'Not set up' : v.active ? 'On' : 'Off';
      const tone = !p.configured ? 'muted' : v.active ? 'on' : 'off';
      return `<section class="relay">
  <div class="head"><h2>${esc(v.label)}</h2><span class="state ${tone}">${state}</span></div>
  <div class="bar"><span style="width:${pct.toFixed(1)}%" class="${pct >= 90 ? 'hot' : ''}"></span></div>
  <p class="figures"><b>${v.usedGB.toFixed(2)} GB</b> of ${v.limitGB} GB this month · resets ${esc(v.resetsAt.slice(0, 10))}</p>
  <p class="note">Measured: ${esc(v.measured)}${v.reason && p.configured ? ` · ${esc(v.reason)}` : ''}</p>
  ${errors[v.id] ? `<p class="error">Last check failed: ${esc(errors[v.id])}</p>` : ''}
</section>`;
    })
    .join('\n');
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><title>Relay status · Undepressable</title>
<style>
  :root{--paper:#121530;--panel:#171b3b;--line:#2e3466;--print:#f4f2ff;--muted:#94a3b8;--pink:#ff4fa0;--aqua:#4fe0d9;--lime:#b5e65a}
  *{box-sizing:border-box}
  body{margin:0;background:var(--paper);color:var(--print);font:16px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
  main{max-width:42rem;margin:0 auto;padding:2.5rem 1.25rem 3rem}
  h1{font-size:2rem;font-weight:800;margin:0;letter-spacing:-.01em}
  .rule{display:block;width:2.75rem;height:.3rem;border-radius:9px;background:var(--pink);margin:.8rem 0 1rem;position:relative}
  .rule::after{content:"";position:absolute;inset:0;border-radius:9px;background:var(--aqua);mix-blend-mode:screen;transform:translate(.35rem,.18rem)}
  .lead{color:#cbd5e1;margin:0 0 1.75rem}
  .relay{background:var(--panel);border:1px solid var(--line);border-radius:.9rem;padding:1rem 1.1rem;margin-bottom:1rem}
  .head{display:flex;justify-content:space-between;align-items:center;gap:1rem}
  h2{font-size:1.1rem;margin:0}
  .state{font-size:.8rem;font-weight:600;border:1px solid;border-radius:999px;padding:.05rem .6rem}
  .on{color:var(--lime)} .off{color:var(--pink)} .muted{color:var(--muted)}
  .bar{height:.5rem;background:#1e2348;border-radius:9px;margin:.9rem 0 .5rem;overflow:hidden}
  .bar span{display:block;height:100%;background:var(--aqua)} .bar span.hot{background:var(--pink)}
  .figures{margin:0;font-size:.95rem} .note{margin:.25rem 0 0;color:var(--muted);font-size:.85rem}
  .error{margin:.4rem 0 0;color:#fca5a5;font-size:.85rem}
  footer{color:var(--muted);font-size:.85rem;margin-top:1.5rem}
</style></head>
<body><main>
<h1>Relay status</h1><span class="rule" aria-hidden="true"></span>
<p class="lead">The relays built into Undepressable, and how much each has carried this month. Each one switches off
at its limit until the first of next month, so none of them ever costs money.</p>
${rows}
<footer>Last checked ${lastPoll ? esc(new Date(lastPoll).toISOString().replace('T', ' ').slice(0, 16)) + ' UTC' : 'not yet'}.
This service keeps no record of who asks it.</footer>
</main></body></html>`;
}
