# Portfolio reports and scheduled tasks

This guide describes the unreleased native tools and bundled Skill. Published version 0.2.2 does not include them.

## Installation and automatic registration

Install and enable a package containing this feature. The plugin registers the bundled `ths-portfolio-report` Skill and three read-only tools automatically. No Skill copying or directory configuration is needed. Resources resolve relative to the installed package, independently of the working directory.

For local development, run `pnpm install`, `pnpm test`, `pnpm typecheck`, `pnpm build`, then `pnpm pack --pack-destination dist`. Install the resulting local package; it is not an npm release.

The installed Desktop 0.2.0-rc.2 host has been verified with an isolated profile and synthetic ledger: card activation, Skill registration, three tools, and a position query pass without a compatibility exemption. Development dependencies target 0.2.1-rc.2. The default bundle combination in this isolated acceptance profile has no schedule service; this does not describe every existing user profile. Scheduled reports require an enabled Schedule service. Adding the official `@deepseek-ai/dsh-experimental-schedule-bundle` to the isolated profile also passed the full timer, cold-session restoration, Skill, query and report persistence flow on Desktop 0.2.0-rc.2. The real 0.2.1-rc.2 Web host passed timer delivery, cold-session restoration, Skill loading, position queries and persisted report verification using a scripted provider and synthetic ledger.

Registrations follow the plugin lifecycle. Disabling or uninstalling unregisters contributions; enabling or restarting restores them. Missing tools or skills services leave the card available and produce a diagnostic. No separate MCP server is required.

## Ordinary chat discovery and invocation

Type `/` in the chat composer to open candidates, or `/ths` to filter for `ths-portfolio-report`. Select it and send `/ths-portfolio-report Show my holdings and generate a brief report.` You can also ask the model explicitly to use this Skill.

Both model and user invocation are enabled. Ordinary chat does not require the Schedule bundle. Isolated real-Desktop acceptance verifies the initial user-turn Skill catalog, loading instructions through the `skill` tool, querying positions, saving the report, and the composer's `skills/list` response. The model and ledger are synthetic fixtures.

A visible catalog entry or loaded body establishes discovery and loading. `REQUEST_BLOCKED` from a portfolio tool means the live data request was refused by the gateway. A working website and a failing fixed-Cookie request still require comparison against the successful browser request; bounded retries do not guarantee recovery from sustained rejection.

## Credentials and portfolio selection

Opening card settings only auto-selects a sole portfolio. Multiple portfolios require a manual choice; opening the panel alone does not save a default.

Sign in and select a portfolio through the card settings. The host credential service owns the Cookie; it never belongs in a Skill, scheduled prompt, or tool arguments.

Selection priority: explicit `portfolio_id`, saved `fundKeyEnv`, configured `fund_key`, then a sole available portfolio. Ambiguous selection returns PORTFOLIO_REQUIRED. An invalid saved or explicit identifier fails rather than switching portfolios.

Ask the model to call `ths_list_portfolios`, then bind the chosen identifier explicitly in scheduled prompts. This prevents a later card selection from changing a task's portfolio.

## Tools and results

| Tool | Arguments | Result |
| --- | --- | --- |
| `ths_list_portfolios` | None | Available portfolios and saved selection |
| `ths_get_positions` | Optional `portfolio_id` | Assets, complete positions, totals and data times |
| `ths_get_pnl` | Optional `portfolio_id` | Portfolio-wide intraday P&L |

Each result has status, code, message, warnings and data. Status ok means acquisition succeeded; only an explicit successful empty positions array means no holdings. Partial means some data is missing or inconsistent; when analysis_available is false, present source values without derived analysis. Error has data=null and does not mean zero assets.

Amounts, quantities and percentages are decimal strings; missing values are null. Every _pct field is already a percentage. weight_in_positions_pct uses invested market value as denominator; weight_in_assets_pct uses total assets. assets.invested_pct is overall exposure.

queried_at is acquisition time; uploaded_at is ledger upload time. quote_date remains null when the source does not supply a confirmed quote date. Query time must not replace it. Intraday point t preserves the source value; sample_at is provided only for a 13-digit millisecond timestamp. Position-level daily totals and portfolio-wide intraday P&L remain separate.

The first version supports ordinary CNY Shanghai/Shenzhen stock and ETF ledgers. Margin debt, short positions, B shares and other markets are unsupported. Preserve reported holding profit rather than recomputing it from rounded display costs. Current snapshots cannot establish trading changes.

## Scheduling

