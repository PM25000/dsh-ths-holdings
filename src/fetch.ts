/**
 * Ledger-data acquisition: POST the same form payloads the original overlay
 * server sent to the Tonghuashun investment-ledger (投资账本) API and normalize
 * the responses into the `/api/stock-pnl` shape. Credential-bearing requests
 * never follow a redirect, so the Cookie cannot be forwarded to another origin.
 * @module @deepseek-ai/dsh-client-ui-stock-pnl/fetch
 */

import type { ChartPoint, Stats } from './types.ts'
import { fetchLedger, type FetchLike } from './transport.ts'
export type { FetchLike } from './transport.ts'

/** The P&L intraday time_share endpoint. */
export const PNL_URL = 'https://tzzb.10jqka.com.cn/caishen_httpserver/tzzb/caishen_fund/pc/asset/v1/time_share'
/** The index quote endpoint. */
export const INDEX_URL = 'https://tzzb.10jqka.com.cn/caishen_httpserver/tzzb/caishen_fund/invest/getQuotes'
/** The portfolio-account list endpoint, used to auto-discover the fund_key. */
export const ACCOUNT_LIST_URL = 'https://tzzb.10jqka.com.cn/caishen_httpserver/tzzb/caishen_fund/pc/account/v1/account_list'

/** The browser User-Agent the request presents. */
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36'

/** The two ledger endpoints the plugin queries for one snapshot. */
export interface Endpoints {
  readonly pnlUrl: string
  readonly indexUrl: string
}

/** The production executor backed by the global fetch. */
export const defaultFetch: FetchLike = (url, init) => fetch(url, init)

/** A successful decoded JSON response. */
interface PostOk<T> {
  readonly ok: true
  readonly body: T
}

/** A rejected request: token expiry, a refused redirect, network, or parse failure. */
interface PostFail {
  readonly ok: false
  readonly tokenExpired: boolean
  readonly error: string
}

type PostResult<T> = PostOk<T> | PostFail

/** The ledger P&L response subset the plugin reads. */
interface PnlBody {
  error_code?: string
  error_msg?: string
  ex_data?: { data?: ReadonlyArray<Record<string, unknown>> }
}

/** The ledger index response subset the plugin reads. */
interface IndexBody {
  error_code?: string
  ex_data?: ReadonlyArray<Record<string, unknown>>
}

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308])

/** Post one ledger endpoint with the Cookie and never follow a redirect. */
async function postForm<T>(
  fetchImpl: FetchLike,
  url: string,
  payload: string,
  cookie: string,
  signal: AbortSignal,
): Promise<PostResult<T>> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/x-www-form-urlencoded',
    Accept: 'application/json, text/plain, */*',
    'Accept-Language': 'zh-CN,zh;q=0.9',
    Referer: 'https://tzzb.10jqka.com.cn/pc/index.html',
    'User-Agent': UA,
    Cookie: cookie,
  }
  let response: Response
  try {
    response = await fetchLedger(fetchImpl, url, { signal, method: 'POST', headers, body: payload, redirect: 'manual' })
  } catch {
    return { ok: false, tokenExpired: false, error: '数据暂时无法获取，稍后自动重试' }
  }
  if (REDIRECT_STATUSES.has(response.status)) {
    return { ok: false, tokenExpired: false, error: `接口重定向未跟随 (HTTP ${response.status})` }
  }
  if (response.status === 401) {
    return { ok: false, tokenExpired: true, error: '登录状态已失效，请在设置中重新登录' }
  }
  if (response.status === 403) {
    return { ok: false, tokenExpired: false, error: '数据暂时无法获取，稍后自动重试' }
  }
  if (!response.ok) {
    return { ok: false, tokenExpired: false, error: `请求失败 (HTTP ${response.status})` }
  }
  try {
    const body: unknown = await response.json()
    if (!isRecord(body)) throw new Error('Invalid response object')
    return { ok: true, body: body as T }
  } catch {
    return { ok: false, tokenExpired: false, error: '响应解析失败' }
  }
}

