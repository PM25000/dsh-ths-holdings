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
