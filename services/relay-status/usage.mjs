// Monthly usage accounting for the relays, and the verdict that follows from it.
// Pure: no I/O, so every rule here is unit-tested (usage.test.mjs).
//
// Months are calendar months in UTC: a relay over its limit stays off until the
// first of the next month, 00:00 UTC.

export const GB = 1e9;

/** "2026-11" */
export function monthOf(now) {
  const d = new Date(now);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** The first moment of the next month, UTC. */
export function nextMonthStart(now) {
  const d = new Date(now);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1);
}

/** The first moment of this month, UTC. */
export function monthStart(now) {
  const d = new Date(now);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
}

export function emptyState() {
  return { months: {}, counters: {}, manual: {}, disabled: {} };
}

/** Bytes counted for a provider this month. */
export function usedBytes(state, id, now) {
  return state.months[monthOf(now)]?.[id] ?? 0;
}

function setMonthly(state, id, bytes, now) {
  const m = monthOf(now);
  state.months[m] ??= {};
  state.months[m][id] = bytes;
}

/**
 * A relay that reports a running total since it started (coturn's metrics).
 * Adds what is new since the last reading; a total that went down means the
 * relay restarted, so the whole new total is new traffic.
 */
export function addCounterReading(state, id, total, now) {
  if (!Number.isFinite(total) || total < 0) return state;
  const last = state.counters[id];
  const delta = last === undefined ? 0 : total >= last ? total - last : total;
  state.counters[id] = total;
  setMonthly(state, id, usedBytes(state, id, now) + delta, now);
  return state;
}

/** A provider that reports this month's total itself (Cloudflare's analytics). */
export function setMonthTotal(state, id, bytes, now) {
  if (!Number.isFinite(bytes) || bytes < 0) return state;
  // Never go backwards within a month: analytics can briefly undercount.
  setMonthly(state, id, Math.max(bytes, usedBytes(state, id, now)), now);
  return state;
}

/**
 * Whether a provider may be handed out right now: configured, not switched
 * off by the admin, and under its limit for this month.
 */
export function verdict(provider, state, now) {
  const used = usedBytes(state, provider.id, now);
  const limit = provider.limitGB * GB;
  const reasons = [];
  if (!provider.configured) reasons.push('not configured');
  if (state.disabled[provider.id]) reasons.push('switched off by the operator');
  if (used >= limit) reasons.push('monthly limit reached');
  return {
    id: provider.id,
    label: provider.label,
    active: reasons.length === 0,
    reason: reasons.join(', ') || null,
    usedGB: Math.round((used / GB) * 100) / 100,
    limitGB: provider.limitGB,
    resetsAt: new Date(nextMonthStart(now)).toISOString(),
    measured: provider.measured,
  };
}

/** Drop months older than the previous one: the state file stays small. */
export function prune(state, now) {
  const keep = new Set([monthOf(now), monthOf(monthStart(now) - 1)]);
  for (const m of Object.keys(state.months)) if (!keep.has(m)) delete state.months[m];
  return state;
}

/** Sum of the named metrics in Prometheus text format (all label sets). */
export function sumMetrics(text, names) {
  let total = 0;
  let seen = false;
  for (const line of String(text).split('\n')) {
    if (!line || line.startsWith('#')) continue;
    const m = /^([a-zA-Z_:][a-zA-Z0-9_:]*)(\{[^}]*\})?\s+([0-9.eE+-]+)/.exec(line);
    if (m && names.includes(m[1])) {
      const v = Number(m[3]);
      if (Number.isFinite(v)) {
        total += v;
        seen = true;
      }
    }
  }
  return seen ? total : null;
}
