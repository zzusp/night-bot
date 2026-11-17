import {roleCompactionExtension} from './pi-role-compaction.js'
import {randomUUID} from 'node:crypto'
import {createAgentSession,DefaultResourceLoader,SessionManager,SettingsManager} from '@earendil-works/pi-coding-agent'

const fail=code=>Object.assign(new Error(code),{code})

/** Detached, exact Pi journal snapshot. Never branch or mutate the live manager. */
export function snapshotPiCompaction(manager){
 return structuredClone({header:manager.getHeader(),entries:manager.getEntries(),leafId:manager.getLeafId()})
}

/** Run only Pi's native compactor in an independent in-memory session. The
 * caller owns freshness checks and durable publication of the returned native
 * result. Candidate history is never published as business history. */
export async function compactPiCandidate({snapshot,cwd,agentDir,resolved,settingsManager,signal,role}){
 signal?.throwIfAborted()
 if(!snapshot?.header||!Array.isArray(snapshot.entries)||!resolved?.modelRuntime||!resolved?.model||!settingsManager)throw fail('PI_BACKGROUND_CANDIDATE_INPUT_INVALID')
 const source=structuredClone(snapshot)
 // Provider caches and disposal are keyed by Pi session id. Only entry ids
 // are shared with the snapshot; the candidate must have its own identity.
 const manager=SessionManager.inMemory(cwd,undefined,[{...source.header,id:randomUUID()},...source.entries])
 if(source.leafId!==manager.getLeafId()){
  if(!source.leafId)throw fail('PI_BACKGROUND_CANDIDATE_LEAF_INVALID')
  manager.branch(source.leafId)
 }
 const sourceIds=new Set(manager.getBranch().map(entry=>entry.id))
 // Never reuse foreground extensions: they hold the live business actor and
 // may invoke memory/skill/write callbacks. Compaction needs only its journal.
 const settings=SettingsManager.inMemory({...structuredClone(settingsManager.getSettings()),packages:[],cacheWarming:'off'})
 let session
 const roleExtension=roleCompactionExtension({role,getSession:()=>session})
 const resourceLoader=new DefaultResourceLoader({cwd,agentDir,settingsManager:settings,extensionFactories:roleExtension?[roleExtension]:[],noExtensions:true,disabledBuiltinExtensions:['mcp'],noSkills:true,noPromptTemplates:true,noThemes:true,noContextFiles:true,systemPrompt:'',appendSystemPrompt:[]})
 await resourceLoader.reload();signal?.throwIfAborted()
 ;({session}=await createAgentSession({cwd,agentDir,modelRuntime:resolved.modelRuntime,model:resolved.model,thinkingLevel:resolved.thinkingLevel,settingsManager:settings,resourceLoader,sessionManager:manager,noTools:'all',tools:[],customTools:[]}))
 const abort=()=>session.abortCompaction()
 // compact() first awaits abort(), before installing its cancellation token.
 const unsubscribe=session.subscribe(event=>{if(event.type==='compaction_start'&&signal?.aborted)abort()})
 signal?.addEventListener('abort',abort,{once:true})
 const stream=session.agent.streamFunction
 session.agent.streamFunction=(model,context,options)=>{
  signal?.throwIfAborted()
  const configured=resolved.requestOptions??{}
  const maxTokens=configured.maxTokens===undefined?options?.maxTokens:Math.min(configured.maxTokens,options?.maxTokens??configured.maxTokens)
  return stream(model,context,{...options,...configured,...maxTokens===undefined?{}:{maxTokens},signal:signal?AbortSignal.any([signal,...options?.signal?[options.signal]:[]]):options?.signal})
 }
 try{
  signal?.throwIfAborted()
  const result=await session.compact()
  signal?.throwIfAborted()
  if(result.firstKeptEntryId!==undefined&&!sourceIds.has(result.firstKeptEntryId))throw fail('PI_BACKGROUND_CANDIDATE_FOREIGN_TAIL')
  return structuredClone(result)
 }finally{
  signal?.removeEventListener('abort',abort);unsubscribe();session.dispose()
 }
}
