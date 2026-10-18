/**
 * Stock P&L overlay plugin, node half: registers `/api/stock-pnl` on the
 * shared web server. Each request resolves the login Cookie through the
 * credential-reference seam and fetches one normalized snapshot from the
 * Tonghuashun investment-ledger API. The browser half renders the returned
 * JSON as a floating card; the Cookie itself never leaves the host process.
 * @module @deepseek-ai/dsh-client-ui-stock-pnl
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'
import { CookieAcquirer } from './acquire.ts'
import { settingHandler } from './settings.ts'
import { collectStats, cookieField, INDEX_URL, normalizeCookie, PNL_URL, type Portfolio, verifyCookie } from './fetch.ts'
import type { Stats } from './types.ts'
import { LedgerClient } from './ledger.ts'
import type {} from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-skill'

export const name = 'ui-stock-pnl'
export const inject = ['webServer', 'credentials']

/** The same-origin route the floating card polls. */
export const ROUTE_PATH = '/api/stock-pnl'

/** Plugin config: the Cookie reference and ledger identity/endpoints. */
export interface Config {
  /** Environment-variable name holding the ledger Cookie; defaults to `STOCK_PNL_COOKIE`. */
  cookieEnv?: string
  /** Credential reference holding the ledger fund key; defaults to `STOCK_PNL_FUND_KEY`. */
  fundKeyEnv?: string
  /** The ledger user id included in every form payload; empty falls back to the Cookie's `userid`. */
  user_id?: string
  /** The ledger fund key selecting the managed portfolio; auto-discovered when empty. */
  fund_key?: string
  /** P&L endpoint override (tests point at a scripted server). */
  pnlUrl?: string
  /** Index endpoint override (tests point at a scripted server). */
  indexUrl?: string
  /** Poll interval the card should use, in milliseconds; defaults to 20000. */
  pollMs?: number
  /** Overall deadline for a card snapshot or model query, including recovery. */
  requestTimeoutMs?: number
}

/** Schemastery config for the overlay route. */
export const Config: z<Config> = z.object({
  cookieEnv: z.string().default('STOCK_PNL_COOKIE'),
  fundKeyEnv: z.string().default('STOCK_PNL_FUND_KEY'),
  user_id: z.string().default(''),
  fund_key: z.string().default(''),
  pnlUrl: z.string().default(PNL_URL),
  indexUrl: z.string().default(INDEX_URL),
  pollMs: z.number().min(1000).default(20000),
  requestTimeoutMs: z.number().min(100).max(120000).default(15000),
})

/** Fully materialized route policy; defaulting happens here, never inline. */
interface ResolvedConfig {
  cookieEnv: string
  fundKeyEnv: string
  user_id: string
  fund_key: string
  pnlUrl: string
  indexUrl: string
  pollMs: number
  requestTimeoutMs: number
}

/** Resolve defaults the same way Schemastery would, so direct `apply` calls stay correct. */
function resolveConfig(config: Config): ResolvedConfig {
  return {
    cookieEnv: config.cookieEnv ?? 'STOCK_PNL_COOKIE',
    fundKeyEnv: config.fundKeyEnv ?? 'STOCK_PNL_FUND_KEY',
    user_id: config.user_id ?? '',
    fund_key: config.fund_key ?? '',
    pnlUrl: config.pnlUrl ?? PNL_URL,
    indexUrl: config.indexUrl ?? INDEX_URL,
    pollMs: config.pollMs ?? 20000,
    requestTimeoutMs: config.requestTimeoutMs ?? 15000,
  }
}

/** Resolve one credential-reference value through the seam; `undefined` when unconfigured. */
async function resolveCredential(ctx: Context, ref: string): Promise<string | undefined> {
  const resolved = await ctx.credentials.resolve(credentialRef(ref))
  return resolved?.value
}

/** The web server's response type, derived from the route contract (no node import). */
type RouteResponse = Parameters<NonNullable<WebRoute['handler']>>[1]

/** The route's response value: the ledger snapshot plus the poll interval the card should use. */
export type RouteStats = Stats & { readonly poll_ms: number }

/** Write a JSON response (same-origin only, so no CORS header). */
function writeJson<T>(res: RouteResponse, status: number, value: T): void {
  const body = JSON.stringify(value)
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': String(new TextEncoder().encode(body).length),
  })
  res.end(body)
}

/**
 * Register the `/api/stock-pnl` route. Per-request failures answer 500 and
 * never take the server down; the route unregisters with the plugin fiber.
 *
 * @param ctx - Cordis context carrying the `webServer` and `credentials` services.
 * @param config - plugin config.
 */
