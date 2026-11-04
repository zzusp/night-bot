import { readFile, writeFile } from 'node:fs/promises'
const manifest = JSON.parse(await readFile('package.json','utf8'))
const host = await readFile('src/host.js','utf8')
const runtimeDsh = Object.entries(manifest.dependencies).filter(([name])=>name.startsWith('@deepseek-ai/dsh-')).map(([name,version])=>({name,version}))
const pluginRows = [...new Set([...host.matchAll(/row\(['"]([^'"]+)['"]/g)].map(match=>match[1]))].sort()
for (const removed of ['storage','storage-json','storage-domain','agent-default-model']) {
  if (pluginRows.includes(removed)) throw new Error('Removed DSH service is still active: '+removed)
}
for (const forbidden of ['dsh-base','dsh-app-boot','dsh-agent-loop','dsh-storage','dsh-storage-json','dsh-storage-domain','dsh-agent-default-model']) {
  if (manifest.dependencies['@deepseek-ai/'+forbidden]) throw new Error('Development/removed service is a production direct dependency: '+forbidden)
}
const report = {
  status:'partial-migration-not-dsh-independent',
  standaloneProcess:true, standaloneFromDshLibraries:false,
  piNative:['agent-core.runAgentLoop iteration','Pi operational tool dispatch','Pi event-stream envelope; provider internally also uses Pi AI'],
  applicationNative:['resident HTTP/DWS bridge','SQLite task/operation/wake/notification ledger','single-document JSON domains and model selection'],
  dshRemaining:['Cordis agent factory/lifecycle compatibility fork','agent and session registries','v4 session journal and persistent inbox','session projections, context assembly and provider replay','llm request/chunk seam and llm-pi-ai provider','credentials, authorization, attachments','tools validation/guards/output/scheduler','filesystem, shell, subprocess/jobs/sandbox/permission services','skills, workspace registry, child-agent providers'],
  directRuntimeDshDependencies:runtimeDsh,
  developmentDependencyCount:Object.keys(manifest.devDependencies??{}).length,
  activeLiteralDshPluginRows:pluginRows,
  activeDynamicDshPluginRows:['bash-sandbox or pwsh-sandbox','tool-bash or tool-pwsh'],
  nativeReplacements:['storage/storage-json/storage-domain runtime -> src/native-domain.js + src/native-state.js','agent-default-model/config-editor dependency -> durable native model selection'],
  protocols:{external:['original HTTP JSON routes','DWS CLI JSON'],internalRemaining:['Cordis service/events','DSH Agent/Session interfaces','DSH session v4 JSONL','DSH LLM GenerateOptions/StreamChunk','DSH tool schema/result/job receipts']},
}
await writeFile('docs/runtime-audit.json',JSON.stringify(report,null,2)+'\n')
console.log(JSON.stringify({status:report.status,directRuntimeDshDependencies:runtimeDsh.length,removedActiveDshServices:4,standaloneFromDshLibraries:false}))
