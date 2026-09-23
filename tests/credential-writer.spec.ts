import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { setImmediate as nextTurn } from 'node:timers/promises'
import { CredentialWriter } from '../src/credential-writer.ts'

function deferred() {
  let resolve!: () => void
  let reject!: (error: Error) => void
  const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

describe('credential write deadlines and cancellation', () => {
  it('bounds the wait but locks subsequent writes until the timed-out provider settles', async () => {
    const pending = deferred()
    const values: string[] = []
    const writer = new CredentialWriter(async value => {
      if (value === 'old') await pending.promise
      values.push(value)
    }, 10)
    await assert.rejects(writer.save('old'), /超时/)
    assert.equal(writer.pending, true)
    await assert.rejects(writer.save('new'), /仍在处理中/)
    assert.deepEqual(values, [])
    pending.resolve()
    await nextTurn()
    await writer.save('new')
    assert.deepEqual(values, ['old', 'new'])
    assert.equal(writer.pending, false)
  })

  it('observes late provider rejection and releases the lock without exposing secrets', async () => {
    const pending = deferred()
    const writer = new CredentialWriter(() => pending.promise, 10)
    await assert.rejects(writer.save('secret'), /超时/)
    pending.reject(new Error('secret-cookie'))
    await nextTurn()
    assert.equal(writer.pending, false)
    await assert.rejects(writer.save('next'), error => {
      assert.match(String(error), /保存凭据失败/)
      assert.ok(!String(error).includes('secret-cookie'))
      return true
    })
  })

  it('cancels the caller promptly while tracking an already-started write', async () => {
    const pending = deferred()
    const started = deferred()
    const controller = new AbortController()
    const writer = new CredentialWriter(() => { started.resolve(); return pending.promise })
    const writing = writer.save('old', controller.signal)
    await started.promise
    controller.abort()
    await assert.rejects(writing, /停止等待/)
    assert.equal(writer.pending, true)
    await assert.rejects(writer.save('new'), /仍在处理中/)
    pending.resolve()
    await nextTurn()
    assert.equal(writer.pending, false)
  })

  it('does not start a write if cancellation happened before dispatch', async () => {
    const controller = new AbortController()
    const writer = new CredentialWriter(async () => assert.fail('unexpected write'))
    const writing = writer.save('secret', controller.signal)
    controller.abort()
    await assert.rejects(writing, /停止等待/)
    await nextTurn()
    assert.equal(writer.pending, false)
    await assert.rejects(writer.save('secret', controller.signal), /停止等待/)
  })

  it('shares pending writes by reference across new instances and module reloads', async () => {
    const pending = deferred()
    const values: string[] = []
    const oldWriter = new CredentialWriter(async value => { await pending.promise; values.push(value) }, 10, 'TEST_RELOAD_COOKIE')
    await assert.rejects(oldWriter.save('old'), /超时/)
    // A fresh module instance models hot reload without retaining the old class or closure.
    const { CredentialWriter: ReloadedWriter } = await import('../src/credential-writer.ts?reload=regression')
    const newWriter = new ReloadedWriter(async value => { values.push(value) }, 10, 'TEST_RELOAD_COOKIE')
    try {
      assert.equal(newWriter.pending, true)
      await assert.rejects(newWriter.save('new'), /仍在处理中/)
      assert.deepEqual(values, [])
      const other = new ReloadedWriter(async value => { values.push(value) }, 10, 'TEST_OTHER_COOKIE')
      await other.save('unrelated')
    } finally {
      pending.resolve()
      await nextTurn()
    }
    assert.equal(newWriter.pending, false)
    await newWriter.save('new')
    assert.deepEqual(values, ['unrelated', 'old', 'new'])
  })

  it('keeps a shared lock after cancellation and releases it on late provider failure', async () => {
    const pending = deferred()
    const started = deferred()
    const controller = new AbortController()
    const oldWriter = new CredentialWriter(() => { started.resolve(); return pending.promise }, 30_000, 'TEST_CANCEL_COOKIE')
    const saving = oldWriter.save('old', controller.signal)
    await started.promise
    controller.abort()
    await assert.rejects(saving, /停止等待/)
    let saved = ''
    const newWriter = new CredentialWriter(async value => { saved = value }, 30_000, 'TEST_CANCEL_COOKIE')
    try {
      await assert.rejects(newWriter.save('new'), /仍在处理中/)
      assert.equal(saved, '')
    } finally {
      pending.reject(new Error('private provider error'))
      await nextTurn()
    }
    await newWriter.save('new')
    assert.equal(saved, 'new')
  })
})
