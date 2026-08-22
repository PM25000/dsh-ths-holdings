/**
 * Login-cookie acquisition for the ledger overlay: kick a visible Edge window
 * (the system-installed Edge — no browser download), wait for the human to
 * sign in, then read the resulting 10jqka cookies and commit them through the
 * credentials seam. playwright-core is resolved through several anchors
 * (global npm root, the web profile, this plugin's own node_modules) so a
 * missing install degrades to a clear hint instead of a crash — the same
 * resolution strategy dsh-web-search-pro uses for its login script.
 * @module dsh-ths-holdings/acquire
 */

import { createRequire } from 'node:module'
import { execFileSync } from 'node:child_process'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Browser, BrowserContext, Page } from 'playwright-core'
import type { AcquireStatusView } from './types.ts'

/** The playwright module shape used at runtime (typed through playwright-core types). */
export interface PwModule {
  chromium: {
    launch(options?: { channel?: string; headless?: boolean; args?: string[] }): Promise<Browser>
  }
}

/** A playwright Cookie (the storageState subset). */
export interface PwCookie {
  name: string
  value: string
  domain: string
  path: string
  expires?: number
  httpOnly?: boolean
  secure?: boolean
  sameSite?: string
}

/** The ledger host's domain suffix (all 10jqka hosts share the Cookie). */
const LEDGER_DOMAIN = '10jqka.com.cn'
/** The session-cookie name marking a completed sign-in (matches fetch.ts's userid derivation). */
const AUTH_COOKIE_NAME = 'userid'
/** The page opened for the sign-in. */
export const LEDGER_LOGIN_URL = 'https://tzzb.10jqka.com.cn'

/** The default wait budget for a sign-in, ms. */
const DEFAULT_TIMEOUT_MS = 10 * 60_000
/** The default sign-in watch cadence, ms. */
const DEFAULT_POLL_MS = 1_000

/** The module directory (lib/ at runtime), for plugin-local resolution anchors. */
const HERE = fileURLToPath(new URL('.', import.meta.url))

/** The global npm root: `npm root -g`, with the stock Windows fallback. */
function globalNpmRoot(): string {
  try {
    return execFileSync('npm', ['root', '-g'], { encoding: 'utf8', windowsHide: true }).trim()
  } catch {
    return path.join(process.env.APPDATA ?? os.homedir(), 'npm', 'node_modules')
  }
}

/**
 * Resolve the playwright-core module through a chain of anchors.
 * @returns the module, or undefined when it is not installed anywhere we look.
 */
export function resolvePlaywright(): PwModule | undefined {
  const home = process.env.DSH_HOME ?? path.join(os.homedir(), '.dsh')
  const anchors = [
    path.join(globalNpmRoot(), 'playwright-core', 'package.json'),
    path.join(home, 'profiles', 'web', 'node_modules', 'playwright-core', 'package.json'),
    path.join(HERE, '..', 'node_modules', 'playwright-core', 'package.json'),
    'playwright-core/package.json',
  ]
  for (const anchor of anchors) {
    try {
      return createRequire(anchor)('playwright-core') as PwModule
    } catch {
      /* try the next anchor */
    }
  }
  return undefined
}

/** True when the cookie belongs to the ledger domain or any 10jqka subdomain. */
function isLedgerCookie(cookie: PwCookie): boolean {
  const domain = cookie.domain.toLowerCase()
  return domain === LEDGER_DOMAIN || domain === `.${LEDGER_DOMAIN}` || domain.endsWith(`.${LEDGER_DOMAIN}`)
}

/** True when the cookie set proves a signed-in session (a non-empty userid). */
export function isSignedIn(cookies: readonly PwCookie[]): boolean {
  return cookies.some(cookie => cookie.name === AUTH_COOKIE_NAME && cookie.value.length > 0 && isLedgerCookie(cookie))
}

/**
 * Build a Cookie header string from storageState cookies — ledger cookies only,
 * canonical `; ` joined (no line-wrapping surprises for the YAML store).
 * @param cookies - cookies as playwright's storageState reports them.
 * @returns a Cookie header, or '' when no ledger cookie is present.
 */
