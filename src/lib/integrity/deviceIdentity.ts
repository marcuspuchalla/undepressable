import { generateIdentity, serializeIdentity, deserializeIdentity, type Identity } from './identity'

// A single anonymous Ed25519 identity per browser, used to sign recording
// proofs and live attestations. Persisted (no PII — just a random keypair) so
// a device's recordings and streams share one verifiable signer.
const IDENTITY_KEY = 'undepressable_identity'
let cachedIdentity: Identity | null = null

export function getIdentity(): Identity {
  if (cachedIdentity) return cachedIdentity
  try {
    const saved = localStorage.getItem(IDENTITY_KEY)
    if (saved) {
      cachedIdentity = deserializeIdentity(JSON.parse(saved))
      return cachedIdentity
    }
  } catch {
    /* corrupt/absent — regenerate below */
  }
  cachedIdentity = generateIdentity()
  try {
    localStorage.setItem(IDENTITY_KEY, JSON.stringify(serializeIdentity(cachedIdentity)))
  } catch {
    /* storage blocked; identity still valid for this session */
  }
  return cachedIdentity
}
