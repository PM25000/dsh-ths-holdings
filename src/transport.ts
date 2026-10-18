/** Bounded recovery for the plugin's read-only ledger requests. */
export type FetchLike = (url: string, init: RequestInit) => Promise<Response>
interface RecoveryOptions {
  /** Existing model reads also recover once from network/429/5xx failures. */
  retryTransient?: boolean
  /** Test seams; production uses abortable timers and a small jitter. */
  wait?: (milliseconds: number, signal: AbortSignal) => Promise<void>
  random?: () => number
}
function wait(milliseconds: number, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted()
  return new Promise((resolve, reject) => {
    const cancel = (): void => { clearTimeout(timer); reject(signal.reason) }
    const timer = setTimeout(() => { signal.removeEventListener('abort', cancel); resolve() }, milliseconds)
    signal.addEventListener('abort', cancel, { once: true })
  })
}
/** No redirects, credential mutation, response cache, or replay of business failures. */
export async function fetchLedger(fetchImpl: FetchLike, url: string, init: RequestInit, options: RecoveryOptions = {}): Promise<Response> {
  const signal = init.signal ?? AbortSignal.timeout(15_000)
  const request: RequestInit = { ...init, redirect: 'manual', signal }
  let transientRetries = 0
  for (let attempt = 0; ; attempt++) {
    signal.throwIfAborted()
    let response: Response | undefined
    try { response = await fetchImpl(url, request) } catch (error) {
      if (signal.aborted || !options.retryTransient || transientRetries >= 1 || attempt >= 2) throw error
      transientRetries++
    }
    if (response) {
      const gateway = response.status === 403
      const transient = options.retryTransient && (response.status === 429 || response.status >= 500 && response.status <= 599) && transientRetries < 1
      if (attempt >= 2 || !gateway && !transient) {
        if (!response.ok) void response.body?.cancel().catch(() => {})
        return response
      }
      if (!gateway) transientRetries++
      // Release rejected bodies without allowing an untrusted stream to stall the deadline.
      void response.body?.cancel().catch(() => {})
    }
    signal.throwIfAborted()
    const delay = (attempt === 0 ? 300 : 900) + Math.floor((options.random ?? Math.random)() * 100)
    await (options.wait ?? wait)(delay, signal)
  }
}
