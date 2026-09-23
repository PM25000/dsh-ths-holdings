/**
 * `ui-stock-pnl` coverage: unit tests for the ledger acquisition logic and a
 * REAL-composition test that boots the node half through the vendored Loader
 * and asserts the user-visible `/api/stock-pnl` HTTP surface (the Cookie on
 * the ledger request and the returned snapshot).
 */

import { createServer } from 'node:http'
import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import { CredentialProvider } from '@deepseek-ai/dsh-credentials'
import type { CredentialInfo, CredentialRef, ResolvedCredential } from '@deepseek-ai/dsh-credentials'
import z from '@deepseek-ai/schemastery'
import WebServer from '@deepseek-ai/dsh-host-webserver'
import * as uiStockPnl from '../src/index.ts'
import { collectStats, cookieField, listPortfolios, verifyCookie, type FetchLike } from '../src/fetch.ts'

const FIXED_NOW = () => new Date('2026-05-26T06:00:00Z')
const COOKIE_ENV = 'STOCK_PNL_COOKIE'

/** Wrap any JSON as a fetch-style Response. */
function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

const PNL_BODY = { error_code: '0', ex_data: { data: [{ time: 1, zf: -1.0 }, { time: 2, zf: 2.5 }] } }
const INDEX_BODY = {
  error_code: '0',
  ex_data: [
    { zqdm: '000001', xianjia: 3000, zuoshou: 0 },
    { zqdm: '1A0001', xianjia: 3030, zuoshou: 3000 },
  ],
}

describe('collectStats', () => {
  const base = {
    pnlUrl: 'https://ledger.test/pnl',
    indexUrl: 'https://ledger.test/index',
    cookie: 'sid=abc',
    cookieEnv: COOKIE_ENV,
    user_id: '825299250',
    fund_key: '172074074',
    now: FIXED_NOW,
  }

  it('normalizes a successful P&L and index fetch without a redirect-following request', async () => {
    const initList: RequestInit[] = []
    const queue = [PNL_BODY, INDEX_BODY]
    const fetchImpl: FetchLike = async (_url, init) => {
      initList.push(init)
      return jsonResponse(queue.shift())
    }
    const stats = await collectStats({ ...base, fetchImpl })
    assert.equal(stats.error, '')
    assert.equal(stats.token_expired, false)
    assert.equal(stats.pnl_pct, 2.5)
    assert.equal(stats.sh_pct, 1)
    assert.deepEqual(stats.chart_data, [{ t: 1, v: -1.0 }, { t: 2, v: 2.5 }])
    for (const init of initList) assert.equal(init.redirect, 'manual')
  })

  it('reports a missing Cookie without touching the ledger', async () => {
    let called = false
    const stats = await collectStats({
      ...base,
      cookie: undefined,
      fetchImpl: async () => { called = true; return jsonResponse(PNL_BODY) },
    })
    assert.equal(called, false)
    assert.ok((stats.error)?.includes(COOKIE_ENV))
  })

  it('flags an HTTP 401 as token expiry', async () => {
    const stats = await collectStats({ ...base, fetchImpl: async () => new Response('', { status: 401 }) })
    assert.equal(stats.token_expired, true)
    assert.ok((stats.error)?.includes('TOKEN_EXPIRED'))
  })

  it('derives the ledger user id from the Cookie when user_id is empty', async () => {
    const bodies: string[] = []
    const queue = [PNL_BODY, INDEX_BODY]
    const fetchImpl: FetchLike = async (_url, init) => {
      bodies.push(String(init.body))
      return jsonResponse(queue.shift())
    }
    await collectStats({ ...base, cookie: 'userid=825299250; sess_tk=abc', user_id: '', fetchImpl })
    assert.ok((bodies[0])?.includes('userid=825299250'))
    assert.ok((bodies[0])?.includes('user_id=825299250'))
  })

  it('refuses to follow a redirect with the Cookie', async () => {
    const stats = await collectStats({
      ...base,
      fetchImpl: async (_url, init) => { assert.equal(init.redirect, 'manual'); return new Response(null, { status: 302 }) },
    })
    assert.ok((stats.error)?.includes('重定向未跟随'))
  })
})

