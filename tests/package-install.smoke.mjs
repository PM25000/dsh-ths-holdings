/** Rebuild, pack, install into a fresh directory, then exercise installed capabilities. */
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, writeFile, copyFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
const repo=fileURLToPath(new URL('..',import.meta.url))
const manager=process.env.npm_execpath
assert(manager,'Run this test through pnpm run test:package')
function run(args,cwd=repo){
 const native=/\.exe$/i.test(manager)
 const child=spawnSync(native?manager:process.execPath,native?args:[manager,...args],{cwd,env:process.env,stdio:'inherit',windowsHide:true})
 if(child.error)throw child.error
 assert.equal(child.status,0,'Package command failed: '+args.join(' '))
}
await mkdir(join(repo,'dist'),{recursive:true})
const root=await mkdtemp(join(repo,'dist/packed-install-'))
run(['run','build'])
run(['pack','--pack-destination',root])
const pkg=JSON.parse(await readFile(join(repo,'package.json'),'utf8'))
const dependencies={'dsh-ths-holdings':'file:./dsh-ths-holdings-'+pkg.version+'.tgz'}
for(const name of ['@deepseek-ai/cordis','@deepseek-ai/dsh-tools','@deepseek-ai/dsh-skill','@deepseek-ai/dsh-system-prompt','@deepseek-ai/dsh-credentials','@deepseek-ai/dsh-host-webserver'])dependencies[name]=pkg.devDependencies[name]
await writeFile(join(root,'package.json'),JSON.stringify({name:'ths-package-consumer',private:true,type:'module',packageManager:pkg.packageManager,dependencies},null,2))
run(['install'],root)
await copyFile(join(repo,'tests/package-consumer.smoke.mjs'),join(root,'consumer.mjs'))
const child=spawnSync(process.execPath,[join(root,'consumer.mjs')],{cwd:root,env:process.env,stdio:'inherit',windowsHide:true})
if(child.error)throw child.error
assert.equal(child.status,0,'Installed package verification failed')
console.log('Package verification evidence: '+join(root,'package-verification.json'))
