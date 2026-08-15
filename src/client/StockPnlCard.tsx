/**
 * The floating P&L card: collapsible, right-edge, click-through unless hovered,
 * and draggable vertically along the right edge. It polls the same-origin
 * `/api/stock-pnl` route and renders today's position P&L, the Shanghai
 * Composite Index, and a mini intraday chart with the A-share red-up/green-down
 * convention. A settings button opens a small form that saves the
 * STOCK_PNL_COOKIE and STOCK_PNL_FUND_KEY through the host credential seam.
 * Live data is component-local.
 */
import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import clsx from 'clsx'
import css from './stock-pnl.module.css'

/** The `/api/stock-pnl` payload subset the card renders. */
interface Snapshot {
  pnl_pct: number
  pnl_yk: number
  sh_pct: number
  chart_data: readonly { t: number; v: number }[]
  updated_at: string
  error: string
  token_expired: boolean
  poll_ms: number
}

/** Business face injected at registration: the two credential-writing verbs. */
export interface StockPnlInjected {
  /** Persist the Cookie value through the host credential seam. */
  onSaveCookie: (value: string) => Promise<void>
  /** Persist the fund key through the host credential seam. */
  onSaveFundKey: (value: string) => Promise<void>
}

/** One portfolio item from `/api/stock-pnl/portfolios`. */
interface PortfolioInfo {
  readonly fund_key: string
  readonly manualname: string
  readonly brokername: string
}

/** Bootstrap poll interval, used until the first response reports the host's `poll_ms`. */
const DEFAULT_POLL_MS = 20_000

/** Signed-percent display, A-share convention (red = profit, green = loss). */
function signed(n: number): string {
  if (n > 0) return `+${n.toFixed(2)}%`
  if (n < 0) return `${n.toFixed(2)}%`
  return '0.00%'
}

/** The row value class for the red-up/green-down convention. */
function colorClass(n: number): string {
  if (n > 0) return 'up'
  if (n < 0) return 'down'
  return ''
}

/** Format the P&L value: percentage only, or both amount and percentage. */
function formatPnl(pct: number, yk: number, showAmount: boolean): string {
  if (showAmount) {
    const amount = yk > 0 ? `¥+${yk.toFixed(2)}` : yk < 0 ? `¥${yk.toFixed(2)}` : '¥0.00'
    const percent = pct > 0 ? `+${pct.toFixed(2)}%` : pct < 0 ? `${pct.toFixed(2)}%` : '0.00%'
    return `${amount} (${percent})`
  }
  if (pct > 0) return `+${pct.toFixed(2)}%`
  if (pct < 0) return `${pct.toFixed(2)}%`
  return '0.00%'
}

/** Render the ISO `updated_at` as local HH:MM:SS (the raw ISO reads as a changing technical value). */
function formatTime(iso: string): string {
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleTimeString([], { hour12: false })
}

/** One mini chart polyline from the normalized percent series. */
function MiniChart({ data, last }: { data: readonly { t: number; v: number }[]; last: number }): ReactNode {
  if (data.length < 2) return null
  const values = data.map(point => point.v)
  const min = Math.min(...values)
  const max = Math.max(...values)
  const range = max - min || 1
  const W = 220
  const H = 48
  const stroke = last >= 0 ? '#ef4444' : '#22c55e'
  const points = data.map((point, index) => {
    const x = (W * index) / (data.length - 1)
    const y = H - ((point.v - min) / range) * H
    return `${x.toFixed(1)},${y.toFixed(1)}`
  }).join(' ')
  const zeroY = H - ((0 - min) / range) * H
  return (
    <svg className={css.chart} width={W} height={H} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
      {zeroY >= 0 && zeroY <= H && (
        <line x1={0} y1={zeroY} x2={W} y2={zeroY} stroke="rgba(255,255,255,0.25)" strokeWidth={1} strokeDasharray="3 3" />
      )}
      <polyline points={points} fill="none" stroke={stroke} strokeWidth={1.5} strokeLinejoin="round" />
    </svg>
  )
}

