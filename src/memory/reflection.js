import {reflectionAdmission,admitReflectionLessons,confirmedAdmissionRevision,ADMISSION_PROMPT} from './reflection-admission.js'
import {MemoryMaintenance} from './maintenance.js'
import {learningCoverage} from './learning-coverage.js'
import {contentSnapshot} from './previous.js'
import {learnedSkillSupported} from './evolution.js'
import {generateLearnedSkill,loadBundledCreator} from './skill-generation.js'
import {isDeepStrictEqual} from 'node:util'
import {officialReflectionText,reflectionInputFits} from './reflection-inference.js'
import {reflectionInput} from './reflection-input.js'
import {assignReflectionMemoryKeys,reflectionMemoryKey,reviewMemoryKeys,reviewLessonMemoryKey,reflectionRetrySupported} from './reflection-keys.js'
import {Service} from '@deepseek-ai/cordis'
import {join} from 'node:path'
import {rm} from 'node:fs/promises'
import {bindingSchema,memoryScope,readableScopes} from './scope.js'
import {checkedText,checkedTextWithLimit,hash,renderMemoryContent} from './format.js'
import {atomicWrite,readRegular,withLock,failure,privateDirectory} from '../runtime/files.js'
const validKey=value=>typeof value==='string'&&/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value)&&value.length<=60
const brief=value=>checkedText(String(value??'').slice(0,1800))
// Only a known pre-effect CAS conflict can release a reserved plan. Interrupted
// or partially applied plans keep their original keys and receipt checks.
function staleUnappliedPlan(review){
  return ['MEMORY_SCOPE_CHANGED','REFLECTION_REVISION_CONFLICT'].includes(review?.code)&&!review.forgotten&&review.lessons?.length&&review.lessons.every(lesson=>lesson.admission&&!lesson.applied&&!lesson.skillsSnapshot&&(lesson.memoryWrite===undefined||lesson.memoryWrite==='not-applied'))
}
/** 任务完成后的无工具复盘；任务账本仍是权威，完成不代表渠道已送达。 */
export default class Reflection extends Service {
  static inject=['memory','skills','agents','nativePiProvider','runtimePaths']
  constructor(ctx,config={}){
    super(ctx,'reflection');this.host=ctx;this.config=config;this.jobs=new Set();this.sources=new Set();this.abort=new AbortController();this.closed=false;this.lastError=null
    this.maintenance=new MemoryMaintenance(this,config.maintenance??{},config.maintenanceModel)
    const provider={name:'learned',list:async options=>({candidates:await this.catalog(options?.scope),complete:!!options?.scope||!this.host.agents.currentInitiator()}),get:async(candidate,options)=>this.skill(candidate,options?.scope,{resourceOnly:options?.resourceOnly===true})}
    ctx.skills.registerProvider(()=>provider)
    this.officialResources=(skills,options)=>this.readOfficialResources(provider,skills,options)
    ctx.effect(()=>async()=>{this.closed=true;this.abort.abort();await this.maintenance.stop();await this.whenIdle()},'reflection drain')
  }
  async [Service.init](){
    await this.host.memory.bindingReady
    const scope=memoryScope({actorId:'host'}),state=await this.state(scope),entries=await this.supportEntries(scope,state),revision=(await this.host.memory.store.index(scope)).revision
    const renamed=new Set(Object.values(state.mutations??{}).filter(row=>validKey(row.key)&&validKey(row.newKey)&&row.newKey!==row.key&&!state.skills[row.key]).map(row=>row.key))
    if(renamed.size){const skills=join(this.directory(scope),'skills');await privateDirectory(skills);for(const key of renamed)await rm(join(skills,key),{recursive:true,force:true})}
    for(const [key,value]of Object.entries(state.skills))if(value.active&&validKey(key)&&learnedSkillSupported(value,entries))await atomicWrite(join(this.directory(scope),'skills',key,'SKILL.md'),this.renderSkill(scope,key,value,revision))
  }
  attachStore(store,{ownerActorId,model,credentials,onReview,responsibilityFor}={}){
    if(this.config.enabled===false)return
    const source={store,ownerActorId,model,credentials,onReview,responsibilityFor,after:0,pending:new Map(),archivePending:new Map()};this.sources.add(source);void this.scanSource(source)
    return ()=>this.sources.delete(source)
  }
  scan(){for(const source of this.sources)void this.scanSource(source)}
  scanSource(source){
    if(this.closed)return source.scanning
    source.scanRequested=true;if(source.scanning)return source.scanning
    const job=this.host.agents.withoutInitiator(async()=>{
      do{source.scanRequested=false;let page
      for(const [id,{scope,report}]of source.archivePending??[]){if(this.closed)return;if(await this.archiveReview(source,report.taskId,report,scope))source.archivePending.delete(id)}
      for(const [id,event]of source.pending){if(this.closed)return;if(await this.review(source,event))source.pending.delete(id)}
      do{page=await source.store.query({kind:'task.events',after:source.after,limit:100});for(const event of page.events){
        if(this.closed)return
        if(event.kind==='task.completed'){source.pending.set(event.id,event);if(await this.review(source,event))source.pending.delete(event.id)}
      }source.after=page.nextCursor}while(page.hasMore&&!this.closed)
      }while(source.scanRequested&&!this.closed)
    }).catch(error=>{this.lastError=error.code??'REFLECTION_SCAN_FAILED';this.host.logger.warn('reflection: '+this.lastError)}).finally(()=>{source.scanning=undefined;this.jobs.delete(job);if(source.scanRequested&&!this.closed&&this.sources.has(source))void this.scanSource(source)})
    source.scanning=job;this.jobs.add(job);return job
  }
  async state(scope){return this.host.memory.store.locked(scope,async()=>JSON.parse(await readRegular(join(this.directory(scope),'state.json'))??'{"version":1,"reviews":{},"skills":{}}'))}
  directory(scope){return join(this.host.memory.store.directory(scope),'evolution')}
  async review(source,event){
    const task=await source.store.query({kind:'task.get',taskId:event.taskId})
    if(!task||task.archiveRestore?.reviewRequired||task.archiveRestore?.completionEventIds?.includes(event.id)||typeof source.ownerActorId!=='string')return true
    const binding={actorId:task.ownerActorId??source.ownerActorId,...task.groupId&&task.metadata?.channelType!=='chat'?{groupId:task.metadata?.memoryGroupId??task.groupId,groupWrite:true}:{}}
    const scope=memoryScope(binding,{scope:binding.groupId?'group':'personal'},true),directory=this.directory(scope),id=hash(event.id)
    // Serialize this event, not the whole memory scope, during tool-free inference.
    // The shared evolution lock remains mandatory for every publication below.
    return withLock(join(directory,'review-locks',id),async()=>{
      const initial=await this.state(scope),previous=initial.reviews[id]
      // Old failures may already have effects without durable key/write receipts.
      // Preserve them for audit, but never infer again or replay them under new names.
      if(previous&&(previous.status==='done'||previous.status==='skipped'||!reflectionRetrySupported(previous)))return this.archiveReview(source,task.taskId,previous,scope)
      if(previous?.attempts>=3)return this.archiveReview(source,task.taskId,previous,scope)
      if(previous?.retryAt>Date.now())return false
      const attempts=(previous?.attempts??0)+1,generation=initial.forgetGeneration??0
      const refresh=previous?.forgetGeneration!==undefined&&staleUnappliedPlan(previous)
      const revoked=previous?.forgetGeneration!==undefined&&previous.forgetGeneration!==generation&&(refresh||previous.lessons===undefined)
      const forgetGeneration=previous?previous.forgetGeneration:generation
      let inputRecord=previous?.input,input,snapshot,lessons=refresh?undefined:structuredClone(previous?.lessons),preparationError
      const signal=this.abort.signal
      if(!revoked)try{
        const executions=await source.store.query({kind:'execution.list',taskId:task.taskId}),operations=await source.store.query({kind:'operation.list',taskId:task.taskId})
        input=reflectionInput(task,event,executions,operations);const known=new Set(input.facts.map(f=>f.id))
        if(!lessons)inputRecord={sha256:hash(JSON.stringify(input)),coverage:input.coverage}
        snapshot=await this.host.memory.store.index(scope,{topic:'experience',includeExpired:true})
        if(!lessons){
          const official=this.host.get('nativePiProvider')?.official
          if(typeof official?.resolve!=='function')throw failure('REFLECTION_OFFICIAL_MODEL_REQUIRED')
          const resolved=await official.resolve({...source.model,signal:AbortSignal.any([signal,AbortSignal.timeout(30000)])},source.credentials===undefined?undefined:{credentials:source.credentials})
          // The configured Pi provider already bounds idle streams. A fixed
          // total deadline here also aborts healthy, progressing inference.
          // Drop only this event's proven-unused reservations for fresh admission.
          const admissionState=refresh?{...initial,reviews:Object.fromEntries(Object.entries(initial.reviews).filter(([key])=>key!==id))}:initial
          const admission=await reflectionAdmission(this,scope,admissionState,input,(value,instructions)=>officialReflectionText(resolved,value,{signal,groupResponsibility:source.responsibilityFor?.(task.groupId)??'',instructions:instructions??ADMISSION_PROMPT}),{fits:reflectionInputFits(resolved,source.responsibilityFor?.(task.groupId)??'')})
          snapshot=admission.index
          const output=JSON.parse(admission.raw)
          output.lessons=admitReflectionLessons(output,admission)
          const keys=new Set()
          lessons=output.lessons.map(lesson=>{
            if(!Array.isArray(lesson.evidenceIds)||!lesson.evidenceIds.length||lesson.evidenceIds.some(e=>!known.has(e)))throw failure('REFLECTION_EVIDENCE_INVALID')
            if(!validKey(lesson.memoryKey))throw failure('REFLECTION_MEMORY_KEY_INVALID')
            if(lesson.skill&&!validKey(lesson.key))throw failure('REFLECTION_SKILL_KEY_INVALID')
            if(keys.has(lesson.key))throw failure('REFLECTION_DUPLICATE_KEY');keys.add(lesson.key)
            const value={...lesson.admission?{memoryKey:lesson.memoryKey,admission:lesson.admission,reuseCue:lesson.reuseCue}:{},key:lesson.key,summary:checkedText(lesson.summary),why:checkedText(lesson.why),howToApply:checkedText(lesson.howToApply),evidenceIds:lesson.evidenceIds}
            if(lesson.skill?.evidenceBacked===true&&typeof lesson.skill.applicability==='string'&&lesson.skill.applicability.trim()&&lesson.skill.applicability!=='Not established'){
              const guidance=lesson.skill.guidance??(Array.isArray(lesson.skill.steps)?lesson.skill.steps.join(String.fromCharCode(10)):undefined)
              value.skill={guidance:checkedTextWithLimit(guidance,12000),reason:brief(lesson.skill.reason),applicability:brief(lesson.skill.applicability),evidenceBacked:true}
            }return value
          })
        }
        for(const lesson of lessons){
          if(!lesson.skill||lesson.applied||lesson.generated)continue
          const prior=initial.skills[lesson.key]
          if(prior?.origin==='router'||prior?.source)throw failure('REFLECTION_ADMISSION_TARGET_FORBIDDEN')
          // 候选与原始证据交给实际 creator；慢生成不占用共享发布锁。
          lesson.generated=await this.generateSkill({key:lesson.key,candidate:lesson.skill,reuse:lesson.admission?.skill,evidence:input,source:{eventId:event.id,taskId:task.taskId},previous:prior?{body:prior.body,steps:prior.steps,applicability:prior.applicability,revision:prior.revision}:null},{model:source.model,credentials:source.credentials,signal:this.abort.signal})
          lesson.generated.expectedRevision=prior?.revision??initial.skillRevisions?.[lesson.key]??0
        }
      }catch(error){preparationError=error}
      const report=await withLock(join(directory,'.lock'),async()=>{
        const state=await this.state(scope)
        // Forgetting or another committed review must not be overwritten by a
        // result prepared against older review state. Retry from current state.
        if(JSON.stringify(state.reviews[id])!==JSON.stringify(previous))return null
        if(revoked||(state.forgetGeneration??0)!==generation){
          const revoked={memoryKeyVersion:1,input:inputRecord,status:'skipped',code:'REFLECTION_SCOPE_REVOKED',attempts,eventId:event.id,taskId:task.taskId,recordedAt:new Date().toISOString(),lessons:[],destinations:[]}
          state.reviews[id]=revoked
          await atomicWrite(join(directory,'reviews',id+'.json'),JSON.stringify(revoked,null,2)+'\n')
          await atomicWrite(join(directory,'state.json'),JSON.stringify(state,null,2)+'\n');return revoked
        }
        try{
        if(preparationError)throw preparationError
        if(lessons?.[0]?.admission&&lessons.some(lesson=>!lesson.applied)){
          const last=lessons.filter(lesson=>lesson.memoryWrite==='committed'&&lesson.memoryScopeRevision!==undefined).at(-1)
          const expectedScope=!refresh&&previous?.lessons?await confirmedAdmissionRevision(this.host.memory.store,scope,task,event,lessons):lessons[0].admission.scopeRevision
          if(snapshot.revision!==expectedScope)throw failure('MEMORY_SCOPE_CHANGED')
          if(hash(JSON.stringify(state.skills))!==(last?.skillsSnapshot??lessons[0].admission.skillsHash))throw failure('REFLECTION_REVISION_CONFLICT')
        }
        if(lessons)lessons=assignReflectionMemoryKeys(lessons,snapshot?.entries??[],Object.fromEntries(Object.entries(state.reviews).filter(([key])=>key!==id)))
        signal.throwIfAborted()
        let scopeRevision=snapshot.revision
        // Commit key reservations before any memory/skill effects so retries use
        // the same receipt identity even after a crash or an intervening forget.
        state.reviews[id]={memoryKeyVersion:1,forgetGeneration,input:inputRecord,status:'failed',code:'REFLECTION_WRITE_PENDING',attempts,eventId:event.id,taskId:task.taskId,lessons}
        await atomicWrite(join(directory,'state.json'),JSON.stringify(state,null,2)+'\n')
        for(const lesson of lessons){
          signal.throwIfAborted()
          if(lesson.applied){if(lesson.skill)await this.publishSkill(scope,lesson.key,state);continue}
          if(lesson.skill&&(state.skills[lesson.key]?.revision??state.skillRevisions?.[lesson.key]??0)!==lesson.generated.expectedRevision){delete lesson.generated;throw failure('REFLECTION_REVISION_CONFLICT')}
          const memoryKey=reflectionMemoryKey(lesson)
          const priorMemory=lesson.admission?.memory.action==='update'?(await this.host.memory.store.read(scope,{topic:'experience',key:memoryKey,includeSources:true})).entries[0]:undefined
          if(priorMemory&&(!priorMemory.provenance?.taskId||priorMemory.context||priorMemory.id!==lesson.admission.expectedMemoryId))throw failure('REFLECTION_ADMISSION_TARGET_FORBIDDEN')
          const previousWrite=lesson.memoryWrite
          lesson.memoryWrite='uncertain'
          await atomicWrite(join(directory,'state.json'),JSON.stringify(state,null,2)+'\n')
          let result
          const content={summary:lesson.summary,why:lesson.why,howToApply:lesson.howToApply,reuseCue:lesson.reuseCue}
          try{result=await this.host.memory.store.remember(scope,{scopeRevision,expectedRevision:lesson.admission?.memory.expectedRevision??0,topic:'experience',key:memoryKey,text:renderMemoryContent(content),content,source:{sessionId:task.sessionId??task.taskId,messageId:event.id,quoteSha256:hash(JSON.stringify(input.facts))},...priorMemory?{originSource:priorMemory.originSource??priorMemory.source}:{},provenance:this.host.memory.provenance({task}),...(lesson.admission?.memory.action==='update'?{validate:async()=>{const prior=snapshot.entries.find(e=>e.topic==='experience'&&e.key===memoryKey);if(!prior||prior.id!==lesson.admission.expectedMemoryId)throw failure('REFLECTION_ADMISSION_TARGET_FORBIDDEN')}}:{})})}
          catch(error){if(!['committed','uncertain'].includes(previousWrite)&&['MEMORY_SCOPE_CHANGED','MEMORY_REVISION_CONFLICT'].includes(error.code))lesson.memoryWrite='not-applied';throw error}
          if(!result.ok)continue
          lesson.memoryWrite='committed'
          lesson.memoryScopeRevision=result.revision
          scopeRevision=result.revision
          // A deduplicated receipt must not revive a forgotten or replaced skill.
          const saved=(await this.host.memory.store.read(scope,{topic:'experience',key:memoryKey})).entries[0]
          if(saved?.source?.messageId!==event.id||saved.source.sessionId!==(task.sessionId??task.taskId))continue
          if(lesson.skill){
            const signature=hash(JSON.stringify(lesson.skill.guidance??lesson.skill.steps)),prior=state.skills[lesson.key]
            const observations=[...new Set([...(prior?.taskIds??[]),task.taskId])]
            // Repeated completions/versions of the same task do not count twice.
            const active=lesson.skill.evidenceBacked&&lesson.skill.applicability!=='Not established'&&(prior?.active||Object.values(state.skills).filter(s=>s.active).length<20)
            const supports=[...new Map([...(prior?.supports??[]),{taskId:task.taskId,memoryKey}].map(row=>[JSON.stringify(row),row])).values()].slice(-40)
            const skill={signature,supports,...prior?.origin?{origin:prior.origin}:{},taskIds:observations.slice(-20),memoryKeys:[...new Set([...(prior?.memoryKeys??[]),memoryKey])],active,...lesson.skill.guidance?{guidance:lesson.skill.guidance}:{steps:lesson.skill.steps},reason:lesson.skill.reason,applicability:lesson.generated.description,body:lesson.generated.body,generation:lesson.generated.generation,revision:Math.max(prior?.revision??0,state.skillRevisions?.[lesson.key]??0)+1,updatedAt:new Date().toISOString()}
            if(prior)skill.previous=contentSnapshot(this.renderSkill(scope,lesson.key,prior,scopeRevision).replace(/^NIGHT_LEARNED_SCOPE=[^\n]*\n?/gm,''),prior.revision,prior.updatedAt)
            state.skills[lesson.key]=skill;state.skillRevisions??={};state.skillRevisions[lesson.key]=skill.revision
          }
          // Commit authoritative skill state before publishing its derived file.
          // Retries repair the current file, never replay over later Router edits.
          lesson.applied=true
          if(lesson.admission)lesson.skillsSnapshot=hash(JSON.stringify(state.skills))
          await atomicWrite(join(directory,'state.json'),JSON.stringify(state,null,2)+'\n')
          if(lesson.skill)await this.publishSkill(scope,lesson.key,state)
        }
        state.reviews[id]={memoryKeyVersion:1,input:inputRecord,status:lessons.length?'done':'skipped',attempts,eventId:event.id,taskId:task.taskId,recordedAt:new Date().toISOString(),lessons}
        this.host.skills.invalidateCache()
      }catch(error){const code=typeof error.code==='string'?error.code:error.name==='TimeoutError'?'REFLECTION_MODEL_TIMEOUT':'REFLECTION_MODEL_FAILED';state.reviews[id]={...state.reviews[id],lessons,memoryKeyVersion:1,forgetGeneration,input:inputRecord,status:'failed',attempts,eventId:event.id,taskId:task.taskId,code,retryAt:Date.now()+30000};this.lastError=code;this.host.logger.warn('reflection: '+code)}
      const report={...state.reviews[id],destinations:(state.reviews[id].lessons??[]).map(lesson=>({memory:{scope,topic:'experience',key:reflectionMemoryKey(lesson)},...lesson.skill&&state.skills[lesson.key]?.active?{skill:{scope,key:lesson.key,revision:state.skills[lesson.key].revision}}:{}}))};state.reviews[id]=report;await atomicWrite(join(directory,'reviews',id+'.json'),JSON.stringify(report,null,2)+'\n');await atomicWrite(join(directory,'state.json'),JSON.stringify(state,null,2)+'\n');return report
      })
      if(!report)return false
      if(report.status==='done')this.maintenance.notify({topic:'experience'})
      const archived=await this.archiveReview(source,task.taskId,report,scope)
      return archived&&(report.status==='done'||report.status==='skipped'||report.attempts>=3)
    })
  }
  async publishReviewArchive(source,taskId,report,scope){
    if(!source.onReview)return
    // Archive callbacks may be slow. Serialize them separately and reread the
    // authoritative report so a concurrent forget never publishes stale bodies.
    await withLock(join(this.directory(scope),'archive-locks',hash(report.eventId)),async()=>{
      const current=(await this.state(scope)).reviews[hash(report.eventId)]
      if(current)await source.onReview(taskId,current)
    })
  }
  async archiveReview(source,taskId,report,scope){
    try{await this.publishReviewArchive(source,taskId,report,scope);return true}
    catch(error){this.lastError=error.code??'TASK_REVIEW_ARCHIVE_FAILED';this.host.logger.warn(this.lastError);return false}
  }
  renderSkill(scope,key,value){
    return ['---','name: learned-'+key,'description: '+JSON.stringify(value.applicability),'---',
      this.skillMarker(scope,key,value),'',
      ...value.origin==='router'?['Source message: '+value.source.messageId]:[],'',
      ...value.body!==undefined?[value.body]:value.guidance!==undefined?[value.guidance]:value.steps.map((step,i)=>(i+1)+'. '+step),''].join('\n')
  }
  skillMarker(scope,key,value){
    // Shared memory revisions change for unrelated tasks. Bind history to this
    // skill's own version AND rendered content instead, including its identity.
    const fingerprint=hash(JSON.stringify([scope.kind,scope.id,key,value.revision,value.applicability,value.origin??null,value.source??null,value.body??value.guidance??null,value.steps??null]))
    return 'NIGHT_LEARNED_SCOPE='+scope.kind+'/'+scope.id+';revision='+value.revision+';key='+key+';fingerprint='+fingerprint
  }
  async skillHistorySelection(scope,markers){
    const keys=new Map()
    for(const marker of markers){
      const match=marker.match(/^NIGHT_LEARNED_SCOPE=[^;]+;revision=\d+;key=([a-z0-9]+(?:-[a-z0-9]+)*);fingerprint=[a-f0-9]+$/)
      if(match&&validKey(match[1]))keys.set(marker,match[1])
    }
    if(!keys.size)return {keys,entries:[]}
    const state=await this.state(scope)
    for(const [marker,key] of keys){
      const value=state.skills[key]
      if(!value?.active||this.skillMarker(scope,key,value)!==marker)keys.delete(marker)
    }
    if(!keys.size)return {keys,entries:[]}
    const entries=await this.supportEntries(scope,state)
    for(const [marker,key] of keys)if(!learnedSkillSupported(state.skills[key],entries))keys.delete(marker)
    return {keys,entries}
  }
  async authorizesSkillHistory(scope,marker){
    return (await this.skillHistorySelection(scope,[marker])).keys.has(marker)
  }
  skillFromHistorySnapshot(scope, marker, key, state, support) {
    if(!validKey(key)||!Object.hasOwn(state?.skills??{},key))return
    const value=state.skills[key]
    if(value?.active===true&&this.skillMarker(scope,key,value)===marker&&learnedSkillSupported(value,support))return value
  }
  async readSkills(scope,{key}={}){
    if(key!==undefined&&!validKey(key))throw failure('REFLECTION_SKILL_INVALID')
    const state=await this.state(scope),entries=await this.supportEntries(scope,state)
    return {...key!==undefined?{revision:state.skills[key]?.revision??state.skillRevisions?.[key]??0}:{},entries:Object.entries(state.skills).filter(([name])=>key===undefined||name===key).map(([name,value])=>({key:name,name:'learned-'+name,revision:value.revision,active:value.active&&learnedSkillSupported(value,entries),origin:value.origin??'task-reflection',source:value.source??null,applicability:value.applicability,...key!==undefined?{steps:value.steps,...value.guidance?{guidance:value.guidance}:{},reason:value.reason,...value.body!==undefined?{body:value.body}:{},...value.generation?{generation:value.generation}:{}}:{}}))}
  }
  async publishSkill(scope,key,state){
    const directory=this.directory(scope),value=state.skills[key],generation=(await this.host.memory.store.index(scope)).revision
    await privateDirectory(join(directory,'skills'))
    const path=join(directory,'skills',key,'SKILL.md')
    if(value?.active)await atomicWrite(path,this.renderSkill(scope,key,value,generation))
    else await rm(join(directory,'skills',key),{recursive:true,force:true})
    if(await readRegular(path)!==(value?.active?this.renderSkill(scope,key,value,generation):undefined))throw failure('REFLECTION_WRITE_UNCONFIRMED')
  }
  creator(){return loadBundledCreator()}
  async generateSkill(input,{model,credentials,signal}={}){
    const official=this.host.get('nativePiProvider')?.official
    if(typeof official?.resolve!=='function')throw failure('REFLECTION_OFFICIAL_MODEL_REQUIRED')
    signal=AbortSignal.any([signal,this.abort?.signal].filter(Boolean))
    const resolved=await official.resolve({...model??this.host.get('agentDefaultModel')?.currentSelection(),signal},credentials===undefined?undefined:{credentials})
    return generateLearnedSkill(resolved,input,{signal,loadCreator:()=>this.creator()})
  }
  async mutateSkill(scope,args){
    const {action,key,source,operationId}=args
    const {newKey,description,body}=args,patch=[newKey,description,body].some(field=>field!==undefined),targetKey=newKey??key
    if(!['upsert','delete'].includes(action)||!validKey(key)||typeof operationId!=='string'||!operationId.trim()||!validKey(targetKey)||newKey===null)throw failure('REFLECTION_SKILL_INVALID')
    if(patch&&(action!=='upsert'||!Number.isInteger(args.expectedRevision)||[args.steps,args.reason,args.applicability].some(field=>field!==undefined)))throw failure('REFLECTION_SKILL_INVALID')
    const edit=patch?{...targetKey!==key?{newKey:targetKey}:{},...description===undefined?{}:{description:checkedText(description)},...body===undefined?{}:{body:checkedTextWithLimit(body,24000)}}:null
    if(edit&&(!Object.keys(edit).length||edit.body&&(/^---(?:\r?\n|$)/.test(edit.body)||/NIGHT_LEARNED_SCOPE=/.test(edit.body))))throw failure('REFLECTION_SKILL_INVALID')
    const content=action==='upsert'&&!patch?{steps:Array.isArray(args.steps)&&args.steps.length?args.steps.map(checkedText):null,reason:checkedText(args.reason),applicability:checkedText(args.applicability)}:null
    if(action==='upsert'&&!patch&&!content.steps)throw failure('REFLECTION_SKILL_INVALID')
    const revisionAt=(state,name)=>state.skills[name]?.revision??state.skillRevisions?.[name]??0
    const checkEdit=state=>{
      if(!state.skills[key])throw failure('REFLECTION_SKILL_NOT_FOUND')
      if(targetKey!==key&&state.skills[targetKey])throw failure('REFLECTION_SKILL_TARGET_EXISTS')
    }
    const operation=hash(operationId),inputHash=hash(JSON.stringify({action,key,content,...edit?{edit}:{},expectedRevision:args.expectedRevision,source:{sessionId:source.sessionId,messageId:source.messageId,actor:source.actor,quoteSha256:source.quoteSha256}})),directory=this.directory(scope)
    return withLock(join(directory,'mutation-locks',operation),async()=>{
      const before=await withLock(join(directory,'.lock'),async()=>{
        await args.validate?.()
        const state=await this.state(scope),receipt=state.mutations?.[operation],prior=state.skills[key],revision=prior?.revision??state.skillRevisions?.[key]??0
        const known=receipt??state.generationFailures?.[operation]
        if(known&&known.inputHash!==inputHash)throw failure('REFLECTION_OPERATION_CONFLICT')
        if(!receipt&&args.expectedRevision!==undefined&&revision!==args.expectedRevision)throw failure('REFLECTION_REVISION_CONFLICT')
        if(patch&&!receipt)checkEdit(state)
        return {receipt,prior,revision,targetRevision:revisionAt(state,targetKey),forgetGeneration:state.forgetGeneration??0}
      })
      let generated
      if(action==='upsert'&&!before.receipt&&(!patch||edit.body!==undefined)){
        try{generated=await this.generateSkill({key:targetKey,candidate:content??{body:edit.body,applicability:edit.description??before.prior.applicability},...patch?{bodyEdit:true}:{},source,previous:before.prior?{body:before.prior.body,steps:before.prior.steps,applicability:before.prior.applicability,revision:before.revision}:null},{model:args.model,signal:args.signal??this.abort?.signal})}
        catch(error){await withLock(join(directory,'.lock'),async()=>{const state=await this.state(scope);state.generationFailures??={};state.generationFailures[operation]={inputHash,key,source,code:error.code??'SKILL_GENERATION_FAILED',at:new Date().toISOString()};await atomicWrite(join(directory,'state.json'),JSON.stringify(state,null,2)+String.fromCharCode(10))});throw error}
      }
      return withLock(join(directory,'.lock'),async()=>{
        await args.validate?.()
        const state=await this.state(scope),prior=state.skills[key],receipt=state.mutations?.[operation],currentRevision=prior?.revision??state.skillRevisions?.[key]??0
        if(receipt&&receipt.inputHash!==inputHash)throw failure('REFLECTION_OPERATION_CONFLICT')
        if(!receipt&&args.expectedRevision!==undefined&&currentRevision!==args.expectedRevision)throw failure('REFLECTION_REVISION_CONFLICT')
        if(!receipt&&(currentRevision!==before.revision||(state.forgetGeneration??0)!==before.forgetGeneration||!isDeepStrictEqual(prior,before.prior)))throw failure('REFLECTION_REVISION_CONFLICT')
        if(patch&&!receipt){checkEdit(state);if(revisionAt(state,targetKey)!==before.targetRevision)throw failure('REFLECTION_REVISION_CONFLICT')}
        let committed=!!receipt
        try{
          if(!receipt){
            const now=new Date().toISOString(),revision=Math.max(currentRevision,revisionAt(state,targetKey))+1
            // 提交新版本前撤销旧加载内容；删除保留版本，防止同名重建的 ABA 冲突。
            const generation=await this.host.memory.store.transaction(scope,async state=>{await args.validate?.();state.mark();return ()=>state.meta.revision})
            await args.validate?.()
            if(action==='upsert'){
              const value=patch?{...prior,applicability:edit.description??prior.applicability,...generated?{body:generated.body,generation:generated.generation}:{},...prior.origin==='router'?{source}:{},provenance:args.provenance,revision,updatedAt:now}:{...content,applicability:generated.description,body:generated.body,generation:generated.generation,signature:hash(JSON.stringify(content.steps)),supports:[],taskIds:[],memoryKeys:[],active:true,origin:'router',source,provenance:args.provenance,revision,updatedAt:now}
              if(prior)value.previous=contentSnapshot(this.renderSkill(scope,key,prior,generation).replace(/^NIGHT_LEARNED_SCOPE=[^\n]*\n?/gm,''),prior.revision,prior.updatedAt)
              if(targetKey!==key)delete state.skills[key]
              state.skills[targetKey]=value
            }else delete state.skills[key]
            state.skillRevisions??={};state.skillRevisions[key]=revision
            if(targetKey!==key)state.skillRevisions[targetKey]=revision
            state.mutations??={};state.mutations[operation]={inputHash,action,key,...targetKey!==key?{newKey:targetKey}:{},revision,source,...generated?{generation:generated.generation}:{},at:now}
            if(state.generationFailures)delete state.generationFailures[operation]
            await atomicWrite(join(directory,'state.json'),JSON.stringify(state,null,2)+'\n');committed=true
          }
          this.host.skills.invalidateCache()
          // 重试只修复当前状态的派生文件，绝不重放旧回执覆盖后来的修改或删除。
          await this.publishSkill(scope,key,state)
          if(targetKey!==key)await this.publishSkill(scope,targetKey,state)
          const saved=await this.state(scope)
          if(saved.mutations?.[operation]?.inputHash!==inputHash)throw failure('REFLECTION_WRITE_UNCONFIRMED')
        }catch(cause){if(committed||cause.committed)throw Object.assign(failure('REFLECTION_WRITE_UNCONFIRMED'),{committed:true,cause});throw cause}
        return {ok:true,persisted:true,...receipt?{duplicate:true}:{},action,key:targetKey,...targetKey!==key?{previousKey:key}:{},revision:state.mutations[operation].revision,currentRevision:revisionAt(state,targetKey),active:!!state.skills[targetKey]?.active,...state.mutations[operation].generation?{generation:state.mutations[operation].generation}:{}}
      })
    })
  }
  async forget(scope,key,{onlyIfDerived=false}={}){
    const directory=this.directory(scope)
    const changedReviews=await withLock(join(directory,'.lock'),async()=>{
      const state=await this.state(scope),changedReviews=[]
      let revokedSkill=false
      for(const [name,skill]of Object.entries(state.skills))if(skill.memoryKeys.includes(key)){
        revokedSkill=true
        state.skillRevisions??={};state.skillRevisions[name]=Math.max(skill.revision??0,state.skillRevisions[name]??0)+1;delete state.skills[name];await privateDirectory(join(directory,'skills'));await rm(join(directory,'skills',name),{recursive:true,force:true})
      }
      for(const [id,review]of Object.entries(state.reviews)){
        const lessons=Array.isArray(review.lessons)?review.lessons:[],destinations=Array.isArray(review.destinations)?review.destinations:[]
        const kept=lessons.filter((lesson,index)=>reviewLessonMemoryKey(review,index)!==key)
        const retained=kept.length!==lessons.length||!lessons.length?destinations.filter(destination=>destination?.memory?.key!==key||destination.memory.topic&&destination.memory.topic!=='experience'):destinations
        if(kept.length!==lessons.length||retained.length!==destinations.length){if(kept.length!==lessons.length)review.lessons=kept;review.forgotten=true;if(retained.length!==destinations.length)review.destinations=retained;changedReviews.push([id,review])}
      }
      if(onlyIfDerived&&!revokedSkill&&!changedReviews.length)return changedReviews
      // An explicit forget or correction also fences inference without reservations.
      state.forgetGeneration=(state.forgetGeneration??0)+1
      for(const [id,review]of changedReviews)await atomicWrite(join(directory,'reviews',id+'.json'),JSON.stringify(review,null,2)+'\n')
      // Commit forgetting before external archive callbacks.
      // A failed callback must never restore learned content on restart.
      await atomicWrite(join(directory,'state.json'),JSON.stringify(state,null,2)+'\n');this.host.skills.invalidateCache()
      return changedReviews
    })
    // Incremental scanning no longer revisits finished events. Keep failed
    // archive refreshes pending so forgetting is repaired without a restart.
    for(const [,review]of changedReviews)for(const source of this.sources)source.archivePending?.set(review.eventId,{scope,report:review})
    for(const [,review]of changedReviews)for(const source of this.sources){
      try{await this.publishReviewArchive(source,review.taskId,review,scope);source.archivePending?.delete(review.eventId)}
      catch(error){source.archivePending?.set(review.eventId,{scope,report:review});throw error}
    }
  }
  // Host 检视只接受已认证渠道 binding；模型工具仍走官方 live actor 权限。
  async inspectTask(task,readerBinding,{store,changeId,version}={}){
    const source=[...this.sources].find(item=>item.store===store)
    if(!source)throw failure('LEARNING_UNAVAILABLE')
    const owner=task.ownerActorId??source.ownerActorId
    if(typeof owner!=='string')throw failure('LEARNING_IDENTITY_INVALID')
    const binding={actorId:owner,...task.groupId&&task.metadata?.channelType!=='chat'?{groupId:task.metadata?.memoryGroupId??task.groupId,groupWrite:true}:{}}
    const scope=memoryScope(binding,{scope:binding.groupId?'group':'personal'})
    const allowed=readableScopes(bindingSchema.parse(readerBinding)).some(row=>row.scope.kind===scope.kind&&row.scope.id===scope.id)
    const state=await this.state(scope),reviews=[],changes=[],bodies=new Map()
    const add=(reviewId,report,kind,key,value,text)=>{
      const id=hash(JSON.stringify([task.taskId,reviewId,kind,key,scope.kind,scope.id]))
      const source={taskId:task.taskId,eventId:report.eventId,reviewId}
      const currentVersion=hash(JSON.stringify([id,value,text??null]))
      const canRead=allowed&&typeof text==='string'
      changes.push({id,entryId:hash(JSON.stringify([kind,key,scope.kind,scope.id])),reviewId,taskId:task.taskId,kind,action:kind==='memory'?'upsert':'current-version',status:value.status,scope:scope.kind,name:key,version:currentVersion,canRead,source})
      if(canRead)bodies.set(id,{id,kind,text,version:currentVersion,source})
    }
    for(const [reviewId,report]of Object.entries(state.reviews)){
      if(report.taskId!==task.taskId)continue
      if(reviewId!==hash(report.eventId)||!['done','skipped','failed'].includes(report.status))throw failure('LEARNING_IDENTITY_INVALID')
      reviews.push({reviewId,taskId:task.taskId,eventId:report.eventId,status:report.status,summary:report.status==='failed'?'复盘失败，不能据此认定记忆或技能已更新':report.status==='skipped'?'复盘未产生新经验':'已记录 '+(report.lessons?.length??0)+' 条复盘；变更以当前落盘证据为准',at:report.recordedAt??null})
      const entries=[]
      const memoryKeys=new Set(reviewMemoryKeys(report))
      for(const key of memoryKeys){
        const saved=(await this.host.memory.store.read(scope,{topic:'experience',key})).entries.find(row=>row.source?.messageId===report.eventId)
        if(saved)entries.push(saved)
        const entry=saved
        add(reviewId,report,'memory',key,{status:entry?'applied':'not-applied',revision:entry?.revision??null,source:entry?.source??null},entry?.text)
      }
      for(const [key,value]of Object.entries(state.skills)){
        if(!value.supports?.some(row=>row.taskId===task.taskId&&memoryKeys.has(row.memoryKey)))continue
        if(!validKey(key))throw failure('LEARNING_IDENTITY_INVALID')
        const supported=value.supports.some(row=>row.taskId===task.taskId&&entries.some(entry=>entry.key===row.memoryKey))
        let text=value.active&&supported?await readRegular(join(this.directory(scope),'skills',key,'SKILL.md')):undefined
        if(text!==undefined){const marker=text.match(/NIGHT_LEARNED_SCOPE=([^;]+);revision=(\d+)/);if(!marker||marker[1]!==scope.kind+'/'+scope.id||text!==this.renderSkill(scope,key,value,Number(marker[2])))text=undefined}
        add(reviewId,report,'skill',key,{status:value.active&&text!==undefined?'applied':value.active?'not-applied':'candidate',revision:value.revision,signature:value.signature},text)
      }
    }
    if(changeId!==undefined){
      const change=changes.find(row=>row.id===changeId)
      if(!change)throw failure('LEARNING_CHANGE_NOT_FOUND')
      if(!change.canRead)throw failure('LEARNING_BODY_FORBIDDEN')
      if(change.version!==version)throw failure('LEARNING_VERSION_STALE')
      return bodies.get(changeId)
    }
    reviews.sort((a,b)=>(b.at??'').localeCompare(a.at??'')||a.reviewId.localeCompare(b.reviewId))
    const changesComplete=learningCoverage(task.taskId,state.reviews,state.skills,changes)
    return {status:'ready',reviews,changes,changesComplete,revision:hash(JSON.stringify([reviews,changes,changesComplete]))}
  }
  async supportEntries(scope,state){
    if(!Object.values(state.skills).some(skill=>skill.active&&skill.origin!=='router'))return []
    return (await this.host.memory.store.index(scope,{topic:'experience'})).entries
  }
  async authorizedSkills(requestedAgent,{signal,verifyState=false}={}){
    signal?.throwIfAborted()
    const agent=this.host.agents.currentInitiator()??requestedAgent;if(!agent)return []
    const binding=await this.host.memory.binding(agent);if(!binding)return []
    const result=[]
    for(const {scope}of readableScopes(binding)){
      signal?.throwIfAborted();const state=await this.state(scope)
      signal?.throwIfAborted();const entries=await this.supportEntries(scope,state)
      signal?.throwIfAborted()
      // Reflection can publish state outside the memory lock. Check it again
      // after reading the evidence index rather than combining two versions.
      if(verifyState&&!isDeepStrictEqual((await this.state(scope)).skills,state.skills))throw failure('PI_OFFICIAL_SKILL_AUTHORIZATION_CHANGED')
      signal?.throwIfAborted()
      for(const [key,value]of Object.entries(state.skills))if(value.active&&learnedSkillSupported(value,entries)){
        const candidate={name:'learned-'+key,description:value.applicability,provider:'learned',source:value.origin??'task-reflection',rank:100,locator:{scope,key},invocation:{modelInvocable:true,userInvocable:true}}
        result.push({candidate,value})
      }
    }
    return result
  }
  async catalog(requestedAgent){return (await this.authorizedSkills(requestedAgent)).map(row=>row.candidate)}
  // These views are fresh for each Host validation phase and never authorize a tool read.
  async readOfficialResources(provider,skills,options){
    const selected=await skills.officialCandidates(provider,options),resources=new Map()
    if(!selected.length)return resources
    const current=new Map((await this.authorizedSkills(options.scope,{signal:options.signal,verifyState:true})).map(row=>[row.candidate.name,row]))
    for(const candidate of selected){
      const row=current.get(candidate.name),{scope,key}=candidate.locator
      const skill=row?.candidate.locator.scope.id===scope.id?{...row.candidate,content:this.renderSkill(scope,key,row.value)}:undefined
      resources.set(candidate.name,skill)
    }
    return resources
  }
  async skill(candidate,agent,{resourceOnly=false}={}){
    const allowed=(await this.catalog(agent)).find(row=>row.name===candidate.name&&row.locator.scope.id===candidate.locator.scope.id);if(!allowed)return
    const {scope,key}=allowed.locator,state=await this.state(scope),value=state.skills[key]
    const content=this.renderSkill(scope,key,value)
    if(!resourceOnly)await this.host.memory.recordUsage(scope,'loadCount')
    return {...allowed,content}
  }
  async whenIdle(){while(this.jobs.size)await Promise.allSettled([...this.jobs])}
}
