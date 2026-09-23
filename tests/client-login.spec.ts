import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { runInNewContext } from 'node:vm'
import { describe, it, type TestContext } from 'node:test'
import React from 'react'
import TestRenderer from 'react-test-renderer'
import ts from 'typescript'
import type { AcquireStatusView } from '../src/types.ts'

const { act } = TestRenderer
const sourceUrl = new URL('../src/client/StockPnlCard.tsx', import.meta.url)
// Exercise the real component and React effects; only browser IO and CSS are stubbed.
const compiled = ts.transpileModule(await readFile(sourceUrl, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
}).outputText
const require = createRequire(sourceUrl)

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}

async function card(t: TestContext) {
  const stored = new Map([['stock-pnl-fund-key', 'old-fund']])
  const intervals = new Map<number, () => void>()
  const statuses: Promise<AcquireStatusView>[] = []
  const calls: string[] = []
  const fundWrites: string[] = []
  let timer = 0
  const host = {
    status: { state: 'idle' } as AcquireStatusView,
    fund: 'old-fund',
    startReply: undefined as Promise<AcquireStatusView> | undefined,
    save: async () => {},
  }
  const fetch = async (url: string) => {
    calls.push(url)
    let value: unknown
    switch (url) {
      case '/api/stock-pnl/acquire':
        host.status = { state: 'acquiring' }
        value = host.startReply ?? host.status
        break
      case '/api/stock-pnl/acquire/status': value = statuses.shift() ?? host.status; break
      case '/api/stock-pnl/acquire/cancel': host.status = { state: 'idle' }; value = host.status; break
      case '/api/stock-pnl/verify': value = { configured: true, valid: host.status.state === 'saved' }; break
      case '/api/stock-pnl/portfolios': value = [{ fund_key: host.fund, manualname: 'test', brokername: 'test' }]; break
      case '/api/stock-pnl': value = { pnl_pct: 0, pnl_yk: 0, sh_pct: 0, chart_data: [], updated_at: '2026-09-23T00:00:00Z', error: '', token_expired: false, poll_ms: 20_000 }; break
      default: assert.fail(`unexpected request: ${url}`)
    }
    // Delaying json() also catches responses whose headers arrived before cancellation.
    return { ok: true, json: async () => value }
  }
  const module = { exports: {} as { StockPnlCard: React.ComponentType } }
  const evaluate = runInNewContext(`(function(require, module, exports) { ${compiled}\n})`, {
    fetch,
    localStorage: {
      getItem: (key: string) => stored.get(key) ?? null,
      setItem: (key: string, value: string) => stored.set(key, value),
      removeItem: (key: string) => stored.delete(key),
    },
    window: { setInterval: (callback: () => void) => { intervals.set(++timer, callback); return timer }, clearInterval: (id: number) => intervals.delete(id) },
    setTimeout: () => ++timer, clearTimeout: () => {},
  })
  evaluate((id: string) => id.endsWith('.css')
    ? { __esModule: true, default: new Proxy({}, { get: (_target, key) => key }) }
    : require(id), module, module.exports)
  let renderer: ReturnType<typeof TestRenderer.create>
  await act(async () => {
    renderer = TestRenderer.create(React.createElement(module.exports.StockPnlCard, {
      onSaveCookie: () => host.save(),
      onSaveFundKey: async (value: string) => { fundWrites.push(value) },
    }))
  })
  t.after(async () => { await act(async () => renderer.unmount()) })
  return {
    host, stored, calls, fundWrites, statuses,
    text: () => JSON.stringify(renderer.toJSON()),
    toggle: () => act(async () => { renderer.root.findByProps({ 'aria-label': '设置 Cookie' }).props.onClick() }),
    click: (label: string) => act(async () => {
      const button = renderer.root.findAllByType('button').find(node => node.children.join('').includes(label))
      assert.ok(button, `missing button: ${label}`)
      assert.ok(!button.props.disabled, `disabled button: ${label}`)
      button.props.onClick()
    }),
    tick: () => act(async () => { for (const callback of [...intervals.values()]) callback() }),
    draft: (value: string) => act(async () => { renderer.root.findByProps({ id: 'stock-pnl-cookie' }).props.onChange({ target: { value } }) }),
    select: (value: string) => act(async () => { await renderer.root.findByType('select').props.onChange({ target: { value } }) }),
  }
}

