/**
 * The standalone evidence check (verify/), as built into this copy of the
 * app, for putting inside evidence bundles. Empty when the app was built
 * without it (npm run build:verify).
 */

import verifyHtml from 'virtual:verify-html'

export const VERIFIER_NAME = 'verify.html'

export function verifierHtml(): string {
  return typeof verifyHtml === 'string' ? verifyHtml : ''
}

/** The bundle entry carrying the check, or none. */
export function verifierEntries(): { name: string; parts: Blob[] }[] {
  const html = verifierHtml()
  return html ? [{ name: VERIFIER_NAME, parts: [new Blob([html], { type: 'text/html' })] }] : []
}
