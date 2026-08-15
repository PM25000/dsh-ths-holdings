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

<!-- 在这里添加你的截图，例如
| 折叠药丸 | 展开卡片 |
|---|---|
| ![pill](screenshots/pill.png) | ![card](screenshots/card.png) |
-->

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

1. 打开 [https://tzzb.10jqka.com.cn](https://tzzb.10jqka.com.cn) 并登录。
2. 按 **F12 → 控制台**，运行：
   ```javascript
   copy(document.cookie)
   ```
3. Cookie 已复制到剪贴板。
4. 打开 DSH 网页 GUI，点击卡片上的 **⚙**。
5. 把 Cookie 粘贴进 **STOCK_PNL_COOKIE** → **保存**。
6. 插件自动发现你的组合——如有多个，从下拉框选一个即可。

会话 Cookie 会过期——过期时卡片显示 **Token 已过期** 横幅，重复步骤 1–5 贴新的即可（`v` 反爬令牌自动处理，无需关心）。

## 特性

- **📊 实时持仓盈亏** — 每 20 秒（可配置）轮询你的真实组合
- **¥ / % 切换** — 今日盈亏可按金额、百分比或两者同时显示
- **📈 当日走势图** — 迷你折线 + 零轴虚线，红涨绿跌
- **🇨🇳 上证指数** — 与你的盈亏并列显示
- **🔄 自动发现** — `fund_key` 从组合列表自动获取；多账户可通过下拉框选择
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
│  通过 ctx.credentials 解析 Cookie        │
│  自动发现 user_id + fund_key             │
│  POST 同花顺账本 API                     │
└───────────────────────────────────────────┘
```

node 半区每次请求通过凭据引用通道（`ctx.credentials`）读取登录 Cookie——浏览器端永远看不到它。携带凭据的请求不跟随重定向。`v` 反爬令牌按 User-Agent 每次现算，存储的 Cookie 只需会话字段。

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
│   ├── fetch.ts            # 同花顺账本 API 调用 + 自动发现
│   └── client/
│       ├── index.ts        # 浏览器半区：shell.overlay 注册
│       └── StockPnlCard.tsx
├── lib/                    # 构建产物（index.js + client.js）
├── cordis.patch.yml        # dsh.bundle 补丁层
├── package.json            # dsh.bundle + dsh.client 清单
├── tests/                  # 账本获取单元测试
└── README.md
```

## FAQ / 故障排查

| 现象 | 原因与解决 |
|---|---|
| 卡片显示 `请配置 Cookie` | `STOCK_PNL_COOKIE` 为空——在 ⚙ 面板粘贴你的 Cookie。 |
| 卡片显示 `Token 已过期` | 会话 Cookie 过期——重新执行 `copy(document.cookie)` 并粘贴新的。 |
| 下拉框没有组合 | 组合列表需要有效的 Cookie——先保存 Cookie，再点 ↻ 刷新。 |
| 有多个组合 | 从下拉框选一个——选择会保存为 `STOCK_PNL_FUND_KEY`。 |
| 粘贴的 Cookie 带换行 | 插件保存时会去掉空白，换行粘贴也没问题。 |

## Model Experience

无——卡片是宿主数据路由上的浏览器端叠加层，不注册任何面向模型的内容。

#### KV Cache 影响

无——插件不贡献任何 prompt、schema 或结果。

## 已知限制

- **账本 API 是未公开的、需登录的端点** — 响应格式可能变化，Cookie 会过期；插件以错误呈现，而不是重试或缓存。
- **组合列表端点（`account_list`）需要先保存 Cookie** — 粘贴有效 Cookie 后组合选择器才会出现。
- **无服务端轮询** — 路由按请求拉取，卡片按配置的 `pollMs` 间隔轮询；没有共享缓存或推送通道。

## License

[MIT](LICENSE)
