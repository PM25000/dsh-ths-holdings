/** Optional model-facing contribution; the existing card does not require these services. */
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { BUNDLED_SKILL_RANK, type SkillProvider } from '@deepseek-ai/dsh-skill'
import { parse } from 'yaml'
import { LedgerClient } from './ledger.ts'
import { pnlSchema, portfoliosSchema, positionsSchema } from './report-schema.ts'

export const name = 'ths-portfolio-model'
export const inject = ['tools', 'skills']
export interface Config { client: LedgerClient }
/** Skill is loaded relative to the installed module, never cwd or a user profile. */
export async function apply(ctx: Context, config: Config): Promise<void> {
  const path = fileURLToPath(new URL('../skills/ths-portfolio-report/SKILL.md', import.meta.url))
  const raw = await readFile(path, 'utf8')
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(raw)
  if (!match?.[1]) throw new Error('ths-portfolio-report: missing skill metadata')
  const metadata: unknown = parse(match[1])
  if (metadata === null || typeof metadata !== 'object' || !('name' in metadata) || metadata.name !== 'ths-portfolio-report'
    || !('description' in metadata) || typeof metadata.description !== 'string') throw new Error('ths-portfolio-report: invalid skill metadata')
  const definition = {
    name: 'ths-portfolio-report', description: metadata.description,
    invocation: { modelInvocable: true, userInvocable: true },
    source: 'bundled' as const, provider: 'ths-portfolio-report',
    path, resourceBase: { kind: 'directory' as const, path: dirname(path) },
  }
  const provider: SkillProvider = {
    name: 'ths-portfolio-report',
    list: async () => [{ ...definition, rank: BUNDLED_SKILL_RANK, locator: path }],
    get: async () => ({ ...definition, content: raw.slice(match[0].length).trim() }),
  }
  ctx.skills.registerProvider(() => provider)
  const parameters = { portfolio_id: { type: 'string', description: '账本选择标识；定时任务应显式指定以固定账本。省略时使用卡片已保存选择或唯一账本。' } } as const
  ctx.tools.register(defineTool({
    name: 'ths_list_portfolios',
    description: '只读查询同花顺投资账本列表和已保存选择。认证信息留在宿主；status=error 表示失败，不是没有账本。',
    parameters: {}, output: { schema: portfoliosSchema, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
    execute: (_args, exec) => config.client.list(exec.signal),
    presentCall: () => ({ card: 'generic', title: '查询同花顺账本', kind: 'read' }),
  }))
  ctx.tools.register(defineTool({
    name: 'ths_get_positions',
    description: '只读查询人民币沪深股票/ETF 普通账本完整持仓和资产。返回十进制字符串、缺失值 null、两种占比和数据时间。status=error 时 data=null；partial 时须展示 warnings；analysis_available=false 时不做衍生分析。账本并非券商实时同步。',
    parameters, output: { schema: positionsSchema, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
    execute: (args, exec) => config.client.positions(exec.signal, args.portfolio_id),
    presentCall: () => ({ card: 'generic', title: '查询同花顺持仓', kind: 'read' }),
  }))
  ctx.tools.register(defineTool({
    name: 'ths_get_pnl',
    description: '只读查询所选账本整体分时盈亏。day_pct 和 points.pct 已是百分数，不能再乘100。与持仓行日盈亏合计分别展示，不强制相等。查询日期不能代替行情日期。',
    parameters, output: { schema: pnlSchema, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
    execute: (args, exec) => config.client.pnl(exec.signal, args.portfolio_id),
    presentCall: () => ({ card: 'generic', title: '查询账本分时盈亏', kind: 'read' }),
  }))
}
