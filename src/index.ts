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
import { collectStats, fetchFundKey, INDEX_URL, listPortfolios, PNL_URL, type Portfolio } from './fetch.ts'
import type { Stats } from './types.ts'

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
  const route: WebRoute = {
    kind: 'exact',
    path: ROUTE_PATH,
    handler: async (_req, res) => {
      try {
        const cookie = await resolveCredential(ctx, spec.cookieEnv)

        // Derive the ledger user id (same fallback as collectStats) so we can
        // call the account_list API when fund_key has not yet been stored.
        const resolvedUser = spec.user_id.length > 0
          ? spec.user_id
          : (cookie?.match(/userid=([^;]*)/)?.[1] ?? '')

        // fund_key: credential store → auto-discover from account_list → config default
        const fundKeyCred = await resolveCredential(ctx, spec.fundKeyEnv)
        let fundKey = fundKeyCred ?? spec.fund_key
        if (!fundKeyCred && cookie && resolvedUser) {
          const discovered = await fetchFundKey(cookie, resolvedUser)
          if (discovered !== undefined) fundKey = discovered
        }

        const stats = await collectStats({
          pnlUrl: spec.pnlUrl,
          indexUrl: spec.indexUrl,
          cookie,
          cookieEnv: spec.cookieEnv,
          user_id: spec.user_id,
          fund_key: fundKey,
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
          : (cookie.match(/userid=([^;]*)/)?.[1] ?? '')
        if (!user_id) { writeJson(res, 200, [] as readonly Portfolio[]); return }
        const list = await listPortfolios(cookie, user_id)
        writeJson(res, 200, list)
      } catch (error) {
        ctx.logger.warn(error instanceof Error ? error : new Error(String(error)))
        if (res.headersSent) { res.destroy(); return }
        res.writeHead(500)
        res.end()
      }
    },
  }
  ctx.effect(() => ctx.webServer.register(portfolioRoute), 'ui-stock-pnl: /api/stock-pnl/portfolios route')
}
