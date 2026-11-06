import {readFile,readdir,writeFile,access} from 'node:fs/promises'
import {createHash} from 'node:crypto'
import {execFileSync} from 'node:child_process'
import {parse} from 'yaml'

const manifest=JSON.parse(await readFile('package.json','utf8'))
const lock=parse(await readFile('pnpm-lock.yaml','utf8'))
const workspace=parse(await readFile('pnpm-workspace.yaml','utf8'))
const source=JSON.parse(await readFile('docs/source-manifest.json','utf8'))
const isDsh=name=>name.startsWith('@deepseek-ai/dsh-')
const declarations=section=>Object.entries(manifest[section]??{}).filter(([name])=>isDsh(name)).map(([name,version])=>({name,version}))
const productionDsh=declarations('dependencies'),developmentDsh=declarations('devDependencies')
const lockedDsh=[...new Set([...Object.keys(lock.packages??{}),...Object.keys(lock.snapshots??{})].filter(isDsh))]
if(productionDsh.length||developmentDsh.length||lockedDsh.length)throw new Error('External DSH package reintroduced')
const host=await readFile('src/host.js','utf8')
if(!host.includes("new URL('./pi-official-runtime.js'")||host.includes("new URL('./native-sessions.js'"))throw new Error('Official default session authority changed')
const modules=[],externalImports=[]
async function walk(directory){for(const entry of await readdir(directory,{withFileTypes:true})){const path=directory+'/'+entry.name;if(entry.isDirectory())await walk(path);else if(entry.isFile()&&/\.(?:js|mjs|cjs)$/.test(path)){modules.push(path);const text=await readFile(path,'utf8');for(const match of text.matchAll(/(?:\bfrom\s*|\bimport\s*\(\s*|\bcreateLazyRequire\s*\(\s*|\bimport\.meta\.resolve\s*\(\s*|\brequire\s*\(\s*)['"](@deepseek-ai\/dsh-[^'"]+)['"]/g))externalImports.push({path,specifier:match[1]})}}}
for(const directory of ['src','bin','packages/dingtalk-core','packages/scope-compat','packages/capability-compat'])await walk(directory)
if(externalImports.length)throw new Error('External DSH runtime import reintroduced')
const retainedAliases=Object.entries(workspace.overrides??{}).filter(([name])=>isDsh(name)).map(([name,target])=>({name,target}))
for(const {target}of retainedAliases){if(!target.startsWith('link:./packages/'))throw new Error('Unsupported namespace override');await access(target.slice(5)+'/package.json')}
const retainedNotices=(await readdir('licenses')).filter(name=>name.startsWith('dsh-')).sort()
let checkpoint
try{checkpoint=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim()}catch{checkpoint=null}
const fingerprint=createHash('sha256');for(const path of [...modules,'package.json','pnpm-lock.yaml','pnpm-workspace.yaml'].sort())fingerprint.update(path+'\0').update(await readFile(path))
const workingTreeDirty=!!execFileSync('git',['status','--porcelain','--untracked-files=no'],{encoding:'utf8'}).trim()
const report={schema:2,sourceFingerprint:fingerprint.digest('hex'),workingTreeDirty,status:'official-pi-default-with-retained-derived-source',checkpoint,completeDshSourceRemoval:false,
 dependencies:{productionDsh,developmentDsh,lockedDsh},runtime:{modules:modules.length,externalDshImports:externalImports},
 authority:{sdk:'@earendil-works/pi-coding-agent',version:manifest.dependencies['@earendil-works/pi-coding-agent'],session:'public AgentSession and SessionManager',metadata:'read-only application session catalog',business:'Night authorization, queues, task state and effect receipts'},
 sourceAccounting:{retained:source.files.filter(row=>!['excluded-ui','retired-driver'].includes(row.status)).length,retired:source.files.filter(row=>row.status==='retired-driver').map(row=>({source:row.source,evidence:row.retirementEvidence})),excludedUi:source.files.filter(row=>row.status==='excluded-ui').length},
 retainedNamespaceOverrides:retainedAliases,retainedDshNoticeFiles:retainedNotices,
 limits:['Zero external packages does not imply zero copied or derived implementation. Retained code and test copies require their notices.','Mutable Session, projection/query drivers and historical-data import are retired; attributed platform/policy implementations and local namespace aliases remain.','Effectful codemode stays disabled: official nested summaries are post-execution and bounded; abort/idle does not join host tools.','Windows kernel isolation and real vendor integration require separate verification.'],
 evidence:['docs/retired-notice-copy-audit.json','docs/NODE-RPC-RETIREMENT.md','docs/retired-session-drivers.md','docs/FS-IO-MIGRATION.md','docs/SEARCH-IO-MIGRATION.md','docs/acceptance/pi-native-retirement-local/goal.md']}
await writeFile('docs/runtime-audit.json',JSON.stringify(report,null,2)+'\n')
console.log(JSON.stringify({status:report.status,productionDsh:productionDsh.length,developmentDsh:developmentDsh.length,lockedDsh:lockedDsh.length,runtimeModules:modules.length,retainedNotices:retainedNotices.length,completeDshSourceRemoval:false}))
