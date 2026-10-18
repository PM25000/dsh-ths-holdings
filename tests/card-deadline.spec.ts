/** Synthetic host-route checks: no real credentials or upstream requests. */
import assert from 'node:assert/strict'
import { describe, it, type TestContext } from 'node:test'
import type { Context } from '@deepseek-ai/cordis'
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'
import { apply } from '../src/index.ts'
import type { FetchLike } from '../src/fetch.ts'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}

function host(t: TestContext, credentials: (ref: string) => Promise<string | undefined>, fetchImpl: FetchLike) {
  t.mock.method(globalThis, 'fetch', fetchImpl)
  const routes = new Map<string, WebRoute>()
  const disposers: Array<() => void | Promise<void>> = []
  apply({
    inject: () => {}, get: () => undefined, logger: { warn: () => {} },
    credentials: { resolve: async (ref: string) => {
      const value = await credentials(ref)
      return value === undefined ? undefined : { value }
    } },
    webServer: { register: (route: WebRoute) => { routes.set(route.path, route); return () => routes.delete(route.path) } },
    effect: (callback: () => () => void | Promise<void>) => { disposers.push(callback()) },
  } as unknown as Context, { requestTimeoutMs: 100, pnlUrl: 'https://ledger.test/pnl', indexUrl: 'https://ledger.test/index' })
  t.after(async () => { for (const dispose of disposers) await dispose() })
  return async () => {
    let status = 0, body = ''
    const res = { headersSent: false,
      writeHead: (code: number) => { status = code },
      end: (value?: string) => { body = value ?? '' }, destroy: () => {},
    }
    await routes.get('/api/stock-pnl')!.handler({} as never, res as never)
    return { status, body }
  }
}

/** Keep the event loop alive for AbortSignal.timeout and fail boundedly on regressions. */
async function bounded<T>(operation: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout>
  try {
    return await Promise.race([operation, new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error('Card request did not finish after its deadline')), 500)
    })])
  } finally { clearTimeout(timer!) }
}

describe('card operation deadline', () => {
  for (const stalledRef of ['STOCK_PNL_COOKIE', 'STOCK_PNL_FUND_KEY']) {
    it(`bounds a stalled ${stalledRef} read and ignores its late result`, async t => {
      const late = deferred<string | undefined>()
      let requests = 0
      const run = host(t, async ref => ref === stalledRef ? late.promise : 'userid=synthetic; sid=fixture', async () => {
        requests++
        throw new Error('No request may follow an expired credential read')
      })
      const operation = run()
      try {
        assert.equal((await bounded(operation)).status, 500)
      } finally {
        late.resolve(stalledRef === 'STOCK_PNL_COOKIE' ? 'userid=synthetic; sid=fixture' : 'sole')
        await operation
      }
      assert.equal(requests, 0)
    })
  }

  for (const stage of ['account_list', '/pnl', '/index']) {
    it(`carries the original deadline into ${stage} acquisition`, async t => {
      // Control expiry directly so this verifies propagation without timing-sensitive sleeps.
      const deadlines: AbortController[] = []
      t.mock.method(AbortSignal, 'timeout', () => {
        const controller = new AbortController()
        deadlines.push(controller)
        return controller.signal
      })
      const requestStarted = deferred<AbortSignal>()
      const endpoints: string[] = []
      const run = host(t, async ref => ref === 'STOCK_PNL_COOKIE' ? 'userid=synthetic; sid=fixture' : undefined, async (url, init) => {
        endpoints.push(url)
        if (url.endsWith(stage)) return new Promise((_resolve, reject) => {
          init.signal!.addEventListener('abort', () => reject(init.signal!.reason), { once: true })
          requestStarted.resolve(init.signal!)
        })
        if (url.endsWith('account_list')) return Response.json({ error_code: '0', ex_data: { common: [{ fund_key: 'sole', manualname: 'Synthetic', brokername: 'Fixture' }] } })
        if (url.endsWith('/pnl')) return Response.json({ error_code: '0', ex_data: { data: [{ time: 1, zf: '1', yk: '10' }] } })
        throw new Error('Unexpected endpoint: ' + url)
      })
      const operation = run()
      try {
        const signal = await bounded(requestStarted.promise)
        deadlines[0]!.abort(new DOMException('Synthetic deadline', 'TimeoutError'))
        assert.equal(signal.aborted, true, 'Each request must still be governed by the original operation deadline')
        const result = await bounded(operation)
        if (stage === 'account_list') assert.equal(result.status, 500)
        else {
          assert.equal(result.status, 200)
          if (stage === '/pnl') assert.notEqual(JSON.parse(result.body).error, '')
          else assert.equal(JSON.parse(result.body).index_unavailable, true)
        }
        assert.equal(endpoints.length, ['account_list', '/pnl', '/index'].indexOf(stage) + 1)
      } finally {
        for (const controller of deadlines) controller.abort()
        await operation
      }
    })
  }
})
