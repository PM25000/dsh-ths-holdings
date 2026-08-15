# dsh-ths-holdings

[English](README.md) | 中文

DeepSeek Harness 网页 GUI 上的**持仓盈亏**悬浮卡片。自动从[同花顺投资账本](https://tzzb.10jqka.com.cn)同步真实持仓数据——**不需要手动维护股票池**。实时显示**今日盈亏**（百分比 + 金额）、**上证指数**和当日分时走势图。

与自选股盯盘工具不同，这个插件读取的是你**真实的持仓盈亏**，不是手动添加的自选股列表。

登录 Cookie 始终留在宿主端——node 半区每次请求通过凭据通道读取，浏览器半区只渲染归一化后的快照。

## 安装

```sh
dsh plugin --profile web add dsh-ths-holdings
```

或者手动从 npm 安装并加入 `cordis.yml`：

```yaml
plugins:
  - id: ths-holdings
    name: dsh-ths-holdings
```

然后重启 `dsh web`。

## 使用

1. 打开 [https://tzzb.10jqka.com.cn](https://tzzb.10jqka.com.cn) 并登录。
2. 按 **F12 → 控制台**，运行：
   ```javascript
   copy(document.cookie)
   ```
3. Cookie 已复制到剪贴板。
4. 回到 DSH 网页 GUI——右下角出现悬浮卡片。
5. 点击卡片上的 **⚙** → 粘贴 Cookie → **保存**。
6. 插件会自动从组合列表发现你的投资组合并开始显示盈亏数据。

## 配置

| 键 | 默认值 | 含义 |
|---|---|---|
| `cookieEnv` | `STOCK_PNL_COOKIE` | 存放账本 Cookie 的环境变量名。 |
| `fundKeyEnv` | `STOCK_PNL_FUND_KEY` | 存放组合 key 的凭据引用（从卡片 ⚙ 表单保存）。 |
| `user_id` | Cookie 的 `userid` | 账本用户 id，表单载荷中都会包含；为空时回退到 Cookie 自身的 `userid`。 |
| `fund_key` | 自动发现 | 选择所管理组合的账本 fund key；设置了 `fundKeyEnv` 凭据时覆盖，为空时从组合列表自动发现。 |
| `pnlUrl` | 同花顺 `time_share` 端点 | 盈亏端点覆盖（测试指向脚本化服务器）。 |
| `indexUrl` | 同花顺 `getQuotes` 端点 | 指数端点覆盖（测试指向脚本化服务器）。 |
| `pollMs` | `20000` | 卡片使用的轮询间隔（毫秒）；随每次响应的 `poll_ms` 上报给浏览器。 |

## 特性

- **📊 实时盈亏** — 每 20 秒轮询（可配置），同时显示盈亏百分比和金额
- **📈 当日走势图** — 迷你折线图，红涨绿跌
- **🇨🇳 上证指数** — 与持仓盈亏并列显示
- **↕ 可拖动** — 沿右侧边缘上下拖动标题栏
- **⚙ 就地设置** — 粘贴 Cookie、选择组合、切换金额显示，全在卡片上完成
- **🔄 自动发现** — `fund_key` 从组合列表自动获取，无需手动配置
- **🔒 凭据安全** — Cookie 始终留在宿主进程

## Model Experience

无——卡片是宿主数据路由上的浏览器端叠加层，不注册任何面向模型的内容。

#### KV Cache 影响

无——插件不贡献任何 prompt、schema 或结果。

## 已知限制

- **组合列表端点（`account_list`）需要先保存 Cookie** — 粘贴有效 Cookie 后组合选择器才会出现。
- **账本 API 是未公开的、需登录的端点** — 响应格式可能变化，Cookie 会过期；插件以错误呈现，而不是重试或缓存。
- **无服务端轮询** — 路由按请求拉取，卡片按配置的 `pollMs` 间隔轮询；没有共享缓存或推送通道。