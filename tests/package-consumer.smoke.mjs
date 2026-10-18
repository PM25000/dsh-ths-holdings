/** Run a copy of this file from a clean installation containing the packed plugin. */
import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { Context, Service } from '@deepseek-ai/cordis'
import Tools from '@deepseek-ai/dsh-tools'
import Skills from '@deepseek-ai/dsh-skill'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import { CredentialProvider } from '@deepseek-ai/dsh-credentials'
import * as plugin from 'dsh-ths-holdings'
class Credentials extends CredentialProvider {
  async resolve(ref) { return ref === 'STOCK_PNL_COOKIE' ? { value: 'userid=synthetic; sid=fix ture', source: 'fixture' } : undefined }
  async describe() { return { configured: true, writable: false } }
  async set() {} async unset() {}
}
class Http extends Service {
  constructor(ctx) { super(ctx, 'webServer') }
  register() { return () => {} }
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
const evidence=[]
try {
 for(let boot=0;boot<2;boot++){
  const ctx=new Context()
  try {
   await ctx.plugin(SystemPrompt);await ctx.plugin(Tools);await ctx.plugin(Skills);await ctx.plugin(Credentials);await ctx.plugin(Http)
   const fork=ctx.plugin(plugin,{})
   await fork
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
   await fork.dispose()
   assert.equal(await ctx.skills.get('ths-portfolio-report'),undefined)
   assert(!ctx.tools.schemas().some(x=>x.name.startsWith('ths_')))
   evidence.push({boot,automaticSkill:true,toolQuery:true,unrelatedCwd:true,unregisteredOnUnload:true,skillPath:path})
  } finally {await ctx.fiber.dispose()}
 }
} finally {globalThis.fetch=originalFetch;process.chdir(originalCwd)}
await writeFile(root+'package-verification.json',JSON.stringify({mode:'packed-artifact-synthetic-ledger',evidence},null,2)+'\n')
console.log(JSON.stringify({boots:evidence.length,packedInstallation:true,automaticSkill:true,toolQuery:true,unload:true}))
