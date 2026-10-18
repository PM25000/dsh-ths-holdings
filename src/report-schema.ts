/** Canonical model-visible results. Decimal values are strings; absent values are null. */
import type { InferValue } from '@deepseek-ai/dsh-tools'
const text = { type: 'string', required: true } as const
const decimal = { oneOf: [{ type: 'string' }, { type: 'null' }], required: true } as const
const portfolio = {
  type: 'object', additionalProperties: false,
  properties: { id: text, name: text, broker: text },
} as const
const state = {
  status: { type: 'string', enum: ['ok', 'partial', 'error'], required: true },
  code: text, message: text,
  warnings: { type: 'array', items: { type: 'string' }, required: true },
} as const
const position = {
  type: 'object', additionalProperties: false,
  properties: {
    market: text, code: text, name: text,
    count: decimal, cost: decimal, price: decimal, value: decimal,
    holding_profit: decimal, holding_pct: decimal, day_profit: decimal, day_pct: decimal,
    weight_in_positions_pct: decimal, weight_in_assets_pct: decimal,
  },
} as const
export const portfoliosSchema = {
  type: 'object', additionalProperties: false,
  properties: { ...state, data: { oneOf: [
    { type: 'object', additionalProperties: false, properties: {
      portfolios: { type: 'array', items: { ...portfolio, properties: {
        ...portfolio.properties, selected: { type: 'boolean', required: true },
      } }, required: true },
    } }, { type: 'null' },
  ], required: true } },
} as const
export const positionsSchema = {
  type: 'object', additionalProperties: false,
  properties: { ...state, data: { oneOf: [
    { type: 'object', additionalProperties: false, properties: {
      portfolio: { ...portfolio, required: true },
      currency: { type: 'string', const: 'CNY', required: true },
      queried_at: text, uploaded_at: decimal, quote_date: decimal,
      assets: { type: 'object', additionalProperties: false, required: true, properties: {
        cash: decimal, total_value: decimal, total_asset: decimal, total_liability: decimal, invested_pct: decimal,
      } },
      totals: { type: 'object', additionalProperties: false, required: true, properties: { holding_profit: decimal, day_profit: decimal } },
      positions: { type: 'array', items: position, required: true },
      position_count: { type: 'integer', required: true },
      analysis_available: { type: 'boolean', required: true },
    } }, { type: 'null' },
  ], required: true } },
} as const
export const pnlSchema = {
  type: 'object', additionalProperties: false,
  properties: { ...state, data: { oneOf: [
    { type: 'object', additionalProperties: false, properties: {
      portfolio: { ...portfolio, required: true }, queried_at: text,
      sample_at: decimal, quote_date: decimal, day_profit: decimal, day_pct: decimal,
      points: { type: 'array', required: true, items: {
        type: 'object', additionalProperties: false, properties: { t: text, pct: decimal, profit: decimal },
      } },
    } }, { type: 'null' },
  ], required: true } },
} as const
export type PortfoliosResult = InferValue<typeof portfoliosSchema>
export type PositionsResult = InferValue<typeof positionsSchema>
export type PnlResult = InferValue<typeof pnlSchema>
export type ReportResult = PortfoliosResult | PositionsResult | PnlResult
