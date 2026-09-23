/** Browser-level cookie access, without attaching a debugger to login pages. */
import { spawn } from 'node:child_process'
import { access, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { StringDecoder } from 'node:string_decoder'
import type { Readable, Writable } from 'node:stream'
import { BrowserCleanup } from './browser-cleanup.ts'

export interface LoginCookie {
  name: string
  value: string
  domain: string
  path: string
}

export interface LoginBrowser {
  readonly cleanupPending?: boolean
  cookies(): Promise<readonly LoginCookie[]>
  isClosed(): Promise<boolean>
  close(): Promise<void>
}

/** A failed launch can still own a browser/profile that needs another cleanup attempt. */
export class LoginBrowserLaunchError extends Error {
  constructor(readonly browser: LoginBrowser) { super('登录浏览器启动失败且清理尚未完成') }
}

interface Pending {
  resolve: (value: unknown) => void
  reject: (error: Error) => void
  timer: ReturnType<typeof setTimeout>
}

/** Null-delimited CDP pipe. Only browser-level methods are sent by the login flow. */
export class BrowserPipe {
  private sequence = 0
  private buffer = ''
  private decoder = new StringDecoder('utf8')
  private pending = new Map<number, Pending>()
  private failure: Error | undefined

  constructor(private readonly input: Writable, output: Readable) {
    output.on('data', (chunk: Buffer) => {
      this.buffer += this.decoder.write(chunk)
      let end: number
      while ((end = this.buffer.indexOf('\0')) !== -1) {
        const json = this.buffer.slice(0, end)
        this.buffer = this.buffer.slice(end + 1)
        try {
          const message = JSON.parse(json) as { id?: number; result?: unknown; error?: unknown }
          if (message.id === undefined) continue
          const request = this.pending.get(message.id)
          if (request === undefined) continue
          this.pending.delete(message.id)
          clearTimeout(request.timer)
          if (message.error) request.reject(new Error('浏览器未能完成登录会话操作'))
          else request.resolve(message.result)
        } catch { this.dispose(new Error('浏览器通信响应无效')) }
      }
    })
    output.on('end', () => this.dispose())
    output.on('error', () => this.dispose())
    input.on('error', () => this.dispose())
  }

  send<T>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    if (this.failure) return Promise.reject(this.failure)
    return new Promise<T>((resolve, reject) => {
      const id = ++this.sequence
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error('浏览器通信超时'))
      }, 10_000)
      this.pending.set(id, { resolve: value => resolve(value as T), reject, timer })
      this.input.write(JSON.stringify({ id, method, params }) + '\0', error => {
        if (error) this.dispose(new Error('浏览器通信已断开'))
      })
    })
  }

  dispose(error = new Error('登录窗口已关闭')): void {
    this.failure ??= error
    for (const request of this.pending.values()) {
      clearTimeout(request.timer)
      request.reject(this.failure)
    }
    this.pending.clear()
  }
}

function browserCandidates(): string[] {
  if (process.platform === 'win32') {
    const roots = [process.env['PROGRAMFILES(X86)'], process.env.PROGRAMFILES, process.env.LOCALAPPDATA]
      .filter((root): root is string => Boolean(root))
    return ['Microsoft/Edge/Application/msedge.exe', 'Google/Chrome/Application/chrome.exe',
      'Microsoft/Edge Beta/Application/msedge.exe', 'Google/Chrome Beta/Application/chrome.exe']
      .flatMap(relative => roots.map(root => join(root, relative)))
  }
  if (process.platform === 'darwin') return [
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ]
  return ['/usr/bin/microsoft-edge', '/usr/bin/microsoft-edge-stable', '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser']
}

/** Launch an isolated, visible browser. Its profile is deleted after this run. */
export async function launchLoginBrowser(url: string): Promise<LoginBrowser> {
  let installed = false
  for (const executable of browserCandidates()) {
    try { await access(executable) } catch { continue }
    installed = true
    try { return await launchExecutable(executable, url) } catch (error) {
      if (error instanceof LoginBrowserLaunchError) throw error
      // Try the next browser only after the failed launch has been cleaned up.
    }
  }
  if (installed) throw new Error('无法启动登录浏览器，请检查浏览器是否被系统策略阻止')
  throw new Error('未检测到已安装的浏览器，请安装 Microsoft Edge 或 Google Chrome')
}

async function launchExecutable(executable: string, url: string): Promise<LoginBrowser> {
  const profile = await mkdtemp(join(tmpdir(), 'dsh-ths-login-'))
  const child = spawn(executable, [
    `--user-data-dir=${profile}`, '--remote-debugging-pipe', '--no-first-run',
    '--no-default-browser-check', '--no-startup-window', '--disable-background-mode',
    '--disable-blink-features=AutomationControlled',
  ], { stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'], windowsHide: false })
  const pipe = new BrowserPipe(child.stdio[3] as Writable, child.stdio[4] as Readable)
  let exited = false
  const exit = new Promise<void>(resolve => {
    const done = (): void => { exited = true; pipe.dispose(); resolve() }
    child.once('exit', done)
    child.on('error', () => {
      // A failed kill also emits error; it does not mean an existing process exited.
      if (child.pid === undefined) done()
    })
  })
  const cleanup = new BrowserCleanup({
    exit,
    requestClose: () => pipe.send('Browser.close'),
    kill: () => { child.kill() },
    dispose: () => pipe.dispose(),
    // Only remove the fresh directory created above, after its browser exits.
    removeProfile: () => rm(profile, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 }),
  })
  const browser: LoginBrowser = {
    get cleanupPending() { return cleanup.pending },
    cookies: async () => (await pipe.send<{ cookies: LoginCookie[] }>('Storage.getCookies')).cookies,
    isClosed: async () => {
      if (exited) return true
      const { targetInfos } = await pipe.send<{ targetInfos: { type: string }[] }>('Target.getTargets')
      return !targetInfos.some(target => target.type === 'page')
    },
    close: () => cleanup.close(),
  }
  try {
    await pipe.send('Target.createTarget', { url, newWindow: true })
    return browser
  } catch (error) {
    try { await browser.close() } catch { throw new LoginBrowserLaunchError(browser) }
    throw error
  }
}
