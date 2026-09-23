<h1 align="center">dsh-ths-holdings</h1>

<p align="center">
  <a href="https://awesome-dsh-plugin.com"><img src="https://awesome-dsh-plugin.com/badge.svg" alt="Awesome DSH Plugin"></a>
  <a href="https://www.npmjs.com/package/dsh-ths-holdings"><img src="https://img.shields.io/npm/v/dsh-ths-holdings?style=flat-square" alt="npm version"></a>
  <a href="https://github.com/PM25000/dsh-ths-holdings"><img src="https://img.shields.io/github/stars/PM25000/dsh-ths-holdings?style=flat-square" alt="GitHub stars"></a>
  <img src="https://img.shields.io/badge/license-MIT-ff1493?style=flat-square" alt="MIT">
</p>

[English](README.md) | 中文

[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（DSH）网页 GUI 上的**持仓盈亏悬浮卡片**。自动从[同花顺投资账本](https://tzzb.10jqka.com.cn)同步你的**真实持仓数据**——无需手动添加股票。实时显示**今日盈亏**、**上证指数**和当日分时走势图，遵循 A 股红涨绿跌惯例。

与自选股盯盘工具不同，这个插件读取的是你的**真实持仓**，显示**真实盈亏**——百分比和金额都支持——每 20 秒自动刷新。

## 截图

![dsh-ths-holdings 卡片](assets/screenshot.png)

## 安装

```sh
dsh plugin --profile web add dsh-ths-holdings
```

安装实际上是在 web profile 里执行 `pnpm add`：包的 `dsh.bundle.patch` 会自动并入 profile 层。然后**重启 `dsh web`**，右下角出现悬浮卡片。

不用 `dsh plugin` 手动安装：编辑 `$DSH_HOME/profiles/web/package.json`：

```jsonc
{
  "dependencies": {
    "dsh-ths-holdings": "^0.1.0"
  },
  "dsh": {
    "profile": {
      "bundles": [
        // ...原有 bundles，
        "dsh-ths-holdings"
      ]
    }
  }
}
```

然后 `cd $DSH_HOME/profiles/web && pnpm install` 并重启 `dsh web`。插件行由包的 `cordis.patch.yml` 提供，不需要手写。

## 使用

**推荐方式（自动获取）**：

1. 打开 DSH 网页 GUI，点击卡片上的 **⚙**。
2. 点击 **🖥 自动获取 Cookie（推荐）**——会弹出系统浏览器窗口（Edge / Chrome，自动选择已安装者）。
3. 在弹出的窗口里完成同花顺投资账本登录（扫码 / 账号密码）。
4. 登录成功后窗口自动关闭，Cookie 自动保存，卡片立即刷新并显示你的持仓。
5. 插件自动发现你的组合——如有多个，从下拉框选一个即可。

> 自动获取使用独立的临时浏览器配置，只通过浏览器层接口读取 Cookie，不连接网页调试器、不注入脚本、不模拟页面尺寸。保存时仅保留 `10jqka.com.cn` 及其子域的 Cookie，浏览器关闭后删除临时配置。登录过程中无需打开开发者工具。

**手动方式（如偶尔需要）**：

1. 打开 [https://tzzb.10jqka.com.cn](https://tzzb.10jqka.com.cn) 并登录。
2. **用鼠标点击浏览器右上角菜单 → 更多工具 → 开发者工具**（Edge 为 `…`，Chrome 为 `⋮`）。本页按 F12 可能无反应，请从浏览器菜单打开。
3. **保持开发者工具打开**，切换到 **网络 / Network**，然后刷新投资账本页面，让工具记录请求。
4. 在请求列表中选择发往 **`tzzb.10jqka.com.cn`** 的页面或账本接口请求，展开 **标头 / Headers → 请求标头 / Request Headers**，找到 **Cookie**，复制它的完整值。只复制 `name=value; name2=value2` 这部分，不要带 `Cookie:` 前缀，也不要复制响应中的 `Set-Cookie`。
5. 回到 DSH 网页 GUI，点击卡片上的 **⚙**，把 Cookie 粘贴进 **STOCK_PNL_COOKIE** → **保存**。
6. 保存后卡片会当场校验 Cookie——显示 **✓ 有效** 或 **✗ 无效**（无效会给出原因与提示）。

如果网页出现「当前页面不支持开发者工具」，可先查看 Network 中已记录的本站请求是否带有 Cookie；没有可复制的 Cookie 时，改用上面的自动获取。手动查看 Cookie 时需要保持开发者工具打开。

会话 Cookie 会过期——过期时卡片显示 **Token 已过期** 横幅，重开 ⚙ 点 **自动获取**（或重复手动步骤 1–5）即可。

> 💡 完成一笔新交易后，请在投资账本 **APP** 上重新上传数据到网页版，避免两端持仓不一致。
>
> ![上传数据教程](assets/update.png)

## 特性

- **📊 实时持仓盈亏** — 每 20 秒（可配置）轮询你的真实组合
- **¥ / % 切换** — 今日盈亏可按金额、百分比或两者同时显示
- **📈 当日走势图** — 迷你折线 + 零轴虚线，红涨绿跌
- **🇨🇳 上证指数** — 与你的盈亏并列显示
- **🔄 自动发现** — `fund_key` 从组合列表自动获取；多账户可通过下拉框选择
- **🖥 自动获取 Cookie** — 一键弹出 Edge 登录窗口，登录即自动保存，无需 F12
- **✓ 保存即校验** — 粘贴或自动获取后当场验证 Cookie 是否被账本接受
- **↕ 可拖动** — 沿右侧边缘上下拖动标题栏（位置存 localStorage）
- **⚙ 就地设置** — 粘贴 Cookie、选择组合，全在卡片上完成
- **🔒 凭据安全** — Cookie 始终留在宿主进程

## 工作原理

```text
┌─────────────── Web 浏览器 ───────────────┐
│  lib/client.js（浏览器端模块）            │
│  · shell.overlay 槽位 → 悬浮卡片          │
│  · React + CSS Modules                    │
│  · 配置存 localStorage                    │
│          │ fetch（同源）                  │
└──────────┼────────────────────────────────┘
           ▼
┌─────────────── DSH 宿主（lib/index.js）──┐
│  cordis 插件：webServer 路由             │
│  · GET /api/stock-pnl          快照      │
│  · GET /api/stock-pnl/portfolios 账户列表 │
│  · GET /api/stock-pnl/verify    Cookie 校验 │
│  · POST /api/stock-pnl/cookie   保存 Cookie │
│  · POST /api/stock-pnl/fund-key 保存组合    │
│  · GET /api/stock-pnl/acquire*   自动登录 │
│  通过 ctx.credentials 解析 Cookie        │
│  自动发现 user_id + fund_key             │
│  POST 同花顺账本 API                     │
└───────────────────────────────────────────┘
```

node 半区每次请求通过凭据引用通道（`ctx.credentials`）读取登录 Cookie。手动粘贴通过插件同源 POST 接口保存，保存后的 Cookie 不会回传浏览器端；自动获取的 Cookie 只在宿主中处理。携带凭据的请求不跟随重定向。

「自动获取 Cookie」走宿主进程内的 `acquire.ts` 状态机：点按钮 → 用系统 Edge / Chrome 打开投资账本 → 浏览器层读取到 `userid` 后保存本站 Cookie 并关闭窗口。`login-browser.ts` 使用专用通信管道，不监听调试端口，不启用网页的 Runtime / Debugger，也不读取页面内容；网页风控提示需用户查看。取消、超时、关窗和保存失败都有相应处理。手动保存不再依赖 DSH 旧版的 `connection.api.credentials`，并遵循宿主配置的凭据名称。

## 配置

| 键 | 默认值 | 含义 |
|---|---|---|
| `cookieEnv` | `STOCK_PNL_COOKIE` | 存放账本 Cookie 的凭据引用。 |
| `fundKeyEnv` | `STOCK_PNL_FUND_KEY` | 存放组合 key 的凭据引用（从卡片 ⚙ 表单保存）。 |
| `user_id` | Cookie 的 `userid` | 账本用户 id，表单载荷中都会包含；为空时回退到 Cookie 自身的 `userid`。 |
| `fund_key` | 自动发现 | 选择所管理组合的账本 fund key；设置了 `fundKeyEnv` 凭据时覆盖，为空时从组合列表自动发现。 |
| `pnlUrl` | 同花顺 `time_share` 端点 | 盈亏端点覆盖（测试指向脚本化服务器）。 |
| `indexUrl` | 同花顺 `getQuotes` 端点 | 指数端点覆盖（测试指向脚本化服务器）。 |
| `pollMs` | `20000` | 卡片使用的轮询间隔（毫秒）；随每次响应的 `poll_ms` 上报给浏览器。 |

## 目录结构

```
dsh-ths-holdings/
├── src/
│   ├── index.ts            # node 半区：webServer 路由 + 凭据解析
│   ├── fetch.ts            # 同花顺账本 API 调用 + 自动发现 + Cookie 校验
│   ├── acquire.ts          # 自动获取 Cookie 状态机
│   ├── login-browser.ts    # 系统浏览器启动和 Cookie 读取
│   ├── settings.ts         # 手动保存 Cookie / 组合
│   └── client/
│       ├── index.ts        # 浏览器半区：shell.overlay 注册
│       └── StockPnlCard.tsx
├── lib/                    # 构建产物（index.js + client.js）
├── cordis.patch.yml        # dsh.bundle 补丁层
├── package.json            # dsh.bundle + dsh.client 清单
├── tests/                  # 账本获取 / 校验 / 自动获取单元测试
└── README.md
```

## FAQ / 故障排查

| 现象 | 原因与解决 |
|---|---|
| 卡片显示 `请配置 Cookie` | `STOCK_PNL_COOKIE` 为空——在 ⚙ 面板点「自动获取」或手动粘贴。 |
| 卡片显示 `Token 已过期` | 会话 Cookie 过期——重新自动获取，或按上方手动步骤复制请求标头中的 Cookie。 |
| 保存时报 `Cannot read properties of undefined (reading 'credentials')` | 旧插件调用了 DSH 已变更的客户端接口。安装修复版本，重启 `dsh web` 并刷新 DSH 页面。 |
| 按 F12 没反应 | 从浏览器右上角菜单 → 更多工具 → 开发者工具打开，再按手动步骤查找 Cookie。 |
| 登录页面提示「当前页面不支持开发者工具」 | 自动获取不需要打开开发者工具。手动方式可先查看 Network 已记录的本站请求；没有可用 Cookie 时改用自动获取。 |
| 自动获取弹出窗口后没有反应 | 在弹出窗口完成登录（扫码 / 账号），登录后窗口会自动关闭并保存。 |
| 弹出窗口显示 `Nginx forbidden` | 同花顺风控偶发拦截——在窗口里 F5 刷新或手动访问登录页重试；登录完成后点「我已登录，继续 →」。 |
| 保存后徽标显示 `✗ 无效` | 粘贴的 Cookie 已失效或不是投资账本会话——重新登录获取后再试；面板会给出具体原因。 |
| 下拉框没有组合 | 组合列表需要有效的 Cookie——先保存有效 Cookie，再点 ↻ 刷新。 |
| 有多个组合 | 从下拉框选一个——选择会保存为 `STOCK_PNL_FUND_KEY`。 |
| 粘贴的 Cookie 带换行 | 插件保存时会去掉空白，换行粘贴也没问题。 |

## Model Experience

无——卡片是宿主数据路由上的浏览器端叠加层，不注册任何面向模型的内容。

#### KV Cache 影响

无——插件不贡献任何 prompt、schema 或结果。

## 已知限制

- **账本 API 是未公开的、需登录的端点** — 响应格式可能变化，Cookie 会过期；插件以错误呈现，而不是重试或缓存。
- **组合列表端点（`account_list`）需要先保存 Cookie** — 粘贴有效 Cookie 后组合选择器才会出现。
- **自动获取使用系统浏览器** — 无需安装 Playwright，自动选择已安装的 Edge / Chrome；机器上两者都没有时需手动粘贴。浏览器必须运行在可显示窗口的桌面会话中。
- **无服务端轮询** — 路由按请求拉取，卡片按配置的 `pollMs` 间隔轮询；没有共享缓存或推送通道。

## 本地验证

`npm test` 运行离线回归测试，`npm run typecheck` 和 `npm run build` 检查并构建插件。
`npm run test:browser` 会打开临时浏览器访问本机测试页，验证 Cookie 读取和常见开发者工具检测信号；不会访问真实账本。真实登录和持仓校验需使用者完成。

## License

[MIT](LICENSE)
