/** Strict read-only ledger acquisition shared by model tools and route adapters. */
import Decimal from 'decimal.js'
import { cookieField, normalizeCookie, type FetchLike } from './fetch.ts'
import { fetchLedger } from './transport.ts'
import type { PnlResult, PortfoliosResult, PositionsResult } from './report-schema.ts'

const D = Decimal.clone({ precision: 40 })
const BASE = 'https://tzzb.10jqka.com.cn/caishen_httpserver/tzzb/caishen_fund/'
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36'
export interface LedgerConfig {
  cookieEnv: string
  fundKeyEnv: string
  user_id: string
  fund_key: string
  requestTimeoutMs: number
  pnlUrl: string
}
/** Values are resolved once per operation and never appear in a result. */
export type CredentialReader = (ref: string) => Promise<string | undefined>
interface Identity { cookie: string; user: string; selected: string }
interface Portfolio { id: string; name: string; broker: string }
type Row = Record<string, unknown>
export class LedgerError extends Error {
  constructor(readonly code: string, message: string) { super(message); this.name = 'LedgerError' }
}
function object(value: unknown): Row {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new LedgerError('INVALID_RESPONSE', '账本响应结构异常')
  return value as Row
}
function scalar(value: unknown, fallback = ''): string {
  return typeof value === 'string' || typeof value === 'number' ? String(value) : fallback
}
/** Parse a decimal without admitting NaN, infinity, scientific notation or blank-as-zero. */
function number(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null
  const s = scalar(value).trim()
  if (!/^[+-]?\d+(?:\.\d+)?$/.test(s) || s.length > 80) throw new LedgerError('INVALID_RESPONSE', '账本包含无效数值')
  return new D(s).toFixed()
}
function pct(value: unknown): string | null {
  const n = number(value)
  return n === null ? null : new D(n).times(100).toFixed()
}
function total(values: (string | null)[]): string | null {
  return values.some(v => v === null) ? null : values.reduce<Decimal>((sum, v) => sum.plus(v!), new D(0)).toFixed()
}
function ratio(a: string | null, b: string | null): string | null {
  return a === null || b === null || new D(b).isZero() ? null : new D(a).div(b).times(100).toDecimalPlaces(6).toFixed()
}
function iso(value: unknown): string | null {
  const raw = scalar(value)
  if (!/^\d{13}$/.test(raw)) return null
  const date = new Date(Number(raw))
  return Number.isFinite(date.getTime()) ? date.toISOString() : null
}
function failure(error: unknown) {
  const e = error instanceof LedgerError ? error : new LedgerError('INTERNAL_ERROR', '查询失败，请检查插件设置')
  return { status: 'error' as const, code: e.code, message: e.message, warnings: [] as string[], data: null }
}
function abort(signal: AbortSignal): void {
  if (signal.aborted) throw new LedgerError(signal.reason?.name === 'TimeoutError' ? 'TIMEOUT' : 'CANCELLED', '查询超时或已取消')
}
/** No persisted cache: each call snapshots credentials, selection and an overall deadline. */
export class LedgerClient {
  constructor(
    private readonly config: LedgerConfig,
    private readonly credentials: CredentialReader,
    private readonly fetchImpl: FetchLike = (url, init) => fetch(url, init),
    private readonly now: () => Date = () => new Date(),
  ) {}
  private async read(ref: string, signal: AbortSignal): Promise<string | undefined> {
    abort(signal)
    return new Promise((resolve, reject) => {
      const cancel = () => reject(new LedgerError(signal.reason?.name === 'TimeoutError' ? 'TIMEOUT' : 'CANCELLED', '查询超时或已取消'))
      signal.addEventListener('abort', cancel, { once: true })
      void this.credentials(ref).then(value => { signal.removeEventListener('abort', cancel); resolve(value) },
        () => { signal.removeEventListener('abort', cancel); reject(new LedgerError('CREDENTIAL_ERROR', '无法读取登录设置，请检查插件配置')) })
    })
  }
  private async identity(signal: AbortSignal): Promise<Identity> {
    abort(signal)
    const cookie = normalizeCookie(await this.read(this.config.cookieEnv, signal) ?? '')
    abort(signal)
    if (!cookie) throw new LedgerError('NOT_CONFIGURED', '请在插件设置中完成同花顺登录')
    const user = this.config.user_id || cookieField(cookie, 'userid') || ''
    if (!user) throw new LedgerError('AUTH_REQUIRED', '登录凭据缺少用户标识，请重新登录')
    const selected = await this.read(this.config.fundKeyEnv, signal) || this.config.fund_key
    abort(signal)
    return { cookie, user, selected }
  }
  private deadline(signal: AbortSignal): AbortSignal {
    return AbortSignal.any([signal, AbortSignal.timeout(this.config.requestTimeoutMs)])
  }
  private async post(path: string, extra: Record<string, string>, identity: Identity, signal: AbortSignal, minimal = false): Promise<Row> {
    const url = path.startsWith('https://') || path.startsWith('http://') ? path : BASE + path
    const headers: Record<string, string> = { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': UA, Cookie: identity.cookie }
    if (!minimal) Object.assign(headers, { Accept: 'application/json, text/plain, */*', 'Accept-Language': 'zh-CN,zh;q=0.9', Referer: 'https://tzzb.10jqka.com.cn/pc/index.html' })
    const body = new URLSearchParams({ terminal: '1', version: '0.0.0', userid: identity.user, user_id: identity.user, ...extra }).toString()
    abort(signal)
    let response: Response
    try {
      response = await fetchLedger(this.fetchImpl, url, { method: 'POST', headers, body, signal }, { retryTransient: true })
    } catch {
      abort(signal)
      throw new LedgerError('NETWORK_ERROR', '账本网络请求失败')
    }
    if (response.status >= 300 && response.status < 400) throw new LedgerError('REDIRECT_REFUSED', '账本请求发生重定向，已停止')
    if (response.status === 401) throw new LedgerError('AUTH_REQUIRED', '登录状态已失效，请重新登录')
    if (response.status === 403) throw new LedgerError('REQUEST_BLOCKED', '请求暂时被拒绝，请稍后重试')
    if (response.status === 429 || response.status >= 500) throw new LedgerError('SERVICE_UNAVAILABLE', '账本服务暂时不可用')
    if (!response.ok) throw new LedgerError('HTTP_ERROR', '账本请求失败')
    let result: Row
    try { result = object(await response.json()) } catch { abort(signal); throw new LedgerError('INVALID_RESPONSE', '账本响应不是有效对象') }
    abort(signal)
    if (String(result.error_code) !== '0') throw new LedgerError('API_REJECTED', '账本拒绝请求，请检查登录和账本设置')
    return result
  }
  private async accounts(identity: Identity, signal: AbortSignal): Promise<Portfolio[]> {
    const result = await this.post('pc/account/v1/account_list', {}, identity, signal, true)
    const rows = object(result.ex_data).common
    if (!Array.isArray(rows)) throw new LedgerError('INVALID_RESPONSE', '账本列表缺少 common 数组')
    const ids = new Set<string>()
    return rows.map(value => {
      const row = object(value), id = scalar(row.fund_key)
      if (!id || ids.has(id)) throw new LedgerError('INVALID_RESPONSE', '账本标识缺失或重复')
      ids.add(id)
      return { id, name: scalar(row.manualname, '未命名账本'), broker: scalar(row.brokername) }
    })
  }
  private async select(identity: Identity, signal: AbortSignal, requested?: string): Promise<Portfolio> {
    const rows = await this.accounts(identity, signal)
    const target = requested === undefined ? identity.selected : requested.trim()
    if (requested !== undefined && !target) throw new LedgerError('INVALID_PORTFOLIO', '账本标识不能为空')
    if (target) {
      const match = rows.find(row => row.id === target)
      if (!match) throw new LedgerError('PORTFOLIO_NOT_FOUND', '指定或已保存的账本不存在，请重新选择')
      return match
    }
    if (rows.length === 0) throw new LedgerError('NO_PORTFOLIOS', '当前登录没有可用账本')
    if (rows.length !== 1) throw new LedgerError('PORTFOLIO_REQUIRED', '存在多个账本，请明确指定账本或在卡片中保存选择')
    return rows[0]!
  }
  async list(signal: AbortSignal): Promise<PortfoliosResult> {
    try {
      const timed = this.deadline(signal), identity = await this.identity(timed)
      const rows = await this.accounts(identity, timed)
      return { status: 'ok', code: 'OK', message: '', warnings: [], data: { portfolios: rows.map(row => ({ ...row, selected: row.id === identity.selected })) } }
    } catch (error) { return failure(error) }
  }
  async positions(signal: AbortSignal, requested?: string): Promise<PositionsResult> {
    try {
      const timed = this.deadline(signal), identity = await this.identity(timed)
      const portfolio = await this.select(identity, timed, requested)
      const result = await this.post('pc/asset/v1/stock_position', { manual_id: '', fund_key: portfolio.id, rzrq_fund_key: '', is_merge: '0' }, identity, timed)
      const data = object(result.ex_data)
      if (!Array.isArray(data.position)) throw new LedgerError('INVALID_RESPONSE', '持仓响应缺少 position 数组')
      if (data.currency !== undefined && !['CNY', 'RMB', '156'].includes(scalar(data.currency))) throw new LedgerError('UNSUPPORTED_ACCOUNT', '目前仅支持人民币普通账本')
      const warnings: string[] = []
      const assets = { cash: number(data.money_remain), total_value: number(data.total_value), total_asset: number(data.total_asset), total_liability: number(data.total_liability), invested_pct: pct(data.position_rate) }
      const keys = new Set<string>()
      const positions = data.position.map(value => {
        const row = object(value), code = scalar(row.code), market = scalar(row.market)
        if (!(market === '1' ? /^[013]\d{5}$/.test(code) : market === '2' && /^[56]\d{5}$/.test(code))) throw new LedgerError('UNSUPPORTED_MARKET', '目前仅支持人民币沪深股票及 ETF 普通账本')
        const key = market + ':' + code
        if (keys.has(key)) throw new LedgerError('INVALID_RESPONSE', '持仓证券标识重复')
        keys.add(key)
        const p = { market, code, name: scalar(row.name, code),
          count: number(row.count), cost: number(row.cost), price: number(row.price), value: number(row.value),
          holding_profit: number(row.hold_profit), holding_pct: pct(row.hold_rate),
          day_profit: number(row.pre_profit), day_pct: pct(row.pre_rate),
          weight_in_positions_pct: pct(row.position_rate), weight_in_assets_pct: ratio(number(row.value), assets.total_asset) }
        if ((p.price !== null && new D(p.price).isNegative()) || (p.value !== null && new D(p.value).isNegative())) throw new LedgerError('INVALID_RESPONSE', '持仓价格或市值为负数')
        if (p.count !== null && new D(p.count).isNegative()) throw new LedgerError('UNSUPPORTED_ACCOUNT', '目前不支持空头或融资融券账本')
        const expectedWeight = ratio(p.value, assets.total_value)
        if (p.weight_in_positions_pct !== null && expectedWeight !== null && new D(p.weight_in_positions_pct).minus(expectedWeight).abs().gt('0.0051')) warnings.push('POSITION_WEIGHT_MISMATCH:' + key)
        if (Object.values(p).some(v => v === null)) warnings.push('MISSING_POSITION_FIELDS:' + key)
        if (p.count !== null && p.price !== null && p.value !== null && new D(p.count).times(p.price).minus(p.value).abs().gt('0.01')) warnings.push('POSITION_VALUE_MISMATCH:' + key)
        return p
      })
      if (Object.values(assets).some(v => v === null)) warnings.push('MISSING_ASSET_FIELDS')
      if (assets.total_liability !== null && !new D(assets.total_liability).isZero()) throw new LedgerError('UNSUPPORTED_ACCOUNT', '目前仅支持无融资负债的普通账本')
      const expectedExposure = ratio(assets.total_value, assets.total_asset)
      if (assets.invested_pct !== null && expectedExposure !== null && new D(assets.invested_pct).minus(expectedExposure).abs().gt('0.0051')) warnings.push('EXPOSURE_MISMATCH')
      const sumValue = total(positions.map(row => row.value))
      if (sumValue !== null && assets.total_value !== null && new D(sumValue).minus(assets.total_value).abs().gt('0.01')) warnings.push('TOTAL_VALUE_MISMATCH')
      if (assets.cash !== null && sumValue !== null && assets.total_asset !== null && assets.total_liability === '0'
        && new D(assets.cash).plus(sumValue).minus(assets.total_asset).abs().gt('0.01')) warnings.push('TOTAL_ASSET_MISMATCH')
      let names: Map<string, string> | undefined
      if (positions.length > 0) {
        try {
          const optional = object((await this.post('pc/optional/v1/sort_list', { sort_rule: '', sort_order: '' }, identity, timed)).ex_data).list
          if (!Array.isArray(optional)) throw new LedgerError('INVALID_RESPONSE', '名称列表格式无效')
          names = new Map(optional.map(item => { const r = object(item); return [scalar(r.market) + ':' + scalar(r.code), scalar(r.name)] }))
        } catch (error) {
          if (signal.aborted || timed.aborted) throw error
          warnings.push('NAME_LOOKUP_UNAVAILABLE')
        }
      }
      for (const p of positions) p.name = names?.get(p.market + ':' + p.code) || p.name
      const uploaded_at = iso(data.upload_time)
      if (uploaded_at === null) warnings.push('UPLOAD_TIME_UNAVAILABLE')
      const checksFailed = warnings.some(w => w.includes('MISMATCH') || w.startsWith('MISSING_'))
      return { status: warnings.length ? 'partial' : 'ok', code: warnings.length ? 'PARTIAL_DATA' : 'OK', message: '',
        warnings, data: { portfolio, currency: 'CNY', queried_at: this.now().toISOString(), uploaded_at, quote_date: null, assets,
          totals: { holding_profit: total(positions.map(p => p.holding_profit)), day_profit: total(positions.map(p => p.day_profit)) },
          positions, position_count: positions.length, analysis_available: !checksFailed } }
    } catch (error) { return failure(error) }
  }
  async pnl(signal: AbortSignal, requested?: string): Promise<PnlResult> {
    try {
      const timed = this.deadline(signal), identity = await this.identity(timed)
      const portfolio = await this.select(identity, timed, requested)
      const result = await this.post(this.config.pnlUrl, { manual_id: '', fundid: '', fund_key: portfolio.id, rzrq_fund_key: '', custid: '' }, identity, timed)
      const values = object(result.ex_data).data
      if (!Array.isArray(values)) throw new LedgerError('INVALID_RESPONSE', '分时响应缺少 data 数组')
      const points = values.map(value => {
        const row = object(value)
        return { t: scalar(row.time), pct: number(row.zf), profit: number(row.yk) }
      })
      const last = points.at(-1)
      const incomplete = points.some(p => !p.t || p.pct === null || p.profit === null)
      const warnings = !last ? ['NO_PNL_SAMPLES'] : incomplete ? ['MISSING_PNL_FIELDS'] : []
      return { status: warnings.length ? 'partial' : 'ok', code: warnings.length ? 'PARTIAL_DATA' : 'OK', message: '', warnings,
        data: { portfolio, queried_at: this.now().toISOString(), quote_date: null, sample_at: iso(last?.t),
          day_profit: last?.profit ?? null, day_pct: last?.pct ?? null, points } }
    } catch (error) { return failure(error) }
  }
}
