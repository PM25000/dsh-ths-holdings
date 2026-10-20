/** Original card entry plus an internal, demand-mounted shared container. */
import { Service, type Context, type Fiber } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/cordis-plugin-loader'
import { apply as applyCard } from './card.ts'
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'
import { LedgerClient } from './ledger.ts'
import { apply as mountHost, resolveConfig, resolveCredential, type Config as HostConfig, type LiveConfig } from './host.ts'
export { Config, ROUTE_PATH, type LiveConfig, type RouteStats } from './host.ts'
export const name = 'ths-holdings'
export const inject = ['loader', 'webServer', 'credentials']
export type Component = 'card' | 'skill'
export interface ComponentState { card: boolean; skill: boolean; revision: number }
declare module '@deepseek-ai/cordis' {
  interface Context { thsHoldings: HoldingsRuntime }
}

/** One service instance owns component leases, live routes and notifications. */
export class HoldingsRuntime extends Service {
  readonly ledger: LedgerClient
  private readonly leases = new Map<Context, Component>()
  private readonly listeners = new Set<(state: ComponentState) => void>()
  private session?: Fiber
  private queue = Promise.resolve()
  private revision = 0
  private readonly config: HostConfig | LiveConfig
  private cardConfig?: HostConfig | LiveConfig
  constructor(private readonly owner: Context, fallback: HostConfig | LiveConfig) {
    super(owner, 'thsHoldings')
    const ctx = owner
    this.config = new Proxy({}, { get: (_target, key) => {
      const entry = [...(ctx.get('loader')?.entries() ?? [])].find(row => row.options.id === 'ths-holdings')
      return Reflect.get(entry?.options.config ?? this.cardConfig ?? fallback, key)
    } })
    this.ledger = new LedgerClient(resolveConfig(this.config), ref => resolveCredential(ctx, ref))
    const streams = new Set<Parameters<WebRoute['handler']>[1]>()
    ctx.effect(() => ctx.webServer.register({ kind: 'exact', path: '/api/stock-pnl/components', handler: (req, res) => {
      if (req.method !== 'GET') { res.writeHead(405); res.end(); return }
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no' })
      streams.add(res)
      const send = (state: ComponentState) => { res.write(`data: ${JSON.stringify(state)}\n\n`) }
      this.listeners.add(send)
      send(this.state())
      res.on('close', () => { streams.delete(res); this.listeners.delete(send) })
    } }))
    ctx.effect(() => () => { for (const stream of streams) stream.end(); streams.clear(); this.listeners.clear() })
  }
  state(): ComponentState {
    const active = [...this.leases.values()]
    return { card: active.includes('card'), skill: active.includes('skill'), revision: this.revision }
  }
  private publish(): void {
    for (const listener of this.listeners) {
      try { listener(this.state()) } catch { this.listeners.delete(listener) }
    }
  }
  changed(): void {
    this.revision++
    this.publish()
  }
  private synchronize(): Promise<void> {
    const next = this.queue.then(async () => {
      if (this.leases.size && !this.session) {
        const fork = this.owner.plugin({ name: 'ths-ledger-session', apply: child => mountHost(child, this.config, () => this.changed()) })
        this.session = fork.ctx.fiber
        await fork
      } else if (!this.leases.size && this.session) {
        const previous = this.session
        this.session = undefined
        previous.dispose()
        await previous.await()
      }
      this.publish()
    })
    this.queue = next.catch(() => {})
    return next
  }
  async attach(owner: Context, component: Component, config?: HostConfig | LiveConfig): Promise<void> {
    if (config) this.cardConfig = config
    owner.fiber.assertActive()
    owner.effect(() => {
      this.leases.set(owner, component)
      return async () => {
        this.leases.delete(owner)
        await this.synchronize()
        if (!this.leases.size) {
          const entry = [...(this.owner.get('loader')?.entries() ?? [])].find(row => row.options.id === 'ths-holdings-shared')
          if (entry) {
            const fiber = entry.fiber
            entry.parent.remove(entry.options.id)
            await fiber?.await()
          }
        }
      }
    })
    await this.synchronize()
  }
}
export async function apply(ctx: Context, config: HostConfig | LiveConfig = {}): Promise<void> {
  if (!ctx.fiber.entry?.options.group) { await applyCard(ctx, config); return }
  ctx.inject(['settings'], child => { child.effect(() => child.settings.configure({ auto: false }, ctx.fiber)) })
  // Container rows are reconciled on every profile edit; their service must stay stable.
  ctx.on('internal/update', () => {})
  new HoldingsRuntime(ctx, config)
}
