import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import Tools from '@deepseek-ai/dsh-tools'
import Skills from '@deepseek-ai/dsh-skill'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import * as model from '../src/model.ts'
import { fixture } from './ledger-fixture.ts'

describe('installed model capabilities', () => {
  it('registers real tool schemas, executes through DSH and releases every contribution on reload', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt); await ctx.plugin(Tools); await ctx.plugin(Skills)
    try {
      for (let n = 0; n < 2; n++) {
        const fork = ctx.plugin(model, { client: fixture().client })
        await fork
        assert.deepEqual(ctx.tools.schemas().map(s => s.name).filter(n => n.startsWith('ths_')).sort(),
          ['ths_get_pnl', 'ths_get_positions', 'ths_list_portfolios'])
        const skill = await ctx.skills.get('ths-portfolio-report')
        assert(skill?.content.includes('ths_get_positions'))
        assert.equal(skill?.source, 'bundled')
        const result = await ctx.tools.execute({ callId: 'fixture-' + n, name: 'ths_get_positions', arguments: {}, signal: new AbortController().signal })
        assert.equal(result.isError, false)
        const data = JSON.parse(result.content.filter(c => c.type === 'text').map(c => c.text).join(''))
        assert.equal(data.status, 'ok'); assert.equal(data.data.positions[0].name, '示例完整名称')
        assert(!JSON.stringify(result).includes('PRIVATE-ACCOUNT'))
        await fork.dispose()
        assert(!ctx.tools.schemas().some(s => s.name.startsWith('ths_')))
        assert.equal(await ctx.skills.get('ths-portfolio-report'), undefined)
      }
    } finally { await ctx.fiber.dispose() }
  })
})
