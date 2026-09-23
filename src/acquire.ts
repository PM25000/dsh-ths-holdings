/** Human login in a visible system browser; only browser cookies are observed. */
import { launchLoginBrowser, type LoginBrowser, type LoginCookie } from './login-browser.ts'
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
  launchBrowser?: (url: string) => Promise<LoginBrowser>
  pollMs?: number
  timeoutMs?: number
  now?: () => number
}

export class CookieAcquirer {
  private state: AcquireStatusView['state'] = 'idle'
  private error = ''
  private hint = ''
  private startedAt = 0
  private generation = 0
  private browser: LoginBrowser | undefined
  private timer: ReturnType<typeof setInterval> | undefined
  private probing: Promise<void> | undefined
  private starting: Promise<AcquireStatusView> | undefined
  private cancelling: Promise<AcquireStatusView> | undefined
  private readonly now: () => number

  constructor(private readonly ctx: AcquireContext) {
    this.now = ctx.now ?? Date.now
  }

  status(): AcquireStatusView {
    return {
      state: this.state,
      ...(this.error ? { error: this.error } : {}),
      ...(this.hint ? { hint: this.hint } : {}),
    }
  }

  start(): Promise<AcquireStatusView> {
    if (this.cancelling) return this.cancelling.then(() => this.start())
    if (this.starting) return this.starting
    if (this.state === 'acquiring') return Promise.resolve(this.status())
    this.starting = this.begin().finally(() => { this.starting = undefined })
    return this.starting
  }

  private async begin(): Promise<AcquireStatusView> {
    const generation = ++this.generation
    this.state = 'acquiring'
    this.error = ''
    this.hint = '请在弹出窗口登录，无需打开开发者工具；若仍出现检测提示，可取消后使用普通浏览器获取 Cookie'
    try {
      const browser = await (this.ctx.launchBrowser ?? launchLoginBrowser)(LEDGER_LOGIN_URL)
      if (generation !== this.generation) { await browser.close(); return this.status() }
      this.browser = browser
      this.startedAt = this.now()
      this.timer = setInterval(() => { void this.check() }, this.ctx.pollMs ?? 1_000)
    } catch {
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
    this.state = 'idle'
    this.stopTimer()
    await this.starting
    await this.probing
    await this.closeBrowser()
    this.error = ''
    this.hint = ''
    return this.status()
  }

  async dispose(): Promise<void> { await this.cancel() }

  private stopTimer(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = undefined
  }

  private async closeBrowser(): Promise<void> {
    const browser = this.browser
    this.browser = undefined
    try { await browser?.close() } catch {
      this.hint = '登录窗口或临时数据清理失败，请关闭登录窗口并重启 DSH 后重试'
    }
  }

  private async probe(): Promise<void> {
    const generation = this.generation
    const browser = this.browser!
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
      try { await this.ctx.save(cookiesToHeader(cookies)) }
      catch { throw new Error('保存凭据失败，请检查 DSH 凭据存储是否可写') }
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
      this.hint = '可重新自动获取，或在普通浏览器登录后手动粘贴 Cookie'
      await this.closeBrowser()
    }
  }
}