describe('login completion in the settings card', () => {
  it('refreshes the selected portfolio when reopening observes saved before the poll', async t => {
    const h = await card(t)
    await h.toggle()
    await h.click('自动获取 Cookie')
    await h.toggle()
    h.host.status = { state: 'saved' }
    h.host.fund = 'new-fund'
    const before = h.calls.filter(url => url.endsWith('/verify')).length
    await h.toggle()
    assert.equal(h.stored.get('stock-pnl-fund-key'), 'new-fund')
    assert.deepEqual(h.fundWrites, ['new-fund'])
    assert.ok(h.calls.filter(url => url.endsWith('/verify')).length > before + 1, 'completion re-verifies beyond the opening-panel check')
    assert.match(h.text(), /已自动获取并保存 Cookie/)
  })

  it('does not repeat completion when polling and panel refresh return saved again', async t => {
    const h = await card(t)
    await h.toggle()
    await h.click('自动获取 Cookie')
    h.host.status = { state: 'saved', cleanup_pending: true }
    h.host.fund = 'new-fund'
    await h.tick()
    assert.deepEqual(h.fundWrites, ['new-fund'])
    await h.select('chosen-fund')
    await h.tick()
    await h.toggle()
    await h.toggle()
    assert.equal(h.stored.get('stock-pnl-fund-key'), 'chosen-fund')
    assert.deepEqual(h.fundWrites, ['new-fund', 'chosen-fund'])
  })

  it('completes a saved status recovered after a failed manual request', async t => {
    const h = await card(t)
    await h.toggle()
    await h.draft('userid=test')
    h.host.save = async () => {
      h.host.status = { state: 'saved' }
      h.host.fund = 'recovered-fund'
      throw new Error('request failed')
    }
    await h.click('保存')
    assert.equal(h.stored.get('stock-pnl-fund-key'), 'recovered-fund')
    assert.deepEqual(h.fundWrites, ['recovered-fund'])
  })

  it('runs completion again for a new login after the previous run completed', async t => {
    const h = await card(t)
    await h.toggle()
    await h.click('自动获取 Cookie')
    h.host.status = { state: 'saved', cleanup_pending: true }
    h.host.fund = 'first-fund'
    await h.tick()
    await h.click('重试清理')
    await h.click('自动获取 Cookie')
    h.host.status = { state: 'saved' }
    h.host.fund = 'second-fund'
    await h.tick()
    assert.equal(h.stored.get('stock-pnl-fund-key'), 'second-fund')
    assert.deepEqual(h.fundWrites, ['first-fund', 'second-fund'])
  })

  it('ignores an old panel response arriving during a new browser launch', async t => {
    const h = await card(t)
    const oldStatus = deferred<AcquireStatusView>()
    const launch = deferred<AcquireStatusView>()
    h.statuses.push(oldStatus.promise)
    h.host.startReply = launch.promise
    await h.toggle()
    await h.click('自动获取 Cookie')
    await act(async () => { oldStatus.resolve({ state: 'saved' }) })
    assert.doesNotMatch(h.text(), /已自动获取并保存 Cookie/)
    assert.equal(h.stored.get('stock-pnl-fund-key'), 'old-fund')
    assert.deepEqual(h.fundWrites, [])
    await act(async () => { launch.resolve({ state: 'acquiring' }) })
    assert.match(h.text(), /正在登录/)
  })

  it('ignores a saved poll response whose body arrives after cancellation', async t => {
    const h = await card(t)
    await h.toggle()
    await h.click('自动获取 Cookie')
    const oldStatus = deferred<AcquireStatusView>()
    h.statuses.push(oldStatus.promise)
    await h.tick()
    await h.click('取消')
    await act(async () => { oldStatus.resolve({ state: 'saved' }) })
    assert.doesNotMatch(h.text(), /已自动获取并保存 Cookie/)
    assert.equal(h.stored.get('stock-pnl-fund-key'), 'old-fund')
    assert.deepEqual(h.fundWrites, [])
  })
})
