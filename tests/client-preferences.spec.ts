import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { runInNewContext } from 'node:vm'
import { it } from 'node:test'
import React from 'react'
import TestRenderer from 'react-test-renderer'
import ts from 'typescript'
import type { ConfigFormSnapshot } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { CardPreferences } from '../src/preferences.ts'

const { act } = TestRenderer
const sources = new Map(await Promise.all(['Preferences', 'StockPnlCard', 'components'].map(async name => {
  const url = new URL(`../src/client/${name}.tsx`, import.meta.url)
  return [name, { url, compiled: ts.transpileModule(await readFile(url, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText }] as const
})))

class Form {
  state: ConfigFormSnapshot<CardPreferences> = {
    status: 'ready', value: { pollMs: 20_000, showCard: true },
    base: {}, user: {}, revision: 1, writable: true,
  }
  listeners = new Set<() => void>()
  writes: unknown[] = []
  fail = false
  refuse = false
  getSnapshot() { return this.state }
  subscribe(listener: () => void) { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
  update(next: Partial<ConfigFormSnapshot<CardPreferences>>) {
    this.state = { ...this.state, ...next }
    for (const listener of this.listeners) listener()
  }
  async mutate(ops: { path: string[]; value: unknown }[], revision: number) {
    this.writes.push({ ops, revision })
    if (this.fail) throw new Error('offline')
    if (this.refuse) return false
    this.update({ value: Object.fromEntries(ops.map(op => [op.path[0], op.value])) as unknown as CardPreferences, revision: revision + 1 })
    return true
  }
}

function components() {
  let requests = 0, pnlRequests = 0, failed = false, id = 0
  const timers = new Map<number, { callback: () => void; ms: number }>()
  const sandbox = {
    fetch: async (url: string) => {
      requests++
      if (url === '/api/stock-pnl/selection') return {ok:true,json:async()=>({fund_key:''})}
      pnlRequests++
      if (failed) throw new Error('offline')
      return { ok: true, json: async () => ({ pnl_pct: 1, pnl_yk: 10, sh_pct: 0, chart_data: [], updated_at: '2026-10-18T01:00:00Z', error: '', token_expired: false, poll_ms: 20_000 }) }
    },
    localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} }, AbortController,
    setTimeout: (callback: () => void, ms: number) => { timers.set(++id, { callback, ms }); return id },
    clearTimeout: (key: number) => { timers.delete(key) },
  }
  function load(name: string): Record<string, React.ComponentType<any>> {
    const { url, compiled } = sources.get(name)!
    const require = createRequire(url)
    const module = { exports: {} }
    const evaluate = runInNewContext(`(function(require, module, exports) { ${compiled}\n})`, sandbox)
    evaluate((id: string) => id.endsWith('.css')
      ? { __esModule: true, default: new Proxy({}, { get: (_target, key) => key }) }
      : id === './StockPnlCard.tsx' ? load('StockPnlCard') : id === './Preferences.tsx' ? load('Preferences') : require(id), module, module.exports)
    return module.exports
  }
  return { ...load('Preferences'), ...load('components'), timers, pnlRequests: () => pnlRequests, requests: () => requests, fail: () => { failed = true } }
}

it('persists only valid preferences, reports refused/failed writes and honors read-only forms', async t => {
  const { Preferences } = components()
  const form = new Form()
  let view: ReturnType<typeof TestRenderer.create>
  await act(async () => { view = TestRenderer.create(React.createElement(Preferences, { preferences: form, t: (key: string) => key })) })
  t.after(async () => { await act(async () => view.unmount()) })
  const number = () => view.root.findByProps({ type: 'number' })
  const save = () => view.root.findByType('button')
  const change = async (value: string) => act(async () => number().props.onChange({ target: { value } }))
  for (const value of ['', '999', '1000.5', '2147483648']) {
    await change(value)
    assert.equal(save().props.disabled, true)
  }
  assert.equal(form.writes.length, 0)
  await change('5000')
  await act(async () => view.root.findByProps({ role: 'switch' }).props.onChange({ target: { checked: false } }))
  form.fail = true
  await act(async () => save().props.onClick())
  assert.equal(view.root.findByProps({ role: 'alert' }).children.join(''), 'failed')
  assert.equal(form.state.value!.showCard, true)
  form.fail = false
  form.refuse = true
  await act(async () => save().props.onClick())
  assert.equal(view.root.findByProps({ role: 'alert' }).children.join(''), 'conflict')
  form.refuse = false
  await act(async () => save().props.onClick())
  assert.deepEqual(form.state.value, { pollMs: 5000, showCard: false })
  assert.equal((form.writes[2] as { revision: number }).revision, 1)
  assert.equal(view.root.findByProps({ role: 'status' }).children.join(''), 'saved')
  await act(async () => form.update({ writable: false }))
  assert.equal(number().props.disabled, true)
  assert.equal(save().props.disabled, true)
})

it('uses accepted polling preferences live, retains a good snapshot, and stops polling while hidden', async t => {
  const h = components()
  const form = new Form()
  form.state = { ...form.state, status: 'loading', value: undefined }
  let view: ReturnType<typeof TestRenderer.create>
  await act(async () => { view = TestRenderer.create(React.createElement(h.StockPnlOverlay, { preferences: form, onSaveCookie: async () => {}, onSaveFundKey: async () => {} })) })
  t.after(async () => { await act(async () => view.unmount()) })
  assert.equal(h.requests(), 0)
  await act(async () => form.update({ status: 'ready', value: { pollMs: 20_000, showCard: true } }))
  assert.equal(h.requests(), 1)
  assert.deepEqual([...h.timers.values()].map(timer => timer.ms), [20_000])
  const updated = view.root.findByProps({ className: 'footer' }).children.join('')
  h.fail()
  await act(async () => form.update({ value: { pollMs: 5000, showCard: true } }))
  assert.deepEqual([...h.timers.values()].map(timer => timer.ms), [5000])
  assert.equal(view.root.findByProps({ className: 'footer' }).children.join(''), updated)
  assert(JSON.stringify(view.toJSON()).includes('+1.00%'))
  await act(async () => form.update({ value: { pollMs: 5000, showCard: false } }))
  assert.equal(view.toJSON(), null)
  assert.equal(h.timers.size, 0)
  const count = h.requests()
  await act(async () => form.update({ value: { pollMs: 1000, showCard: false } }))
  assert.equal(h.requests(), count)
  await act(async () => form.update({ value: { pollMs: 1000, showCard: true } }))
  assert.equal(h.requests(), count + 1)
  assert.deepEqual([...h.timers.values()].map(timer => timer.ms), [1000])
})


it('loads the overlay only for its own component and preserves its snapshot when Skill toggles', async t => {
  const h = components()
  const Store = h.ComponentStore as unknown as new () => { update(state: {card:boolean;skill:boolean;revision:number}):void }
  const store = new Store()
  store.update({card:false,skill:true,revision:0})
  const form = new Form()
  let view: ReturnType<typeof TestRenderer.create>
  await act(async()=>{view=TestRenderer.create(React.createElement(h.ComponentOverlay,{components:store,preferences:form,onSaveCookie:async()=>{},onSaveFundKey:async()=>{}}))})
  t.after(async()=>{await act(async()=>view.unmount())})
  assert.equal(view.toJSON(),null)
  assert.equal(h.requests(),0,'Skill-only mode starts no card requests')
  await act(async()=>store.update({card:true,skill:true,revision:0}))
  assert.equal(h.pnlRequests(),1)
  assert.equal(h.timers.size,1)
  const footer=view.root.findByProps({className:'footer'}).children.join('')
  await act(async()=>store.update({card:true,skill:false,revision:0}))
  assert.equal(h.pnlRequests(),1,'Skill disablement does not restart card polling')
  assert.equal(view.root.findByProps({className:'footer'}).children.join(''),footer)
  await act(async()=>store.update({card:false,skill:true,revision:0}))
  assert.equal(view.toJSON(),null)
  assert.equal(h.timers.size,0)
  await act(async()=>form.update({value:{pollMs:1000,showCard:true}}))
  assert.equal(h.pnlRequests(),1,'Visibility preference cannot enable a disabled card component')
})
