/** Human login in a visible system browser; only browser cookies are observed. */
import { launchLoginBrowser, LoginBrowserLaunchError, type LoginBrowser, type LoginCookie } from './login-browser.ts'
import { CredentialWriter, CredentialWriteError } from './credential-writer.ts'
import type { AcquireStatusView } from './types.ts'

export const LEDGER_LOGIN_URL = 'https://tzzb.10jqka.com.cn'
const LEDGER_DOMAIN = '10jqka.com.cn'

function isLedgerCookie(cookie: LoginCookie): boolean {
  const domain = cookie.domain.toLowerCase()
  return domain === LEDGER_DOMAIN || domain.endsWith(`.${LEDGER_DOMAIN}`)
}

export function isSignedIn(cookies: readonly LoginCookie[]): boolean {
  return cookies.some(cookie => cookie.name === 'userid' && cookie.value.length > 0 && isLedgerCookie(cookie))
}

export function cookiesToHeader(cookies: readonly LoginCookie[]): string {
  return cookies.filter(isLedgerCookie).map(cookie => `${cookie.name}=${cookie.value}`).join('; ')
}

export interface AcquireContext {
  save: (cookie: string) => Promise<void>
  /** Stable host reference; shares pending writes across plugin lifetimes. */
  credentialRef?: string
  launchBrowser?: (url: string) => Promise<LoginBrowser>
  pollMs?: number
  timeoutMs?: number
  saveTimeoutMs?: number
  now?: () => number
}

export class CookieAcquirer {
  private state: AcquireStatusView['state'] = 'idle'
  private error = ''
  private hint = ''
  private startedAt = 0
  private generation = 0
  private disposed = false
  private browser: LoginBrowser | undefined
  private cleanup = new Set<LoginBrowser>()
  private abort: AbortController | undefined
  private readonly writer: CredentialWriter
  private timer: ReturnType<typeof setInterval> | undefined
  private probing: Promise<void> | undefined
  private starting: Promise<AcquireStatusView> | undefined
  private cancelling: Promise<AcquireStatusView> | undefined
  private readonly now: () => number

  constructor(private readonly ctx: AcquireContext) {
    this.now = ctx.now ?? Date.now
    this.writer = new CredentialWriter(ctx.save, ctx.saveTimeoutMs, ctx.credentialRef)
  }

  status(): AcquireStatusView {
    for (const browser of this.cleanup) {
      if (browser.cleanupPending === false) this.cleanup.delete(browser)
    }
    const warnings = [
      ...(this.cleanup.size ? ['登录窗口或临时登录数据尚未清理完成，请关闭登录窗口后点击“重试清理”'] : []),
      ...(this.writer.pending ? ['凭据保存仍在处理中，结果尚未确认；完成前无法再次保存 Cookie'] : []),
    ]
    return {
      state: this.state,
      ...(this.error ? { error: this.error } : {}),
      ...(this.hint ? { hint: this.hint } : {}),
      ...(warnings.length ? { warning: warnings.join('；') } : {}),
      ...(this.cleanup.size ? { cleanup_pending: true } : {}),
      ...(this.writer.pending ? { pending_save: true } : {}),
    }
  }

  start(): Promise<AcquireStatusView> {
    if (this.disposed) return Promise.resolve({ ...this.status(), state: 'failed', error: new CredentialWriteError('inactive').message })
    if (this.cancelling) return this.cancelling.then(() => this.start())
    if (this.starting) return this.starting
    if (this.state === 'acquiring') return Promise.resolve(this.status())
    if (this.writer.pending) return Promise.resolve(this.status())
    this.starting = this.begin().finally(() => { this.starting = undefined })
    return this.starting
  }