First ask for a manual report using the Skill. Then ask DSH to run a report for the explicitly selected portfolio every Monday through Friday at 15:10 in Asia/Shanghai. Include complete holdings, asset totals, daily contributors and data timestamps; failures must not be replaced by old data.

Replace the portfolio identifier with the value returned by the tool. Weekdays do not automatically exclude exchange holidays. Review the saved rule and next execution time in DSH's automation page.

The host must keep running. A delivery receipt proves a message reached the original conversation, not that the model completed a query or report. Check the tool result and final response separately. Restoration behavior varies by host version; exactly-once execution is not guaranteed.

Scheduled runs do not open login windows, change credentials or portfolio selection, or modify schedules. The Skill performs one query/report workflow.

## Sources, deadlines and failures

stock_position is authoritative for holdings. sort_list only enriches names by market and code; additional watchlist securities are excluded. pass_quotes was validated as an input-driven quote endpoint, but this version does not refresh prices separately because mixing times would invalidate snapshot amounts and profit.

Credentials are resolved for each operation. There is no persistent result cache. requestTimeoutMs defaults to 15000 (100–120000), covering credentials, selection and enrichment. HTTP 403 is recovered silently in the transport, after approximately 300ms and 900ms plus small jitter, with at most three attempts per request. Model reads also retry network/429/5xx failures once, within that same three-attempt cap and original deadline. HTTP 401, redirects, business rejection and cancellation are not retried; the Skill adds no retries.

Card refreshes share one deadline starting before credential reads. Discovery, P&L and index requests do not restart that timer. A stalled credential read also ends the refresh and releases the immediate update button.

The card receives only the final refresh result. Empty series, malformed responses and invalid numbers are not accepted as successful refreshes. If recovery is exhausted, credentials are retained and previous successful card values keep their original update time; without previous data the card shows placeholders. Selecting another portfolio or saving a new Cookie in the card clears that local snapshot. Model tool failures still return data=null and never substitute previous results.

The network layer prepares temporary request state before each request and retry without rewriting stored login credentials. Unrecognized formats retain the original request. This adds no background requests or retry attempts and preserves the original deadline; it does not replace signing in again when needed.

NOT_CONFIGURED/AUTH_REQUIRED require checking sign-in through settings; HTTP 401 requires reauthentication. REQUEST_BLOCKED means transport recovery was exhausted; the current report fails and the card retains previous values/time. Stored credentials are not cleared. PORTFOLIO_REQUIRED needs selection; PORTFOLIO_NOT_FOUND needs correcting the task or saved selection. TIMEOUT, NETWORK_ERROR and SERVICE_UNAVAILABLE produce a failed report. INVALID_RESPONSE and API_REJECTED preserve failure without echoing upstream content. NAME_LOOKUP_UNAVAILABLE permits original names. MISSING_* and *_MISMATCH disable derived analysis. UPLOAD_TIME_UNAVAILABLE never substitutes query time.

The ledger depends on user uploads. Successful reads do not establish real-time synchronization with a broker account.

## Reproducible validation

PR checks run typechecking, tests and packed-install acceptance on Node 22 and 24 without real account access or credentials.

Run `pnpm test`, `pnpm typecheck` and `pnpm build` for behavior, types and plugin artifacts. `pnpm test:package` builds and packs the plugin, installs the actual tgz in a fresh directory, changes cwd, and verifies automatic registration, queries, unloading and two host boots.

`pnpm test:desktop-compat` uses the installed Desktop host with an isolated profile and records both manual features and Schedule capability. `node tests/desktop-compat.smoke.cjs --require-schedule` requires full scheduling support; the default bundle combination in the isolated acceptance profile currently fails this stricter check because schedule is absent.

Run `node tests/desktop-compat.smoke.cjs --with-schedule --require-schedule` to add the official Schedule bundle to the isolated profile and require the complete Desktop scheduled-report flow.

Set DSH_SOURCE_ROOT to a built DSH checkout and run `pnpm test:schedule`. This exercises the real Web profile, scheduler and agent loop, including restoration of a cold session, Skill loading, a position query and persisted output. The provider and ledger are scripted/synthetic; this is not a live-model quality evaluation.

The verified DSH source baseline is `687f282e8625c6b8d11ff58211a90524be2e4317` (0.2.1-rc.2). Host artifacts and checks passed, while the default compressed Web build encountered a Windows esbuild temporary-file deletion denial. Local integration pages built successfully with `pnpm --filter @deepseek-ai/dsh-web-frontend exec vite build --minify false --target esnext`. This local configuration does not establish that the default release build passed.

Evidence is stored in ignored dist directories. Live API acquisition, synthetic regression, real-host integration and model quality remain separate evidence categories.
