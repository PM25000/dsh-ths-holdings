# 持仓报告与定时任务

本指南对应尚未发布的原生工具和随包 Skill 功能；已发布的 0.2.2 不包含这些能力。

## 安装与自动挂载

从包含本功能的安装包安装并启用 `dsh-ths-holdings`。插件自动向宿主注册 `ths-portfolio-report` Skill 及三个只读工具，无需复制 Skill 或配置技能目录。资源路径由安装包位置解析，不依赖当前目录。

开发者本地验证使用 `pnpm install`、`pnpm test`、`pnpm typecheck`、`pnpm build`，再运行 `pnpm pack --pack-destination dist`。安装生成的本地包；不要把修改后的本地包当作 npm 已发布版本。

已验证安装的 Desktop 0.2.0-rc.2 的真实宿主可加载卡片、自动注册 Skill 与三个工具并完成持仓查询。开发依赖使用 0.2.1-rc.2。隔离验收 profile 使用的默认 bundle 组合未提供 schedule 服务；这只描述该测试配置，不能据此判断用户已有 profile。定时报告需要宿主启用 Schedule。隔离 profile 加入官方 `@deepseek-ai/dsh-experimental-schedule-bundle` 后，Desktop 0.2.0-rc.2 也通过了定时触发、冷会话恢复、Skill 加载、持仓查询与报告保存的完整链路验收。新版 0.2.1-rc.2 的真实 Web 宿主已通过定时触发、冷会话恢复、Skill 加载、持仓查询和报告保存测试；模型与账本使用合成数据。测试使用隔离 profile 和合成账本，不修改日常 Desktop 配置。

插件跟随宿主的 tools、skills 服务生命周期挂载。禁用或卸载会注销贡献，重新启用或宿主重启会重新注册。服务缺失时卡片可继续使用，插件日志提示缺少的能力。无需单独启动 MCP 服务。

## 普通聊天中查看与调用 Skill

在普通聊天输入框输入 `/` 查看候选项，输入 `/ths` 筛选 `ths-portfolio-report`。选择后可发送：

> /ths-portfolio-report 查看我的持仓，生成简报。

也可以明确要求模型“使用 ths-portfolio-report 查询持仓”。插件同时开放模型调用与用户调用；普通聊天不依赖 Schedule bundle。真实 Desktop 的隔离验收已验证：普通用户消息首轮包含 Skill 目录、`skill` 工具能加载正文、持仓工具能完成查询、报告能保存，以及输入框所用 `skills/list` 接口包含该 Skill。验收模型与账本为合成测试源。

Skill 出现在列表或加载了正文，只证明发现与加载成功。若持仓工具返回 `REQUEST_BLOCKED`，表示真实数据接口仍被网关拒绝，不代表 Skill 未挂载。网页正常而固定 Cookie 请求受拒绝时，仍需对照网页实际成功请求；有限重试不能保证恢复。

## 登录与账本选择

使用卡片设置完成同花顺登录并选择账本。Cookie 由宿主凭据服务保存和读取，不放入 Skill、任务提示或工具参数。

选择优先级：工具显式 `portfolio_id` → 卡片保存的 `fundKeyEnv` → 插件配置的 `fund_key` → 唯一账本。多个账本且没有选择时返回 `PORTFOLIO_REQUIRED`；已保存或指定的账本不存在时返回错误，不改查其他账本。

先要求模型“使用 ths_list_portfolios 查看账本选择标识”，再将确定的标识写入定时任务提示，防止以后切换卡片默认账本时任务跟着改变。账本选择标识可以用于任务；不要提供 Cookie 或证券账户标识。

## 工具

| 工具 | 参数 | 内容 |
| --- | --- | --- |
| `ths_list_portfolios` | 无 | 账本列表及保存的选择 |
| `ths_get_positions` | 可选 `portfolio_id` | 资产概览、完整持仓、汇总与数据时间 |
| `ths_get_pnl` | 可选 `portfolio_id` | 账本整体分时盈亏 |

结果包含 `status`、`code`、`message`、`warnings` 和 `data`：

- `ok`：本次查询成功。成功且明确的 `positions=[]` 才表示空仓。
- `partial`：部分信息缺失或校验出现差异，查看 warnings；`analysis_available=false` 时仅展示原值，不做衍生分析。
- `error`：查询失败，`data=null`，不代表零资产或空仓。

金额、数量和比例返回十进制字符串，缺失值返回 null。所有以 `_pct` 结尾的字段已经是百分数，不再乘100。单行 `weight_in_positions_pct` 是占持仓市值比例，`weight_in_assets_pct` 是占总资产比例，`assets.invested_pct` 是总仓位。

`queried_at` 是本次查询时间，`uploaded_at` 是账本上传时间。接口没有提供可确认的行情日期时，`quote_date=null`；查询时间不能代替行情日期。分时工具保留原始点时间 t，仅在其为13位毫秒时间戳时提供 sample_at。持仓行日盈亏合计与账本整体分时盈亏分别展示，不强制两者相等。

首版只支持人民币沪深股票及 ETF 的普通账本。融资负债、空头、B股及非沪深证券不在已支持范围。工具保留接口持仓盈亏，不使用显示成本反算覆盖；没有历史快照，不能据当前快照判断调仓。

## 创建定时任务

先在正常对话验证：

> 使用 ths-portfolio-report 查询我的指定账本，展示完整持仓和资产概览，标明上传时间、查询时间及行情日期状态。

随后请求 DSH 创建任务，例如：

