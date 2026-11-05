import {readFile,readdir,access} from 'node:fs/promises'
import {createHash} from 'node:crypto'
import {resolve,dirname} from 'node:path'
const digest=bytes=>createHash('sha256').update(bytes).digest('hex')
const manifest=JSON.parse(await readFile('package.json','utf8'))
if(Object.keys(manifest.dependencies??{}).some(name=>name.startsWith('@deepseek-ai/dsh-')))throw new Error('Registry SDK runtime dependency reintroduced')
let files=0
async function walk(directory){for(const entry of await readdir(directory,{withFileTypes:true})){const path=directory+'/'+entry.name;if(entry.isDirectory())await walk(path);else if(entry.isFile()&&/\.(?:js|cjs|mjs)$/.test(path)){
 files++;const text=await readFile(path,'utf8')
 if(/(?:\bfrom\s*|\bimport\s*\(\s*|\bcreateLazyRequire\s*\(\s*|\bimport\.meta\.resolve\s*\(\s*|\brequire\s*\(\s*)['"]@deepseek-ai\/dsh-[^'"]+['"]/.test(text))throw new Error('External SDK runtime import: '+path)
 if(/\b(?:var|class)\s+(?:LlmRuntime|ToolRuntime|SessionStore)\b/.test(text))throw new Error('Legacy runtime orchestrator definition: '+path)
 for(const [,specifier]of text.matchAll(/(?:\bfrom\s*|\bimport\s*\(\s*)['"](\.{1,2}\/[^'"\r\n]+)['"]/g))await access(resolve(dirname(path),specifier))
}}}
for(const directory of ['src','bin','packages/dingtalk-core','packages/scope-compat','packages/capability-compat'])await walk(directory)
const legacy=JSON.parse(await readFile('docs/legacy-runtime-source-manifest.json','utf8'))
for(const entry of legacy.files)if(digest(await readFile(entry.target))!==entry.sha256)throw new Error('Unrecorded legacy/platform source change: '+entry.target)
if(digest(await readFile(legacy.worker.target))!==legacy.worker.sha256)throw new Error('Unrecorded verifier worker change')
const schedule=JSON.parse(await readFile('docs/schedule-source-manifest.json','utf8'))
for(const entry of schedule.files)if(digest(await readFile(entry.target))!==entry.sha256)throw new Error('Unrecorded schedule source adaptation: '+entry.target)
console.log(JSON.stringify({runtimeJsFiles:files,externalSdkImports:0,legacyOrchestratorDefinitions:0,legacySourceFilesVerified:legacy.files.length,worker:'owned-isolated-esm'}))
