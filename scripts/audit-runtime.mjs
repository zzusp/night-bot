import { readFile, writeFile } from 'node:fs/promises'
const manifest = JSON.parse(await readFile('package.json','utf8'))
const host = await readFile('src/host.js','utf8')
const runtimeDsh = Object.entries(manifest.dependencies).filter(([name])=>name.startsWith('@deepseek-ai/dsh-')).map(([name,version])=>({name,version}))
const pluginRows = [...new Set([...host.matchAll(/row\(['"]([^'"]+)['"]/g)].map(match=>match[1]))].sort()
for (const removed of ['storage','storage-json','storage-domain','agent-default-model','llm-pi-ai','tools','jobs-local']) {
  if (pluginRows.includes(removed)) throw new Error('Removed DSH service is still active: '+removed)
}
for (const forbidden of ['dsh-base','dsh-app-boot','dsh-agent-loop','dsh-storage','dsh-storage-json','dsh-storage-domain','dsh-agent-default-model','dsh-llm-pi-ai','dsh-jobs-local']) {
  if (manifest.dependencies['@deepseek-ai/'+forbidden]) throw new Error('Development/removed service is a production direct dependency: '+forbidden)
}
const report = {
  status:'partial-migration-not-dsh-independent',
  piVersions:Object.fromEntries(Object.entries(manifest.dependencies).filter(([name])=>name.startsWith('@earendil-works/pi-'))),
  unmountedPreparation:[],
  standaloneProcess:true, standaloneFromDshLibraries:false,
  piNative:['agent-core.runAgentLoop iteration','Pi operational tool dispatch without placeholder input','Pi coding-agent SessionManager v3 journal and branch context authority','NativePiProvider: Pi Models.streamSimple, native catalog/auth/retry/discovery/login/event handling'],
  applicationNative:['resident HTTP/DWS bridge','SQLite task/operation/wake/notification ledger','single-document JSON domains and model selection','owner-fenced native background job registry with scoped controllers/events, output ring and awaited teardown','scoped NativeTools admission/dispatch/post-policy/output/audit pipeline','native code transport with ordered nested dispatch, cancellation/drain and one-shot sandbox approval'],
  dshRemaining:['Cordis agent factory/lifecycle compatibility fork','agent and session registries','v4 event validators and persistent inbox compatibility facade','runtime prompt assembly and provider replay','legacy v4 import and writer fencing only','generic llm registry/middleware and GenerateOptions/chunk compatibility bridge; native provider no longer invokes dsh-llm-pi-ai','durable credential record store, neutral authorization service, attachment storage/request-image policy helpers','tool schema/defineTool/codegen helpers and scope/event-carrier compatibility; filesystem/shell tool backends; optional PTC worker backend','filesystem, shell, subprocess/sandbox/permission services','skills, workspace registry, child-agent providers'],
  directRuntimeDshDependencies:runtimeDsh,
  developmentDependencyCount:Object.keys(manifest.devDependencies??{}).length,
  activeLiteralDshPluginRows:pluginRows,
  activeDynamicDshPluginRows:['bash-sandbox or pwsh-sandbox','tool-bash or tool-pwsh'],
  nativeReplacements:['storage/storage-json/storage-domain runtime -> src/native-domain.js + src/native-state.js','agent-default-model/config-editor dependency -> durable native model selection','new session journal/context authority -> Pi SessionManager v3, checksummed commits, native branch retirement; legacy v4 importer/fence remains','llm-pi-ai plugin -> src/native-pi-provider.js and native Pi provider modules; generic DSH LLM and attachment policies remain','jobs-local -> src/native-jobs.js; process execution and durable task receipts remain separate','tools runtime service -> src/native-tools.js + native-code-transport.js; schema/scope helpers and capability backends remain'],
  protocols:{external:['original HTTP JSON routes','DWS CLI JSON'],internalRemaining:['Cordis service/events','DSH Agent/Session interfaces','DSH v4 event facade; legacy v4 import only','DSH LLM GenerateOptions/StreamChunk','DSH tool schema/result/job receipts']},
}
await writeFile('docs/runtime-audit.json',JSON.stringify(report,null,2)+'\n')
console.log(JSON.stringify({status:report.status,directRuntimeDshDependencies:runtimeDsh.length,removedActiveDshServices:7,standaloneFromDshLibraries:false}))
