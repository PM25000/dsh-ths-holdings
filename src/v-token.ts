/**
 * Refresh the public Chameleon v3 timestamp/counter encoding using the user's
 * existing browser snapshot. No login ticket or browser fingerprint is created.
 * Format checked against the official Chameleon script on 2026-10-18.
 */
export class VTokenRefresher {
  private readonly counters = new Map<string, number>()
  constructor(private readonly now: () => number = Date.now) {}

  refresh(cookie: string): string {
    const matches = [...cookie.matchAll(/(?:^|;\s*)v=([^;]*)/g)]
    if (matches.length !== 1) return cookie
    const token = matches[0]![1]!
    if (!/^[A-Za-z0-9_-]{60}$/.test(token)) return cookie
    const bytes = Buffer.from(token, 'base64url')
    if (bytes.length !== 45 || bytes[0] !== 3) return cookie
    const payload = Buffer.alloc(43)
    let state = bytes[1]!
    for (let i = 0; i < payload.length; i++) {
      payload[i] = bytes[i + 2]! ^ (state & 255)
      state = ~(state * 131)
    }
    if (payload[42] !== 3 || checksum(payload) !== bytes[1]) return cookie
    const seconds = Math.floor(this.now() / 1000)
    if (!Number.isInteger(seconds) || seconds < 0 || seconds > 0xffffffff) return cookie
    const counter = ((this.counters.get(token) ?? payload.readUInt16BE(40)) + 1) & 0xffff
    // Bound retained browser snapshots; no complete Cookie or login tickets are cached.
    this.counters.delete(token)
    if (this.counters.size >= 32) this.counters.delete(this.counters.keys().next().value!)
    this.counters.set(token, counter)
    payload.writeUInt32BE(seconds, 8)
    payload.writeUInt16BE(counter, 40)
    bytes[1] = state = checksum(payload)
    for (let i = 0; i < payload.length; i++) {
      bytes[i + 2] = payload[i]! ^ (state & 255)
      state = ~(state * 131)
    }
    const refreshed = bytes.toString('base64url')
    return cookie.replace(/((?:^|;\s*)v=)[^;]*/, (_match, prefix: string) => prefix + refreshed)
  }
}

function checksum(payload: Uint8Array): number {
  let value = 0
  for (const byte of payload) value = (value << 5) - value + byte
  return value & 255
}

const tokens = new VTokenRefresher()

/** Refresh only outgoing HTTPS ledger POSTs; leave caller state and stored credentials intact. */
export function refreshLedgerRequest(url: string, init: RequestInit): RequestInit {
  let target: URL
  try { target = new URL(url) } catch { return init }
  if (target.origin !== 'https://tzzb.10jqka.com.cn'
    || !target.pathname.startsWith('/caishen_httpserver/tzzb/caishen_fund/')
    || init.method?.toUpperCase() !== 'POST') return init
  const headers = new Headers(init.headers)
  const cookie = headers.get('cookie')
  if (!cookie) return init
  const refreshed = tokens.refresh(cookie)
  if (refreshed === cookie) return init
  headers.set('Cookie', refreshed)
  return { ...init, headers }
}