  private async begin(): Promise<AcquireStatusView> {
    const generation = ++this.generation
    this.state = 'acquiring'
    this.abort = new AbortController()
    this.error = ''
    this.hint = '请在弹出窗口登录，无需打开开发者工具；若仍出现检测提示，可取消后使用普通浏览器获取 Cookie'
    try {
      if (this.cleanup.size) {
        await this.closeBrowser()
        if (generation !== this.generation) return this.status()
        if (this.cleanup.size) throw new Error('cleanup pending')
      }
      const browser = await (this.ctx.launchBrowser ?? launchLoginBrowser)(LEDGER_LOGIN_URL)
      if (generation !== this.generation) { await this.closeOwned(browser); return this.status() }
      this.browser = browser
      this.startedAt = this.now()
      this.timer = setInterval(() => { void this.check() }, this.ctx.pollMs ?? 1_000)
    } catch (error) {
      if (error instanceof LoginBrowserLaunchError) this.cleanup.add(error.browser)
      if (generation === this.generation) {
        this.state = 'failed'
        this.error = '启动登录浏览器失败'
        this.hint = '请确认已安装 Microsoft Edge 或 Google Chrome；也可在普通浏览器登录后手动粘贴 Cookie'
      }
    }
    return this.status()
  }

  async check(): Promise<AcquireStatusView> {
    if (this.state !== 'acquiring' || !this.browser) return this.status()
    this.probing ??= this.probe().finally(() => { this.probing = undefined })
    await this.probing
    return this.status()
  }

  cancel(): Promise<AcquireStatusView> {
    this.cancelling ??= this.finishCancel().finally(() => { this.cancelling = undefined })
    return this.cancelling
  }

  private async finishCancel(): Promise<AcquireStatusView> {
    ++this.generation
    this.abort?.abort()
    this.state = 'idle'
    this.stopTimer()
    await this.starting
    await this.probing
    await this.closeBrowser()
    this.error = ''
    this.hint = ''
    return this.status()
  }

  async dispose(): Promise<void> {
    this.disposed = true
    await this.cancel()
  }

  /** Manual saves cannot race a login that has not dispatched its write yet. */
  async saveCookie(value: string): Promise<void> {
    if (this.disposed) throw new CredentialWriteError('inactive')
    if (this.state === 'acquiring' || this.starting || this.cancelling) throw new CredentialWriteError('acquiring')
    await this.writer.save(value)
  }

  private stopTimer(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = undefined
  }

  private async closeBrowser(): Promise<void> {
    const browser = this.browser
    this.browser = undefined
    if (browser) this.cleanup.add(browser)
    for (const owned of [...this.cleanup]) await this.closeOwned(owned)
  }

  private async closeOwned(browser: LoginBrowser): Promise<void> {
    this.cleanup.add(browser)
    try { await browser.close(); this.cleanup.delete(browser) } catch { /* retained for retry */ }
  }

  private async probe(): Promise<void> {
    const generation = this.generation
    const browser = this.browser!
    const signal = this.abort!.signal
    const active = (): boolean => generation === this.generation && this.state === 'acquiring'
    try {
      const timeout = this.ctx.timeoutMs ?? 10 * 60_000
      if (this.now() - this.startedAt > timeout) throw new Error('等待登录超时，窗口已自动关闭，请重试')
      const closed = await browser.isClosed()
      if (!active()) return
      if (closed) throw new Error('登录窗口已关闭，自动获取已中止')
      const cookies = await browser.cookies()
      if (!active() || !isSignedIn(cookies)) return
      this.stopTimer()
      await this.writer.save(cookiesToHeader(cookies), signal)
      if (!active()) return
      this.state = 'saved'
      this.error = ''
      this.hint = ''
      await this.closeBrowser()
    } catch (error) {
      if (!active()) return
      this.stopTimer()
      this.state = 'failed'
      this.error = error instanceof Error ? error.message : '自动获取失败，请重试'
      this.hint = error instanceof CredentialWriteError && this.writer.pending
        ? '取消仅停止等待，已经提交的保存仍可能完成；请等待存储服务恢复后重试'
        : '可重新自动获取，或在普通浏览器登录后手动粘贴 Cookie'
      await this.closeBrowser()
    }
  }
}
