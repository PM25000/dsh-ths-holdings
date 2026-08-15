# dsh-ths-holdings

English | [中文](README.zh.md)

A floating position P&L card for the [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) web GUI. It automatically syncs your **real portfolio data** from the [Tonghuashun investment-ledger](https://tzzb.10jqka.com.cn) (同花顺投资账本) — no manual stock picking needed. Displays **今日盈亏** (today's P&L), **上证指数** (Shanghai Composite Index), and an intraday mini chart.

Unlike simple watchlist tools, this plugin reads your actual stock positions and shows your real profit & loss — both as a percentage and as a yuan amount.

The login Cookie never leaves the host — the node half reads it per request through the credential seam and the browser half renders only the normalized snapshot.

## Installation

```sh
dsh plugin --profile web add dsh-ths-holdings
```

Or install from npm and add to your `cordis.yml` manually:

```yaml
plugins:
  - id: stock-pnl
    name: dsh-stock-pnl
```

Then restart `dsh web`.

## Usage

1. Open [https://tzzb.10jqka.com.cn](https://tzzb.10jqka.com.cn) and log in.
2. Press **F12 → Console** and run:
   ```javascript
   copy(document.cookie)
   ```
3. The cookie is now in your clipboard.
4. Open the DSH web GUI — a floating card appears at the bottom-right corner.
5. Click **⚙** on the card → paste the cookie → **save**.
6. The plugin auto-discovers your portfolio from the account list and begins showing P&L data.

## Config

| Key | Default | Meaning |
|---|---|---|
| `cookieEnv` | `STOCK_PNL_COOKIE` | Environment-variable name that holds the ledger Cookie. |
| `fundKeyEnv` | `STOCK_PNL_FUND_KEY` | Credential reference holding the ledger fund key (saved from the card's ⚙ form). |
| `user_id` | the Cookie's `userid` | The ledger user id, included in every form payload; an empty value falls back to the Cookie's own `userid`. |
| `fund_key` | auto-discovered | The ledger fund key selecting the managed portfolio; overridden by the `fundKeyEnv` credential when set, auto-discovered from the account list when empty. |
| `pnlUrl` | Tonghuashun `time_share` endpoint | P&L endpoint override (tests point at a scripted server). |
| `indexUrl` | Tonghuashun `getQuotes` endpoint | Index endpoint override (tests point at a scripted server). |
| `pollMs` | `20000` | Poll interval (ms) the card uses; reported to the browser in each response's `poll_ms`. |

## Features

- **📊 Real-time P&L** — polls every 20 s (configurable) and shows today's position P&L as both percentage and amount
- **📈 Intraday chart** — mini polyline with red-up/green-down convention
- **🇨🇳 Shanghai Composite Index** — displayed alongside the portfolio P&L
- **↕ Draggable** — drag the title bar vertically along the right edge
- **⚙ In-place settings** — paste Cookie, select portfolio, and toggle amount display — all from the card itself
- **🔄 Auto-discovery** — `fund_key` is auto-discovered from the portfolio list; no manual configuration needed
- **🔒 Credential-safe** — the Cookie never leaves the host process

## Model Experience

None — the card is a browser-side overlay over a host data route and registers nothing model-facing.

#### KV Cache effect

None — the plugin contributes no prompt, schema, or result.

## Known Limitations

- **The portfolio list endpoint (`account_list`) requires the Cookie to be saved first** — the portfolio selector appears after you paste a valid Cookie.
- **The ledger API is an undocumented, login-gated endpoint** — its response format can change and the Cookie expires; the plugin surfaces both as errors rather than retrying or caching.
- **No server-side polling** — the route fetches on each request and the card polls at the configured `pollMs` interval; there is no shared cache or push channel.