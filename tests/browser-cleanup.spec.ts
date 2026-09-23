import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { setImmediate as nextTurn } from 'node:timers/promises'
import { BrowserCleanup } from '../src/browser-cleanup.ts'

function fixture(remove = async () => {}) {
  let exit!: () => void
  let removals = 0
  let kills = 0
  const cleanup = new BrowserCleanup({
    exit: new Promise<void>(resolve => { exit = resolve }),
    requestClose: async () => {},
    kill: () => { kills++ },
    dispose: () => {},
    removeProfile: async () => { removals++; await remove() },
    killMs: 0,
    timeoutMs: 10,
  })
  return { cleanup, exit, removals: () => removals, kills: () => kills }
}

describe('browser profile cleanup', () => {
  it('never deletes a live profile and still cleans up after a close timeout', async () => {
    const f = fixture()
    await assert.rejects(f.cleanup.close(), /关闭超时/)
    assert.equal(f.kills(), 1)
    assert.equal(f.removals(), 0)
    assert.equal(f.cleanup.pending, true)
    f.exit()
    await nextTurn()
    assert.equal(f.removals(), 1)
    assert.equal(f.cleanup.pending, false)
    await f.cleanup.close()
    assert.equal(f.removals(), 1)
  })

  it('cleans up when the user closes the browser without calling close', async () => {
    const f = fixture()
    f.exit()
    await nextTurn()
    assert.equal(f.cleanup.pending, false)
    assert.equal(f.removals(), 1)
  })

  it('reports removal failures and permits a later retry', async () => {
    let locked = true
    const f = fixture(async () => { if (locked) throw new Error('profile locked') })
    f.exit()
    await nextTurn() // The background rejection must be observed, not unhandled.
    assert.equal(f.cleanup.pending, true)
    await assert.rejects(f.cleanup.close(), /profile locked/)
    locked = false
    await f.cleanup.close()
    assert.equal(f.cleanup.pending, false)
  })

  it('deduplicates closes and trusts exit even if the pipe response never arrives', async () => {
    let exit!: () => void
    let removals = 0
    const cleanup = new BrowserCleanup({
      exit: new Promise<void>(resolve => { exit = resolve }),
      requestClose: () => new Promise(() => {}),
      kill: () => {}, dispose: () => {},
      removeProfile: async () => { removals++ },
    })
    const first = cleanup.close()
    assert.equal(cleanup.close(), first)
    exit()
    await first
    assert.equal(removals, 1)
  })
})
