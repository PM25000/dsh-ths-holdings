import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { PassThrough } from 'node:stream'
import { setImmediate as nextTurn } from 'node:timers/promises'
import { CookieAcquirer, cookiesToHeader, isSignedIn } from '../src/acquire.ts'
import { BrowserPipe, LoginBrowserLaunchError, type LoginCookie, type LoginBrowser } from '../src/login-browser.ts'

const cookie = (name: string, value: string, domain = '.10jqka.com.cn'): LoginCookie => ({ name, value, domain, path: '/' })
function fixture() {
  let cookies: readonly LoginCookie[] = []
  let closed = false
  const browser: LoginBrowser = {
    cookies: async () => cookies,
    isClosed: async () => closed,
    close: async () => { closed = true },
  }
  return { browser, setCookies: (next: LoginCookie[]) => { cookies = next }, closed: () => closed }
}
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}

describe('human login acquisition', () => {
  it('accepts only nonempty userid on the exact ledger domain or subdomains', () => {
    assert.equal(isSignedIn([cookie('userid', '1')]), true)
    assert.equal(isSignedIn([cookie('userid', '', '10jqka.com.cn')]), false)
    assert.equal(isSignedIn([cookie('userid', '1', 'evil10jqka.com.cn')]), false)
    assert.equal(isSignedIn([cookie('userid', '1', '10jqka.com.cn.evil.test')]), false)
    assert.equal(cookiesToHeader([cookie('userid', '1'), cookie('sid', 'private', 'other.test')]), 'userid=1')
  })

  it('waits for login, saves once, and closes the window', async t => {
    const f = fixture()
    const saved: string[] = []
    const acquirer = new CookieAcquirer({ launchBrowser: async () => f.browser, save: async value => { saved.push(value) } })
    t.after(() => acquirer.dispose())
    assert.equal((await acquirer.start()).state, 'acquiring')
    assert.equal((await acquirer.check()).state, 'acquiring')
    f.setCookies([cookie('userid', '1'), cookie('sid', 'test'), cookie('secret', 'other', 'other.test')])
    const results = await Promise.all([acquirer.check(), acquirer.check()])
    assert.ok(results.every(result => result.state === 'saved'))
    assert.deepEqual(saved, ['userid=1; sid=test'])
    assert.equal(f.closed(), true)
  })

  it('times out and closes the owned browser', async t => {
    const f = fixture()
    let now = 0
    const acquirer = new CookieAcquirer({ launchBrowser: async () => f.browser, save: async () => assert.fail('unexpected save'), now: () => now, timeoutMs: 10 })
    t.after(() => acquirer.dispose())
    await acquirer.start()
    now = 11
    const result = await acquirer.check()
    assert.equal(result.state, 'failed')
    assert.match(result.error!, /超时/)
    assert.equal(f.closed(), true)
  })

  it('reports manual window closure and supports a retry', async t => {
    let f = fixture()
    const acquirer = new CookieAcquirer({ launchBrowser: async () => f.browser, save: async () => {} })
    t.after(() => acquirer.dispose())
    await acquirer.start()
    await f.browser.close()
    assert.match((await acquirer.check()).error!, /窗口已关闭/)
    f = fixture()
    assert.equal((await acquirer.start()).state, 'acquiring')
  })

  it('does not expose a credential provider error containing a cookie', async t => {
    const f = fixture()
    f.setCookies([cookie('userid', '1')])
    const acquirer = new CookieAcquirer({ launchBrowser: async () => f.browser, save: async () => { throw new Error('secret-cookie') } })
    t.after(() => acquirer.dispose())
    await acquirer.start()
    const result = await acquirer.check()
    assert.equal(result.state, 'failed')
    assert.match(result.error!, /保存凭据失败/)
    assert.ok(!JSON.stringify(result).includes('secret-cookie'))
    assert.equal(f.closed(), true)
  })

  it('deduplicates starts and closes a launch that completes after cancellation', async () => {
    const f = fixture()
    const launch = deferred<LoginBrowser>()
    let launches = 0
    const acquirer = new CookieAcquirer({ launchBrowser: () => { launches++; return launch.promise }, save: async () => assert.fail('unexpected save') })
    const first = acquirer.start()
    const second = acquirer.start()
    const cancelled = acquirer.cancel()
    launch.resolve(f.browser)
    await Promise.all([first, second, cancelled])
    assert.equal(launches, 1)
    assert.equal(acquirer.status().state, 'idle')
    assert.equal(f.closed(), true)
  })

  it('does not save cookies returned after cancellation', async () => {
    const f = fixture()
    const cookies = deferred<readonly LoginCookie[]>()
    const reading = deferred<void>()
    f.browser.cookies = () => { reading.resolve(); return cookies.promise }
    const acquirer = new CookieAcquirer({ launchBrowser: async () => f.browser, save: async () => assert.fail('unexpected save') })
    await acquirer.start()
    const checking = acquirer.check()
    await reading.promise
    const cancelling = acquirer.cancel()
    cookies.resolve([cookie('userid', '1')])
    await Promise.all([checking, cancelling])
    assert.equal(acquirer.status().state, 'idle')
    assert.equal(f.closed(), true)
  })

  it('reports a browser launch failure with a useful hint', async () => {
    const acquirer = new CookieAcquirer({ launchBrowser: async () => { throw new Error('no browser') }, save: async () => {} })
    const result = await acquirer.start()
    assert.equal(result.state, 'failed')
    assert.match(result.hint!, /Edge.*Chrome/)
    await acquirer.dispose()
  })

  it('times out a stuck save, closes the browser, and prevents manual or automatic overwrite', async t => {
    const f = fixture()
    f.setCookies([cookie('userid', 'old')])
    const pending = deferred<void>()
    const values: string[] = []
    let launches = 0
    const acquirer = new CookieAcquirer({
      launchBrowser: async () => { launches++; return f.browser },
      save: async value => { await pending.promise; values.push(value) }, saveTimeoutMs: 10,
    })
    t.after(() => acquirer.dispose())
    await acquirer.start()
    const result = await acquirer.check()
    assert.equal(result.state, 'failed')
    assert.equal(result.pending_save, true)
    assert.match(result.error!, /超时/)
    assert.equal(f.closed(), true)
    await assert.rejects(acquirer.saveCookie('userid=new'), /仍在处理中/)
    await acquirer.start()
    assert.equal(launches, 1)
    pending.resolve()
    await nextTurn()
    assert.equal(acquirer.status().pending_save, undefined)
    assert.equal(acquirer.status().state, 'failed')
    await acquirer.saveCookie('userid=new')
    assert.deepEqual(values, ['userid=old', 'userid=new'])
  })

  it('cancels and disposes without waiting for an unabortable credential write', { timeout: 1000 }, async () => {
    const f = fixture()
    f.setCookies([cookie('userid', 'old')])
    const pending = deferred<void>()
    const writing = deferred<void>()
    const acquirer = new CookieAcquirer({ launchBrowser: async () => f.browser,
      save: () => { writing.resolve(); return pending.promise },
    })
    await acquirer.start()
    const checking = acquirer.check()
    await writing.promise
    const cancelled = await acquirer.cancel()
    await checking
    await acquirer.dispose()
    assert.equal(cancelled.state, 'idle')
    assert.equal(cancelled.pending_save, true)
    assert.equal(f.closed(), true)
    pending.resolve()
    await nextTurn()
    assert.equal(acquirer.status().state, 'idle')
    assert.equal(acquirer.status().pending_save, undefined)
  })

  it('keeps cleanup failures visible after success and cancellation and supports retry', async () => {
    const f = fixture()
    f.setCookies([cookie('userid', '1')])
    let failCleanup = true
    f.browser.close = async () => { if (failCleanup) throw new Error('locked') }
    const acquirer = new CookieAcquirer({ launchBrowser: async () => f.browser, save: async () => {} })
    await acquirer.start()
    assert.equal((await acquirer.check()).state, 'saved')
    assert.equal(acquirer.status().cleanup_pending, true)
    const cancelled = await acquirer.cancel()
    assert.equal(cancelled.state, 'idle')
    assert.match(cancelled.warning!, /临时登录数据/)
    failCleanup = false
    assert.equal((await acquirer.cancel()).cleanup_pending, undefined)
    assert.equal(acquirer.status().warning, undefined)
  })

  it('retains cleanup ownership after a failed launch and notices late cleanup success', async () => {
    const f = fixture()
    let pending = true
    Object.defineProperty(f.browser, 'cleanupPending', { get: () => pending })
    f.browser.close = async () => { if (pending) throw new Error('not exited') }
    const acquirer = new CookieAcquirer({
      launchBrowser: async () => { throw new LoginBrowserLaunchError(f.browser) }, save: async () => {},
    })
    assert.equal((await acquirer.start()).cleanup_pending, true)
    assert.equal((await acquirer.cancel()).cleanup_pending, true)
    pending = false
    assert.equal(acquirer.status().cleanup_pending, undefined)
    assert.equal(acquirer.status().warning, undefined)
    await acquirer.dispose()
  })

  it('does not open another browser while cleanup of the previous one keeps failing', async () => {
    const f = fixture()
    let failCleanup = true
    let launches = 0
    f.browser.close = async () => { if (failCleanup) throw new Error('locked') }
    const acquirer = new CookieAcquirer({ launchBrowser: async () => { launches++; return f.browser }, save: async () => {} })
    await acquirer.start()
    await acquirer.cancel()
    assert.equal((await acquirer.start()).cleanup_pending, true)
    assert.equal(launches, 1)
    failCleanup = false
    assert.equal((await acquirer.start()).state, 'acquiring')
    assert.equal(launches, 2)
    await acquirer.dispose()
  })
})

describe('browser pipe transport', () => {
  it('handles fragmented UTF-8 replies and out-of-order responses', async () => {
    const input = new PassThrough()
    const output = new PassThrough()
    const pipe = new BrowserPipe(input, output)
    const first = pipe.send('Storage.getCookies')
    const second = pipe.send('Target.getTargets')
    const data = Buffer.from('{"id":2,"result":"登录"}\0{"id":1,"result":[]}\0')
    for (const byte of data) output.write(Buffer.from([byte]))
    assert.deepEqual(await first, [])
    assert.equal(await second, '登录')
    pipe.dispose()
  })

  it('rejects pending requests when the browser disconnects', async () => {
    const pipe = new BrowserPipe(new PassThrough(), new PassThrough())
    const pending = pipe.send('Storage.getCookies')
    pipe.dispose()
    await assert.rejects(pending, /窗口已关闭/)
    await assert.rejects(pipe.send('Storage.getCookies'), /窗口已关闭/)
  })
})
