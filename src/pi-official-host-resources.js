import {officialRetrySettings} from './runtime/pi-official-settings.js'
import {SettingsManager} from '@earendil-works/pi-coding-agent'
import {createHash} from 'node:crypto'
import {isAbsolute,join,dirname,resolve} from 'node:path'
import {lstat,realpath} from 'node:fs/promises'
import {officialInstructionFiles} from './native-agent-instructions.js'
import {officialSkillResources} from './native-tool-skill.js'
import {memoryWriteAuthorization} from './memory/tools.js'
import {scopeOf} from './native-scope.js'
import {inside} from './runtime/paths.js'
import {atomicWrite,privateDirectory,readRegular} from './runtime/files.js'

const fail=code=>{throw Object.assign(new Error(code),{code})}
const hash=value=>createHash('sha256').update(value).digest('hex')
const service=(ctx,name)=>typeof ctx.get==='function'?ctx.get(name):ctx[name]
const routeKeys=['provider','model','reasoningEffort','maxTokens','temperature']
const route=value=>Object.fromEntries(routeKeys.filter(key=>value?.[key]!==undefined).map(key=>[key,value[key]]))
async function safePath(path,{file=false}={}){
 let cursor=resolve(path)
 for(;;){const info=await lstat(cursor).catch(error=>{if(error.code!=='ENOENT')throw error});if(info&&(info.isSymbolicLink()||cursor===path&&file&&(!info.isFile()||info.nlink!==1)||cursor!==path&&!info.isDirectory()))fail('PI_OFFICIAL_RESOURCE_PATH_UNSAFE');const parent=dirname(cursor);if(parent===cursor)break;cursor=parent}
}

/** Host configuration fixes resource and extraction authority. Per-agent options
 * select a primary route, never roots, credential stores or memory permission. */
