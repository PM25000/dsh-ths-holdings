interface CleanupContext {
  exit: Promise<void>
  requestClose: () => Promise<unknown>
  kill: () => void
  dispose: () => void
  removeProfile: () => Promise<void>
  killMs?: number
  timeoutMs?: number
}

/** Keep exit-triggered cleanup alive even when a caller stops waiting for close. */
export class BrowserCleanup {
  private exited = false
  private removed = false
  private removing: Promise<void> | undefined
  private closing: Promise<void> | undefined
  private readonly exit: Promise<void>

  constructor(private readonly ctx: CleanupContext) {
    this.exit = ctx.exit.then(() => {
      this.exited = true
      // Observe background failures; close() remains available to retry/report them.
      void this.remove().catch(() => {})
    })
  }

  get pending(): boolean { return !this.removed }

  private remove(): Promise<void> {
    if (this.removed) return Promise.resolve()
    this.removing ??= Promise.resolve().then(() => this.ctx.removeProfile()).then(() => {
      this.removed = true
    }).finally(() => { this.removing = undefined })
    return this.removing
  }

  close(): Promise<void> {
    this.closing ??= this.finish().finally(() => { this.closing = undefined })
    return this.closing
  }

  private async finish(): Promise<void> {
    let killer: ReturnType<typeof setTimeout> | undefined
    let deadline: ReturnType<typeof setTimeout> | undefined
    try {
      if (!this.exited) {
        // The pipe response can be lost when Chromium exits; process exit is authoritative.
        void this.ctx.requestClose().catch(() => {})
        killer = setTimeout(() => { this.ctx.kill() }, this.ctx.killMs ?? 2_000)
        await Promise.race([
          this.exit,
          new Promise<never>((_resolve, reject) => {
            deadline = setTimeout(() => reject(new Error('登录窗口关闭超时')), this.ctx.timeoutMs ?? 5_000)
          }),
        ])
      }
      await this.remove()
    } finally {
      clearTimeout(killer)
      clearTimeout(deadline)
      this.ctx.dispose()
    }
  }
}
