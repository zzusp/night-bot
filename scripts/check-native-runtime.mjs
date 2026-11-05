import {readFile,readdir,access} from 'node:fs/promises'
import {createHash} from 'node:crypto'
import {resolve,dirname} from 'node:path'
const digest=bytes=>createHash('sha256').update(bytes).digest('hex')
const manifest=JSON.parse(await readFile('package.json','utf8'))
if(Object.keys(manifest.dependencies??{}).some(name=>name.startsWith('@deepseek-ai/dsh-')))throw new Error('Registry SDK runtime dependency reintroduced')
// Retired source copies and their differential-only direct dependencies must not
// silently become part of a later install or validation path again.
for(const name of ['dsh-chunked-list','dsh-util-time','dsh-llm-pi-ai','dsh-skill-filesystem','dsh-agent-instructions','dsh-shell-env','dsh-shell','dsh-tool-bash','dsh-tool-pwsh','dsh-launch-environment','dsh-credentials-local','dsh-timeout','dsh-tool-call-timeout-policy','dsh-tool-subagent-control','dsh-fs-sandbox','dsh-fs-observation-policy','dsh-bash-sandbox','dsh-pwsh-sandbox','dsh-brand','dsh-authorization','dsh-workspace','dsh-skill','dsh-sandbox-windows-acl','dsh-typert-protocol','dsh-attachment','dsh-attachment-local'])if(manifest.devDependencies?.['@deepseek-ai/'+name])throw new Error('Retired differential dependency reintroduced: '+name)
for(const path of ['src/native-chunked-list.js','test/fixtures/legacy-subagent-interface.mjs','test/fixtures/legacy-llm-interface.mjs','test/fixtures/legacy-tools-interface.mjs','src/native-typert-protocol.js','src/native-brand.js']){
 try{await access(path)}catch(error){if(error.code==='ENOENT')continue;throw error}
 throw new Error('Retired comparison source reintroduced: '+path)
}
const piLicense=JSON.parse(await readFile('docs/pi-license-source.json','utf8'))
if(digest(await readFile(piLicense.localLicense))!==piLicense.sha256)throw new Error('Pinned Pi license text changed')
for(const name of ['pi-agent-core','pi-ai','pi-coding-agent']){
 const dependency='@earendil-works/'+name,source=piLicense.packages.find(row=>row.name===dependency)
 if(!source||source.version!==manifest.dependencies[dependency])throw new Error('Pi dependency/license provenance mismatch: '+dependency)
}
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
for(const entry of [...legacy.removedHistoricalFormats.files,legacy.removedHistoricalFormats.worker]){try{await access(entry.target)}catch(error){if(error.code==='ENOENT')continue;throw error}throw new Error('Removed historical format source reintroduced: '+entry.target)}
const schedule=JSON.parse(await readFile('docs/schedule-source-manifest.json','utf8'))
for(const entry of schedule.files)if(digest(await readFile(entry.target))!==entry.sha256)throw new Error('Unrecorded schedule source adaptation: '+entry.target)
console.log(JSON.stringify({runtimeJsFiles:files,externalSdkImports:0,legacyOrchestratorDefinitions:0,legacySourceFilesVerified:legacy.files.length,historicalFormatFilesRemoved:legacy.removedHistoricalFormats.files.length+1}))
