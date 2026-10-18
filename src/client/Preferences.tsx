import { useCallback, useEffect, useId, useState, useSyncExternalStore } from 'react'
import type { ConfigForm } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import { MAX_POLL_MS, type CardPreferences } from '../preferences.ts'
import { StockPnlCard, type StockPnlInjected } from './StockPnlCard.tsx'
import type {} from './locales.ts'
import css from './preferences.module.css'

export interface PreferencesInjected {
  preferences: ConfigForm<CardPreferences>
}

function usePreferences(preferences: ConfigForm<CardPreferences>) {
  return useSyncExternalStore(
    useCallback((listener: () => void) => preferences.subscribe(listener), [preferences]),
    useCallback(() => preferences.getSnapshot(), [preferences]),
  )
}

/** Unmounting a hidden card also disposes its polling effect. */
export function StockPnlOverlay({ preferences, ...props }: PreferencesInjected & StockPnlInjected) {
  const state = usePreferences(preferences)
  // Wait for the persisted visibility before starting any quote requests.
  if (state.status !== 'ready' || !state.value || !state.value.showCard) return null
  return <StockPnlCard {...props} pollMs={state.value.pollMs} />
}

export function Preferences({ preferences, t }: PreferencesInjected & PropsLocale<'settings.ths-holdings'>) {
  const state = usePreferences(preferences)
  const [pollMs, setPollMs] = useState('')
  const [showCard, setShowCard] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<'saved' | 'failed' | 'conflict' | null>(null)
  const fieldId = useId()
  useEffect(() => {
    if (!state.value) return
    setPollMs(String(state.value.pollMs))
    setShowCard(state.value.showCard)
  }, [state.value?.pollMs, state.value?.showCard])
  const parsed = Number(pollMs)
  const valid = pollMs.trim() !== '' && Number.isInteger(parsed) && parsed >= 1000 && parsed <= MAX_POLL_MS
  const disabled = saving || !state.writable
  const save = async () => {
    if (!valid || disabled || state.status !== 'ready') return
    setSaving(true)
    setMessage(null)
    try {
      const saved = await preferences.mutate([
        { op: 'set', path: ['pollMs'], value: parsed },
        { op: 'set', path: ['showCard'], value: showCard },
      ], state.revision)
      setMessage(saved ? 'saved' : 'conflict')
    } catch { setMessage('failed') }
    finally { setSaving(false) }
  }
  if (state.status !== 'ready' || !state.value) {
    return <p role="status">{t(state.status === 'loading' ? 'loading' : 'unavailable')}</p>
  }
  return <section className={css.section}>
    <h2 className={css.title}>{t('title')}</h2>
    <p className={css.hint}>{t('description')}</p>
    <label className={css.toggle}>
      <span>{t('showCard')}</span>
      <input type="checkbox" role="switch" checked={showCard} disabled={disabled}
        onChange={event => { setShowCard(event.target.checked); setMessage(null) }} />
    </label>
    <p className={css.hint}>{t('showCardHint')}</p>
    <label htmlFor={fieldId}>{t('pollMs')}</label>
    <input id={fieldId} className={css.input} type="number" min={1000} max={MAX_POLL_MS} step={1000}
      value={pollMs} disabled={disabled} aria-invalid={!valid} aria-describedby={`${fieldId}-hint`}
      onChange={event => { setPollMs(event.target.value); setMessage(null) }} />
    <p id={`${fieldId}-hint`} className={css.hint}>{t('pollHint')}</p>
    {!valid && <p role="alert">{t('invalid')}</p>}
    {!state.writable && <p role="status">{t('readOnly')}</p>}
    <button type="button" className={css.save} disabled={disabled || !valid} onClick={() => { void save() }}>
      {t(saving ? 'saving' : 'save')}
    </button>
    {message && <p role={message === 'saved' ? 'status' : 'alert'}>{t(message)}</p>}
  </section>
}