> 每周一至周五北京时间15:10，使用 ths-portfolio-report 查询 portfolio_id 为“前一步确认的选择标识”的账本。生成资产概览、完整持仓表、主要日盈亏贡献和数据时间。失败时说明原因，不用旧结果替代。

示例中的选择标识必须替换为真实的工具返回值。确认任务使用 `Asia/Shanghai`；周一至周五不会自动排除交易所节假日。根据宿主实际支持的规则，在自动化任务页面检查任务频率和下次运行时间。

最新 DSH 将提醒投递到原会话，宿主必须保持运行。投递记录证明消息已进入对话，不证明模型已完成工具查询或报告；应检查原对话中的工具结果和最终答复。不同宿主版本的恢复行为可能不同，不保证恰好执行一次。

定时运行不自动打开登录窗口、修改凭据、切换账本或更改任务规则。Skill 只完成本次查询，不自行再创建调度。

## 数据来源及请求

`stock_position` 是持仓主数据；`sort_list` 仅按市场与代码补全名称，额外自选证券不会加入持仓。已验证的 `pass_quotes` 接口是按输入代码查询行情，不用于发现持仓；本期不额外刷新行情以免混合不同时间的数量、市值和盈亏。

每次查询重新读取宿主凭据，没有持久化查询缓存。整体查询默认15秒，包含凭据读取、账本选择和名称补全；可配置 `requestTimeoutMs`，范围100–120000毫秒。HTTP 403 在网络层静默恢复：约300毫秒、900毫秒后补发，附加少量随机延迟，每个请求最多3次尝试。模型查询的网络错误、429或5xx最多补发一次，组合恢复同样不超过3次；所有等待计入原查询截止时间。401、重定向、业务拒绝及取消不重试。Skill 不额外重试。

卡片仅在本次刷新完成后接收结果，恢复成功不会闪现403或登录过期。持续拒绝时保留 Cookie；空序列、格式错误及无效数值也不作为成功刷新。有历史成功值时显示原数值和原更新时间，无成功值时显示占位符。卡片内切换账本或保存新 Cookie 会清空旧快照。该回退只用于卡片展示，模型工具查询失败仍返回 data=null，不把旧数据当作新报告。

## 故障处理

| 错误或警告 | 处理 |
| --- | --- |
| NOT_CONFIGURED / AUTH_REQUIRED | 在卡片设置中检查登录；明确401时重新登录，不自动清除旧凭据 |
| REQUEST_BLOCKED | 静默恢复后仍被拒绝，本次报告失败；卡片保留上次成功值及时间，稍后正常刷新 |
| PORTFOLIO_REQUIRED | 指定账本或在卡片保存选择 |
| PORTFOLIO_NOT_FOUND | 检查已保存或任务绑定的账本，不能自动切换 |
| TIMEOUT / NETWORK_ERROR / SERVICE_UNAVAILABLE | 检查网络及服务，本次报告显示失败 |
| INVALID_RESPONSE / API_REJECTED | 响应格式或业务状态异常，检查宿主日志中的脱敏错误码 |
| NAME_LOOKUP_UNAVAILABLE | 使用原始名称及代码，持仓仍然有效 |
| MISSING_* / *_MISMATCH | 展示缺失或差异，停止衍生分析 |
| UPLOAD_TIME_UNAVAILABLE | 上传时间未知，不用查询时间顶替 |

投资账本依赖用户上传同步；接口查询成功不意味着券商账户已实时同步。

## 开发与验收命令

- `pnpm test`：原有卡片、凭据及新增查询与注册表测试。
- `pnpm typecheck`、`pnpm build`：类型与插件构建。
- PR 自动检查在 Node 22、24 上运行类型检查、测试和安装包验收，不访问真实账本或凭据。
- `pnpm test:package`：重新构建并打包，在新目录安装实际 tgz，改变工作目录，验证自动挂载、查询、卸载和两次宿主启动。
- `pnpm test:desktop-compat`：使用已安装 Desktop 的真实宿主和隔离 profile；记录普通聊天的 Skill 目录、正文加载、查询、斜杠菜单和 Schedule 能力，不修改日常配置。
- `node tests/desktop-compat.smoke.cjs --require-schedule`：强制要求该 Desktop profile 同时提供 Schedule；当前隔离验收 profile 的默认 bundle 组合会明确失败并指出缺少 schedule。
- `node tests/desktop-compat.smoke.cjs --with-schedule --require-schedule`：在隔离 profile 加入官方 Schedule bundle，强制验收 Desktop 的完整定时报告链路。
- 设置 `DSH_SOURCE_ROOT` 为已构建的 DSH checkout，然后运行 `pnpm test:schedule`：使用真实 Web profile、调度服务和 Agent 循环，验证冷会话恢复、Skill 加载、持仓查询与报告持久化。模型和账本为合成测试源；这不等于真实模型质量评估。

本次 DSH 源码基线为 `687f282e8625c6b8d11ff58211a90524be2e4317`（0.2.1-rc.2）。默认完整构建的宿主产物及检查通过，Web 默认压缩构建遇到 Windows esbuild 临时文件删除拒绝；隔离验收页面使用 `pnpm --filter @deepseek-ai/dsh-web-frontend exec vite build --minify false --target esnext` 构建成功。该页面构建配置用于本地验证，不作为默认发布构建成功的证明。

测试报告保存在忽略的 dist 目录。真实接口成功、合成响应回归、真实宿主集成和模型质量评估分别记录，不相互替代。
