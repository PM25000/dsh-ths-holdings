import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
const source=process.env.DSH_SOURCE_ROOT
assert(source,'Set DSH_SOURCE_ROOT to a built DeepSeek Harness checkout')
const config=fileURLToPath(new URL('./schedule.vitest.config.mts',import.meta.url))
const result=spawnSync(process.execPath,[join(source,'node_modules/vitest/vitest.mjs'),'run','--config',config],{cwd:source,env:process.env,stdio:'inherit',windowsHide:true})
if(result.error)throw result.error
process.exitCode=result.status??1