export function createOfficialHostResourceResolver(ctx,{paths=service(ctx,'runtimePaths'),model,memoryModel=model,privateRoot=paths?.runtime,instructionOptions={},skillRoots=[],maxParallelToolCalls,isLive=actor=>actor.lifecycle?.isLive()===true&&!actor.lifecycle.signal.aborted}={}){
 if(typeof privateRoot!=='string'||!isAbsolute(privateRoot)||typeof isLive!=='function')throw new TypeError('Explicit absolute private resource root and owner lifetime capability required')
 if(!Number.isSafeInteger(maxParallelToolCalls)||maxParallelToolCalls<1)throw new TypeError('Explicit positive maxParallelToolCalls required')
 const roots=[paths?.skills,paths?.agentsHome&&join(paths.agentsHome,'skills'),paths?.harnessHome&&join(paths.harnessHome,'skills'),...skillRoots].filter(Boolean).map(path=>{if(!isAbsolute(path))throw new TypeError('Explicit absolute skill root required');return resolve(path)})
 const primary=structuredClone(route(model)),extraction=structuredClone(route(memoryModel)),instructionsConfig=structuredClone(instructionOptions)
 return async function resolveResources({actor,options={},header,store,mode}){
  if(!actor?.id||actor.session||!actor.ctx||scopeOf(actor.ctx)!==actor||header?.id!==actor.id||!isAbsolute(header?.cwd??''))fail('PI_OFFICIAL_RESOURCE_ACTOR_REQUIRED')
  const actorCtx=actor.ctx,cwd=header.cwd,signal=actor.lifecycle?.signal?AbortSignal.any([actor.lifecycle.signal,...options.signal?[options.signal]:[]]):options.signal
  const assertCurrent=()=>{signal?.throwIfAborted();if(actor.ctx!==actorCtx||scopeOf(actorCtx)!==actor||!isLive(actor))fail('PI_OFFICIAL_RESOURCE_OWNER_CLOSED')}
  const withActor=operation=>{assertCurrent();const agents=service(actorCtx,'agents');if(typeof agents?.withInitiator!=='function')fail('PI_OFFICIAL_RESOURCE_ATTRIBUTION_REQUIRED');return agents.withInitiator(actor,operation)}
  const credentials=service(actorCtx,'credentials'),provider=service(ctx,'nativePiProvider')?.official
  if(!credentials||typeof provider?.resolve!=='function')fail('PI_OFFICIAL_RESOURCE_MODEL_REQUIRED')
  assertCurrent()
  const saved=mode==='resume'?store?.manager?.buildSessionProjection():undefined
  const restored=saved?.model?{provider:saved.model.provider,model:saved.model.modelId}:{}
  const resolved=await provider.resolve({...primary,...restored,...route(options.agentOptions),...signal?{signal}:{}},{credentials})
  assertCurrent()
  const agentDir=join(privateRoot,'pi-agents',hash(actor.id));await safePath(agentDir);await privateDirectory(agentDir);assertCurrent()
  if(!resolved.retrySettings)fail('PI_OFFICIAL_RETRY_SETTINGS_REQUIRED')
  const settingsManager=SettingsManager.inMemory({packages:[],retry:structuredClone(officialRetrySettings(resolved.retrySettings).retry)})
  const registry=service(actorCtx,'tools'),systemPrompt=service(actorCtx,'systemPrompt'),skills=service(actorCtx,'skills'),memory=service(actorCtx,'memory'),fs=service(actorCtx,'fs')
  if(!registry||!systemPrompt||!skills||!fs)fail('PI_OFFICIAL_RESOURCE_SERVICES_REQUIRED')
  async function currentSkill(summary){
   assertCurrent()
   const current=await withActor(()=>skills.get(summary.name,{scope:actor,cwd,signal}))
   assertCurrent()
   if(!current||['name','provider','source','description'].some(key=>current[key]!==summary[key])||summary.path!==undefined&&current.path!==summary.path||['modelInvocable','userInvocable'].some(key=>current.invocation?.[key]!==summary.invocation?.[key])||typeof current.content!=='string')fail('PI_OFFICIAL_SKILL_AUTHORIZATION_CHANGED')
   return current
  }
  async function skillFile(summary){
   const current=await currentSkill(summary)
   if(current.path!==undefined){
    const target=await withActor(()=>fs.resolve(current.path,{signal})),info=await withActor(()=>fs.stat(target,signal))
    if(info?.type!=='file')fail('PI_OFFICIAL_SKILL_FILE_REQUIRED')
    await withActor(()=>fs.readText(target,signal));const path=fs.processPath(target)
    if(typeof path!=='string'||!isAbsolute(path)||![cwd,...roots].some(root=>inside(root,path)))fail('PI_OFFICIAL_SKILL_FILE_REQUIRED')
    await safePath(path,{file:true});if(await realpath(path)!==path)fail('PI_OFFICIAL_RESOURCE_PATH_UNSAFE')
    await currentSkill(summary);return path
   }
   // NativeSkills.get has already traversed the exact scoped provider (including
   // Reflection's current memory catalog/revision). This is opaque authorized
   // provider text, not a new skill renderer or a private memory path mapping.
   const directory=join(agentDir,'skills',hash(current.provider+'\0'+current.name+'\0'+current.content)),path=join(directory,'SKILL.md')
   await safePath(path,{file:true});await privateDirectory(directory)
   const prior=await readRegular(path)
   if(prior!==undefined&&prior!==current.content)fail('PI_OFFICIAL_RESOURCE_CACHE_CONFLICT')
   const verified=await currentSkill(summary)
   if(verified.content!==current.content)fail('PI_OFFICIAL_SKILL_AUTHORIZATION_CHANGED')
   assertCurrent();if(prior===undefined)await atomicWrite(path,current.content)
   await safePath(path,{file:true});const published=await currentSkill(summary);if(published.content!==current.content)fail('PI_OFFICIAL_SKILL_AUTHORIZATION_CHANGED');assertCurrent();return path
  }
  const context={systemPrompt,
   currentDirectory:async current=>{if(current!==actor)fail('PI_OFFICIAL_RESOURCE_ACTOR_REQUIRED');assertCurrent();return service(actorCtx,'workingDirectory').get(actor)},
   instructions:async current=>{if(current!==actor)fail('PI_OFFICIAL_RESOURCE_ACTOR_REQUIRED');assertCurrent();if(!isAbsolute(paths?.agentsHome??'')||!isAbsolute(paths?.harnessHome??''))fail('PI_OFFICIAL_INSTRUCTION_ROOTS_REQUIRED');const currentCwd=service(actorCtx,'workingDirectory').get(actor),discoveredPaths=service(actorCtx,'nativeAgentInstructions')?.officialDiscoveredPaths?.(actor)??[];const result=await withActor(()=>officialInstructionFiles({...instructionsConfig,discoveredPaths,maxBytes:instructionsConfig.maxBytes??65536,cwd:currentCwd,projectRoot:cwd,agentsHome:paths.agentsHome,instructionHome:paths.harnessHome,signal},fs));assertCurrent();return result},
   skills:async current=>{if(current!==actor)fail('PI_OFFICIAL_RESOURCE_ACTOR_REQUIRED');const snapshot=await withActor(()=>skills.snapshot({scope:actor,cwd,signal}));const resources=await officialSkillResources(snapshot,{resolveFilePath:skillFile});assertCurrent();return resources},
   ...memory?{memory:memory.official({authorizeWrite:memoryWriteAuthorization(actorCtx),isLive:current=>current===actor&&isLive(actor),resolveExtractionModel:async(current,{signal:extractionSignal}={})=>{if(current!==actor)fail('PI_OFFICIAL_RESOURCE_ACTOR_REQUIRED');assertCurrent();return provider.resolve({...extraction,...extractionSignal?{signal:extractionSignal}:{}},{credentials})}})}:{},
  }
  return {resolved,settingsManager,agentDir,registry,maxParallelToolCalls,context}
 }
}
