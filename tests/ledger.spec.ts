import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { LedgerClient } from '../src/ledger.ts'
import { config, fixture, positionBody } from './ledger-fixture.ts'
const signal = () => new AbortController().signal
describe('strict ledger reads', () => {
  it('acquires actual positions, completes names without adding watchlist rows, and reconciles exact decimal values', async () => {
    const h = fixture()
    const r = await h.client.positions(signal())
    assert.equal(r.status, 'ok')
    assert.equal(r.data?.position_count, 1)
    assert.equal(r.data?.positions[0]?.name, '示例完整名称')
    assert.equal(r.data?.totals.holding_profit, '0.27')
    assert.equal(r.data?.positions[0]?.day_pct, '1')
    assert.equal(r.data?.positions[0]?.weight_in_positions_pct, '100')
    assert.equal(r.data?.positions[0]?.weight_in_assets_pct, '60.238569')
    assert.equal(r.data?.quote_date, null)
    assert.equal(r.data?.uploaded_at, '2026-10-15T07:12:15.000Z')
    assert(!JSON.stringify(r).includes('PRIVATE-ACCOUNT'))
    assert(!JSON.stringify(r).includes('private-cookie-value'))
    const accounts = h.seen.find(x => x.url.endsWith('account_list'))!
    assert.equal(new Headers(accounts.init.headers).get('referer'), null)
    assert(h.seen.every(x => x.init.redirect === 'manual' && x.init.signal))
    const request = new URLSearchParams(String(h.seen.find(x => x.url.endsWith('stock_position'))!.init.body))
    assert.equal(request.get('fund_key'), 'portfolio-0')
    assert.equal(request.get('is_merge'), '0')
  })
  it('does not choose the first of multiple ledgers, but honors explicit and saved selections', async () => {
    const h = fixture({ accounts: 2 })
    assert.equal((await h.client.positions(signal())).code, 'PORTFOLIO_REQUIRED')
    assert(!h.seen.some(x => x.url.endsWith('stock_position')))
    assert.equal((await h.client.positions(signal(), 'portfolio-1')).data?.portfolio.id, 'portfolio-1')
    assert.equal((await fixture({ accounts: 2, selected: 'portfolio-1' }).client.positions(signal())).data?.portfolio.id, 'portfolio-1')
    assert.equal((await h.client.positions(signal(), 'missing')).code, 'PORTFOLIO_NOT_FOUND')
    assert.equal((await h.client.positions(signal(), ' ')).code, 'INVALID_PORTFOLIO')
  })
  it('distinguishes no ledgers, no credentials, and an expired login', async () => {
    assert.equal((await fixture({ accounts: 0 }).client.positions(signal())).code, 'NO_PORTFOLIOS')
    const missing = new LedgerClient(config, async () => undefined, async () => { throw new Error('must not fetch') })
    assert.equal((await missing.positions(signal())).code, 'NOT_CONFIGURED')
    const h = fixture({ intercept: () => new Response('secret-cookie-echo', { status: 401 }) })
    const result = await h.client.list(signal())
    assert.equal(result.code, 'AUTH_REQUIRED'); assert.equal(result.data, null)
    assert(!JSON.stringify(result).includes('secret-cookie-echo'))
    assert.equal(h.seen.length, 1)
  })
  it('requires an explicit valid positions array before reporting empty holdings', async () => {
    const empty = positionBody(); empty.ex_data.position = []; empty.ex_data.total_value = '0'; empty.ex_data.total_asset = '20'; empty.ex_data.position_rate = '0'
    const result = await fixture({ body: empty }).client.positions(signal())
    assert.equal(result.status, 'ok'); assert.equal(result.data?.position_count, 0)
    assert.equal(result.data?.totals.day_profit, '0')
    assert.equal((await fixture({ body: { error_code: '0', ex_data: {} } }).client.positions(signal())).code, 'INVALID_RESPONSE')
  })
  it('retains missing numbers as null and suppresses derived analysis', async () => {
    const body = positionBody(); body.ex_data.position[0]!.pre_profit = ''
    const r = await fixture({ body }).client.positions(signal())
    assert.equal(r.status, 'partial')
    assert.equal(r.data?.totals.day_profit, null)
    assert.equal(r.data?.analysis_available, false)
  })
  it('keeps original amounts and flags inconsistent totals', async () => {
    const body = positionBody(); body.ex_data.total_value = '99'
    const r = await fixture({ body }).client.positions(signal())
    assert(r.warnings.includes('TOTAL_VALUE_MISMATCH'))
    assert.equal(r.data?.assets.total_value, '99')
    assert.equal(r.data?.analysis_available, false)
  })
  it('does not recompute holding profit using rounded displayed costs', async () => {
    const body = positionBody(); body.ex_data.position[0]!.hold_profit = '0.2699'
    const r = await fixture({ body }).client.positions(signal())
    assert.equal(r.data?.totals.holding_profit, '0.2699')
  })
  it('reports a partial result when name enrichment fails', async () => {
    const r = await fixture({ namesFail: true }).client.positions(signal())
    assert.equal(r.status, 'partial'); assert.equal(r.data?.positions[0]?.name, '示例')
    assert(r.warnings.includes('NAME_LOOKUP_UNAVAILABLE'))
    assert(!JSON.stringify(r).includes('private-cookie-value'))
  })
  it('rejects malformed numbers, duplicate securities and unsupported accounts', async () => {
    const invalid = positionBody(); invalid.ex_data.position[0]!.price = 'NaN'
    assert.equal((await fixture({ body: invalid }).client.positions(signal())).code, 'INVALID_RESPONSE')
    const duplicate = positionBody(); duplicate.ex_data.position.push(duplicate.ex_data.position[0]!)
    assert.equal((await fixture({ body: duplicate }).client.positions(signal())).code, 'INVALID_RESPONSE')
    const margin = positionBody(); margin.ex_data.total_liability = '1'
    assert.equal((await fixture({ body: margin }).client.positions(signal())).code, 'UNSUPPORTED_ACCOUNT')
    const foreign = positionBody(); foreign.ex_data.position[0]!.market = 'HK'
    assert.equal((await fixture({ body: foreign }).client.positions(signal())).code, 'UNSUPPORTED_MARKET')
  })
  it('refuses redirects and business failures without echoing arbitrary upstream messages', async () => {
    const redirect = fixture({ intercept: () => new Response(null, { status: 302 }) })
    assert.equal((await redirect.client.positions(signal())).code, 'REDIRECT_REFUSED')
    assert.equal(redirect.seen.length, 1)
    const rejected = fixture({ intercept: () => Response.json({ error_code: '1', error_msg: 'private-cookie-value' }) })
    const r = await rejected.client.positions(signal())
    assert.equal(r.code, 'API_REJECTED'); assert(!JSON.stringify(r).includes('private-cookie-value'))
  })
  it('retries a temporary network failure once and no more', async () => {
    let failures = 0
    const bad = fixture({ intercept: () => { failures++; throw new Error('private-cookie-value') } })
    assert.equal((await bad.client.list(signal())).code, 'NETWORK_ERROR'); assert.equal(failures, 2)
  })
  it('cancels in-flight work and performs no request for a pre-cancelled call', async () => {
    const controller = new AbortController()
    const h = fixture({ intercept: async (_url, init) => new Promise((_resolve, reject) => {
      init.signal!.addEventListener('abort', () => reject(init.signal!.reason), { once: true })
      controller.abort()
    }) })
    assert.equal((await h.client.list(controller.signal)).code, 'CANCELLED')
    const pre = fixture()
    assert.equal((await pre.client.positions(controller.signal)).code, 'CANCELLED')
    assert.equal(pre.seen.length, 0)
  })
  it('bounds the whole operation with a deadline', async () => {
    const client = new LedgerClient({ ...config, requestTimeoutMs: 20 }, async () => 'userid=test-user', async (_url, init) => new Promise((_resolve, reject) => {
      init.signal!.addEventListener('abort', () => reject(init.signal!.reason), { once: true })
    }))
    const keepAlive = setTimeout(() => {}, 100)
    try { assert.equal((await client.list(signal())).code, 'TIMEOUT') } finally { clearTimeout(keepAlive) }
  })
  it('bounds a stalled credential read and never starts a request after cancellation', async () => {
    const c = new AbortController()
    let requests = 0
    const client = new LedgerClient(config, async () => new Promise(() => {}), async () => { requests++; throw new Error('unexpected') })
    const result = client.list(c.signal)
    c.abort()
    assert.equal((await result).code, 'CANCELLED')
    assert.equal(requests, 0)
  })
  it('flags the two exposure denominators and rejects explicitly foreign currency', async () => {
    const body = positionBody(); body.ex_data.position[0]!.position_rate = '0.5'
    const result = await fixture({ body }).client.positions(signal())
    assert(result.warnings.some(w => w.startsWith('POSITION_WEIGHT_MISMATCH')))
    assert.equal(result.data?.analysis_available, false)
    const foreign = { ...positionBody(), ex_data: { ...positionBody().ex_data, currency: 'USD' } }
    assert.equal((await fixture({ body: foreign }).client.positions(signal())).code, 'UNSUPPORTED_ACCOUNT')
  })
  it('reports P&L without inventing an empty-series zero or multiplying percent twice', async () => {
    const r = await fixture().client.pnl(signal())
    assert.equal(r.status, 'ok'); assert.equal(r.data?.day_pct, '1.25'); assert.equal(r.data?.day_profit, '0.3')
    const empty = fixture({ intercept: url => url.endsWith('time_share') ? Response.json({ error_code: '0', ex_data: { data: [] } }) : undefined })
    const e = await empty.client.pnl(signal())
    assert.equal(e.status, 'partial'); assert.equal(e.data?.day_profit, null)
  })
})


describe('model gateway failure', () => {
  it('keeps a persistent refusal separate from authentication failure', async () => {
    let blockedCalls = 0
    const blocked = new LedgerClient({ ...config, requestTimeoutMs: 5000 }, async () => 'userid=test; sid=private', async () => { blockedCalls++; return new Response('private-cookie', { status: 403 }) })
    const result = await blocked.list(signal())
    assert.equal(result.code, 'REQUEST_BLOCKED'); assert.equal(result.data, null); assert.equal(blockedCalls, 3)
    assert(!JSON.stringify(result).includes('private-cookie'))
  })
})
