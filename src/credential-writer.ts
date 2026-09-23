/** A provider write cannot be aborted: bound the caller's wait, but keep the write lock. */
export class CredentialWriteError extends Error {
  constructor(readonly code: 'busy' | 'acquiring' | 'inactive' | 'timeout' | 'cancelled' | 'failed') {
    super({
      busy: '上次凭据保存仍在处理中，请稍后再试',
      acquiring: '自动登录正在进行，请先取消并等待结束后再手动保存',
      inactive: '插件已停止或重新加载，请刷新页面后重试',
      timeout: '保存凭据超时，结果尚未确认，请稍后重试',
      cancelled: '已停止等待凭据保存',
      failed: '保存凭据失败，请检查 DSH 凭据存储是否可写',
    }[code])
  }
}

// Keep only in-flight ownership tokens, never credentials or old provider callbacks.
// A process-wide reference key survives plugin/provider recreation and module hot reload.
// Conservatively serialize the same reference even if two contexts use different stores.
const registryKey = Symbol.for('dsh-ths-holdings.credential-writes.v1')
const processState = globalThis as typeof globalThis & { [registryKey]?: Map<string, symbol> }
const sharedWrites = processState[registryKey] ??= new Map<string, symbol>()

export class CredentialWriter {
  private readonly writes: Map<string, symbol>
  private readonly reference: string

  constructor(private readonly persist: (value: string) => Promise<void>, private readonly timeoutMs = 30_000, reference?: string) {
    this.writes = reference === undefined ? new Map() : sharedWrites
    this.reference = reference ?? ''
  }

  get pending(): boolean { return this.writes.has(this.reference) }

  async save(value: string, signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) throw new CredentialWriteError('cancelled')
    if (this.pending) throw new CredentialWriteError('busy')
    const owner = Symbol()
    this.writes.set(this.reference, owner)
    const release = (): void => {
      if (this.writes.get(this.reference) === owner) this.writes.delete(this.reference)
    }
    const write = Promise.resolve().then(() => {
      if (signal?.aborted) throw new CredentialWriteError('cancelled')
      return this.persist(value)
    }).then(
      () => { release() },
      () => { release(); throw new CredentialWriteError('failed') },
    )
    let timer: ReturnType<typeof setTimeout> | undefined
    let abort: (() => void) | undefined
    try {
      await Promise.race([
        write,
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => reject(new CredentialWriteError('timeout')), this.timeoutMs)
          abort = () => reject(new CredentialWriteError('cancelled'))
          signal?.addEventListener('abort', abort, { once: true })
          if (signal?.aborted) abort()
        }),
      ])
    } finally {
      clearTimeout(timer)
      if (abort) signal?.removeEventListener('abort', abort)
      // Only the actual provider completion above may unlock another write.
      // Promise.race also observes a late rejection after timeout/cancellation.
    }
  }
}
