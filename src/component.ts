/** Mount the package-root client carrier only while a feature needs it. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/cordis-plugin-loader'
import type { Component, HoldingsRuntime } from './index.ts'
import type { Config, LiveConfig } from './host.ts'
export const SHARED_ENTRY_ID = 'ths-holdings-shared'
export async function attachComponent(ctx: Context, component: Component, config?: Config | LiveConfig): Promise<HoldingsRuntime> {
  let entry = [...ctx.loader.entries()].find(row => row.options.id === SHARED_ENTRY_ID)
  if (!entry) {
    const options = { id: SHARED_ENTRY_ID, name: 'dsh-ths-holdings', group: true }
    // Use the card's resolution tree, so its package-root client has one source.
    const card = [...ctx.loader.entries()].find(row => row.options.id === 'ths-holdings')
    const id = await (card ? card.parent.create(options) : ctx.loader.create(options))
    entry = ctx.loader.resolve(id)
  }
  await entry.refresh()
  await entry.fiber?.await()
  const runtime = ctx.get('thsHoldings')
  if (!runtime) throw new Error('同花顺共享服务未就绪')
  await runtime.attach(ctx, component, config)
  return runtime
}