/** Reject absent, non-numeric and non-finite values before accepting a card snapshot. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
function finiteNumber(value: unknown): number | undefined {
  if (typeof value !== 'number' && (typeof value !== 'string' || value.trim() === '')) return undefined
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

/** The P&L time_share form payload. */
function pnlPayload(input: { user_id: string; fund_key: string }): string {
  return `terminal=1&version=0.0.0&userid=${input.user_id}&user_id=${input.user_id}&manual_id=&fundid=&fund_key=${input.fund_key}&rzrq_fund_key=&custid=`
}

/** The Shanghai Composite index form payload. */
function indexPayload(input: { user_id: string }): string {
  return `terminal=1&version=0.0.0&userid=${input.user_id}&user_id=${input.user_id}&code=2%3A1A0001&date=`
}

/**
 * Rebuild a Cookie the credentials store may have line-wrapped: the YAML
 * serializer folds long values across lines and the parser inserts a space at
 * each break, which corrupts base64/JWT values. Split on `;`, strip whitespace
 * from every `key=value`, and rejoin with the canonical `; ` separator.
 */
export function normalizeCookie(cookie: string): string {
  return cookie
    .split(/;\s*/)
    .map(part => part.replace(/\s+/g, ''))
    .filter(part => part.length > 0)
    .join('; ')
}

