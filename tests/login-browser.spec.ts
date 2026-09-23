import assert from 'node:assert/strict'
import childProcess from 'node:child_process'
import { EventEmitter } from 'node:events'
import fs from 'node:fs/promises'
import { syncBuiltinESMExports } from 'node:module'
import { PassThrough } from 'node:stream'
import { afterEach, describe, it, mock } from 'node:test'
import { setImmediate as nextTurn } from 'node:timers/promises'
import { launchLoginBrowser, LoginBrowserLaunchError } from '../src/login-browser.ts'

function fixture() {
  const profiles: string[] = []
  const removed: string[] = []
  let attempts = 0
  mock.method(fs, 'access', async () => {
    if (attempts++ > 0) throw new Error('no other installed browser')
  })
  mock.method(fs, 'mkdtemp', async () => {
    const profile = `mock-login-profile-${profiles.length}`
    profiles.push(profile)
    return profile
  })
  mock.method(fs, 'rm', async (profile: string) => { removed.push(profile) })
  return { profiles, removed }
}

afterEach(() => {
  mock.restoreAll()
  syncBuiltinESMExports()
})

describe('browser launch failure cleanup', () => {
  it('removes the profile when spawn throws synchronously', async () => {
    const f = fixture()
    mock.method(childProcess, 'spawn', () => { throw new Error('synchronous spawn failure') })
    syncBuiltinESMExports()

    await assert.rejects(launchLoginBrowser('http://example.invalid'), /无法启动登录浏览器/)
    assert.equal(f.profiles.length, 1)
    assert.deepEqual(f.removed, f.profiles)
  })

  it('retains cleanup ownership if profile removal fails before a process starts', async () => {
    const f = fixture()
    let locked = true
    mock.method(fs, 'rm', async (profile: string) => {
      if (locked) throw new Error('profile locked')
      f.removed.push(profile)
    })
    const spawn = mock.method(childProcess, 'spawn', () => { throw new Error('synchronous spawn failure') })
    // A cleanup failure must stop fallback even if another browser is installed.
    mock.method(fs, 'access', async () => {})
    syncBuiltinESMExports()

    let failure: LoginBrowserLaunchError | undefined
    await assert.rejects(launchLoginBrowser('http://example.invalid'), error => {
      assert.ok(error instanceof LoginBrowserLaunchError)
      failure = error
      return true
    })
    assert.ok(failure)
    assert.equal(spawn.mock.callCount(), 1)
    assert.equal(failure.browser.cleanupPending, true)
    assert.equal(await failure.browser.isClosed(), true)
    assert.deepEqual(f.removed, [])

    locked = false
    await failure.browser.close()
    assert.equal(failure.browser.cleanupPending, false)
    assert.deepEqual(f.removed, f.profiles)
  })

  it('waits for process exit after pipe setup fails, even when kill emits an error', async () => {
    const f = fixture()
    let kills = 0
    const child = Object.assign(new EventEmitter(), {
      pid: 1234,
      // A missing pipe makes BrowserPipe construction fail after spawn succeeds.
      stdio: [null, null, null, null, null],
      kill() {
        kills++
        this.emit('error', new Error('simulated kill failure'))
        return false
      },
    })
    mock.method(childProcess, 'spawn', () => child)
    syncBuiltinESMExports()

    const rejected = assert.rejects(launchLoginBrowser('http://example.invalid'), /无法启动登录浏览器/)
    try {
      await nextTurn()
      assert.equal(kills, 1)
      assert.equal(f.profiles.length, 1)
      assert.deepEqual(f.removed, [], 'an error does not prove that a running process exited')
    } finally {
      child.emit('exit', 0)
      await rejected
    }
    assert.deepEqual(f.removed, f.profiles)
  })

  it('cleans up an asynchronous spawn failure with no process id', async () => {
    const f = fixture()
    const child = Object.assign(new EventEmitter(), {
      pid: undefined,
      stdio: [null, null, null, new PassThrough(), new PassThrough()],
      kill() { assert.fail('there is no process to terminate') },
    })
    mock.method(childProcess, 'spawn', () => {
      queueMicrotask(() => child.emit('error', new Error('executable disappeared')))
      return child
    })
    syncBuiltinESMExports()

    await assert.rejects(launchLoginBrowser('http://example.invalid'), /无法启动登录浏览器/)
    assert.equal(f.profiles.length, 1)
    assert.deepEqual(f.removed, f.profiles)
  })
})
