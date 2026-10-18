/** Settings shared by the Host Config and its client form. */
export const SETTINGS_ENTRY_ID = 'ths-holdings'
export const DEFAULT_POLL_MS = 20_000
export const MAX_POLL_MS = 2_147_483_647

export interface CardPreferences {
  pollMs: number
  showCard: boolean
}