export function cookiesToHeader(cookies: readonly PwCookie[]): string {
  return cookies.filter(isLedgerCookie).map(cookie => `${cookie.name}=${cookie.value}`).join('; ')
}

/** The context the acquirer needs: how to commit and where to look. */
export interface AcquireContext {
  /** Commit the acquired Cookie (the credentials-seam write). */
  save: (cookie: string) => Promise<void>
  /** Resolve the playwright module; injectable for tests. */
  resolvePlaywright: () => PwModule | undefined
  /** Sign-in watch cadence, ms. */
  pollMs?: number
  /** Total wait budget before timing out, ms. */
  timeoutMs?: number
  /** Clock override for tests. */
  now?: () => number
}

/**
 * The acquire state machine. Owns one run at a time: launch a visible window,
 * watch for the sign-in cookie, then commit it and finish. All methods are
 * safe to call from the plugin's web routes.
 */
export class CookieAcquirer {
  private readonly pollMs: number
  private readonly timeoutMs: number
  private readonly now: () => number

  private state: AcquireStatusView['state'] = 'idle'
  private error = ''
  private hint = ''
  private startedAt = 0
  private probing = false
  private browser: Browser | undefined
  private context: BrowserContext | undefined
  private page: Page | undefined
  private timer: ReturnType<typeof setInterval> | undefined

  constructor(private readonly ctx: AcquireContext) {
    this.pollMs = ctx.pollMs ?? DEFAULT_POLL_MS
    this.timeoutMs = ctx.timeoutMs ?? DEFAULT_TIMEOUT_MS
    this.now = ctx.now ?? (() => Date.now())
  }

  /** The current status view for the browser. */
  status(): AcquireStatusView {
    return {
      state: this.state,
      ...(this.error !== '' ? { error: this.error } : {}),
      ...(this.hint !== '' ? { hint: this.hint } : {}),
    }
  }

  /**
   * Start a new sign-in run: open a visible Edge window on the ledger page and
   * begin watching for the sign-in cookie. A no-op when one is already running.
   * @returns the resulting status.
   */
  async start(): Promise<AcquireStatusView> {
    if (this.state === 'acquiring') return this.status()
    this.error = ''
    this.hint = ''
    const pw = this.ctx.resolvePlaywright()
    if (pw === undefined) {
      this.state = 'failed'
      this.error = '未找到 playwright-core，无法自动获取 Cookie'
      this.hint = '请先安装（npm i -g playwright-core）或在本插件的依赖里安装 playwright-core，然后重启 dsh web 再试'
      return this.status()
    }
    try {
      this.browser = await pw.chromium.launch({
        channel: 'msedge',
        headless: false,
        // Lower the automation fingerprint: the ledger's WAF refuses plainly
        // automated contexts ("Nginx forbidden") more reliably than it reads the
        // real user agent — this is the standard anti-detection surface, not a
        // captcha/anti-bot platform.
        args: ['--disable-blink-features=AutomationControlled'],
      })
      this.context = await this.browser.newContext({
        locale: 'zh-CN',
        viewport: { width: 1280, height: 800 },
      })
      // The one fingerprint an automation framework always adds: hide the
      // `navigator.webdriver` tell and the Chrome runtime banner.
      await this.context.addInitScript(() => {
        Object.defineProperty(navigator, 'webdriver', { get: () => undefined })
        Object.defineProperty(window, 'chrome', { get: () => ({ runtime: {} }) })
      })
      this.page = await this.context.newPage()
      this.startedAt = this.now()
      this.state = 'acquiring'
      // Best-effort landing: the page may hang behind a slow gateway; the
      // window stays open and usable for sign-in either way.
      await this.page.goto(LEDGER_LOGIN_URL, { waitUntil: 'domcontentloaded', timeout: 60_000 }).catch(() => {})
      // Detect a WAF refusal (`nginx forbidden` pages) and surface it as an
      // actionable notice while keeping the window usable for manual sign-in.
      void this.detectBlocked()
      this.timer = setInterval(() => { void this.probe() }, this.pollMs)
    } catch (error) {
      await this.closeBrowser()
      this.state = 'failed'
      this.error = `启动浏览器失败: ${error instanceof Error ? error.message : String(error)}`
    }
    return this.status()
  }