/** The floating card, exported for the `shell.overlay` registration. */
export function StockPnlCard({ onSaveCookie, onSaveFundKey }: StockPnlInjected): ReactNode {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null)
  const [offline, setOffline] = useState(false)
  const [collapsed, setCollapsed] = useState(false)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [refreshKey, setRefreshKey] = useState(0)
  // Portfolio list and the currently selected fund_key.
  const [portfolios, setPortfolios] = useState<readonly PortfolioInfo[]>([])
  const [portfolioFundKey, setPortfolioFundKey] = useState(() => localStorage.getItem('stock-pnl-fund-key') ?? '')
  const [portfolioRefreshKey, setPortfolioRefreshKey] = useState(0)
  // Show the yuan amount (yk) instead of percentage when toggled.
  const [showAmount, setShowAmount] = useState(() => localStorage.getItem('stock-pnl-show-amount') === 'true')
  // Vertical position of the card's top edge, in viewport pixels; `null` keeps
  // the CSS default (bottom-anchored). Dragging sticks the card to the right edge.
  const [top, setTop] = useState<number | null>(null)
  const cardRef = useRef<HTMLElement | null>(null)
  const dragRef = useRef<{ startY: number; startTop: number; moved: boolean } | null>(null)
  const suppressClick = useRef(false)

  /** Begin a vertical drag from a handle; records the card's current top. */
  const startDrag = (event: React.PointerEvent<HTMLElement>): void => {
    if (event.button !== 0 || cardRef.current === null) return
    dragRef.current = { startY: event.clientY, startTop: cardRef.current.getBoundingClientRect().top, moved: false }
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  /** Move the card along the right edge, clamped to the viewport. */
  const moveDrag = (event: React.PointerEvent<HTMLElement>): void => {
    const drag = dragRef.current
    if (drag === null) return
    const dy = event.clientY - drag.startY
    if (Math.abs(dy) > 4) drag.moved = true
    if (!drag.moved) return
    const height = cardRef.current?.offsetHeight ?? 40
    setTop(Math.min(Math.max(drag.startTop + dy, 0), Math.max(0, window.innerHeight - height)))
  }

  /** End the drag; a real drag suppresses the click the same gesture would fire. */
  const endDrag = (): void => {
    const drag = dragRef.current
    if (drag === null) return
    suppressClick.current = drag.moved
    dragRef.current = null
  }

  /** The inline style that pins the card to a dragged `top`; `undefined` uses the CSS default. */
  const cardStyle = top === null ? undefined : { top: `${top}px`, bottom: 'auto' }

  useEffect(() => {
    let disposed = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const tick = async (): Promise<void> => {
      let interval = DEFAULT_POLL_MS
      try {
        const response = await fetch('/api/stock-pnl')
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        const next = (await response.json()) as Snapshot
        if (disposed) return
        interval = Number.isFinite(next.poll_ms) && next.poll_ms > 0 ? next.poll_ms : DEFAULT_POLL_MS
        setSnapshot(next)
        setOffline(false)
      } catch {
        if (disposed) return
        setOffline(true)
      }
      if (!disposed) timer = setTimeout(() => { void tick() }, interval)
    }
    void tick()
    return () => {
      disposed = true
      if (timer !== undefined) clearTimeout(timer)
    }
  }, [refreshKey])

  // Fetch the portfolio list when the settings panel opens or refresh is clicked.
  useEffect(() => {
    if (!editing) return
    let disposed = false
    void (async () => {
      try {
        const resp = await fetch('/api/stock-pnl/portfolios')
        if (disposed || !resp.ok) return
        const list = (await resp.json()) as readonly PortfolioInfo[]
        if (disposed) return
        setPortfolios(list)
        // Auto-select the first portfolio when none has been stored yet.
        if (list.length > 0 && !localStorage.getItem('stock-pnl-fund-key')) {
          const first = list[0]!
          setPortfolioFundKey(first.fund_key)
          localStorage.setItem('stock-pnl-fund-key', first.fund_key)
          try { await onSaveFundKey(first.fund_key) } catch { /* ignore */ }
        }
      } catch { /* ignore */ }
    })()
    return () => { disposed = true }
  }, [editing, portfolioRefreshKey])

  const pnl = snapshot?.pnl_pct ?? 0
  const yk = snapshot?.pnl_yk ?? 0
  const sh = snapshot?.sh_pct ?? 0
  const pnlSign = showAmount ? yk : pnl

  const save = async (): Promise<void> => {
    setSaving(true)
    setSaveError(null)
    setSaved(false)
    try {
      const cookieValue = draft.replace(/\s+/g, '')
      if (cookieValue.length > 0) await onSaveCookie(cookieValue)
      // Cookie changed — clear stored fund_key so the next settings open
      // auto-selects the first portfolio from the fresh account list.
      localStorage.removeItem('stock-pnl-fund-key')
      setPortfolioFundKey('')
      setPortfolioRefreshKey(k => k + 1)
      setSaved(true)
      setEditing(false)
      setDraft('')
      setRefreshKey(key => key + 1)
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : String(error))
    } finally {
      setSaving(false)
    }
  }

  if (collapsed) {
    return (
      <button
        type="button"
        className={clsx(css.card, css.collapsed, colorClass(pnlSign) === 'up' && css.up, colorClass(pnlSign) === 'down' && css.down)}
        ref={node => { cardRef.current = node }}
        style={cardStyle}
        onClick={() => {
          if (suppressClick.current) { suppressClick.current = false; return }
          setCollapsed(false)
        }}
        onPointerDown={startDrag}
        onPointerMove={moveDrag}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        aria-label="展开今日盈亏"
        title="点击展开"
      >
        <span className={css.pillLabel}>今日盈亏</span>
        <span className={css.pillValue}>{offline ? '--' : formatPnl(pnl, yk, showAmount)}</span>
      </button>
    )
  }

  return (
    <div className={css.card} ref={node => { cardRef.current = node }} style={cardStyle}>
      <div className={css.header}>
        <button
          type="button"
          className={css.headerMain}
          onClick={() => {
            if (suppressClick.current) { suppressClick.current = false; return }
            setCollapsed(true)
          }}
          onPointerDown={startDrag}
          onPointerMove={moveDrag}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          aria-label="收起今日盈亏"
          title="点击收起"
        >
          <span className={css.collapseHint}>▾</span>
          <span>今日盈亏</span>
          <span className={clsx(css.value, colorClass(pnlSign) === 'up' && css.up, colorClass(pnlSign) === 'down' && css.down)}>{offline ? '--' : formatPnl(pnl, yk, showAmount)}</span>
        </button>
        <button
          type="button"
          className={css.settingsBtn}
          onClick={() => { setEditing(value => !value); setSaved(false); setSaveError(null) }}
          aria-label="设置 Cookie"
        >
          ⚙
        </button>
      </div>

      {editing && (
        <div className={css.settings}>
          <label className={css.settingsLabel} htmlFor="stock-pnl-cookie">STOCK_PNL_COOKIE</label>
          <textarea
            id="stock-pnl-cookie"
            className={css.settingsInput}
            value={draft}
            onChange={event => { setDraft(event.target.value) }}
            placeholder="粘贴投资账本登录 Cookie"
            rows={3}
          />
          <div className={css.portfolioHeader}>
            <span className={css.settingsLabel}>选择组合</span>
            <button
              type="button"
              className={css.refreshBtn}
              onClick={() => {
                setPortfolios([])
                setPortfolioRefreshKey(k => k + 1)
              }}
              disabled={portfolios.length === 0}
              aria-label="刷新组合列表"
            >
              ↻
            </button>
          </div>
          <select
            className={css.portfolioSelect}
            value={portfolioFundKey}
            onChange={async event => {
              const key = event.target.value
              if (!key) return
              setPortfolioFundKey(key)
              localStorage.setItem('stock-pnl-fund-key', key)
              try { await onSaveFundKey(key) } catch { /* ignore */ }
            }}
          >
            <option value="">{portfolios.length === 0 ? '加载中...' : '-- 选择组合 --'}</option>
            {portfolios.map(p => (
              <option key={p.fund_key} value={p.fund_key}>
                {p.manualname}（{p.brokername}）
              </option>
            ))}
          </select>
          <label className={css.toggleLabel}>
            <input type="checkbox" checked={showAmount} onChange={event => { const v = event.target.checked; setShowAmount(v); localStorage.setItem('stock-pnl-show-amount', String(v)) }} />
            显示金额（¥）
          </label>
          <div className={css.settingsActions}>
            <button type="button" className={css.saveBtn} onClick={() => { void save() }} disabled={saving || draft.trim().length === 0}>
              保存
            </button>
            <button type="button" className={css.cancelBtn} onClick={() => { setEditing(false) }} disabled={saving}>
              取消
            </button>
          </div>
          {saving && <div className={css.settingsStatus}>保存中...</div>}
          {saveError !== null && <div className={css.error}>{saveError}</div>}
          {saved && <div className={css.settingsStatus}>已保存</div>}
        </div>
      )}

      {offline ? <div className={css.error}>连接中...</div> : <MiniChart data={snapshot?.chart_data ?? []} last={pnl} />}
      <div className={css.row}>
        <span className={css.label}>上证指数</span>
        <span className={clsx(css.value, css.small, colorClass(sh) === 'up' && css.up, colorClass(sh) === 'down' && css.down)}>{offline ? '--' : signed(sh)}</span>
      </div>
      {snapshot !== null && snapshot.token_expired && <div className={css.alert}>Token 已过期，请更新 Cookie</div>}
      {snapshot !== null && snapshot.error !== '' && (
        <div className={css.error}>{snapshot.error}</div>
      )}
      <div className={css.footer}>{snapshot === null ? '等待数据...' : `更新于 ${formatTime(snapshot.updated_at)}`}</div>
    </div>
  )
}
