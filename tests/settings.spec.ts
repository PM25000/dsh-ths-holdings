import assert from 'node:assert/strict'
import { afterEach, describe, it } from 'node:test'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import type { Context } from '@deepseek-ai/cordis'
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'
import { apply } from '../src/index.ts'
import { saveSetting } from '../src/client/settings.ts'

const cleanup: Array<() => Promise<void>> = []
afterEach(async () => { for (const close of cleanup.splice(0)) await close() })

async function host(fail = false, beforeSave?: () => Promise<void>) {
  const values = new Map<string, string>()
  const routes = new Map<string, WebRoute>()
  const disposers: Array<() => void | Promise<void>> = []
  const mount = () => apply({
    credentials: {
      set: async (ref: string, value: string) => {
        await beforeSave?.()
        if (fail) throw new Error(`refused secret: ${value}`)
        values.set(ref, value)
      },
      resolve: async (ref: string) => values.has(ref) ? { value: values.get(ref) } : undefined,
    },
    webServer: { register: (route: WebRoute) => { routes.set(route.path, route); return () => { routes.delete(route.path) } } },
    effect: (callback: () => () => void | Promise<void>) => { disposers.push(callback()) },
  } as unknown as Context, { cookieEnv: 'CUSTOM_COOKIE', fundKeyEnv: 'CUSTOM_FUND' })
  const unmount = async () => { for (const dispose of disposers.splice(0)) await dispose() }
  mount()
  const server = createServer((req, res) => {
    const route = routes.get(req.url!)
    if (!route) { res.writeHead(404); res.end(); return }
    void route.handler(req, res)
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  cleanup.push(async () => {
    await unmount()
    await new Promise<void>(resolve => server.close(() => resolve()))
  })
  return { values, url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    reload: async () => { await unmount(); mount() },
  }
}
const json = (value: unknown): RequestInit => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ value }) })

describe('settings host routes', () => {
  it('persists cookie and fund key through configured references and never echoes secrets', async () => {
    const h = await host()
    const response = await fetch(`${h.url}/api/stock-pnl/cookie`, json(' userid=1; sid=abc\n def '))
    assert.equal(response.status, 200)
    assert.deepEqual(await response.json(), { saved: true })
    assert.equal(h.values.get('CUSTOM_COOKIE'), 'userid=1; sid=abcdef')
    assert.equal((await fetch(`${h.url}/api/stock-pnl/fund-key`, json(' account-2 '))).status, 200)
    assert.equal(h.values.get('CUSTOM_FUND'), 'account-2')
  })

  it('rejects GET, cross-site, malformed, oversized, and empty submissions', async () => {
    const h = await host()
    const url = `${h.url}/api/stock-pnl/cookie`
    assert.equal((await fetch(url)).status, 405)
    assert.equal((await fetch(url, { ...json('secret'), headers: { 'Content-Type': 'application/json', Origin: 'https://other.test' } })).status, 403)
    assert.equal((await fetch(url, { ...json('secret'), headers: { 'Content-Type': 'text/plain' } })).status, 415)
    assert.equal((await fetch(url, { ...json('secret'), body: '{' })).status, 400)
    assert.equal((await fetch(url, json(' '.repeat(4)))).status, 400)
    assert.equal((await fetch(url, json('s'.repeat(70_000)))).status, 413)
    assert.equal(h.values.size, 0)
  })

  it('reports persistence errors without exposing the submitted credential', async () => {
    const h = await host(true)
    const response = await fetch(`${h.url}/api/stock-pnl/cookie`, json('sid=private-test'))
    assert.equal(response.status, 500)
    assert.ok(!(await response.text()).includes('private-test'))
    assert.equal(h.values.size, 0)
  })

  it('rejects normalized-empty cookies without replacing the existing credential', async () => {
    const h = await host()
    const url = `${h.url}/api/stock-pnl/cookie`
    assert.equal((await fetch(url, json('userid=existing'))).status, 200)
    for (const value of [';;;', ' ; \n ; \t ; ', null, 123]) {
      assert.equal((await fetch(url, json(value))).status, 400)
      assert.equal(h.values.get('CUSTOM_COOKIE'), 'userid=existing')
    }
  })

  it('rejects overlapping HTTP writes and exposes only pending status', async () => {
    let release!: () => void
    let started!: () => void
    const pending = new Promise<void>(resolve => { release = resolve })
    const writing = new Promise<void>(resolve => { started = resolve })
    const h = await host(false, () => { started(); return pending })
    const url = `${h.url}/api/stock-pnl/cookie`
    const first = fetch(url, json('userid=old'))
    await writing
    try {
      assert.equal((await fetch(url, json('userid=new'))).status, 409)
      const status = await (await fetch(`${h.url}/api/stock-pnl/acquire/status`)).json() as { pending_save?: boolean }
      assert.equal(status.pending_save, true)
      assert.ok(!JSON.stringify(status).includes('userid='))
    } finally { release() }
    assert.equal((await first).status, 200)
    assert.equal((await fetch(url, json('userid=new'))).status, 200)
    assert.equal(h.values.get('CUSTOM_COOKIE'), 'userid=new')
  })

  it('saves from the client without any connection.api and propagates server failures', async () => {
    const h = await host()
    const original = globalThis.fetch
    globalThis.fetch = (input, init) => original(`${h.url}${String(input)}`, init)
    try {
      await saveSetting('cookie', 'userid=test')
      assert.equal(h.values.get('CUSTOM_COOKIE'), 'userid=test')
      await assert.rejects(saveSetting('cookie', ''), /不能为空/)
    } finally { globalThis.fetch = original }
  })

  it('preserves write exclusion when the plugin is re-applied to a fresh context', async () => {
    let release!: () => void
    let started!: () => void
    const pending = new Promise<void>(resolve => { release = resolve })
    const writing = new Promise<void>(resolve => { started = resolve })
    let calls = 0
    const h = await host(false, () => { if (++calls === 1) { started(); return pending }; return Promise.resolve() })
    const url = `${h.url}/api/stock-pnl/cookie`
    const first = fetch(url, json('userid=old'))
    await writing
    try {
      await h.reload()
      const status = await (await fetch(`${h.url}/api/stock-pnl/acquire/status`)).json() as { pending_save?: boolean }
      assert.equal(status.pending_save, true)
      assert.equal((await fetch(url, json('userid=new'))).status, 409)
      assert.equal(calls, 1)
    } finally { release(); await first }
    assert.equal((await fetch(url, json('userid=new'))).status, 200)
    assert.equal(h.values.get('CUSTOM_COOKIE'), 'userid=new')
  })
})