  /**
   * After the landing page settles, look for the familiar WAF refusal markers
   * (nginx 403 "forbidden" bodies) and, when found, record a non-fatal notice
   * the card renders under the acquiring state.
   */
  private async detectBlocked(): Promise<void> {
    try {
      await this.page?.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {})
      const text = (await this.page?.content()) ?? ''
      if (/forbidden|nginx|403/i.test(text) && text.length < 50_000) {
        this.error = '页面被同花顺风控拦截（Nginx forbidden）'
        this.hint = '请在弹出窗口里按 F5 刷新或手动访问 https://tzzb.10jqka.com.cn 重新加载；登录完成后点「我已登录，继续 →」'
      }
    } catch { /* landing itself may be missing; the window stays usable */ }
  }

  /**
   * Run one immediate sign-in probe — the "我已登录" button. A no-op unless a
   * run is acquiring.
   * @returns the resulting status.
   */
  async check(): Promise<AcquireStatusView> {
    if (this.state !== 'acquiring') return this.status()
    await this.probe()
    return this.status()
  }

  /**
   * Abandon a running sign-in: close the window and return to idle.
   * @returns the resulting status.
   */
  async cancel(): Promise<AcquireStatusView> {
    if (this.state === 'acquiring') {
      this.stopTimer()
      await this.closeBrowser()
    }
    this.state = 'idle'
    this.error = ''
    this.hint = ''
    return this.status()
  }

  /** Tear down for plugin disposal: stop watching and close any window. */
  async dispose(): Promise<void> {
    this.stopTimer()
    await this.closeBrowser()
    this.state = 'idle'
  }

  private stopTimer(): void {
    if (this.timer !== undefined) {
      clearInterval(this.timer)
      this.timer = undefined
    }
  }

  private async closeBrowser(): Promise<void> {
    const browser = this.browser
    this.browser = undefined
    this.context = undefined
    this.page = undefined
    if (browser === undefined) return
    try { await browser.close() } catch { /* already gone */ }
  }

  /**
   * One watch tick: detect the sign-in cookie, then commit and finish.
   * Failures (timeout, closed window, save refusal) settle as `failed`.
   */
  private async probe(): Promise<void> {
    if (this.probing || this.state !== 'acquiring') return
    this.probing = true
    try {
      const elapsed = this.now() - this.startedAt
      if (elapsed > this.timeoutMs) {
        this.stopTimer()
        await this.closeBrowser()
        this.state = 'failed'
        this.error = `等待登录超时（${Math.max(1, Math.round(this.timeoutMs / 60_000))} 分钟），窗口已自动关闭`
        return
      }
      // The human may have closed the window mid-sign-in.
      if (this.page?.isClosed?.() === true || this.browser?.isConnected?.() === false) {
        this.stopTimer()
        this.state = 'failed'
        this.error = '登录窗口已关闭，自动获取已中止'
        return
      }
      const cookies = (await this.context?.cookies()) ?? []
      if (!isSignedIn(cookies)) return
      const header = cookiesToHeader(cookies)
      if (header.length === 0) return
      this.stopTimer()
      try {
        await this.ctx.save(header)
      } catch (error) {
        await this.closeBrowser()
        this.state = 'failed'
        this.error = `保存凭据失败: ${error instanceof Error ? error.message : String(error)}`
        this.hint = '请检查凭据存储是否可写（.credentials.yaml 权限 / 部署是否只读）'
        return
      }
      await this.closeBrowser()
      this.state = 'saved'
    } catch (error) {
      this.stopTimer()
      await this.closeBrowser()
      this.state = 'failed'
      this.error = `自动获取失败: ${error instanceof Error ? error.message : String(error)}`
    } finally {
      this.probing = false
    }
  }
}