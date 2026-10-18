/**
 * Stock P&L overlay plugin, browser half: the floating `stock-pnl` card in the
 * frame-wide `shell.overlay` layer. The card polls the same-origin
 * `/api/stock-pnl` route the node half serves and renders the normalized
 * snapshot; the Cookie stays on the host. A settings button saves the Cookie
 * through this plugin's same-origin host routes.
 * @module @deepseek-ai/dsh-client-ui-stock-pnl/client
 */

import type { Context } from '@deepseek-ai/cordis'
// The renderer now owns the ctx.slots service; ui-slots supplies the pure contracts.
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
// Type-only: pulls ui-layout's SlotMap merge (the `shell.overlay` list entry).
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import { Preferences, StockPnlOverlay } from './Preferences.tsx'
import { SETTINGS_ENTRY_ID, type CardPreferences } from '../preferences.ts'
import { SETTINGS_NS, zh, en } from './locales.ts'
import { saveSetting } from './settings.ts'

export type { StockPnlInjected } from './StockPnlCard.tsx'

/** The credential reference the node half resolves (matches its default `cookieEnv`). */
export const COOKIE_REF = 'STOCK_PNL_COOKIE'
/** The credential reference for the ledger fund key (matches the default `fundKeyEnv`). */
export const FUND_KEY_REF = 'STOCK_PNL_FUND_KEY'

/** Required service: the slot registry. */
export const inject = ['slots', 'configForms', 'locale']

/**
 * Client plugin body: contribute the card as one additive entry of the
 * frame-wide floating layer. The inject wait ties registration to the
 * declaring entry (ui-layout's AppFrame) and removes it with the plugin fiber;
 * the inject face hands the card verbs that write the Cookie and fund key
 * through the host credential seam.
 * @param ctx - client root context.
 */
export function apply(ctx: Context): void {
  const preferences = ctx.configForms.get<CardPreferences>(SETTINGS_ENTRY_ID)
  ctx.effect(() => ctx.locale.register(SETTINGS_NS, { zh, en }))
  const t = ctx.locale.bind(SETTINGS_NS)
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section', id: SETTINGS_ENTRY_ID, order: 200,
    label: () => t('title'), locale: SETTINGS_NS,
    inject: () => ({ preferences }),
  }, Preferences))
  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay',
    id: 'stock-pnl',
    order: 100,
    inject: () => ({
      preferences,
      onSaveCookie: async (value) => {
        await saveSetting('cookie', value)
      },
      onSaveFundKey: async (value) => {
        await saveSetting('fund-key', value)
      },
    }),
  }, StockPnlOverlay))
}