export function apply(ctx: Context, config: Config = {}): void {
  const spec = resolveConfig(config)
  const ledger = new LedgerClient(spec, ref => resolveCredential(ctx, ref))
  ctx.inject(['tools', 'skills'], async modelCtx => {
    const model = await import('./model.ts')
    await model.apply(modelCtx, { client: ledger })
  })
  if (!ctx.get('tools') || !ctx.get('skills')) ctx.logger.warn('报告 Skill 等待 tools、skills 服务；请检查当前宿主组合。卡片保持可用。')
  const route: WebRoute = {
    kind: 'exact',
    path: ROUTE_PATH,
    handler: async (_req, res) => {
      try {
        const cookie = await resolveCredential(ctx, spec.cookieEnv)

        // Derive the ledger user id (same fallback as collectStats) so we can
        // call the account_list API when fund_key has not yet been stored.
        // The Cookie is normalized first (the store folds long values across
        // YAML lines and the read inserts a space at each break) and the field
        // is read with the anchored cookieField — a bare `/userid=/` regex
        // would match a different `*_userid=` cookie and get the ledger 403.
        const resolvedUser = spec.user_id.length > 0
          ? spec.user_id
          : (cookieField(normalizeCookie(cookie ?? ''), 'userid') ?? '')

        // fund_key: saved credential → config default → sole available account
        const fundKeyCred = await resolveCredential(ctx, spec.fundKeyEnv)
        let fundKey = fundKeyCred ?? spec.fund_key
        if (!fundKey && cookie && resolvedUser) {
          const result = await ledger.list(new AbortController().signal)
          if (result.data === null) throw new Error(result.code)
          const accounts = result.data.portfolios
          if (accounts.length !== 1) {
            writeJson(res, 200, { pnl_pct: 0, pnl_yk: 0, sh_pct: 0, chart_data: [], updated_at: new Date().toISOString(),
              error: accounts.length === 0 ? '当前登录没有可用账本' : '存在多个账本，请在设置中选择账本', token_expired: false, poll_ms: spec.pollMs })
            return
          }
          fundKey = accounts[0]!.id
        }

        const stats = await collectStats({
          pnlUrl: spec.pnlUrl,
          indexUrl: spec.indexUrl,
          cookie,
          cookieEnv: spec.cookieEnv,
          user_id: spec.user_id,
          fund_key: fundKey,
          requestTimeoutMs: spec.requestTimeoutMs,
        })
        writeJson(res, 200, { ...stats, poll_ms: spec.pollMs })
      } catch (error) {
        ctx.logger.warn(error instanceof Error ? error : new Error(String(error)))
        if (res.headersSent) {
          res.destroy()
          return
        }
        res.writeHead(500)
        res.end()
      }
    },
  }
  ctx.effect(() => ctx.webServer.register(route), 'ui-stock-pnl: /api/stock-pnl route')

  // Portfolio list endpoint: lets the card render a portfolio selector.
  const portfolioRoute: WebRoute = {
    kind: 'exact',
    path: '/api/stock-pnl/portfolios',
    handler: async (_req, res) => {
      try {
        const cookie = await resolveCredential(ctx, spec.cookieEnv)
        if (!cookie) { writeJson(res, 200, [] as readonly Portfolio[]); return }
        const user_id = spec.user_id.length > 0
          ? spec.user_id
          : (cookieField(normalizeCookie(cookie), 'userid') ?? '')
        if (!user_id) { writeJson(res, 200, [] as readonly Portfolio[]); return }
        const result = await ledger.list(new AbortController().signal)
        if (result.data === null) { writeJson(res, 502, { error: result.code, message: result.message }); return }
        writeJson(res, 200, result.data.portfolios.map(row => ({ fund_key: row.id, manualname: row.name, brokername: row.broker })))
      } catch (error) {
        ctx.logger.warn(error instanceof Error ? error : new Error(String(error)))
        if (res.headersSent) { res.destroy(); return }
        res.writeHead(500)
        res.end()
      }
    },
  }
  ctx.effect(() => ctx.webServer.register(portfolioRoute), 'ui-stock-pnl: /api/stock-pnl/portfolios route')

  // Register one exact route for the life of the plugin fiber.
  const addRoute = (path: string, handler: WebRoute['handler']): void => {
    ctx.effect(() => ctx.webServer.register({ kind: 'exact', path, handler }), `ui-stock-pnl: ${path}`)
  }

  // Auto-acquire: a visible Edge window waits for the sign-in, then its Cookie
  // is committed through the same reference the snapshot route reads.
  const acquirer = new CookieAcquirer({
    credentialRef: spec.cookieEnv,
    save: async cookie => {
      await ctx.credentials.set(credentialRef(spec.cookieEnv), cookie)
    },
  })
  ctx.effect(() => async () => { await acquirer.dispose() }, 'ui-stock-pnl: acquire teardown')

  addRoute('/api/stock-pnl/cookie', settingHandler(ctx, spec.cookieEnv, true, value => acquirer.saveCookie(value)))
  addRoute('/api/stock-pnl/fund-key', settingHandler(ctx, spec.fundKeyEnv, false))

  // Verify: probe the ledger with the stored Cookie and report whether it works.
  const verifyHandler: WebRoute['handler'] = async (_req, res) => {
    try {
      const cookie = await resolveCredential(ctx, spec.cookieEnv)
      const user = spec.user_id.length > 0 ? spec.user_id : undefined
      const result = await verifyCookie(cookie, user)
      writeJson(res, 200, {
        configured: cookie !== undefined && cookie.length > 0,
        valid: result.valid,
        reason: result.reason,
        ...(result.error !== undefined ? { error: result.error } : {}),
        ...(result.hint !== undefined ? { hint: result.hint } : {}),
        ...(result.portfolios !== undefined ? { portfolios: result.portfolios } : {}),
      })
    } catch (error) {
      ctx.logger.warn(error instanceof Error ? error : new Error(String(error)))
      writeJson(res, 200, { configured: false, valid: false, error: '验证失败' })
    }
  }
  addRoute('/api/stock-pnl/verify', verifyHandler)

  // Auto-acquire lifecycle: start / status / immediate-check / cancel.
  addRoute('/api/stock-pnl/acquire', async (_req, res) => { writeJson(res, 200, await acquirer.start()) })
  addRoute('/api/stock-pnl/acquire/status', (_req, res) => { writeJson(res, 200, acquirer.status()) })
  addRoute('/api/stock-pnl/acquire/check', async (_req, res) => { writeJson(res, 200, await acquirer.check()) })
  addRoute('/api/stock-pnl/acquire/cancel', async (_req, res) => { writeJson(res, 200, await acquirer.cancel()) })
}
