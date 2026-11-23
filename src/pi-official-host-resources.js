import {officialRetrySettings,officialRouterCompactionSettings,officialTriageCompactionSettings} from './runtime/pi-official-settings.js'
import {SettingsManager} from '@earendil-works/pi-coding-agent'
import {createHash} from 'node:crypto'
import {isDeepStrictEqual} from 'node:util'
import {isAbsolute,join,dirname,resolve} from 'node:path'
import {lstat,realpath} from 'node:fs/promises'
import {officialInstructionFiles} from './native-agent-instructions.js'
import {readExecutionPrinciples,readRouterPrinciples} from './settings/execution-principles.js'
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
  const scopedService=name=>service(actorCtx,'agentPresets')?.serviceFor?.(actor,name)??service(actorCtx,name)
  const assertCurrent=()=>{signal?.throwIfAborted();if(actor.ctx!==actorCtx||scopeOf(actorCtx)!==actor||!isLive(actor))fail('PI_OFFICIAL_RESOURCE_OWNER_CLOSED')}
  const withActor=operation=>{assertCurrent();const agents=service(actorCtx,'agents');if(typeof agents?.withInitiator!=='function')fail('PI_OFFICIAL_RESOURCE_ATTRIBUTION_REQUIRED');return agents.withInitiator(actor,operation)}
  const credentials=service(actorCtx,'credentials'),provider=service(ctx,'nativePiProvider')?.official
  if(!credentials||typeof provider?.resolve!=='function')fail('PI_OFFICIAL_RESOURCE_MODEL_REQUIRED')
  assertCurrent()
  const saved=mode==='resume'?store?.manager?.buildSessionProjection():undefined
  const restored=saved?.model?{provider:saved.model.provider,model:saved.model.modelId}:{}
  const requested=route(options.agentOptions),defaults={...primary}
  // An explicit route is a complete reasoning selection: omission delegates to
  // Pi/profile defaults, rather than borrowing another route's global effort.
  // On resume Pi restores and clamps its original thinking entry itself.
  if(mode==='resume'||requested.provider!==undefined||requested.model!==undefined)delete defaults.reasoningEffort
  const selected=await provider.resolve({...defaults,...restored,...requested,...signal?{signal}:{}},{credentials})
  const resolved=mode==='resume'&&requested.reasoningEffort===undefined?{...selected,thinkingLevel:undefined}:selected
  assertCurrent()
  const agentDir=join(privateRoot,'pi-agents',hash(actor.id));await safePath(agentDir);await privateDirectory(agentDir);assertCurrent()
  if(!resolved.retrySettings)fail('PI_OFFICIAL_RETRY_SETTINGS_REQUIRED')
  const settingsManager=SettingsManager.inMemory({packages:[],retry:structuredClone(officialRetrySettings(resolved.retrySettings).retry),...(header.runtimeOwner==='conversation-router'?{compaction:officialRouterCompactionSettings(resolved.model,{outputReserveTokens:resolved.requestOptions?.maxTokens})}:header.runtimeOwner==='channel-triage'?{compaction:officialTriageCompactionSettings(resolved.model,{outputReserveTokens:resolved.requestOptions?.maxTokens})}:{})})
  const registry=service(actorCtx,'tools'),systemPrompt=service(actorCtx,'systemPrompt'),skills=service(actorCtx,'skills'),memory=service(actorCtx,'memory'),reflection=service(actorCtx,'reflection')
  // A mounted preset's narrower FS is the resource capability too. If that
  // selection is absent, never retry through a broader inherited filesystem.
  const presets=service(actorCtx,'agentPresets'),fs=typeof presets?.serviceFor==='function'?presets.serviceFor(actor,'fs'):service(actorCtx,'fs')
  if(!registry||!systemPrompt||!skills||!fs)fail('PI_OFFICIAL_RESOURCE_SERVICES_REQUIRED')
  async function readSkillFile(path){
   assertCurrent()
   const target=await withActor(()=>fs.resolve(path,{signal})),info=await withActor(()=>fs.stat(target,signal))
   if(info?.type!=='file')fail('PI_OFFICIAL_SKILL_FILE_REQUIRED')
   const content=await withActor(()=>fs.readText(target,signal)),canonical=fs.processPath(target)
   if(typeof canonical!=='string'||!isAbsolute(canonical)||![cwd,...roots].some(root=>inside(root,canonical)))fail('PI_OFFICIAL_SKILL_FILE_REQUIRED')
   await safePath(canonical,{file:true});if(await realpath(canonical)!==canonical)fail('PI_OFFICIAL_RESOURCE_PATH_UNSAFE')
   assertCurrent();return {content,path:canonical}
  }
  function validateSkill(summary,current){
   if(!current||['name','provider','source','description'].some(key=>current[key]!==summary[key])||summary.path!==undefined&&current.path!==summary.path||['modelInvocable','userInvocable'].some(key=>current.invocation?.[key]!==summary.invocation?.[key])||typeof current.content!=='string')fail('PI_OFFICIAL_SKILL_AUTHORIZATION_CHANGED')
  }
  async function currentSkill(summary,{resource=false}={}){
   assertCurrent()
   let prepared,current
   if(resource&&typeof skills.officialResource==='function'){prepared=await withActor(()=>skills.officialResource(summary.name,{scope:actor,cwd,signal},readSkillFile));current=prepared?.skill}
   else current=await withActor(()=>skills.get(summary.name,{scope:actor,cwd,signal,resourceOnly:true}))
   assertCurrent()
   validateSkill(summary,current)
   return resource?{current,fileValidated:prepared?.fileValidated===true}:current
  }
  async function skillFile(summary){
   const {current,fileValidated}=await currentSkill(summary,{resource:true})
   if(fileValidated)return current.path
   if(current.path!==undefined){
    const target=await withActor(()=>fs.resolve(current.path,{signal})),info=await withActor(()=>fs.stat(target,signal))
    if(info?.type!=='file')fail('PI_OFFICIAL_SKILL_FILE_REQUIRED')
    await withActor(()=>fs.readText(target,signal));const path=fs.processPath(target)
    if(typeof path!=='string'||!isAbsolute(path)||![cwd,...roots].some(root=>inside(root,path)))fail('PI_OFFICIAL_SKILL_FILE_REQUIRED')
    await safePath(path,{file:true});if(await realpath(path)!==path)fail('PI_OFFICIAL_RESOURCE_PATH_UNSAFE')
    await currentSkill(summary);return path
   }
   const file=await prepareSkillCache(current)
   const verified=await currentSkill(summary)
   if(verified.content!==file.content)fail('PI_OFFICIAL_SKILL_AUTHORIZATION_CHANGED')
   await publishSkillCache(file)
   const published=await currentSkill(summary)
   if(published.content!==file.content)fail('PI_OFFICIAL_SKILL_AUTHORIZATION_CHANGED')
   assertCurrent();return file.path
  }
  async function prepareSkillCache({provider,name,content}){
   const directory=join(agentDir,'skills',hash(provider+'\0'+name+'\0'+content)),path=join(directory,'SKILL.md')
   await safePath(path,{file:true});await privateDirectory(directory)
   const prior=await readRegular(path)
   if(prior!==undefined&&prior!==content)fail('PI_OFFICIAL_RESOURCE_CACHE_CONFLICT')
   return {path,content,missing:prior===undefined}
  }
  async function publishSkillCache({path,content,missing}){
   assertCurrent();if(missing)await atomicWrite(path,content)
   await safePath(path,{file:true})
  }
  async function skillResources(current){
   if(current!==actor)fail('PI_OFFICIAL_RESOURCE_ACTOR_REQUIRED')
   // Retrospectives can publish a new shared skill/memory revision between the
   // catalog and body reads, including during Pi's turn_end after a tool ran.
   // Retry only this scoped resource transaction, never the model/tool turn.
   // Each attempt starts from a fresh catalog and retains all authorization,
   // content, filesystem and lifetime checks; revocations cannot reuse old data.
   for(let attempt=0;;attempt++){
    assertCurrent()
    let revision=skills.revision
    try{
     const options={scope:actor,cwd,signal}
     const snapshot=await withActor(()=>skills.snapshot(options));revision=skills.revision
     const readLearned=()=>withActor(()=>reflection.officialResources(skills,options))
     const learned=snapshot.complete&&reflection?await readLearned():new Map(),learnedFiles=[]
     const resources=await officialSkillResources(snapshot,{resolveFilePath:async summary=>{
      if(!learned.has(summary.name))return skillFile(summary)
      assertCurrent();const value=learned.get(summary.name);validateSkill(summary,value)
      const file=await prepareSkillCache(value);learnedFiles.push(file);return file.path
     }})
     if(learnedFiles.length){
      const verifyLearned=async()=>{
       const current=await readLearned()
       if(revision!==skills.revision||!isDeepStrictEqual(current,learned))fail('PI_OFFICIAL_SKILL_AUTHORIZATION_CHANGED')
       assertCurrent()
      }
      // Learned skills share a fresh authorization view per phase. Warm files
      // need no write, but still require the final verification after mapping.
      if(learnedFiles.some(file=>file.missing))await verifyLearned()
      for(const file of learnedFiles)await publishSkillCache(file)
      await verifyLearned()
     }
     // Another parallel mapping may still be reading when a provider is
     // revoked. Do not publish the already mapped part of that old catalog.
     if(revision!==skills.revision)fail('PI_OFFICIAL_SKILL_AUTHORIZATION_CHANGED')
     assertCurrent();return resources
    }catch(error){
     assertCurrent()
     if(error?.code!=='PI_OFFICIAL_SKILL_AUTHORIZATION_CHANGED'||attempt>=2)throw error
     // A concurrent owner may already have invalidated this revision. Repeating
     // that mutation makes two refreshing actors invalidate each other's retries.
     if(revision===skills.revision)skills.invalidateCache()
    }
   }
  }
  const context={systemPrompt,
   currentDirectory:async current=>{if(current!==actor)fail('PI_OFFICIAL_RESOURCE_ACTOR_REQUIRED');assertCurrent();return scopedService('workingDirectory').get(actor)},
   instructions:async current=>{if(current!==actor)fail('PI_OFFICIAL_RESOURCE_ACTOR_REQUIRED');assertCurrent();if(!isAbsolute(paths?.agentsHome??'')||!isAbsolute(paths?.harnessHome??''))fail('PI_OFFICIAL_INSTRUCTION_ROOTS_REQUIRED');const currentCwd=scopedService('workingDirectory').get(actor),discoveredPaths=scopedService('nativeAgentInstructions')?.officialDiscoveredPaths?.(actor)??[];const result=await withActor(()=>officialInstructionFiles({...instructionsConfig,discoveredPaths,maxBytes:instructionsConfig.maxBytes??65536,cwd:currentCwd,projectRoot:cwd,agentsHome:paths.agentsHome,instructionHome:paths.harnessHome,signal},fs));
    if(paths.mode==='portable'&&header.agentPreset==='night-bot-task'){
     const {text}=await readExecutionPrinciples(paths);if(text.trim())result.push({path:'night-bot://execution/AGENTS.md',content:text})
    }
    assertCurrent();return result},
   ...paths.mode==='portable'&&header.runtimeOwner==='conversation-router'?{runInstructions:async current=>{
    if(current!==actor)fail('PI_OFFICIAL_RESOURCE_ACTOR_REQUIRED');assertCurrent()
    const {text}=await readRouterPrinciples(paths);assertCurrent()
    return text.trim()?[{path:'night-bot://router/AGENTS.md',content:text}]:[]
   }}:{},
   skills:skillResources,
   ...memory?{memory:memory.official({authorizeWrite:memoryWriteAuthorization(actorCtx),isLive:current=>current===actor&&isLive(actor),resolveExtractionModel:async(current,{signal:extractionSignal}={})=>{if(current!==actor)fail('PI_OFFICIAL_RESOURCE_ACTOR_REQUIRED');assertCurrent();return provider.resolve({...extraction,...extractionSignal?{signal:extractionSignal}:{}},{credentials})}})}:{},
  }
  return {resolved,settingsManager,agentDir,registry,maxParallelToolCalls,context}
 }
}
