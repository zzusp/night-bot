import {learningCoverage} from './learning-coverage.js'
import {contentSnapshot} from './previous.js'
import {learnedSkillSupported} from './evolution.js'
import {generateLearnedSkill,loadBundledCreator} from './skill-generation.js'
import {isDeepStrictEqual} from 'node:util'
import {officialReflectionText} from './reflection-inference.js'
import {reflectionInput} from './reflection-input.js'
import {assignReflectionMemoryKeys,reflectionMemoryKey,reviewMemoryKeys,reviewLessonMemoryKey,reflectionRetrySupported} from './reflection-keys.js'
import {Service} from '@deepseek-ai/cordis'
import {join} from 'node:path'
import {rm} from 'node:fs/promises'
import {bindingSchema,memoryScope,readableScopes} from './scope.js'
import {checkedText,hash,renderMemoryContent} from './format.js'
import {atomicWrite,readRegular,withLock,failure,privateDirectory} from '../runtime/files.js'
const validKey=value=>typeof value==='string'&&/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value)&&value.length<=60
const brief=value=>checkedText(String(value??'').slice(0,1800))
/** 任务完成后的无工具复盘；任务账本仍是权威，完成不代表渠道已送达。 */
export default class Reflection extends Service {
  static inject=['memory','skills','agents','nativePiProvider','runtimePaths']
  constructor(ctx,config={}){
    super(ctx,'reflection');this.host=ctx;this.config=config;this.jobs=new Set();this.sources=new Set();this.abort=new AbortController();this.closed=false;this.lastError=null
    ctx.skills.registerProvider(()=>({name:'learned',list:async options=>({candidates:await this.catalog(options?.scope),complete:!!options?.scope||!this.host.agents.currentInitiator()}),get:async(candidate,options)=>this.skill(candidate,options?.scope,{resourceOnly:options?.resourceOnly===true})}))
    ctx.effect(()=>async()=>{this.closed=true;this.abort.abort();await this.whenIdle()},'reflection drain')
  }
  async [Service.init](){
    await this.host.memory.bindingReady
    const scope=memoryScope({actorId:'host'}),state=await this.state(scope),entries=await this.supportEntries(scope,state),revision=(await this.host.memory.store.index(scope)).revision
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
  async state(scope){return JSON.parse(await readRegular(join(this.directory(scope),'state.json'))??'{"version":1,"reviews":{},"skills":{}}')}
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
      const attempts=(previous?.attempts??0)+1
      let inputRecord=previous?.input,input,snapshot,lessons=previous?.lessons,preparationError
      const signal=this.abort.signal,inferenceSignal=AbortSignal.any([signal,AbortSignal.timeout(30000)])
      try{
        const executions=await source.store.query({kind:'execution.list',taskId:task.taskId}),operations=await source.store.query({kind:'operation.list',taskId:task.taskId})
        input=reflectionInput(task,event,executions,operations);const known=new Set(input.facts.map(f=>f.id))
        if(!previous?.lessons)inputRecord={sha256:hash(JSON.stringify(input)),coverage:input.coverage}
        snapshot=await this.host.memory.store.index(scope,{topic:'experience',includeExpired:true})
        if(!lessons){
          const official=this.host.get('nativePiProvider')?.official
          if(typeof official?.resolve!=='function')throw failure('REFLECTION_OFFICIAL_MODEL_REQUIRED')
          const resolved=await official.resolve({...source.model,signal:inferenceSignal},source.credentials===undefined?undefined:{credentials:source.credentials})
          const raw=await officialReflectionText(resolved,input,{signal:inferenceSignal,groupResponsibility:source.responsibilityFor?.(task.groupId)??''})
          const output=JSON.parse(raw);if(!Array.isArray(output.lessons)||output.lessons.length>3)throw failure('REFLECTION_INVALID')
          const keys=new Set()
          lessons=output.lessons.map(lesson=>{
            if(!validKey(lesson.key)||!Array.isArray(lesson.evidenceIds)||!lesson.evidenceIds.length||lesson.evidenceIds.some(e=>!known.has(e)))throw failure('REFLECTION_EVIDENCE_INVALID')
            if(keys.has(lesson.key))throw failure('REFLECTION_DUPLICATE_KEY');keys.add(lesson.key)
            const value={key:lesson.key,summary:checkedText(lesson.summary),why:checkedText(lesson.why),howToApply:checkedText(lesson.howToApply),evidenceIds:lesson.evidenceIds}
            if(lesson.skill){if(!Array.isArray(lesson.skill.steps)||!lesson.skill.steps.length||lesson.skill.steps.length>8)throw failure('REFLECTION_SKILL_INVALID');value.skill={steps:lesson.skill.steps.map(brief),reason:brief(lesson.skill.reason),applicability:brief(lesson.skill.applicability??'Not established'),evidenceBacked:lesson.skill.evidenceBacked===true}}return value
          })
        }
        for(const lesson of lessons){
          if(!lesson.skill||lesson.applied||lesson.generated)continue
          const prior=initial.skills[lesson.key]
          // 候选与原始证据交给实际 creator；慢生成不占用共享发布锁。
          lesson.generated=await this.generateSkill({key:lesson.key,candidate:lesson.skill,evidence:input,source:{eventId:event.id,taskId:task.taskId},previous:prior?{body:prior.body,steps:prior.steps,applicability:prior.applicability,revision:prior.revision}:null},{model:source.model,credentials:source.credentials,signal:this.abort.signal})
          lesson.generated.expectedRevision=prior?.revision??initial.skillRevisions?.[lesson.key]??0
        }
      }catch(error){preparationError=error}
      const report=await withLock(join(directory,'.lock'),async()=>{
        const state=await this.state(scope)
        // Forgetting or another committed review must not be overwritten by a
        // result prepared against older review state. Retry from current state.
        if(JSON.stringify(state.reviews[id])!==JSON.stringify(previous))return null
        if((state.forgetGeneration??0)!==(initial.forgetGeneration??0)){
          const revoked={memoryKeyVersion:1,input:inputRecord,status:'skipped',code:'REFLECTION_SCOPE_REVOKED',attempts,eventId:event.id,taskId:task.taskId,recordedAt:new Date().toISOString(),lessons:[],destinations:[]}
          state.reviews[id]=revoked
          await atomicWrite(join(directory,'reviews',id+'.json'),JSON.stringify(revoked,null,2)+'\n')
          await atomicWrite(join(directory,'state.json'),JSON.stringify(state,null,2)+'\n');return revoked
        }
        if(lessons)lessons=assignReflectionMemoryKeys(lessons,snapshot?.entries??[],state.reviews)
        try{
        if(preparationError)throw preparationError
        signal.throwIfAborted()
        let scopeRevision=snapshot.revision
        // Commit key reservations before any memory/skill effects so retries use
        // the same receipt identity even after a crash or an intervening forget.
        state.reviews[id]={memoryKeyVersion:1,input:inputRecord,status:'failed',code:'REFLECTION_INCOMPLETE',attempts,eventId:event.id,taskId:task.taskId,lessons}
        await atomicWrite(join(directory,'state.json'),JSON.stringify(state,null,2)+'\n')
        for(const lesson of lessons){
          signal.throwIfAborted()
          if(lesson.applied){if(lesson.skill)await this.publishSkill(scope,lesson.key,state);continue}
          if(lesson.skill&&(state.skills[lesson.key]?.revision??state.skillRevisions?.[lesson.key]??0)!==lesson.generated.expectedRevision){delete lesson.generated;throw failure('REFLECTION_REVISION_CONFLICT')}
          const memoryKey=reflectionMemoryKey(lesson)
          const previousWrite=lesson.memoryWrite
          lesson.memoryWrite='uncertain'
          await atomicWrite(join(directory,'state.json'),JSON.stringify(state,null,2)+'\n')
          let result
          try{result=await this.host.memory.store.remember(scope,{scopeRevision,expectedRevision:0,topic:'experience',key:memoryKey,text:renderMemoryContent(lesson),content:{summary:lesson.summary,why:lesson.why,howToApply:lesson.howToApply},source:{sessionId:task.sessionId??task.taskId,messageId:event.id,quoteSha256:hash(JSON.stringify(input.facts))},provenance:this.host.memory.provenance({task})})}
          catch(error){if(!['committed','uncertain'].includes(previousWrite)&&['MEMORY_SCOPE_CHANGED','MEMORY_REVISION_CONFLICT'].includes(error.code))lesson.memoryWrite='not-applied';throw error}
          if(!result.ok)continue
          lesson.memoryWrite='committed'
          scopeRevision=result.revision
          // A deduplicated receipt must not revive a forgotten or replaced skill.
          const saved=(await this.host.memory.store.read(scope,{topic:'experience',key:memoryKey})).entries[0]
          if(saved?.source?.messageId!==event.id||saved.source.sessionId!==(task.sessionId??task.taskId))continue
          if(lesson.skill){
            const signature=hash(JSON.stringify(lesson.skill.steps)),prior=state.skills[lesson.key]
            const observations=prior?.signature===signature?[...new Set([...prior.taskIds,task.taskId])]:[task.taskId]
            // Repeated completions/versions of the same task do not count twice.
            const active=lesson.skill.evidenceBacked&&lesson.skill.applicability!=='Not established'&&(prior?.active||Object.values(state.skills).filter(s=>s.active).length<20)
            const supports=[...(prior?.supports??[]).filter(row=>row.memoryKey!==memoryKey),{taskId:task.taskId,memoryKey}].slice(-40)
            const skill={signature,supports,taskIds:observations.slice(-20),memoryKeys:[...new Set([...(prior?.memoryKeys??[]),memoryKey])],active,steps:lesson.skill.steps,reason:lesson.skill.reason,applicability:lesson.generated.description,body:lesson.generated.body,generation:lesson.generated.generation,revision:Math.max(prior?.revision??0,state.skillRevisions?.[lesson.key]??0)+1,updatedAt:new Date().toISOString()}
            if(prior)skill.previous=contentSnapshot(this.renderSkill(scope,lesson.key,prior,scopeRevision).replace(/^NIGHT_LEARNED_SCOPE=[^\n]*\n?/gm,''),prior.revision,prior.updatedAt)
            state.skills[lesson.key]=skill;state.skillRevisions??={};state.skillRevisions[lesson.key]=skill.revision
          }
          // Commit authoritative skill state before publishing its derived file.
          // Retries repair the current file, never replay over later Router edits.
          lesson.applied=true
          await atomicWrite(join(directory,'state.json'),JSON.stringify(state,null,2)+'\n')
          if(lesson.skill)await this.publishSkill(scope,lesson.key,state)
        }
        state.reviews[id]={memoryKeyVersion:1,input:inputRecord,status:lessons.length?'done':'skipped',attempts,eventId:event.id,taskId:task.taskId,recordedAt:new Date().toISOString(),lessons}
        this.host.skills.invalidateCache()
      }catch(error){state.reviews[id]={...state.reviews[id],...lessons?{lessons}:{},memoryKeyVersion:1,input:inputRecord,status:'failed',attempts,eventId:event.id,taskId:task.taskId,code:error.code??'REFLECTION_MODEL_FAILED',retryAt:Date.now()+30000};this.lastError=state.reviews[id].code;this.host.logger.warn('reflection: '+this.lastError)}
      const report={...state.reviews[id],destinations:(state.reviews[id].lessons??[]).map(lesson=>({memory:{scope,topic:'experience',key:reflectionMemoryKey(lesson)},...state.skills[lesson.key]?.active?{skill:{scope,key:lesson.key,revision:state.skills[lesson.key].revision}}:{}}))};state.reviews[id]=report;await atomicWrite(join(directory,'reviews',id+'.json'),JSON.stringify(report,null,2)+'\n');await atomicWrite(join(directory,'state.json'),JSON.stringify(state,null,2)+'\n');return report
      })
      if(!report)return false
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
  renderSkill(scope,key,value,revision){
    return ['---','name: learned-'+key,'description: '+JSON.stringify(value.applicability),'---',
      'NIGHT_LEARNED_SCOPE='+scope.kind+'/'+scope.id+';revision='+revision,'',
      ...value.origin==='router'?['Source message: '+value.source.messageId]:[],'',
      ...value.body!==undefined?[value.body]:value.steps.map((step,i)=>(i+1)+'. '+step),''].join('\n')
  }
  async readSkills(scope,{key}={}){
    if(key!==undefined&&!validKey(key))throw failure('REFLECTION_SKILL_INVALID')
    const state=await this.state(scope),entries=await this.supportEntries(scope,state)
    return {...key!==undefined?{revision:state.skills[key]?.revision??state.skillRevisions?.[key]??0}:{},entries:Object.entries(state.skills).filter(([name])=>key===undefined||name===key).map(([name,value])=>({key:name,name:'learned-'+name,revision:value.revision,active:value.active&&learnedSkillSupported(value,entries),origin:value.origin??'task-reflection',source:value.source??null,applicability:value.applicability,...key!==undefined?{steps:value.steps,reason:value.reason,...value.body!==undefined?{body:value.body}:{},...value.generation?{generation:value.generation}:{}}:{}}))}
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
    if(!['upsert','delete'].includes(action)||!validKey(key)||typeof operationId!=='string'||!operationId.trim())throw failure('REFLECTION_SKILL_INVALID')
    const content=action==='upsert'?{steps:Array.isArray(args.steps)&&args.steps.length?args.steps.map(checkedText):null,reason:checkedText(args.reason),applicability:checkedText(args.applicability)}:null
    if(action==='upsert'&&!content.steps)throw failure('REFLECTION_SKILL_INVALID')
    const operation=hash(operationId),inputHash=hash(JSON.stringify({action,key,content,expectedRevision:args.expectedRevision,source:{sessionId:source.sessionId,messageId:source.messageId,actor:source.actor,quoteSha256:source.quoteSha256}})),directory=this.directory(scope)
    return withLock(join(directory,'mutation-locks',operation),async()=>{
      const before=await withLock(join(directory,'.lock'),async()=>{
        await args.validate?.()
        const state=await this.state(scope),receipt=state.mutations?.[operation],prior=state.skills[key],revision=prior?.revision??state.skillRevisions?.[key]??0
        const known=receipt??state.generationFailures?.[operation]
        if(known&&known.inputHash!==inputHash)throw failure('REFLECTION_OPERATION_CONFLICT')
        if(!receipt&&args.expectedRevision!==undefined&&revision!==args.expectedRevision)throw failure('REFLECTION_REVISION_CONFLICT')
        return {receipt,prior,revision,forgetGeneration:state.forgetGeneration??0}
      })
      let generated
      if(action==='upsert'&&!before.receipt){
        try{generated=await this.generateSkill({key,candidate:content,source,previous:before.prior?{body:before.prior.body,steps:before.prior.steps,applicability:before.prior.applicability,revision:before.revision}:null},{model:args.model,signal:args.signal??this.abort?.signal})}
        catch(error){await withLock(join(directory,'.lock'),async()=>{const state=await this.state(scope);state.generationFailures??={};state.generationFailures[operation]={inputHash,key,source,code:error.code??'SKILL_GENERATION_FAILED',at:new Date().toISOString()};await atomicWrite(join(directory,'state.json'),JSON.stringify(state,null,2)+String.fromCharCode(10))});throw error}
      }
      return withLock(join(directory,'.lock'),async()=>{
        await args.validate?.()
        const state=await this.state(scope),prior=state.skills[key],receipt=state.mutations?.[operation],currentRevision=prior?.revision??state.skillRevisions?.[key]??0
        if(receipt&&receipt.inputHash!==inputHash)throw failure('REFLECTION_OPERATION_CONFLICT')
        if(!receipt&&args.expectedRevision!==undefined&&currentRevision!==args.expectedRevision)throw failure('REFLECTION_REVISION_CONFLICT')
        if(!receipt&&(currentRevision!==before.revision||(state.forgetGeneration??0)!==before.forgetGeneration||!isDeepStrictEqual(prior,before.prior)))throw failure('REFLECTION_REVISION_CONFLICT')
        let committed=!!receipt
        try{
          if(!receipt){
            const now=new Date().toISOString(),revision=currentRevision+1
            // 提交新版本前撤销旧加载内容；删除保留版本，防止同名重建的 ABA 冲突。
            const generation=await this.host.memory.store.transaction(scope,async state=>{await args.validate?.();state.mark();return ()=>state.meta.revision})
            await args.validate?.()
            if(action==='upsert'){
              const value={...content,applicability:generated.description,body:generated.body,generation:generated.generation,signature:hash(JSON.stringify(content.steps)),supports:[],taskIds:[],memoryKeys:[],active:true,origin:'router',source,provenance:args.provenance,revision,updatedAt:now}
              if(prior)value.previous=contentSnapshot(this.renderSkill(scope,key,prior,generation).replace(/^NIGHT_LEARNED_SCOPE=[^\n]*\n?/gm,''),prior.revision,prior.updatedAt)
              state.skills[key]=value
            }else delete state.skills[key]
            state.skillRevisions??={};state.skillRevisions[key]=revision
            state.mutations??={};state.mutations[operation]={inputHash,action,key,revision,source,...generated?{generation:generated.generation}:{},at:now}
            if(state.generationFailures)delete state.generationFailures[operation]
            await atomicWrite(join(directory,'state.json'),JSON.stringify(state,null,2)+'\n');committed=true
          }
          this.host.skills.invalidateCache()
          // 重试只修复当前状态的派生文件，绝不重放旧回执覆盖后来的修改或删除。
          await this.publishSkill(scope,key,state)
          const saved=await this.state(scope)
          if(saved.mutations?.[operation]?.inputHash!==inputHash)throw failure('REFLECTION_WRITE_UNCONFIRMED')
        }catch(cause){if(committed||cause.committed)throw Object.assign(failure('REFLECTION_WRITE_UNCONFIRMED'),{committed:true,cause});throw cause}
        return {ok:true,persisted:true,...receipt?{duplicate:true}:{},action,key,revision:state.mutations[operation].revision,currentRevision:state.skills[key]?.revision??state.skillRevisions?.[key]??0,active:!!state.skills[key]?.active,...state.mutations[operation].generation?{generation:state.mutations[operation].generation}:{}}
      })
    })
  }
  async forget(scope,key){
    const directory=this.directory(scope)
    const changedReviews=await withLock(join(directory,'.lock'),async()=>{
      const state=await this.state(scope),changedReviews=[]
      // Fence even outstanding inference that has not reserved lesson keys yet.
      state.forgetGeneration=(state.forgetGeneration??0)+1
      for(const [name,skill]of Object.entries(state.skills))if(skill.memoryKeys.includes(key)){
        state.skillRevisions??={};state.skillRevisions[name]=Math.max(skill.revision??0,state.skillRevisions[name]??0)+1;delete state.skills[name];await privateDirectory(join(directory,'skills'));await rm(join(directory,'skills',name),{recursive:true,force:true})
      }
      for(const [id,review]of Object.entries(state.reviews)){
        const lessons=Array.isArray(review.lessons)?review.lessons:[],destinations=Array.isArray(review.destinations)?review.destinations:[]
        const kept=lessons.filter((lesson,index)=>reviewLessonMemoryKey(review,index)!==key)
        const retained=kept.length!==lessons.length||!lessons.length?destinations.filter(destination=>destination?.memory?.key!==key||destination.memory.topic&&destination.memory.topic!=='experience'):destinations
        if(kept.length!==lessons.length||retained.length!==destinations.length){if(kept.length!==lessons.length)review.lessons=kept;review.forgotten=true;if(retained.length!==destinations.length)review.destinations=retained;changedReviews.push([id,review])}
      }
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
    return (await this.host.memory.store.index(scope,{topic:'experience'})).entries.slice(0,50)
  }
  async catalog(requestedAgent){
    const agent=this.host.agents.currentInitiator()??requestedAgent;if(!agent)return []
    const binding=await this.host.memory.binding(agent);if(!binding)return []
    const result=[]
    for(const {scope}of readableScopes(binding)){
      const state=await this.state(scope),entries=await this.supportEntries(scope,state)
      for(const [key,skill]of Object.entries(state.skills))if(skill.active&&learnedSkillSupported(skill,entries))result.push({name:'learned-'+key,description:skill.applicability,provider:'learned',source:skill.origin??'task-reflection',rank:100,locator:{scope,key},invocation:{modelInvocable:true,userInvocable:true}})
    }
    return result
  }
  async skill(candidate,agent,{resourceOnly=false}={}){
    const allowed=(await this.catalog(agent)).find(row=>row.name===candidate.name&&row.locator.scope.id===candidate.locator.scope.id);if(!allowed)return
    const {scope,key}=allowed.locator,state=await this.state(scope),value=state.skills[key],revision=(await this.host.memory.store.index(scope)).revision
    const content=this.renderSkill(scope,key,value,revision)
    if(!resourceOnly)await this.host.memory.recordUsage(scope,'loadCount')
    return {...allowed,content}
  }
  async whenIdle(){while(this.jobs.size)await Promise.allSettled([...this.jobs])}
}
