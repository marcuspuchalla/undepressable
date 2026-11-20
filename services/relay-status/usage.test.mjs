import { describe, it, expect } from 'vitest'
import { GB, monthOf, nextMonthStart, emptyState, usedBytes, addCounterReading, setMonthTotal, verdict, prune, sumMetrics } from './usage.mjs'

const NOV = Date.UTC(2026, 10, 19, 12)
const DEC = Date.UTC(2026, 11, 1, 0, 5)

describe('months', () => {
  it('uses UTC calendar months', () => {
    expect(monthOf(NOV)).toBe('2026-11')
    expect(new Date(nextMonthStart(NOV)).toISOString()).toBe('2026-12-01T00:00:00.000Z')
    expect(new Date(nextMonthStart(Date.UTC(2026, 11, 31))).toISOString()).toBe('2027-01-01T00:00:00.000Z')
  })
})

describe('running counters (coturn)', () => {
  it('counts only what is new since the last reading', () => {
    const s = emptyState()
    addCounterReading(s, 'fmp', 5 * GB, NOV) // first reading: a baseline, nothing counted
    addCounterReading(s, 'fmp', 7 * GB, NOV)
    addCounterReading(s, 'fmp', 7.5 * GB, NOV)
    expect(usedBytes(s, 'fmp', NOV)).toBe(2.5 * GB)
  })

  it('treats a lower total as a restart, not as negative traffic', () => {
    const s = emptyState()
    addCounterReading(s, 'fmp', 10 * GB, NOV)
    addCounterReading(s, 'fmp', 12 * GB, NOV)
    addCounterReading(s, 'fmp', 1 * GB, NOV) // restarted, then sent 1 GB
    expect(usedBytes(s, 'fmp', NOV)).toBe(3 * GB)
  })

  it('starts each month at zero', () => {
    const s = emptyState()
    addCounterReading(s, 'fmp', 0, NOV)
    addCounterReading(s, 'fmp', 19 * GB, NOV)
    addCounterReading(s, 'fmp', 19.5 * GB, DEC)
    expect(usedBytes(s, 'fmp', NOV)).toBe(19 * GB)
    expect(usedBytes(s, 'fmp', DEC)).toBe(0.5 * GB)
  })

  it('ignores nonsense readings', () => {
    const s = emptyState()
    addCounterReading(s, 'fmp', 1 * GB, NOV)
    addCounterReading(s, 'fmp', NaN, NOV)
    addCounterReading(s, 'fmp', -5, NOV)
    addCounterReading(s, 'fmp', 2 * GB, NOV)
    expect(usedBytes(s, 'fmp', NOV)).toBe(1 * GB)
  })
})

describe('month totals (Cloudflare analytics)', () => {
  it('never goes backwards within a month', () => {
    const s = emptyState()
    setMonthTotal(s, 'cloudflare', 300 * GB, NOV)
    setMonthTotal(s, 'cloudflare', 290 * GB, NOV)
    expect(usedBytes(s, 'cloudflare', NOV)).toBe(300 * GB)
  })
})

describe('verdict', () => {
  const fmp = { id: 'fmp', label: 'fmp', limitGB: 20, configured: true, measured: 'relay metrics' }

  it('is active under the limit and off at it, until the next month', () => {
    const s = emptyState()
    setMonthTotal(s, 'fmp', 19.99 * GB, NOV)
    expect(verdict(fmp, s, NOV).active).toBe(true)
    setMonthTotal(s, 'fmp', 20 * GB, NOV)
    const v = verdict(fmp, s, NOV)
    expect(v.active).toBe(false)
    expect(v.reason).toBe('monthly limit reached')
    expect(v.resetsAt).toBe('2026-12-01T00:00:00.000Z')
    expect(verdict(fmp, s, DEC).active).toBe(true)
  })

  it('respects the operator switch and a missing configuration', () => {
    const s = emptyState()
    s.disabled.fmp = true
    expect(verdict(fmp, s, NOV).reason).toBe('switched off by the operator')
    expect(verdict({ ...fmp, configured: false }, emptyState(), NOV).active).toBe(false)
  })
})

describe('prune', () => {
  it('keeps this month and the previous one only', () => {
    const s = emptyState()
    s.months = { '2026-09': { fmp: 1 }, '2026-10': { fmp: 2 }, '2026-11': { fmp: 3 } }
    prune(s, NOV)
    expect(Object.keys(s.months).sort()).toEqual(['2026-10', '2026-11'])
  })
})

describe('sumMetrics', () => {
  it('sums every label set of the named metrics and ignores the rest', () => {
    const text = [
      '# HELP turn_total_traffic_sentb Represents total finished sessions sent bytes',
      '# TYPE turn_total_traffic_sentb gauge',
      'turn_total_traffic_sentb 1000',
      'turn_total_traffic_peer_sentb{realm="x"} 250',
      'turn_total_traffic_peer_sentb{realm="y"} 250',
      'turn_total_traffic_rcvb 99999',
    ].join('\n')
    expect(sumMetrics(text, ['turn_total_traffic_sentb', 'turn_total_traffic_peer_sentb'])).toBe(1500)
  })

  it('says null when none of the metrics are there', () => {
    expect(sumMetrics('other 1', ['turn_total_traffic_sentb'])).toBeNull()
  })
})
