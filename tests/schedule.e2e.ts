/** Real assembled DSH scheduling and agent loop; a scripted model and synthetic ledger keep this keyless. */
import { it, expect, vi } from 'vitest'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { mkdir, writeFile } from 'node:fs/promises'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { fixture } from './ledger-fixture.ts'

it('delivers a real timer, loads the bundled Skill, queries positions, and persists the resulting report', async () => {
  const source=process.env.DSH_SOURCE_ROOT!
  const requireDsh=createRequire(join(source,'apps/cli/package.json'))
  const {LlmAdapter,ToolCallId}=requireDsh('@deepseek-ai/dsh-llm')
  const {SessionId}=requireDsh('@deepseek-ai/dsh-session')
  const {launchWebScaffold}=await import(pathToFileURL(join(source,'apps/web/tests/scaffold.ts')).href)
  const h=fixture()
  const realFetch=globalThis.fetch
  vi.stubGlobal('fetch',async(input: RequestInfo|URL,init: RequestInit)=>{
    const url=typeof input==='string'?input:input instanceof URL?input.href:input.url
    return new URL(url).hostname==='tzzb.10jqka.com.cn'?h.fetchImpl(url,init):realFetch(input,init)
  })
  vi.stubEnv('TEST_COOKIE','userid=test-user; sid=private-cookie-value')
  vi.stubEnv('TEST_FUND','portfolio-0')
  const repo=fileURLToPath(new URL('..',import.meta.url))
  await mkdir(join(repo,'dist'),{recursive:true})
  const overlay=join(repo,'dist/schedule-overlay.yml')
  await writeFile(overlay,'- id: ths-holdings\n  config: { cookieEnv: TEST_COOKIE, fundKeyEnv: TEST_FUND }\n')
  const scaffold=await launchWebScaffold({profile:{hmr:false,packages:[{dir:repo,enabled:true}]},extraOverlayPath:overlay})
  let step=0
  const report='合成持仓报告：示例完整名称，3股；总资产50.3元，持仓市值30.3元，现金20元；持仓盈亏0.27元，接口日盈亏0.3元。行情日期未提供。'
  class Adapter extends LlmAdapter {
    async listModels(provider: string){return[{provider,id:'fixture',name:'Fixture'}]}
    async *stream(options: {tools?:{name:string}[];messages:unknown[]}){
      if(step===1)expect(JSON.stringify(options.messages)).toContain('宿主已负责有限重试和超时')
      if(step<2){
        const name=step===0?'skill':'ths_get_positions'
        expect(options.tools?.some(t=>t.name===name)).toBe(true)
        const args=step===0?{name:'ths-portfolio-report'}:{portfolio_id:'portfolio-0'}
        const id=ToolCallId('scheduled-fixture-'+step++)
        yield {type:'block-start',index:0,blockType:'tool-call'}
        yield {type:'block-end',index:0,block:{type:'tool-call',id,name,arguments:JSON.stringify(args)}}
        yield {type:'finish',reason:{kind:'tool-calls'}}
      } else {
        expect(JSON.stringify(options.messages)).toContain('示例完整名称')
        yield {type:'block-start',index:0,blockType:'text'}
        yield {type:'block-end',index:0,block:{type:'text',text:report}}
        yield {type:'finish',reason:{kind:'stop'}}
      }
    }
  }
  try {
    scaffold.ctx.llm.registerAdapter(['ths-schedule-fixture'],new Adapter())
    const handle=await scaffold.ctx.agents.create({sessionId:SessionId('ths-schedule-fixture'),meta:{cwd:scaffold.workspaceCwd},
      agentOptions:{provider:'ths-schedule-fixture',model:'fixture'},
      setup:(agentCtx: unknown)=>scaffold.ctx.agentPresets.mount(agentCtx).then(()=>undefined)})
    const agent=handle.agent
    expect((await scaffold.ctx.skills.get('ths-portfolio-report'))?.name).toBe('ths-portfolio-report')
    await scaffold.ctx.sessionController.selectModel({sessionId:agent.id,provider:'ths-schedule-fixture',model:'fixture'})
    const settled=scaffold.whenTurnSettled(15000)
    const record=await scaffold.ctx.schedule.create(agent.id,{title:'持仓报告测试',prompt:'使用 ths-portfolio-report 查询 portfolio_id=portfolio-0，生成持仓报告。',after_seconds:2})
    await scaffold.ctx.sessions.flush(agent.session)
    await handle.dispose()
    expect(scaffold.ctx.agents.get(agent.id)).toBeUndefined()
    await settled
    const restored=scaffold.ctx.agents.get(agent.id)
    expect(restored).toBeTruthy()
    expect(restored).not.toBe(agent)
    expect(await scaffold.ctx.sessions.flush(restored.session)).toBe(true)
    const events=restored.session.snapshotEvents()
    const saved=Array.from(events)
    const text=JSON.stringify(saved)
    expect(text).toContain(report)
    expect(text).toContain('ths_get_positions')
    expect(text).not.toContain('PRIVATE-ACCOUNT')
    const catalog=await scaffold.ctx.schedule.catalog()
    const task=catalog.find((x: {id:string})=>x.id===record.id)
    expect(task?.lastDelivery).toBeTruthy()
    await writeFile(join(repo,'dist/schedule-verification.json'),JSON.stringify({mode:'real-dsh-host-scripted-provider-synthetic-ledger',
      hostCommit:'687f282e8625c6b8d11ff58211a90524be2e4317',coldSessionRestored:true,timerDelivered:true,skillLoaded:true,positionsQueried:true,reportPersisted:true,report},null,2)+'\n')
  } finally {await scaffold.close();vi.unstubAllGlobals();vi.unstubAllEnvs()}
})