describe('cookieField', () => {
  it('reads the anchored `userid` field even when another cookie embeds a `userid=` substring', () => {
    // The ledger Cookie can carry a `pex_userid` (or similar) field whose value
    // ends in `=...`; a bare `/userid=([^;]*)/` regex matches the wrong field
    // and the account_list gateway answers 403 ("请求失败，请稍后重试"). The
    // field-boundary regex must win.
    const cookie = 'pex_userid=el2bijcg9j; userid=825299250; tz=8'
    assert.equal(cookieField(cookie, 'userid'), '825299250')
    // Reaffirm the doc'd regression: the naive extraction would be WRONG here.
    assert.equal(cookie.match(/userid=([^;]*)/)?.[1], 'el2bijcg9j')
  })
})

describe('listPortfolios', () => {
  it('normalizes a line-wrapped cookie and sends the minimal accepted request shape', async () => {
    // A credential-store read of a long cookie arrives with a space at each
    // YAML-fold break; the header must be rebuilt before it reaches the API.
    const wrapped = 'userid=825299250; sid=abc def ghi; tz=8'
    const seen: Record<string, string | undefined> = {}
    const list = await listPortfolios(wrapped, '825299250', async (_url, init) => {
      assert.equal(init.redirect, 'manual')
      const headers = new Headers(init.headers)
      seen.cookie = headers.get('cookie') ?? ''
      seen.referer = headers.get('referer') ?? undefined
      seen.accept = headers.get('accept') ?? undefined
      return jsonResponse({ error_code: '0', ex_data: { common: [{ fund_key: 'k1', manualname: '组合A', brokername: '华泰' }] } })
    })
    // normalizeCookie strips whitespace per `key=value` part and rejoins with '; '.
    assert.equal(seen.cookie, 'userid=825299250; sid=abcdefghi; tz=8')
    // The minimal shape (no browser-simulation headers) is what the gateway accepts.
    assert.equal(seen.referer, undefined)
    assert.equal(seen.accept, undefined)
    assert.deepEqual(list, [{ fund_key: 'k1', manualname: '组合A', brokername: '华泰' }])
  })
})

/** An in-memory credentials provider resolving from the process environment, for the Loader boot. */
class TestCredentialProvider extends CredentialProvider {
  static Config = z.object({})
  resolve(ref: CredentialRef): Promise<ResolvedCredential | undefined> {
    const value = process.env[ref]
    return Promise.resolve(value !== undefined && value.length > 0 ? { value, source: 'env' } : undefined)
  }
  describe(ref: CredentialRef): Promise<CredentialInfo> {
    return Promise.resolve({ configured: Boolean(process.env[ref]), writable: false })
  }
  set(): Promise<void> { return Promise.resolve() }
  unset(): Promise<void> { return Promise.resolve() }
}

let root: string | undefined
let context: Context | undefined
let ledgerServer: Server | undefined
let ledgerCookie: string | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
  if (ledgerServer !== undefined) await new Promise<void>(resolve => { ledgerServer?.close(() => { resolve() }) })
  ledgerServer = undefined
  delete process.env[COOKIE_ENV]
  ledgerCookie = undefined
})

/** Boot the node half plus a webserver and credentials provider through the real Loader. */
async function loadComposition(): Promise<number> {
  root = await mkdtemp(join(tmpdir(), 'dsh-stock-pnl-loader-'))

  ledgerCookie = ''
  ledgerServer = createServer((req, res) => {
    ledgerCookie = String(req.headers.cookie ?? '')
    res.writeHead(200, { 'content-type': 'application/json' })
    if (req.url === '/pnl') res.end(JSON.stringify(PNL_BODY))
    else res.end(JSON.stringify(INDEX_BODY))
  })
  await new Promise<void>((resolve, reject) => {
    ledgerServer!.once('error', reject)
    ledgerServer!.listen(0, '127.0.0.1', () => { resolve() })
  })
  const ledgerPort = (ledgerServer.address() as AddressInfo).port

  process.env[COOKIE_ENV] = 'sid=test-secret'

  const configPath = join(root, 'cordis.yml')
  await writeFile(configPath, [
    "- name: '@deepseek-ai/dsh-host-webserver'",
    '  config:',
    "    host: '127.0.0.1'",
    '    port: 0',
    "- name: '@deepseek-ai/dsh-credentials-test'",
    "- name: '@deepseek-ai/dsh-client-ui-stock-pnl'",
    '  config:',
    `    cookieEnv: '${COOKIE_ENV}'`,
    `    pnlUrl: 'http://127.0.0.1:${String(ledgerPort)}/pnl'`,
    `    indexUrl: 'http://127.0.0.1:${String(ledgerPort)}/index'`,
    '',
  ].join('\n'))

  context = new Context()
  context.baseUrl = pathToFileURL(root).href + '/'
  await context.plugin(Loader)
  context.loader.builtins.include = Include
  const modules = new Map<string, unknown>([
    ['@deepseek-ai/dsh-host-webserver', WebServer],
    ['@deepseek-ai/dsh-credentials-test', TestCredentialProvider],
    ['@deepseek-ai/dsh-client-ui-stock-pnl', uiStockPnl],
  ])
  context.loader.internal = {
    version: 'v2',
    async import(specifier: string) {
      if (!modules.has(specifier)) throw new Error(`unexpected Loader import: ${specifier}`)
      return modules.get(specifier)
    },
  } as unknown as NonNullable<typeof context.loader.internal>
  await context.loader.create({
    name: 'cordis:include',
    config: { path: pathToFileURL(configPath).href },
  })
  await context.loader.await()

  const server = context.webServer as InstanceType<typeof WebServer>
  return server.port
}

