export const SETTINGS_NS = 'settings.ths-holdings'

export const zh = {
  title: '同花顺持仓',
  description: '调整持仓盈亏卡片的显示与自动刷新。',
  showCard: '显示持仓盈亏卡片',
  showCardHint: '关闭后停止卡片自动刷新，聊天查询和定时报告仍可使用。',
  pollMs: '刷新间隔（毫秒）',
  pollHint: '默认 20000 毫秒（20 秒），最小 1000 毫秒。保存后立即生效。',
  save: '保存',
  saving: '保存中…',
  saved: '已保存',
  loading: '正在读取设置…',
  unavailable: '设置暂不可用，请确认插件已启用并重新打开设置。',
  readOnly: '当前设置为只读。',
  invalid: '请输入 1000～2147483647 之间的整数毫秒数。',
  failed: '保存失败，请重试。',
  conflict: '设置未保存，请检查当前值后重试。',
}
export type SettingsKey = keyof typeof zh
export const en: Record<SettingsKey, string> = {
  title: 'Tonghuashun holdings',
  description: 'Control the portfolio P&L card and its automatic refresh.',
  showCard: 'Show portfolio P&L card',
  showCardHint: 'Turning this off stops card polling. Chat queries and scheduled reports remain available.',
  pollMs: 'Refresh interval (milliseconds)',
  pollHint: 'Default: 20000 ms (20 seconds). Minimum: 1000 ms. Changes apply when saved.',
  save: 'Save',
  saving: 'Saving…',
  saved: 'Saved',
  loading: 'Loading settings…',
  unavailable: 'Settings are unavailable. Check that the plugin is enabled and reopen Settings.',
  readOnly: 'These settings are read-only.',
  invalid: 'Enter a whole number of milliseconds between 1000 and 2147483647.',
  failed: 'Could not save settings. Please retry.',
  conflict: 'Settings were not saved. Check the current values and retry.',
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    'settings.ths-holdings': SettingsKey
  }
}
