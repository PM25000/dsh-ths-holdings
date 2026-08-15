/**
 * Stock P&L overlay plugin, browser half: the floating `stock-pnl` card in the
 * frame-wide `shell.overlay` layer. The card polls the same-origin
 * `/api/stock-pnl` route the node half serves and renders the normalized
 * snapshot; the Cookie stays on the host. A settings button saves the Cookie
 * through the credential Remote API (`credentials.set`), the same channel the
 * Models settings page uses for API keys.
 * @module @deepseek-ai/dsh-client-ui-stock-pnl/client
 */

import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type { ConnectionHandle } from '@deepseek-ai/dsh-api-remotes/client'
// Type-only: pulls ui-layout's SlotMap merge (the `shell.overlay` list entry).
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import { StockPnlCard } from './StockPnlCard.tsx'
import type { StockPnlInjected } from './StockPnlCard.tsx'

export type { StockPnlInjected } from './StockPnlCard.tsx'

/** The credential reference the node half resolves (matches its default `cookieEnv`). */
export const COOKIE_REF = 'STOCK_PNL_COOKIE'
/** The credential reference for the ledger fund key (matches the default `fundKeyEnv`). */
export const FUND_KEY_REF = 'STOCK_PNL_FUND_KEY'

/** Required services: the slot registry and the Remote API carrier. */
export const inject = ['slots', 'connection']

/**
 * Client plugin body: contribute the card as one additive entry of the
 * frame-wide floating layer. The inject wait ties registration to the
 * declaring entry (ui-layout's AppFrame) and removes it with the plugin fiber;
 * the inject face hands the card verbs that write the Cookie and fund key
 * through the host credential seam.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  const connection = ctx.get('connection') as ConnectionHandle

  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay',
    id: 'stock-pnl',
    order: 100,
    inject: (): StockPnlInjected => ({
      onSaveCookie: async (value) => {
        await connection.api.credentials.set({ ref: COOKIE_REF, value })
      },
      onSaveFundKey: async (value) => {
        await connection.api.credentials.set({ ref: FUND_KEY_REF, value })
      },
    }),
  }, StockPnlCard))
}