describe('verifyCookie', () => {
  it('reports a missing cookie', async () => {
    const result = await verifyCookie(undefined)
    assert.equal(result.valid, false)
    assert.equal(result.reason, 'missing')
  })

  it('rejects a cookie without a userid field', async () => {
    const result = await verifyCookie('sid=abc', undefined, async () => jsonResponse({}))
    assert.equal(result.valid, false)
    assert.equal(result.reason, 'no-userid')
  })

  it('flags HTTP 401/403 as expired with a re-login hint', async () => {
    const fetchImpl: FetchLike = async (_url, init) => {
      assert.equal(init.redirect, 'manual')
      return new Response('', { status: 401 })
    }
    const result = await verifyCookie('userid=825299250; sid=abc', undefined, fetchImpl)
    assert.equal(result.valid, false)
    assert.equal(result.reason, 'expired')
    assert.ok((result.hint)?.includes('自动获取'))
  })

  it('passes when the ledger accepts the cookie and lists portfolios', async () => {
    const fetchImpl: FetchLike = async (_url, init) => {
      assert.ok((new Headers(init.headers).get('cookie'))?.includes('sid=abc'))
      return jsonResponse({
        error_code: '0',
        ex_data: { common: [{ fund_key: 'k1', manualname: '组合A', brokername: '华泰' }] },
      })
    }
    const result = await verifyCookie('userid=u042; sid=abc', undefined, fetchImpl)
    assert.equal(result.valid, true)
    assert.equal(result.reason, 'ok')
    assert.deepEqual(result.portfolios, [{ fund_key: 'k1', manualname: '组合A', brokername: '华泰' }])
  })

  it('reports a rejected envelope with the ledger message', async () => {
    const fetchImpl: FetchLike = async () => jsonResponse({ error_code: '1', error_msg: '需要登录' })
    const result = await verifyCookie('userid=u042; sid=abc', undefined, fetchImpl)
    assert.equal(result.valid, false)
    assert.equal(result.reason, 'rejected')
    assert.ok((result.error)?.includes('需要登录'))
    assert.ok((result.hint)?.includes('重新登录'))
  })
})

describe('real Loader composition', () => {
  it('serves /api/stock-pnl with the Cookie, and unknown routes 404', { timeout: 60_000 }, async () => {
    const port = await loadComposition()

    const response = await fetch(`http://127.0.0.1:${String(port)}/api/stock-pnl`)
    assert.equal(response.status, 200)
    const stats = (await response.json()) as {
      pnl_pct: number
      sh_pct: number
      error: string
      token_expired: boolean
      poll_ms: number
    }
    assert.equal(stats.error, '')
    assert.equal(stats.token_expired, false)
    assert.equal(stats.pnl_pct, 2.5)
    assert.equal(stats.sh_pct, 1)
    assert.equal(stats.poll_ms, 20000)
    assert.ok((ledgerCookie)?.includes('sid=test-secret'))

    assert.equal((await fetch(`http://127.0.0.1:${String(port)}/no/such/route`)).status, 404)
  })
})
