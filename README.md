<h1 align="center">dsh-ths-holdings</h1>

<p align="center">
  <a href="https://awesome-dsh-plugin.com"><img src="https://awesome-dsh-plugin.com/badge.svg" alt="Awesome DSH Plugin"></a>
  <a href="https://www.npmjs.com/package/dsh-ths-holdings"><img src="https://img.shields.io/npm/v/dsh-ths-holdings?style=flat-square" alt="npm version"></a>
  <a href="https://github.com/PM25000/dsh-ths-holdings"><img src="https://img.shields.io/github/stars/PM25000/dsh-ths-holdings?style=flat-square" alt="GitHub stars"></a>
  <img src="https://img.shields.io/badge/license-MIT-ff1493?style=flat-square" alt="MIT">
  <a href="https://www.npmjs.com/package/dsh-ths-holdings"><img src="https://img.shields.io/npm/dt/dsh-ths-holdings?style=flat-square" alt="npm version"></a>
</p>

English | [中文](README.zh.md)

A floating **position P&L card** for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (DSH) Desktop and Web. It automatically syncs your **real portfolio data** from the [Tonghuashun investment-ledger](https://tzzb.10jqka.com.cn) (同花顺投资账本) — no manual stock picking. Displays **今日盈亏** (today's P&L), **上证指数** (Shanghai Composite Index), and an intraday mini chart, all in the A-share red-up/green-down convention.

Unlike watchlist tools, this plugin reads your **actual positions** and shows your **real profit & loss** — both as a percentage and as a yuan amount — updating every 20 seconds.

## Screenshots

![dsh-ths-holdings card](assets/screenshot.png)

## Version compatibility

Plugin **0.3.0** targets the DSH **0.2 series** and has been tested with Desktop **0.2.0-rc.2**, without a compatibility exemption. For DSH 0.1, keep plugin **0.2.0**; this migration does not support the older host.

**0.3.0** adds holdings queries in ordinary chat, scheduled portfolio reports, and **立即更新数据** (Refresh now), along with network stability fixes.

## Installation

### Desktop

1. Open DSH Desktop and select **Plugins** in the sidebar.
2. Select **Add plugin** and enter `dsh-ths-holdings` in the package field.
3. Confirm that you trust the plugin as prompted, then select **Install**.
4. When installation finishes, select **Enable now**. The floating card appears at the bottom-right corner. If a restart is requested, fully quit Desktop and reopen it.

Desktop does not currently update plugins automatically. To upgrade an installed version, uninstall it from the Plugins page, then install the new version. See the [official DSH installation guide](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/client/ui-plugin-manager/README.md#installing-a-bundle).

### Web

Run in a terminal:

```sh
dsh plugin --profile web add dsh-ths-holdings
```

After installation, **restart `dsh web`** and refresh the DSH page. The floating card appears at the bottom-right corner.

Desktop and Web manage their plugins separately; use the installation method for the application you run.

## Usage

**Recommended — auto-acquire:**

1. Open DSH Desktop or Web and click **⚙** on the card.
2. Click **🖥 自动获取 Cookie（推荐）** — a system browser window opens (Edge / Chrome — the first installed one wins).
3. Sign in to the Tonghuashun investment ledger in that window (QR code / account).
4. When the sign-in succeeds the window closes itself, the Cookie is saved automatically, and the card refreshes with your portfolio.
5. The plugin auto-discovers your portfolio — if you have several, pick one from the dropdown. Done.

Click **立即更新数据** in the expanded ⚙ settings to fetch P&L and the index immediately using the saved sign-in and selected portfolio. The button shows a loading state during the request; failures retain previous successful values and their original update time.

Open **Settings → Tonghuashun holdings** in DSH to change the refresh interval (default: 20000 ms, or 20 seconds) and card visibility. Click **Save** to apply changes immediately and retain them after restart. Hiding the card stops its automatic refresh; chat queries and scheduled reports remain available.

**Manual (backup):**

1. Open [https://tzzb.10jqka.com.cn](https://tzzb.10jqka.com.cn) and log in.
2. **Click the browser's top-right menu → More tools → Developer tools** (`…` in Edge, `⋮` in Chrome). F12 may have no effect on this page; open the tools through the browser menu.
3. **Keep developer tools open**, select **Network**, then refresh the ledger page to record requests.
4. Select a page or ledger API request to **`tzzb.10jqka.com.cn`**. Under **Headers → Request Headers**, copy the complete **Cookie** value. Copy only the `name=value; name2=value2` portion, without the `Cookie:` prefix; do not copy a response's `Set-Cookie` header.
5. Return to DSH Desktop or Web — click **⚙**, paste the cookie into **STOCK_PNL_COOKIE** → **save**.
6. The card validates the saved cookie immediately — it shows **✓ valid** or **✗ invalid** (with the reason/hint).

If the page reports that developer tools are unsupported, first check whether Network has already recorded a ledger request with a Cookie header. If no usable Cookie is available, use auto-acquire above. Keep developer tools open while inspecting cookies manually.

The session cookie expires eventually — when it does, the card shows a **Token 已过期** banner; re-open ⚙ and click **auto-acquire** (or repeat manual steps 1–5) with a fresh cookie.

> 💡 After completing a new trade, re-upload your data from the investment-ledger **app** to the web version so your holdings stay consistent between the two.
>
> ![Data upload tutorial](assets/update.png)

## Query holdings in chat

Installing and enabling the plugin automatically makes the bundled `ths-portfolio-report` Skill available in ordinary chat and scheduled tasks. No separate Skill installation or MCP server is needed. Sign-in and portfolio selection use the card settings; you do not need to find or enter a portfolio ID.

After signing in, simply say in DSH chat:

> Show my holdings in Tonghuashun Investment Ledger.

The assistant uses the selected portfolio. If several are available and none is selected, choose by name when asked. You can also say “Show holdings from my ‘Long-term investments’ portfolio in Tonghuashun Investment Ledger.”

Reports default to an asset overview, the full holdings table and the largest positions. They include security names and codes, quantities, cost and current prices, market values, portfolio weights, holding P&L and daily P&L. Query time and ledger upload time are shown separately; missing data is identified rather than treated as zero.

## Schedule reports

For example, say:

> Every weekday at 4:30 p.m. Beijing time, check my holdings in Tonghuashun Investment Ledger and generate a holdings and P&L report. Keep this task linked to the currently selected portfolio.

You can also include relevant news:

> Every weekday at 9:00 a.m., check my holdings in Tonghuashun Investment Ledger and tell me about important news related to those holdings.

Have the assistant confirm the portfolio name and next run time. Scheduled reports require a running DSH host with Schedule enabled. Weekday rules do not automatically exclude exchange holidays.

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

## FAQ / Troubleshooting

| Symptom | Cause & fix |
|---|---|
| Card shows `请配置 Cookie` | `STOCK_PNL_COOKIE` is empty — click **auto-acquire** in the ⚙ panel, or paste manually. |
| Card shows `Token 已过期` | Re-acquire the cookie or copy the Cookie request header using the manual steps above. |
| F12 has no effect | Click the browser's top-right menu → More tools → Developer tools, then follow the manual steps. |
| Login page says developer tools are unsupported | Auto-acquire does not require developer tools. For manual acquisition, check already recorded ledger requests in Network; if no usable Cookie is available, use auto-acquire. |
| No portfolio in the dropdown | The account list needs a valid Cookie first; save the Cookie, then click ↻ to refresh. |
| Multiple portfolios | Select the one you want from the dropdown — the choice is saved as `STOCK_PNL_FUND_KEY`. |
| Cookie pasted with line breaks | The plugin strips whitespace on save, so wrapped lines are fine. |
| “稍后重试” or “数据暂时无法获取” | Wait and retry. The card may retain previous successful values; check the displayed update time. |
| The assistant cannot query holdings | Check that the plugin is enabled and sign-in is complete. Fully restart DSH, then try again. |
| The report fails while the card still has values | The card may be showing an earlier snapshot. Reports treat the current query as failed and do not reuse old results. |

## Known Limitations

- **Auto-acquire uses a system browser** — no Playwright installation is needed. Edge or Chrome must be installed and the host must have a visible desktop session; otherwise use manual paste.
- Reports currently support ordinary CNY portfolios holding Shanghai/Shenzhen stocks and ETFs. Margin accounts, short positions, B shares and other markets are outside the supported scope.
- Enter login information only in plugin settings, not in chat or scheduled prompts.

## License

[MIT](LICENSE)
