import type { TrustedKey } from './release'

/**
 * Keys whose signature makes an update trustworthy. Compiled into every copy,
 * so a copy installed today can judge the updates it is offered later.
 *
 * Empty here on purpose: the project's maintainers add their public key when
 * they start signing releases (see docs/THREAT_MODEL.md → "Signed releases").
 * Builders can add keys without editing code: VITE_RELEASE_KEYS="id:hex,id:hex".
 */
const BUILT_IN: TrustedKey[] = []

function fromEnv(): TrustedKey[] {
  const raw = ((import.meta as any).env?.VITE_RELEASE_KEYS as string | undefined) ?? ''
  return raw
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const [id, publicKey] = entry.includes(':') ? entry.split(':') : ['release key', entry]
      return { id: id.trim(), publicKey: publicKey.trim().toLowerCase() }
    })
    .filter((k) => /^[0-9a-f]{64}$/.test(k.publicKey))
}

export const TRUSTED_RELEASE_KEYS: TrustedKey[] = [...BUILT_IN, ...fromEnv()]
