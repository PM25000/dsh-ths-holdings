/** Synthetic ledger records: no real account identifiers or balances. */
import { LedgerClient, type LedgerConfig } from '../src/ledger.ts'
import type { FetchLike } from '../src/fetch.ts'
export const config: LedgerConfig = { cookieEnv: 'TEST_COOKIE', fundKeyEnv: 'TEST_FUND', user_id: '', fund_key: '', requestTimeoutMs: 1000, pnlUrl: 'https://ledger.test/time_share' }
export function positionBody() {
  return { error_code: '0', ex_data: {
    money_remain: '20.00', total_value: '30.30', total_asset: '50.30', total_liability: '0', position_rate: '0.6024', upload_time: '1792048335000',
    position: [{ market: '1', code: '000001', name: '示例', count: '3', cost: '10.01', price: '10.10', value: '30.30',
      hold_profit: '0.27', hold_rate: '0.00899', pre_profit: '0.30', pre_rate: '0.01', position_rate: '1', stock_account: 'PRIVATE-ACCOUNT' }],
  } }
}
export function fixture(options: {
  accounts?: number; selected?: string; body?: unknown; namesFail?: boolean
  intercept?: (url: string, init: RequestInit) => Response | Promise<Response> | undefined
} = {}) {
  const seen: { url: string; init: RequestInit }[] = []
  const fetchImpl: FetchLike = async (url, init) => {
    seen.push({ url, init })
    const intercepted = await options.intercept?.(url, init)
    if (intercepted) return intercepted
    let body: unknown
    if (url.endsWith('account_list')) body = { error_code: '0', ex_data: { common: Array.from({ length: options.accounts ?? 1 }, (_, i) => ({ fund_key: 'portfolio-' + i, manualname: '示例账本' + i, brokername: '示例券商' })) } }
    else if (url.endsWith('stock_position')) body = options.body ?? positionBody()
    else if (url.endsWith('sort_list')) {
      if (options.namesFail) throw new Error('private-cookie-value must never escape')
      body = { error_code: '0', ex_data: { list: [{ market: '1', code: '000001', name: '示例完整名称' }, { market: '2', code: '600000', name: '额外自选股' }] } }
    } else if (url.endsWith('time_share')) body = { error_code: '0', ex_data: { data: [{ time: '1792134000000', zf: '1.25', yk: '0.30' }] } }
    else throw new Error('unexpected endpoint')
    return new Response(JSON.stringify(body), { status: 200 })
  }
  const credentials = async (ref: string) => ref === 'TEST_COOKIE' ? 'userid=test-user; sid=private-cookie-value' : options.selected
  return { seen, fetchImpl, client: new LedgerClient(config, credentials, fetchImpl, () => new Date('2026-10-18T00:00:00Z')) }
}
