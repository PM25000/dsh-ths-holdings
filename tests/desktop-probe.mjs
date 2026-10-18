import { LlmAdapter } from '__DSH_LLM_MODULE__'
export const name='ths-compat-probe'
export const inject=['webServer','tools','skills']
export function apply(ctx) {
 let scheduledContext
 const services=['llm','schedule','agents','agentPresets','sessionController','sessions']
 ctx.inject(services,inner=>{
  scheduledContext=inner
  inner.effect(()=>()=>{scheduledContext=undefined})
 })
 const register=(path,run)=>ctx.effect(()=>ctx.webServer.register({kind:'exact',path,handler:async(_req,res)=>{
  try {const value=await run();res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify(value))}
  catch(error){res.writeHead(500,{'Content-Type':'text/plain'});res.end(String(error))}
 }}),'ths desktop diagnostic')
 register('/api/ths-compat/model',async()=>{
  const skill=await ctx.skills.get('ths-portfolio-report')
  const tools=ctx.tools.schemas().filter(t=>t.name.startsWith('ths_')).map(t=>t.name)
  const result=await ctx.tools.execute({callId:'desktop-positions',name:'ths_get_positions',arguments:{portfolio_id:'compat-two'},signal:new AbortController().signal})
  return {skill:skill?.name,body:skill?.content,tools,result}
 })
 register('/api/ths-compat/schedule',async()=>{
  const missing=services.filter(name=>!ctx.get(name))
  if(missing.length)return {supported:false,missing,mode:'installed-desktop-capability-check'}
  const scheduleCtx=scheduledContext
  if(!scheduleCtx)throw new Error('Schedule dependencies are not ready')
  let step=0
  const report='Desktop 合成持仓报告：示例完整名称；持仓市值30.3，现金20，总资产50.3。'
  class Adapter extends LlmAdapter {
   async listModels(provider){return[{provider,id:'fixture',name:'Desktop Fixture'}]}
   async *stream(options){
    if(step===1&&!JSON.stringify(options.messages).includes('宿主已负责有限重试和超时'))throw new Error('Skill instructions were not loaded')
    if(step<2){
     const name=step===0?'skill':'ths_get_positions',args=step===0?{name:'ths-portfolio-report'}:{portfolio_id:'compat-two'},id='desktop-fixture-'+step++
     yield {type:'block-start',index:0,blockType:'tool-call'}
     yield {type:'block-end',index:0,block:{type:'tool-call',id,name,arguments:JSON.stringify(args)}}
     yield {type:'finish',reason:{kind:'tool-calls'}}
    }else{
     if(!JSON.stringify(options.messages).includes('示例完整名称'))throw new Error('No position result in model history')
     yield {type:'block-start',index:0,blockType:'text'}
     yield {type:'block-end',index:0,block:{type:'text',text:report}}
     yield {type:'finish',reason:{kind:'stop'}}
    }
   }
  }
  scheduleCtx.llm.registerAdapter(['ths-desktop-fixture'],new Adapter())
  const handle=await scheduleCtx.agents.create({sessionId:'ths-desktop-schedule',meta:{cwd:process.cwd()},
   agentOptions:{provider:'ths-desktop-fixture',model:'fixture'},setup:agentCtx=>scheduleCtx.agentPresets.mount(agentCtx).then(()=>undefined)})
  const id=handle.agent.id
  await scheduleCtx.sessionController.selectModel({sessionId:id,provider:'ths-desktop-fixture',model:'fixture'})
  let off,timer
  try {
   const settled=new Promise((resolve,reject)=>{
    timer=setTimeout(()=>reject(new Error('Desktop scheduled report timeout')),15000)
    off=scheduleCtx.on('session/event',(session,event)=>{if(session.id===id&&event.type==='turn/end')resolve()})
   })
   const record=await scheduleCtx.schedule.create(id,{title:'Desktop 持仓测试',prompt:'使用 ths-portfolio-report 查询 portfolio_id=compat-two，生成持仓报告。',after_seconds:2})
   await scheduleCtx.sessions.flush(handle.agent.session)
   await handle.dispose()
   const cold=scheduleCtx.agents.get(id)===undefined
   await settled
   const restored=scheduleCtx.agents.get(id)
   await scheduleCtx.sessions.flush(restored.session)
   const events=restored.session.snapshotEvents()
   const text=JSON.stringify(events)
   if(!text.includes(report))throw new Error('Desktop report missing')
   const task=(await scheduleCtx.schedule.catalog()).find(x=>x.id===record.id)
   return {supported:true,mode:'installed-desktop-scripted-provider-synthetic-ledger',coldSessionRestored:cold&&restored!==handle.agent,skillLoaded:step===2,
    timerDelivered:!!task?.lastDelivery,positionsQueried:text.includes('ths_get_positions'),reportPersisted:true}
  } finally {clearTimeout(timer);off?.()}
 })
}
