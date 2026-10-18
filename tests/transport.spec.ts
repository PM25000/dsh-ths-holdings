import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { fetchLedger } from '../src/transport.ts'

describe('bounded ledger transport recovery', () => {
  it('silently recovers two refusals while preserving the exact request and refusing redirects', async () => {
    const waits: number[] = [], requests: RequestInit[] = []
    const response = await fetchLedger(async (_url, init) => {
      requests.push(init)
      return new Response('', { status: requests.length < 3 ? 403 : 200 })
    }, 'https://ledger.test/read', { method: 'POST', headers: { Cookie: 'private-cookie' }, body: 'fixed=payload', redirect: 'follow' }, {
      random: () => 0, wait: async ms => { waits.push(ms) },
    })
    assert.equal(response.status, 200)
    assert.deepEqual(waits, [300, 900])
    assert.equal(requests.length, 3)
    for (const init of requests) {
      assert.equal(init.redirect, 'manual'); assert.equal(init.body, 'fixed=payload')
      assert.equal(new Headers(init.headers).get('cookie'), 'private-cookie')
      assert.equal(init.signal, requests[0]!.signal)
    }
  })
  it('releases every rejected response body, including the final failure', async () => {
    let released = 0
    const response = await fetchLedger(async () => new Response(new ReadableStream({ cancel: () => { released++ } }), { status: 403 }), 'https://ledger.test/read', {}, { wait: async () => {} })
    assert.equal(response.status, 403); assert.equal(released, 3)
  })
  it('caps mixed gateway and service recovery at three total requests', async () => {
    let calls = 0
    const result = await fetchLedger(async () => new Response('', { status: ++calls === 1 ? 503 : 403 }), 'https://ledger.test/read', {}, { retryTransient: true, wait: async () => {} })
    assert.equal(result.status, 403); assert.equal(calls, 3)
  })
  it('retries an ordinary transient failure once and never replays 401, redirects or business envelopes', async () => {
    let calls = 0
    await assert.rejects(fetchLedger(async () => { calls++; throw new Error('network') }, 'https://ledger.test/read', {}, { retryTransient: true, wait: async () => {} }))
    assert.equal(calls, 2)
    for (const status of [401, 302, 200]) {
      let count = 0
      await fetchLedger(async () => { count++; return new Response('{"error_code":"1"}', { status }) }, 'https://ledger.test/read', {})
      assert.equal(count, 1)
    }
  })
  it('cancels backoff before another request and respects a pre-cancelled call', async () => {
    const controller = new AbortController(); let calls = 0
    const pending = fetchLedger(async () => { calls++; return new Response('', { status: 403 }) }, 'https://ledger.test/read', { signal: controller.signal })
    setTimeout(() => controller.abort(), 15)
    await assert.rejects(pending, { name: 'AbortError' }); assert.equal(calls, 1)
    await assert.rejects(fetchLedger(async () => { calls++; return new Response() }, 'https://ledger.test/read', { signal: controller.signal }), { name: 'AbortError' })
    assert.equal(calls, 1)
  })
  it('uses the same caller deadline for the request and every recovery delay', async () => {
    let calls = 0
    await assert.rejects(fetchLedger(async () => { calls++; return new Response('', { status: 403 }) }, 'https://ledger.test/read', { signal: AbortSignal.timeout(20) }), { name: 'TimeoutError' })
    assert.equal(calls, 1)
  })
})
