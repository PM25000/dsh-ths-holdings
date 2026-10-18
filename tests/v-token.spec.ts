import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { VTokenRefresher, refreshLedgerRequest } from '../src/v-token.ts'
import { fetchLedger } from '../src/transport.ts'

// Synthetic browser state, encoded independently by the official pure codec;
// these vectors contain no account, session, or real browser data.
const SEED = 'Az8_w1sUZiVsqGI5MFhLnhUpzhHMJJPGrXiXutEM2-414Nfi2fQjFr1IJwPi'
const FIRST = 'A3p6kC7by6ZRH0fKRSvWfTjey6KZK_4FcK9yqYRzJo3Yd5IxbLtOFUA_wrNX'
const SECOND = 'A5mZtQGWGFsWysTP2jYFcJ9LqId2Jo3YdxqxbLtOFUA_wjHUA3adqAdqwTdI'
const ROLLOVER_SEED = 'A0hIJuihuTjPRdW8Q43Es1b0GbRf8az7jlWAfwL5lEO23WDHqgF8i95lr_BR'
const ROLLOVER = 'A0REMgQN_WQrcUko_x0A_7JAFcAzXWjHKoH8C17l0I_SiWzThm04V3qRzJut'
const URL = 'https://tzzb.10jqka.com.cn/caishen_httpserver/tzzb/caishen_fund/pc/account/v1/account_list'

describe('Chameleon v3 request refresh', () => {
  it('matches independent timestamp/counter vectors and preserves every other Cookie field', () => {
    const tokens = new VTokenRefresher(() => 1700000200000)
    const cookie = `userid=synthetic; ticket=synthetic-ticket; v=${SEED}; other=x`
    assert.equal(tokens.refresh(cookie), `userid=synthetic; ticket=synthetic-ticket; v=${FIRST}; other=x`)
    assert.equal(tokens.refresh(cookie), `userid=synthetic; ticket=synthetic-ticket; v=${SECOND}; other=x`)
    assert.ok(cookie.includes(SEED))
  })
  it('wraps the serialized counter and rejects invalid or unknown tokens without replacement', () => {
    const tokens = new VTokenRefresher(() => 1700000200000)
    assert.equal(tokens.refresh(`v=${ROLLOVER_SEED}`), `v=${ROLLOVER}`)
    const badChecksum = SEED.slice(0, -1) + 'A'
    const unknownVersion = Buffer.from(SEED, 'base64url'); unknownVersion[0] = 4
    for (const cookie of ['userid=x', 'v=short', `v=${badChecksum}`, `v=${unknownVersion.toString('base64url')}`, `v=${SEED}; v=${SEED}`, `other_v=${SEED}`]) assert.equal(tokens.refresh(cookie), cookie)
    assert.equal(new VTokenRefresher(() => NaN).refresh(`v=${SEED}`), `v=${SEED}`)
  })
  it('changes only official ledger POST headers and leaves the caller object untouched', () => {
    const headers = new Headers({ Cookie: `userid=synthetic; v=${SEED}`, 'X-Test': 'preserved' })
    const signal = new AbortController().signal
    const init = { method: 'POST', headers, body: 'same=payload', signal }
    const refreshed = refreshLedgerRequest(URL, init)
    assert.notEqual(new Headers(refreshed.headers).get('cookie'), headers.get('cookie'))
    assert.equal(headers.get('cookie'), `userid=synthetic; v=${SEED}`)
    assert.equal(new Headers(refreshed.headers).get('x-test'), 'preserved')
    assert.equal(refreshed.body, init.body); assert.equal(refreshed.signal, signal)
    for (const url of [URL.replace('https:', 'http:'), URL.replace('tzzb.10jqka.com.cn', 'other.test'), 'https://tzzb.10jqka.com.cn/other', 'invalid']) assert.equal(refreshLedgerRequest(url, init), init)
    assert.equal(refreshLedgerRequest(URL, { ...init, method: 'GET' }).headers, headers)
  })
  it('refreshes each bounded retry independently, including simultaneous requests', async () => {
    const seen: string[] = []
    const headers = { Cookie: `userid=synthetic; ticket=synthetic-ticket; v=${SEED}` }
    await fetchLedger(async (_url, init) => {
      seen.push(new Headers(init.headers).get('cookie')!)
      assert.equal(init.redirect, 'manual'); assert.equal(init.body, 'same=payload')
      return new Response('', { status: seen.length < 3 ? 403 : 200 })
    }, URL, { method: 'POST', headers, body: 'same=payload' }, { wait: async () => {} })
    assert.equal(seen.length, 3); assert.equal(new Set(seen).size, 3)
    assert.ok(seen.every(cookie => cookie.startsWith('userid=synthetic; ticket=synthetic-ticket; v=')))
    assert.equal(headers.Cookie, `userid=synthetic; ticket=synthetic-ticket; v=${SEED}`)
    const concurrent = await Promise.all(Array.from({ length: 4 }, async () => new Headers(refreshLedgerRequest(URL, { method: 'POST', headers }).headers).get('cookie')))
    assert.equal(new Set(concurrent).size, 4)
  })
})
