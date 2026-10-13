/**
 * Perceptual fingerprints of video frames: two 64-bit hashes (difference and
 * average hash) of a 64×64 grayscale thumbnail. Unlike a cryptographic hash,
 * they stay nearly the same when a frame is re-encoded, rescaled or slightly
 * recoloured — which is what happens to the picture on its way from the
 * person filming to each viewer — while different scenes differ in many bits.
 *
 * Kept free of the DOM: the browser part only has to produce the 64×64 RGBA
 * pixels (lib/corroborate/frames.ts).
 */

export const THUMB = 64
/**
 * A bit is set only when brightness differs by more than this (of 255): flat
 * areas — sky, a wall, a dark frame — then read the same on both ends instead
 * of flipping with encoder noise.
 */
const MARGIN = 2

/** Grayscale (Rec. 601 luma) of an RGBA buffer. */
function luma(rgba: ArrayLike<number>, n: number): Float64Array {
  const out = new Float64Array(n)
  for (let i = 0; i < n; i++) out[i] = 0.299 * rgba[i * 4] + 0.587 * rgba[i * 4 + 1] + 0.114 * rgba[i * 4 + 2]
  return out
}

/** Box-average a w×h grayscale image down to cols×rows. */
function shrink(g: Float64Array, w: number, h: number, cols: number, rows: number): Float64Array {
  const out = new Float64Array(cols * rows)
  for (let r = 0; r < rows; r++) {
    const y0 = Math.floor((r * h) / rows)
    const y1 = Math.floor(((r + 1) * h) / rows)
    for (let c = 0; c < cols; c++) {
      const x0 = Math.floor((c * w) / cols)
      const x1 = Math.floor(((c + 1) * w) / cols)
      let sum = 0
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) sum += g[y * w + x]
      out[r * cols + c] = sum / ((y1 - y0) * (x1 - x0))
    }
  }
  return out
}

function bitsToHex(bits: boolean[]): string {
  let hex = ''
  for (let i = 0; i < bits.length; i += 4) hex += ((+bits[i] << 3) | (+bits[i + 1] << 2) | (+bits[i + 2] << 1) | +bits[i + 3]).toString(16)
  return hex
}

/** 32 hex digits: dHash (64 bits) then aHash (64 bits) of a THUMB×THUMB RGBA image. */
export function fingerprint(rgba: ArrayLike<number>, w = THUMB, h = THUMB): string {
  const g = luma(rgba, w * h)
  const d = shrink(g, w, h, 9, 8)
  const dBits: boolean[] = []
  for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) dBits.push(d[r * 9 + c] + MARGIN < d[r * 9 + c + 1])
  const a = shrink(g, w, h, 8, 8)
  const mean = a.reduce((x, y) => x + y, 0) / 64
  const aBits = Array.from(a, (v) => v > mean + MARGIN)
  return bitsToHex(dBits) + bitsToHex(aBits)
}

const POP = Array.from({ length: 16 }, (_, i) => (i & 1) + ((i >> 1) & 1) + ((i >> 2) & 1) + ((i >> 3) & 1))

/** Number of differing bits between two fingerprints (0 … 128). */
export function distance(a: string, b: string): number {
  let d = 0
  for (let i = 0; i < Math.min(a.length, b.length); i++) d += POP[parseInt(a[i], 16) ^ parseInt(b[i], 16)]
  return d + 4 * Math.abs(a.length - b.length)
}

/** At or below this many differing bits (of 128), two frames count as the same picture. */
export const SAME_PICTURE = 24