/** Read one `name=value` field out of a Cookie, or `undefined` when absent. */
export function cookieField(cookie: string, name: string): string | undefined {
  const match = cookie.match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`))
  return match?.[1]
}

/** One portfolio account from the account_list API. */
export interface Portfolio {
  readonly fund_key: string
  readonly manualname: string
  readonly brokername: string
}

/** One verified-Cookie answer (the user-visible verify route payload). */
export interface VerifyResult {
  readonly valid: boolean
  readonly reason: 'missing' | 'no-userid' | 'expired' | 'blocked' | 'redirected' | 'http' | 'parse' | 'rejected' | 'ok'
  /** Human-readable diagnostics for the invalid case. */
  readonly error?: string
  /** Actionable hint (e.g. re-sign in). */
  readonly hint?: string
  /** Portfolio accounts visible to the authenticated Cookie. */
  readonly portfolios?: readonly Portfolio[]
}

/**
 * Normalize the account-list payload into portfolio rows (empty when absent).
 * @param body - the decoded account_list response.
 * @returns the portfolio rows with a non-empty fund_key.
 */
function parsePortfolios(body: { ex_data?: { common?: ReadonlyArray<Record<string, unknown>> } }): Portfolio[] {
  const common = body.ex_data?.common ?? []
  return common.map(item => ({
    fund_key: String(item.fund_key ?? ''),
    manualname: String(item.manualname ?? ''),
    brokername: String(item.brokername ?? ''),
  })).filter(portfolio => portfolio.fund_key.length > 0)
}

/**
 * Query the portfolio list and return every account. Silently returns `[]` on
 * any network or parse failure so the caller can fall back gracefully.
 * The request shape is byte-identical to verifyCookie's (the same endpoint) —
 * optional browser headers are omitted to preserve the established request
 * shape. Intermittent gateway rejection is handled by the shared transport.
 * The Cookie is normalized first: the credentials store folds long values
 * across YAML lines and the read inserts a space at each break.
 * @param fetchImpl - executor override for tests; defaults to the global fetch.
 */
export async function listPortfolios(cookie: string, user_id: string, fetchImpl: FetchLike = defaultFetch): Promise<readonly Portfolio[]> {
  const payload = `terminal=1&version=0.0.0&userid=${user_id}&user_id=${user_id}`
  try {
    const response = await fetchLedger(fetchImpl, ACCOUNT_LIST_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': UA, Cookie: normalizeCookie(cookie) },
      body: payload,
      redirect: 'manual',
    })
    if (REDIRECT_STATUSES.has(response.status) || response.status === 401 || response.status === 403 || !response.ok) return []
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const body = (await response.json()) as any
    return parsePortfolios(body)
  } catch {
    return []
  }
}

/**
 * Probe the ledger account-list endpoint with the stored Cookie and report
 * whether it is accepted. A 401 means reauthentication is required. Intermittent
 * 403s recover silently; an exhausted 403 is a temporary rejection, not proof
 * that the Cookie expired. Redirects and business failures are never replayed.
 * @param cookie - the stored Cookie, or undefined when nothing is configured.
 * @param user_id - explicit user id, or undefined to derive it from the Cookie.
 * @param fetchImpl - executor override for tests.
 * @returns the structured verdict, never throwing.
 */
export async function verifyCookie(
  cookie: string | undefined,
  user_id?: string,
  fetchImpl: FetchLike = defaultFetch,
): Promise<VerifyResult> {
  if (cookie === undefined || cookie.length === 0) {
    return { valid: false, reason: 'missing', error: '未配置 Cookie（请粘贴或自动获取）' }
  }
  const normalized = normalizeCookie(cookie)
  const uid = (user_id ?? '').length > 0 ? user_id : cookieField(normalized, 'userid')
  if (uid === undefined || uid.length === 0) {
    return { valid: false, reason: 'no-userid', error: 'Cookie 缺少 userid 字段，可能已失效' }
  }
  let response: Response
  try {
    response = await fetchLedger(fetchImpl, ACCOUNT_LIST_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': UA, Cookie: normalized },
      body: `terminal=1&version=0.0.0&userid=${uid}&user_id=${uid}`,
      redirect: 'manual',
    })
  } catch {
    return { valid: false, reason: 'http', error: '暂时无法验证登录状态，请稍后重试' }
  }
  if (REDIRECT_STATUSES.has(response.status)) {
    return { valid: false, reason: 'redirected', error: `接口重定向未跟随 (HTTP ${response.status})` }
  }
  if (response.status === 403) {
    return { valid: false, reason: 'blocked', error: '暂时无法验证登录状态，请稍后重试', hint: '现有 Cookie 已保留，稍后再次验证' }
  }
  if (response.status === 401) {
    return { valid: false, reason: 'expired', error: 'Cookie 已过期（Token 无效），请重新登录获取', hint: '点击「自动获取 Cookie」或重新粘贴' }
  }
  if (!response.ok) {
    return { valid: false, reason: 'http', error: `HTTP ${response.status}` }
  }
  let body: { error_code?: string; error_msg?: string; ex_data?: { common?: ReadonlyArray<Record<string, unknown>> } }
  try {
    const decoded: unknown = await response.json()
    if (!isRecord(decoded) || decoded.error_code === undefined) throw new Error('Invalid response object')
    body = decoded as typeof body
  } catch {
    return { valid: false, reason: 'parse', error: '响应解析失败' }
  }
  if (String(body.error_code) !== '0') {
    return {
      valid: false,
      reason: 'rejected',
      error: '账本拒绝请求，请检查登录和账本设置',
      hint: String(body.error_msg ?? '').includes('登录') ? '请重新登录获取新的 Cookie' : undefined,
    }
  }
  if (!Array.isArray(body.ex_data?.common) || !body.ex_data.common.every(isRecord)) {
    return { valid: false, reason: 'parse', error: '账本列表格式异常' }
  }
  return { valid: true, reason: 'ok', portfolios: parsePortfolios(body) }
}

/** Inputs for one snapshot acquisition. */
export interface CollectStatsInput extends Endpoints {
  /** The resolved Cookie, or `undefined` when the environment supplied none. */
  readonly cookie: string | undefined
  /** The environment-variable name for the Cookie, named in the not-configured error. */
  readonly cookieEnv: string
  /** The ledger user id, included in every form payload; empty falls back to the Cookie's `userid`. */
  readonly user_id: string
  /** The ledger fund key selecting the managed portfolio. */
  readonly fund_key: string
  /** Executor override for tests. */
  readonly fetchImpl?: FetchLike
  /** Overall deadline for this snapshot, including silent recovery. */
  readonly requestTimeoutMs?: number
  /** Clock override for tests; defaults to `new Date()`. */
  readonly now?: () => Date
}

/**
 * Fetch and normalize one snapshot. A missing Cookie and a refused ledger
 * request both return a populated `Stats` with a non-empty `error`; only a
 * thrown executor falls through to the caller (already contained).
 */
export async function collectStats(input: CollectStatsInput): Promise<Stats> {
  const fetchImpl = input.fetchImpl ?? defaultFetch
  const now = input.now ?? (() => new Date())
  const signal = AbortSignal.timeout(input.requestTimeoutMs ?? 15_000)
  if (input.cookie === undefined || input.cookie.length === 0) {
    return {
      pnl_pct: 0,
      pnl_yk: 0,
      sh_pct: 0,
      chart_data: [],
      updated_at: now().toISOString(),
      error: `请配置 Cookie（环境变量 ${input.cookieEnv}）`,
      token_expired: false,
    }
  }

  let pnlPct = 0
  let pnlYk = 0
  let chartData: ChartPoint[] = []
  let shPct = 0
  let error = ''
  let tokenExpired = false
  let indexUnavailable = false

  const cookie = normalizeCookie(input.cookie)
  // The ledger form payload needs the user id; fall back to the Cookie's own
  // `userid` field so the plugin works without a separate `user_id` config.
  const user_id = input.user_id.length > 0 ? input.user_id : (cookieField(cookie, 'userid') ?? '')

  const pnl = await postForm<PnlBody>(fetchImpl, input.pnlUrl, pnlPayload({ user_id, fund_key: input.fund_key }), cookie, signal)
  if (pnl.ok) {
    if (String(pnl.body.error_code) !== '0') {
      error = '账本拒绝请求，请检查登录和账本设置'
    } else {
      const points = pnl.body.ex_data?.data
      if (!Array.isArray(points) || points.length === 0) {
        error = '暂无可用盈亏数据，稍后自动更新'
      } else if (!points.every(point => isRecord(point) && finiteNumber(point.time) !== undefined && finiteNumber(point.zf) !== undefined)
        || finiteNumber(points.at(-1)?.yk) === undefined) {
        error = '盈亏数据格式异常，稍后自动更新'
      } else {
        const last = points.at(-1)!
        pnlPct = finiteNumber(last.zf)!
        pnlYk = finiteNumber(last.yk)!
        chartData = points.map(point => ({ t: finiteNumber(point.time)!, v: finiteNumber(point.zf)! }))
      }
    }
  } else {
    tokenExpired = pnl.tokenExpired
    error = pnl.error
  }

  if (error === '') {
    const index = await postForm<IndexBody>(fetchImpl, input.indexUrl, indexPayload({ user_id }), cookie, signal)
    indexUnavailable = true
    if (index.ok && String(index.body.error_code) === '0' && Array.isArray(index.body.ex_data)) {
      for (const item of index.body.ex_data) {
        if (!isRecord(item)) continue
        if (item.zqdm !== '1A0001') continue
        const price = finiteNumber(item.xianjia)
        const prev = finiteNumber(item.zuoshou)
        if (price !== undefined && price > 0 && prev !== undefined && prev > 0) { shPct = Math.round(((price - prev) / prev) * 10000) / 100; indexUnavailable = false }
        break
      }
    }
  }

  return {
    pnl_pct: pnlPct,
    pnl_yk: pnlYk,
    sh_pct: shPct,
    chart_data: chartData,
    updated_at: now().toISOString(),
    error,
    token_expired: tokenExpired,
    ...(indexUnavailable ? { index_unavailable: true } : {}),
  }
}
