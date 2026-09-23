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
})
