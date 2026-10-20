/** Independently enabled bundled report Skill and its read-only tools. */
import type { Context } from '@deepseek-ai/cordis'
import { attachComponent } from './component.ts'
import { apply as registerModel } from './model.ts'
export const name = 'ths-portfolio-skill'
export const inject = ['loader', 'webServer', 'credentials', 'tools', 'skills']
export async function apply(ctx: Context): Promise<void> {
  const runtime = await attachComponent(ctx, 'skill')
  // Cordis exposes an ambient const enum; 1/2 are its loading/active states.
  if (ctx.fiber.state !== 1 && ctx.fiber.state !== 2) return
  await registerModel(ctx, { client: runtime.ledger })
}
