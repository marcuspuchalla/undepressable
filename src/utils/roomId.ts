// Room ID utilities
// User sees: 6 alphanumeric characters (e.g., "A7B3C9")
// Internal: Fixed prefix + user input for better uniqueness

const FIXED_PREFIX = 'p2pstream-v1-'

// Generate a random 6-character alphanumeric ID
export function generateShortRoomId(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
  let result = ''
  for (let i = 0; i < 6; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length))
  }
  return result
}

// Get the full internal room ID (with prefix)
export function getFullRoomId(shortId: string): string {
  return `${FIXED_PREFIX}${shortId.toUpperCase()}`
}

// Extract short ID from full ID (for display)
export function getShortRoomId(fullId: string): string {
  if (fullId.startsWith(FIXED_PREFIX)) {
    return fullId.slice(FIXED_PREFIX.length)
  }
  return fullId
}

// Validate a short room ID format
export function isValidShortRoomId(id: string): boolean {
  return /^[A-Z0-9]{6}$/.test(id.toUpperCase())
}
