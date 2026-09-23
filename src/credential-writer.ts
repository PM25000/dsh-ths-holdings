/** A provider write cannot be aborted: bound the caller's wait, but keep the write lock. */
export class CredentialWriteError extends Error {
  constructor(readonly code: 'busy' | 'timeout' | 'cancelled' | 'failed') {
    super({
      busy: '上次凭据保存仍在处理中，请稍后再试',
      timeout: '保存凭据超时，结果尚未确认，请稍后重试',
      cancelled: '已停止等待凭据保存',
      failed: '保存凭据失败，请检查 DSH 凭据存储是否可写',
    }[code])
  }
}

export class CredentialWriter {
  private writing = false

  constructor(private readonly persist: (value: string) => Promise<void>, private readonly timeoutMs = 30_000) {}

  get pending(): boolean { return this.writing }

  async save(value: string, signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) throw new CredentialWriteError('cancelled')
    if (this.writing) throw new CredentialWriteError('busy')
    this.writing = true
    const write = Promise.resolve().then(() => {
      if (signal?.aborted) throw new CredentialWriteError('cancelled')
      return this.persist(value)
    }).then(
      () => { this.writing = false },
      () => { this.writing = false; throw new CredentialWriteError('failed') },
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
