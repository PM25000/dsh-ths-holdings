<h1 align="center">dsh-ths-holdings</h1>

<p align="center">
  <a href="https://awesome-dsh-plugin.com"><img src="https://awesome-dsh-plugin.com/badge.svg" alt="Awesome DSH Plugin"></a>
  <a href="https://www.npmjs.com/package/dsh-ths-holdings"><img src="https://img.shields.io/npm/v/dsh-ths-holdings?style=flat-square" alt="npm version"></a>
  <a href="https://github.com/PM25000/dsh-ths-holdings"><img src="https://img.shields.io/github/stars/PM25000/dsh-ths-holdings?style=flat-square" alt="GitHub stars"></a>
  <img src="https://img.shields.io/badge/license-MIT-ff1493?style=flat-square" alt="MIT">
  <a href="https://www.npmjs.com/package/dsh-ths-holdings"><img src="https://img.shields.io/npm/dt/dsh-ths-holdings?style=flat-square" alt="npm version"></a>
</p>

English | [中文](README.zh.md)

A floating **position P&L card** for the [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (DSH) web GUI. It automatically syncs your **real portfolio data** from the [Tonghuashun investment-ledger](https://tzzb.10jqka.com.cn) (同花顺投资账本) — no manual stock picking. Displays **今日盈亏** (today's P&L), **上证指数** (Shanghai Composite Index), and an intraday mini chart, all in the A-share red-up/green-down convention.

Unlike watchlist tools, this plugin reads your **actual positions** and shows your **real profit & loss** — both as a percentage and as a yuan amount — updating every 20 seconds.

## Screenshots

![dsh-ths-holdings card](assets/screenshot.png)

## Installation

```sh
dsh plugin --profile web add dsh-ths-holdings
```

Installation is `pnpm add` inside your web profile: the package's `dsh.bundle.patch` is applied to the profile layer automatically. Then **restart `dsh web`** — a floating card appears at the bottom-right corner.

To install manually (without `dsh plugin`), edit `$DSH_HOME/profiles/web/package.json`:

```jsonc
{
  "dependencies": {
    "dsh-ths-holdings": "^0.1.0"
  },
  "dsh": {
    "profile": {
      "bundles": [
        // ...existing bundles,
        "dsh-ths-holdings"
      ]
    }
  }
}
```

then `cd $DSH_HOME/profiles/web && pnpm install` and restart `dsh web`. The plugin row itself comes from the package's `cordis.patch.yml` — you don't write it by hand.

## Usage

**Recommended — auto-acquire:**

1. Open the DSH web GUI — click **⚙** on the card.
2. Click **🖥 自动获取 Cookie（推荐）** — the system Edge browser opens in a visible window.
3. Sign in to the Tonghuashun investment ledger in that window (QR code / account).
4. When the sign-in succeeds the window closes itself, the Cookie is saved automatically, and the card refreshes with your portfolio.
5. The plugin auto-discovers your portfolio — if you have several, pick one from the dropdown. Done.

> Requires browser automation: install once with `npm i -g playwright-core` (pure JS, no browser download — the system Edge is reused). If it is missing, the card shows the install command and auto-acquire degrades to manual paste.
>
> The auto-acquired Edge window ships anti-automation camouflage (hides `navigator.webdriver`, disables the AutomationControlled Blink feature) to pass the Tonghuashun WAF. If a specific network/time still shows **Nginx forbidden**, press `F5` in the popped window or open [https://tzzb.10jqka.com.cn](https://tzzb.10jqka.com.cn) manually, then click **「我已登录，继续 →」** on the card; only `10jqka`-domain cookies are kept, never stored as raw plaintext.

**Manual (no install):**

1. Open [https://tzzb.10jqka.com.cn](https://tzzb.10jqka.com.cn) and log in.
2. Press **F12 → Console** and run:
   ```javascript
   copy(document.cookie)
   ```
3. The cookie is now in your clipboard.
4. Open the DSH web GUI — click **⚙** on the card, paste the cookie into **STOCK_PNL_COOKIE** → **save**.
5. The card validates the saved cookie immediately — it shows **✓ valid** or **✗ invalid** (with the reason/hint).

The session cookie expires eventually — when it does, the card shows a **Token 已过期** banner; re-open ⚙ and click **auto-acquire** (or repeat manual steps 1–4) with a fresh cookie (the `v` anti-bot token is handled automatically).

> 💡 After completing a new trade, re-upload your data from the investment-ledger **app** to the web version so your holdings stay consistent between the two.
>
> ![Data upload tutorial](assets/update.png)

## Features

- **📊 Real-time position P&L** — polls every 20 s (configurable) from your actual portfolio
- **¥ / % toggle** — show today's P&L as a yuan amount, a percentage, or both
- **📈 Intraday chart** — mini polyline with a zero axis, red-up/green-down
- **🇨🇳 Shanghai Composite Index** — displayed alongside your P&L
- **🔄 Auto-discovery** — `fund_key` is discovered from the portfolio list; multi-account selection via dropdown
- **🖥 Auto-acquire Cookie** — one click pops the Edge sign-in window; the cookie is saved automatically, no F12 needed
- **✓ Validate on save** — the stored cookie is checked against the ledger right after paste or auto-acquire
- **↕ Draggable** — drag the title bar vertically along the right edge (position persists in localStorage)
- **⚙ In-place settings** — paste Cookie and select portfolio from the card itself
- **🔒 Credential-safe** — the Cookie never leaves the host process

## How it works

```text
┌─────────────── Web browser ───────────────┐
│  lib/client.js (browser module)           │
│  · shell.overlay slot → floating card      │
│  · React + CSS Modules                     │
│  · config in localStorage                  │
│          │ fetch (same-origin)             │
└──────────┼─────────────────────────────────┘
           ▼
┌─────────────── DSH Host (lib/index.js) ───┐
│  cordis plugin: webServer routes          │
│  · GET /api/stock-pnl          snapshot    │
│  · GET /api/stock-pnl/portfolios  accounts │
│  · GET /api/stock-pnl/verify     cookie ok?│
│  · POST /api/stock-pnl/acquire*   sign-in │
│  resolves Cookie via ctx.credentials      │
│  auto-discovers user_id + fund_key        │
│  POSTs Tonghuashun ledger APIs            │
└───────────────────────────────────────────┘
```

The node half reads the login Cookie per request through the credential-reference seam (`ctx.credentials`) — it never reaches the browser. Credential-bearing requests never follow a redirect. The `v` anti-bot token is minted per request from the User-Agent; the stored Cookie only needs its session fields.

Auto-acquire runs an in-host state machine (`acquire.ts`): click the button → an anti-automation Edge window opens the ledger → once the sign-in is detected (`userid` cookie), the host collects that domain's cookies, commits them through the credential seam, and closes the window. Timeout, an early user window-close, or a WAF interception all surface as actionable notices on the card.

## Config

| Key | Default | Meaning |
|---|---|---|
| `cookieEnv` | `STOCK_PNL_COOKIE` | Credential reference holding the ledger Cookie. |
| `fundKeyEnv` | `STOCK_PNL_FUND_KEY` | Credential reference holding the ledger fund key (saved from the card's ⚙ form). |
| `user_id` | the Cookie's `userid` | The ledger user id, included in every form payload; an empty value falls back to the Cookie's own `userid`. |
| `fund_key` | auto-discovered | The ledger fund key selecting the managed portfolio; overridden by the `fundKeyEnv` credential when set, auto-discovered from the account list when empty. |
| `pnlUrl` | Tonghuashun `time_share` endpoint | P&L endpoint override (tests point at a scripted server). |
| `indexUrl` | Tonghuashun `getQuotes` endpoint | Index endpoint override (tests point at a scripted server). |
| `pollMs` | `20000` | Poll interval (ms) the card uses; reported to the browser in each response's `poll_ms`. |

## Directory structure

```
dsh-ths-holdings/
├── src/
│   ├── index.ts            # node half: webServer routes + credential resolution
│   ├── fetch.ts            # Tonghuashun ledger API calls + auto-discovery + cookie verify
│   ├── acquire.ts          # auto-acquire cookie (playwright-core drives Edge)
│   └── client/
│       ├── index.ts        # browser half: shell.overlay registration
│       └── StockPnlCard.tsx
├── lib/                    # built artifacts (index.js + client.js)
├── cordis.patch.yml        # dsh.bundle patch layer
├── package.json            # dsh.bundle + dsh.client manifests
├── tests/                  # ledger / verify / acquire unit tests
└── README.md
```

## FAQ / Troubleshooting

| Symptom | Cause & fix |
|---|---|
| Card shows `请配置 Cookie` | `STOCK_PNL_COOKIE` is empty — click **auto-acquire** in the ⚙ panel, or paste manually. |
| Card shows `Token 已过期` | The session Cookie expired — click **auto-acquire** in the ⚙ panel to re-sign-in, or re-run `copy(document.cookie)` and paste. |
| Auto-acquire reports missing playwright-core | Browser automation is not installed — run `npm i -g playwright-core`, restart `dsh web`, retry; manual paste works without it. |
| Popped window shows `Nginx forbidden` | The Tonghuashun WAF intermittently refuses automation — F5 in the window or open the ledger URL manually, then click **「我已登录，继续 →」**. |
| No portfolio in the dropdown | The account list needs a valid Cookie first; save the Cookie, then click ↻ to refresh. |
| Multiple portfolios | Select the one you want from the dropdown — the choice is saved as `STOCK_PNL_FUND_KEY`. |
| Cookie pasted with line breaks | The plugin strips whitespace on save, so wrapped lines are fine. |

## Model Experience

None — the card is a browser-side overlay over a host data route and registers nothing model-facing.

#### KV Cache effect

None — the plugin contributes no prompt, schema, or result.

## Known Limitations

- **The ledger API is an undocumented, login-gated endpoint** — its response format can change and the Cookie expires; the plugin surfaces both as errors rather than retrying or caching.
- **The portfolio list endpoint (`account_list`) requires the Cookie to be saved first** — the portfolio selector appears after you paste a valid Cookie.
- **Auto-acquire needs playwright-core and the system Edge** — without them auto-acquire is unavailable (manual paste still works); the card says so explicitly.
- **No server-side polling** — the route fetches on each request and the card polls at the configured `pollMs` interval; there is no shared cache or push channel.

## License

[MIT](LICENSE)
