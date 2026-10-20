/** Host-owned component state shared by the settings page and overlay. */
import { useCallback, useSyncExternalStore } from 'react'
import type { ComponentState } from '../index.ts'
import { Preferences, StockPnlOverlay, type PreferencesInjected } from './Preferences.tsx'
import { StockPnlCard, type StockPnlInjected } from './StockPnlCard.tsx'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
export class ComponentStore {
  private value: ComponentState = { card: false, skill: false, revision: 0 }
  private readonly listeners = new Set<() => void>()
  snapshot = () => this.value
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
  update(state: ComponentState): void {
    this.value = state
    for (const listener of this.listeners) listener()
  }
}
type Injected = PreferencesInjected & StockPnlInjected & { components: ComponentStore }
function useComponents(store: ComponentStore) {
  return useSyncExternalStore(useCallback(listener => store.subscribe(listener), [store]), store.snapshot)
}
export function ComponentOverlay({ components, ...props }: Injected) {
  const state = useComponents(components)
  return state.card ? <StockPnlOverlay {...props} settingsRevision={state.revision} /> : null
}
export function ComponentPreferences({ components, t, ...props }: Injected & PropsLocale<'settings.ths-holdings'>) {
  const state = useComponents(components)
  if (!state.card && !state.skill) return <p role="status">{t('componentsDisabled')}</p>
  return <>
    {state.card ? <Preferences preferences={props.preferences} t={t} /> : <h2>{t('title')}</h2>}
    <h3>{t('connection')}</h3>
    <StockPnlCard {...props} settingsOnly settingsRevision={state.revision} />
  </>
}
