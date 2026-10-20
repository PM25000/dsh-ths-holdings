/** Floating card component; shared settings and routes belong to the container. */
import type { Context } from '@deepseek-ai/cordis'
import { attachComponent } from './component.ts'
import type {} from '@deepseek-ai/dsh-settings'
import type { Config as HostConfig, LiveConfig } from './host.ts'
export { Config } from './host.ts'
export const name = 'ths-holdings-card'
export const inject = ['loader', 'webServer', 'credentials']
export async function apply(ctx: Context, config: HostConfig | LiveConfig = {}): Promise<void> {
  ctx.inject(['settings'], child => { child.effect(() => child.settings.configure({ auto: false }, ctx.fiber)) })
  await attachComponent(ctx, 'card', config)
}
