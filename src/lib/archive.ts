// Home-archive pairing.
//
// The load-sparing design: the streamer sends one copy to a friend at the scene.
// That friend's phone *forwards* the stream on to a device the friend left safe
// at home (a "home node"), which records it. If the phone is seized, the footage
// is already at home — and the streamer never has to send more than one stream.
//
// A pairing is just a shared secret that both the home node and the phone use to
// meet in a private Trystero room. No server, no account.

const HOME_KEY = "undepressable_home_key"; // this device's own home-node secret
const PAIRED_KEY = "undepressable_paired_home"; // the home secret this phone forwards to

const CHARS = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // no easily-confused chars

function randomKey(len = 8): string {
  let out = "";
  const rand = new Uint32Array(len);
  crypto.getRandomValues(rand);
  for (let i = 0; i < len; i++) out += CHARS[rand[i] % CHARS.length];
  return out;
}

/** The archive room id two paired devices meet in. */
export function archiveRoomId(key: string): string {
  return `undepressable-archive-${key.toUpperCase()}`;
}

export function isValidHomeKey(key: string): boolean {
  return new RegExp(`^[${CHARS}]{8}$`).test(key.toUpperCase());
}

/** This device's stable home-node secret (generated once, persisted). */
export function getHomeKey(): string {
  let k = localStorage.getItem(HOME_KEY);
  if (!k || !isValidHomeKey(k)) {
    k = randomKey();
    try {
      localStorage.setItem(HOME_KEY, k);
    } catch {
      /* storage blocked; key lives for this session only */
    }
  }
  return k;
}

/** The home secret this phone is configured to forward to (or null). */
export function getPairedHome(): string | null {
  const k = localStorage.getItem(PAIRED_KEY);
  return k && isValidHomeKey(k) ? k : null;
}

export function setPairedHome(key: string): boolean {
  if (!isValidHomeKey(key)) return false;
  try {
    localStorage.setItem(PAIRED_KEY, key.toUpperCase());
  } catch {
    return false;
  }
  return true;
}

export function clearPairedHome(): void {
  try {
    localStorage.removeItem(PAIRED_KEY);
  } catch {
    /* ignore */
  }
}
