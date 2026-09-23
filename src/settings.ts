import type { Context } from '@deepseek-ai/cordis'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'
import { normalizeCookie } from './fetch.ts'
import { CredentialWriteError } from './credential-writer.ts'

/** Small write-only endpoint; the client cannot choose an arbitrary credential reference. */
export function settingHandler(ctx: Context, ref: string, cookie: boolean, save?: (value: string) => Promise<void>): WebRoute['handler'] {
  return async (req, res) => {
    const reply = (status: number, error?: string): void => {
      res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
      res.end(JSON.stringify(error ? { error } : { saved: true }))
    }
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST')
      reply(405, '请使用 POST 保存设置')
      return
    }
    // JSON-only, no CORS, and explicit browser-origin checks prevent cross-site writes.
    let foreignOrigin = false
    if (req.headers.origin !== undefined) {
      try { foreignOrigin = new URL(req.headers.origin).host !== req.headers.host }
      catch { foreignOrigin = true }
    }
    if (foreignOrigin || req.headers['sec-fetch-site'] === 'cross-site') {
      reply(403, '不允许跨站保存设置')
      return
    }
    if (req.headers['content-type']?.split(';')[0]?.trim().toLowerCase() !== 'application/json') {
      reply(415, '请使用 JSON 提交设置')
      return
    }
    let value: unknown
    try {
      const chunks: Buffer[] = []
      let length = 0
      for await (const chunk of req) {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
        length += buffer.length
        if (length > 64 * 1024) { reply(413, '提交的设置过长'); return }
        chunks.push(buffer)
      }
      value = (JSON.parse(Buffer.concat(chunks).toString('utf8')) as { value?: unknown } | null)?.value
    } catch {
      reply(400, '设置格式无效')
      return
    }
    const normalized = typeof value === 'string' ? (cookie ? normalizeCookie(value) : value.trim()) : ''
    if (normalized.length === 0) {
      reply(400, '设置不能为空')
      return
    }
    try {
      if (save) await save(normalized)
      else await ctx.credentials.set(credentialRef(ref), normalized)
      reply(200)
    } catch (error) {
      if (error instanceof CredentialWriteError) {
        reply(error.code === 'timeout' ? 504 : error.code === 'failed' ? 500 : 409, error.message)
        return
      }
      // Provider errors may contain the submitted secret; never echo or log them.
      reply(500, '保存凭据失败，请检查 DSH 凭据存储是否可写')
    }
  }
}
