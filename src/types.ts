/**
 * Wire types for the stock P&L overlay feature.
 * @module @deepseek-ai/dsh-client-ui-stock-pnl/types
 */

/** One intraday P&L sample: Unix epoch milliseconds and its signed percent change. */
export interface ChartPoint {
  readonly t: number
  readonly v: number
}

/**
 * The `/api/stock-pnl` payload, consumed by the floating card unchanged.
 */
export interface Stats {
  /** Today's position P&L as a signed percent (red = profit in CN convention). */
  readonly pnl_pct: number
  /** Today's position P&L as a signed yuan amount. */
  readonly pnl_yk: number
  /** Shanghai Composite Index change as a signed percent. */
  readonly sh_pct: number
  /** Intraday P&L percent series for the mini chart. */
  readonly chart_data: readonly ChartPoint[]
  /** ISO-8601 time of the last fetch. */
  readonly updated_at: string
  /** Empty on success; a human- or machine-readable message otherwise. */
  readonly error: string
  /** True when the configured Cookie was rejected (HTTP 401/403) by the ledger API. */
  readonly token_expired: boolean
}

/** One ledger portfolio account, as reported by the verify endpoint. */
export interface VerifyPortfolio {
  readonly fund_key: string
  readonly manualname: string
  readonly brokername: string
}

/** The `/api/stock-pnl/verify` payload: whether a usable Cookie is stored. */
export interface VerifyView {
  /** True when the credential reference holds a non-empty Cookie. */
  readonly configured: boolean
  /** True when the stored Cookie was accepted by the ledger API. */
  readonly valid: boolean
  /** Human-readable diagnostics for the invalid case. */
  readonly error?: string
  /** Actionable hint (e.g. re-sign in / re-acquire). */
  readonly hint?: string
  /** Portfolio accounts visible to the validated Cookie (empty when unauthenticated). */
  readonly portfolios?: readonly VerifyPortfolio[]
}

/** One step of the auto-acquire state machine, as reported by the status endpoint. */
export interface AcquireStatusView {
  /** idle=no run; acquiring=a visible Edge window is waiting for sign-in; saved=Cookie committed; failed=see error/hint. */
  readonly state: 'idle' | 'acquiring' | 'saved' | 'failed'
  /** Human-readable failure message (failed only). */
  readonly error?: string
  /** Actionable hint for the failure (e.g. how to install playwright-core). */
  readonly hint?: string
}
