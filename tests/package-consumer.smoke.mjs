/** Run a copy of this file from a clean installation containing the packed plugin. */
import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { Context, Service } from '@deepseek-ai/cordis'
import Tools from '@deepseek-ai/dsh-tools'
import Skills from '@deepseek-ai/dsh-skill'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import { CredentialProvider } from '@deepseek-ai/dsh-credentials'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import { parse, stringify } from 'yaml'
class Credentials extends CredentialProvider {
  async resolve(ref) { return ref === 'CUSTOM_COOKIE' ? { value: 'userid=synthetic; sid=fix ture', source: 'fixture' } : ref === 'CUSTOM_FUND' ? { value: 'fixture', source: 'fixture' } : undefined }
  async describe() { return { configured: true, writable: false } }
  async set() {} async unset() {}
}
class Http extends Service {
  constructor(ctx) { super(ctx, 'webServer') }
  routes=new Map()
  register(route) { assert(!this.routes.has(route.path),'No duplicate route: '+route.path); this.routes.set(route.path,route); return () => this.routes.delete(route.path) }
}
const root=fileURLToPath(new URL('.',import.meta.url)), originalCwd=process.cwd(), originalFetch=globalThis.fetch
await mkdir(root+'unrelated-cwd',{recursive:true})
process.chdir(root+'unrelated-cwd')
globalThis.fetch=async (url,init)=>{
  const headers=new Headers(init.headers)
  assert.equal(headers.get('cookie'),'userid=synthetic; sid=fixture','Folded credentials are normalized on the active query path')
  assert.equal(init.redirect,'manual')
  let ex_data
  if(String(url).endsWith('account_list')) {
    assert.equal(headers.get('referer'),null);assert.equal(headers.get('accept'),null)
    ex_data={common:[{fund_key:'fixture',manualname:'合成账本',brokername:'合成'}]}
  }
  else if(String(url).endsWith('stock_position')) ex_data={money_remain:'20',total_value:'30.3',total_asset:'50.3',total_liability:'0',position_rate:'0.6024',upload_time:'1792048335000',
    position:[{market:'1',code:'000001',name:'合成证券',count:'3',cost:'10.01',price:'10.1',value:'30.3',hold_profit:'0.27',hold_rate:'0.00899',pre_profit:'0.3',pre_rate:'0.01',position_rate:'1',stock_account:'PRIVATE-ACCOUNT'}]}
  else if(String(url).endsWith('sort_list')) ex_data={list:[{market:'1',code:'000001',name:'合成证券全名'}]}
  else throw new Error('unexpected endpoint')
  return Response.json({error_code:'0',ex_data})
}
const packageRoot=new URL('../',import.meta.resolve('dsh-ths-holdings'))
const rows=parse(await readFile(new URL('cordis.patch.yml',packageRoot),'utf8')).flatMap(patch=>patch.insert??[])
assert.equal(rows.length,2,'The installation declares exactly two feature components')
const cardConfig={cookieEnv:'CUSTOM_COOKIE',fundKeyEnv:'CUSTOM_FUND',pollMs:3456,showCard:false}
const configPath=root+'cordis.yml'
await writeFile(configPath,stringify(rows.map(row=>({...row,...row.id==='ths-holdings'?{config:cardConfig}:{} }))))
const evidence=[]
try {
 for(let boot=0;boot<2;boot++){
  const ctx=new Context()
  try {
   await ctx.plugin(SystemPrompt);await ctx.plugin(Tools);await ctx.plugin(Skills);await ctx.plugin(Credentials);await ctx.plugin(Http)
   ctx.baseUrl=pathToFileURL(root).href
   await ctx.plugin(Loader)
   ctx.loader.builtins.include=Include
   ctx.loader.internal={version:'v2',import:specifier=>import(specifier)}
   const includeId=await ctx.loader.create({name:'cordis:include',config:{path:pathToFileURL(configPath).href}})
   const fork=ctx.loader.resolve(includeId).fiber
   await fork.await();await ctx.loader.await()
   const entry=id=>[...ctx.loader.entries()].find(row=>row.options.id===id)
   const toggle=async(id,enabled)=>{
    const target=entry(id),previous=target.fiber
    await target.update({disabled:!enabled})
    if(!enabled)await previous?.await()
    else await target.fiber?.await()
   }
   assert.equal(entry('ths-holdings').options.config.pollMs,3456)
   assert.equal(entry('ths-holdings').options.config.showCard,false)
   if(boot===1)assert.equal(entry('ths-holdings').disabled,true,'Card disabled state survives a cold boot')
   const until=Date.now()+3000
   while(!(await ctx.skills.get('ths-portfolio-report'))&&Date.now()<until)await new Promise(r=>setTimeout(r,10))
   const skill=await ctx.skills.get('ths-portfolio-report')
   assert(skill?.content.includes('ths_get_positions'),'Skill mounts automatically from installed package')
   assert.equal(skill.source,'bundled')
   assert.equal(skill.invocation.modelInvocable,true);assert.equal(skill.invocation.userInvocable,true)
   assert.deepEqual(ctx.tools.schemas().map(s=>s.name).filter(n=>n.startsWith('ths_')).sort(),['ths_get_pnl','ths_get_positions','ths_list_portfolios'])
   const path=skill.resourceBase.path
   assert(path.includes('node_modules'),'Skill resolves from the installed package')
   const result=await ctx.tools.execute({callId:'packed-'+boot,name:'ths_get_positions',arguments:{},signal:new AbortController().signal})
   assert.equal(result.isError,false)
   const value=JSON.parse(result.content.filter(x=>x.type==='text').map(x=>x.text).join(''))
   assert.equal(value.status,'ok');assert.equal(value.data.position_count,1)
   assert.equal(value.data.positions[0].name,'合成证券全名')
   assert(!JSON.stringify(result).includes('PRIVATE-ACCOUNT'))
   const routes=ctx.get('webServer').routes
   await toggle('ths-holdings-skill',false)
   assert.equal(await ctx.skills.get('ths-portfolio-report'),undefined)
   if(boot===0)assert(routes.has('/api/stock-pnl'),'Card-only mode retains routes')
   await toggle('ths-holdings',false)
   assert.equal(routes.size,0,'Last feature releases routes and client carrier')
   assert.equal(ctx.get('thsHoldings'),undefined)
   await toggle('ths-holdings-skill',true)
   assert.equal(ctx.get('thsHoldings').state().card,false)
   const again=await ctx.tools.execute({callId:'skill-only',name:'ths_get_positions',arguments:{},signal:new AbortController().signal})
   assert.equal(JSON.parse(again.content[0].text).status,'ok','Skill-only mode retains custom credential references from disabled card config')
   await toggle('ths-holdings',true)
   assert.equal(ctx.get('thsHoldings').state().card,true)
   assert.equal(ctx.tools.schemas().filter(tool=>tool.name.startsWith('ths_')).length,3)
   await toggle('ths-holdings',false)
   await writeFile(configPath,stringify(rows.map(row=>({...row,...row.id==='ths-holdings'?{config:cardConfig,disabled:true}:{} }))))
   fork.dispose();await fork.await()
   assert.equal(await ctx.skills.get('ths-portfolio-report'),undefined)
   assert(!ctx.tools.schemas().some(x=>x.name.startsWith('ths_')))
   evidence.push({boot,automaticSkill:true,toolQuery:true,unrelatedCwd:true,unregisteredOnUnload:true,independentComponents:true,customCredentials:true,coldSettings:true,skillPath:path})
  } finally {await ctx.fiber.dispose()}
 }
} finally {globalThis.fetch=originalFetch;process.chdir(originalCwd)}
await writeFile(root+'package-verification.json',JSON.stringify({mode:'packed-artifact-synthetic-ledger',evidence},null,2)+'\n')
console.log(JSON.stringify({boots:evidence.length,packedInstallation:true,automaticSkill:true,toolQuery:true,unload:true}))
