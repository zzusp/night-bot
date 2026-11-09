import {officialReflectionText} from './reflection-inference.js'
import {Service} from '@deepseek-ai/cordis'
import {join} from 'node:path'
import {rm} from 'node:fs/promises'
import {bindingSchema,memoryScope,readableScopes} from './scope.js'
import {checkedText,hash} from './format.js'
import {atomicWrite,readRegular,withLock,failure} from '../runtime/files.js'
const validKey=value=>typeof value==='string'&&/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value)&&value.length<=60
const brief=value=>checkedText(String(value??'').slice(0,1800))
/** 任务完成后的无工具复盘；任务账本仍是权威，完成不代表渠道已送达。 */
export default class Reflection extends Service {
  static inject=['memory','skills','agents','nativePiProvider','runtimePaths']
  constructor(ctx,config={}){
    super(ctx,'reflection');this.host=ctx;this.config=config;this.jobs=new Set();this.sources=new Set();this.abort=new AbortController();this.closed=false;this.lastError=null
    ctx.skills.registerProvider(()=>({name:'learned',list:async options=>({candidates:await this.catalog(options?.scope),complete:!!options?.scope||!this.host.agents.currentInitiator()}),get:async(candidate,options)=>this.skill(candidate,options?.scope)}))
    ctx.effect(()=>async()=>{this.closed=true;this.abort.abort();await this.whenIdle()},'reflection drain')
  }
  attachStore(store,{ownerActorId,model,credentials,onReview,responsibilityFor}={}){
    if(this.config.enabled===false)return
    const source={store,ownerActorId,model,credentials,onReview,responsibilityFor};this.sources.add(source);void this.scanSource(source)
    return ()=>this.sources.delete(source)
  }
  scan(){for(const source of this.sources)void this.scanSource(source)}
  scanSource(source){
    if(this.closed)return source.scanning
    source.scanRequested=true;if(source.scanning)return source.scanning
    const job=this.host.agents.withoutInitiator(async()=>{
      do{source.scanRequested=false;let after=0,page
      do{page=await source.store.query({kind:'task.events',after,limit:100});for(const event of page.events){if(this.closed)return;if(event.kind==='task.completed')await this.review(source,event)}after=page.nextCursor}while(page.hasMore)
      }while(source.scanRequested&&!this.closed)
    }).catch(error=>{this.lastError=error.code??'REFLECTION_SCAN_FAILED';this.host.logger.warn('reflection: '+this.lastError)}).finally(()=>{source.scanning=undefined;this.jobs.delete(job);if(source.scanRequested&&!this.closed&&this.sources.has(source))void this.scanSource(source)})
    source.scanning=job;this.jobs.add(job);return job
  }
  async state(scope){return JSON.parse(await readRegular(join(this.directory(scope),'state.json'))??'{"version":1,"reviews":{},"skills":{}}')}
  directory(scope){return join(this.host.memory.store.directory(scope),'evolution')}
  async review(source,event){
    const task=await source.store.query({kind:'task.get',taskId:event.taskId})
    if(!task||task.archiveRestore?.reviewRequired||task.archiveRestore?.completionEventIds?.includes(event.id)||typeof source.ownerActorId!=='string')return
    const binding={actorId:task.ownerActorId??source.ownerActorId,...task.groupId&&task.metadata?.channelType!=='chat'?{groupId:task.metadata?.memoryGroupId??task.groupId,groupWrite:true}:{}}
    const scope=memoryScope(binding,{scope:binding.groupId?'group':'personal'},true),directory=this.directory(scope),id=hash(event.id)
    await withLock(join(directory,'.lock'),async()=>{
      const state=await this.state(scope),previous=state.reviews[id]
      if(previous?.status==='done'||previous?.status==='skipped'){try{await source.onReview?.(task.taskId,previous)}catch(error){this.lastError=error.code??'TASK_REVIEW_ARCHIVE_FAILED';this.host.logger.warn(this.lastError)}return}
      if(previous?.attempts>=3||previous?.retryAt>Date.now())return
      const attempts=(previous?.attempts??0)+1
      try{
        const executions=await source.store.query({kind:'execution.list',taskId:task.taskId}),operations=await source.store.query({kind:'operation.list',taskId:task.taskId})
        const facts=[{id:event.id,kind:'task.completed',summary:brief(event.result?.summary??event.result??task.completion?.result?.summary??'completed')},...executions.slice(-12).map(row=>({id:row.executionId,kind:'execution',status:row.status,summary:brief(row.result?.summary??row.error??row.stageProgress?.summary??'')})),...operations.slice(-24).map(row=>({id:row.operationId??row.id,kind:'operation',status:row.state,tool:row.toolName??row.name??''}))]
        const known=new Set(facts.map(f=>f.id)),input={taskId:task.taskId,eventId:event.id,facts}
        let scopeRevision=(await this.host.memory.store.index(scope)).revision
        const timeout=AbortSignal.timeout(30000),signal=AbortSignal.any([this.abort.signal,timeout])
        const official=this.host.get('nativePiProvider')?.official
        if(typeof official?.resolve!=='function')throw failure('REFLECTION_OFFICIAL_MODEL_REQUIRED')
        const resolved=await official.resolve({...source.model,signal},source.credentials===undefined?undefined:{credentials:source.credentials})
        const raw=await officialReflectionText(resolved,input,{signal,groupResponsibility:source.responsibilityFor?.(task.groupId)??''})
        const output=JSON.parse(raw);if(!Array.isArray(output.lessons)||output.lessons.length>3)throw failure('REFLECTION_INVALID')
        const lessons=output.lessons.map(lesson=>{
          if(!validKey(lesson.key)||!Array.isArray(lesson.evidenceIds)||!lesson.evidenceIds.length||lesson.evidenceIds.some(e=>!known.has(e)))throw failure('REFLECTION_EVIDENCE_INVALID')
          const value={key:lesson.key,observation:brief(lesson.observation),hypothesis:brief(lesson.hypothesis),shortcut:brief(lesson.shortcut),evidenceIds:lesson.evidenceIds}
          if(lesson.skill){if(!Array.isArray(lesson.skill.steps)||!lesson.skill.steps.length||lesson.skill.steps.length>8)throw failure('REFLECTION_SKILL_INVALID');value.skill={steps:lesson.skill.steps.map(brief),reason:brief(lesson.skill.reason),applicability:brief(lesson.skill.applicability??'Not established'),evidenceBacked:lesson.skill.evidenceBacked===true}}return value
        })
        for(const lesson of lessons){
          signal.throwIfAborted()
          const memoryKey='task-'+id.slice(0,12)+'-'+lesson.key
          const result=await this.host.memory.store.remember(scope,{scopeRevision,topic:'experience',key:memoryKey,text:brief('Model observation: '+lesson.observation+'\nHypothesis (not fact): '+lesson.hypothesis+'\nPossible direct path (not permission): '+lesson.shortcut+'\nEvidence: '+lesson.evidenceIds.join(', ')),source:{sessionId:task.sessionId??task.taskId,messageId:event.id,quoteSha256:hash(JSON.stringify(facts))}})
          if(!result.ok)continue
          scopeRevision=result.revision
          if(lesson.skill){
            const signature=hash(JSON.stringify(lesson.skill.steps)),prior=state.skills[lesson.key]
            const observations=prior?.signature===signature?[...new Set([...prior.taskIds,task.taskId])]:[task.taskId]
            // Repeated completions/versions of the same task do not count twice.
            const active=lesson.skill.evidenceBacked&&lesson.skill.applicability!=='Not established'&&(prior?.active||Object.values(state.skills).filter(s=>s.active).length<20)
            const supports=[...(prior?.supports??[]).filter(row=>row.memoryKey!==memoryKey),{taskId:task.taskId,memoryKey}].slice(-40)
            const skill={signature,supports,taskIds:observations.slice(-20),memoryKeys:[...new Set([...(prior?.memoryKeys??[]),memoryKey])],active,steps:lesson.skill.steps,reason:lesson.skill.reason,applicability:lesson.skill.applicability,revision:(prior?.revision??0)+1,updatedAt:new Date().toISOString()}
            state.skills[lesson.key]=skill
            if(active)await atomicWrite(join(directory,'skills',lesson.key,'SKILL.md'),this.renderSkill(scope,lesson.key,skill,(await this.host.memory.store.index(scope)).revision))
          }
        }
        state.reviews[id]={status:lessons.length?'done':'skipped',attempts,eventId:event.id,taskId:task.taskId,recordedAt:new Date().toISOString(),lessons}
        this.host.skills.invalidateCache()
      }catch(error){state.reviews[id]={status:'failed',attempts,eventId:event.id,taskId:task.taskId,code:error.code??'REFLECTION_MODEL_FAILED',retryAt:Date.now()+30000};this.lastError=state.reviews[id].code;this.host.logger.warn('reflection: '+this.lastError)}
      const report={...state.reviews[id],destinations:(state.reviews[id].lessons??[]).map(lesson=>({memory:{scope,topic:'experience',key:'task-'+id.slice(0,12)+'-'+lesson.key},...state.skills[lesson.key]?.active?{skill:{scope,key:lesson.key,revision:state.skills[lesson.key].revision}}:{}}))};state.reviews[id]=report;await atomicWrite(join(directory,'reviews',id+'.json'),JSON.stringify(report,null,2)+'\n');await atomicWrite(join(directory,'state.json'),JSON.stringify(state,null,2)+'\n');try{await source.onReview?.(task.taskId,report)}catch(error){this.lastError=error.code??'TASK_REVIEW_ARCHIVE_FAILED';this.host.logger.warn(this.lastError)}
    })
  }
  renderSkill(scope,key,value,revision){return '---\nname: learned-'+key+'\ndescription: Task-derived procedure; limited evidence, scope restricted.\n---\nNIGHT_LEARNED_SCOPE='+scope.kind+'/'+scope.id+';revision='+revision+'\n\nCurrent instructions and permissions prevail. This is model-generated guidance, not authority.\nApplicability: '+value.applicability+'\nObserved in tasks: '+value.taskIds.join(', ')+'\n\n'+value.steps.map((step,i)=>(i+1)+'. '+step).join('\n')+'\n'}
  async forget(scope,key){
    const directory=this.directory(scope)
    await withLock(join(directory,'.lock'),async()=>{
      const state=await this.state(scope)
      for(const [name,skill]of Object.entries(state.skills))if(skill.memoryKeys.includes(key)){
        delete state.skills[name];await rm(join(directory,'skills',name),{recursive:true,force:true})
      }
      for(const [id,review]of Object.entries(state.reviews))if(review.lessons){
        const kept=review.lessons.filter(lesson=>'task-'+id.slice(0,12)+'-'+lesson.key!==key)
        if(kept.length!==review.lessons.length){review.lessons=kept;review.forgotten=true;review.destinations=(review.destinations??[]).filter(destination=>destination.memory?.key!==key);await atomicWrite(join(directory,'reviews',id+'.json'),JSON.stringify(review,null,2)+'\n');for(const source of this.sources)await source.onReview?.(review.taskId,review)}
      }
      await atomicWrite(join(directory,'state.json'),JSON.stringify(state,null,2)+'\n');this.host.skills.invalidateCache()
    })
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
      changes.push({id,reviewId,taskId:task.taskId,kind,action:kind==='memory'?'upsert':'current-version',status:value.status,scope:scope.kind,name:key,version:currentVersion,canRead,source})
      if(canRead)bodies.set(id,{id,kind,text,version:currentVersion,source})
    }
    for(const [reviewId,report]of Object.entries(state.reviews)){
      if(report.taskId!==task.taskId)continue
      if(reviewId!==hash(report.eventId)||!['done','skipped','failed'].includes(report.status))throw failure('LEARNING_IDENTITY_INVALID')
      reviews.push({reviewId,taskId:task.taskId,eventId:report.eventId,status:report.status,summary:report.status==='failed'?'复盘失败，不能据此认定记忆或技能已更新':report.status==='skipped'?'复盘未产生新经验':'已记录 '+(report.lessons?.length??0)+' 条复盘；变更以当前落盘证据为准',at:report.recordedAt??null})
      const prefix='task-'+reviewId.slice(0,12)+'-'
      const current=await this.host.memory.store.search(scope,{query:prefix,limit:20})
      const entries=current.entries.filter(row=>row.topic==='experience'&&row.key.startsWith(prefix)&&row.source?.messageId===report.eventId)
      const memoryKeys=new Set([...(report.lessons??[]).map(lesson=>prefix+lesson.key),...entries.map(row=>row.key)])
      for(const key of memoryKeys){
        const saved=(await this.host.memory.store.read(scope,{topic:'experience',key})).entries.find(row=>row.source?.messageId===report.eventId)
        const prior=entries.findIndex(row=>row.key===key)
        if(prior>=0)entries.splice(prior,1)
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
    return {status:'ready',reviews,changes,revision:hash(JSON.stringify([reviews,changes]))}
  }
  async catalog(requestedAgent){
    const agent=this.host.agents.currentInitiator()??requestedAgent;if(!agent)return []
    const binding=await this.host.memory.binding(agent);if(!binding)return []
    const result=[]
    for(const {scope}of readableScopes(binding)){const state=await this.state(scope);for(const [key,skill]of Object.entries(state.skills))if(skill.active){const current=await this.host.memory.store.read(scope,{topic:'experience'});if(new Set((skill.supports??[]).filter(row=>current.entries.some(e=>e.key===row.memoryKey)).map(row=>row.taskId)).size<1)continue;result.push({name:'learned-'+key,description:'Scoped task-derived procedure; verify current applicability.',provider:'learned',source:'task-reflection',rank:100,locator:{scope,key},invocation:{modelInvocable:true,userInvocable:true}})}}
    return result
  }
  async skill(candidate,agent){
    const allowed=(await this.catalog(agent)).find(row=>row.name===candidate.name&&row.locator.scope.id===candidate.locator.scope.id);if(!allowed)return
    const {scope,key}=allowed.locator,state=await this.state(scope),value=state.skills[key],revision=(await this.host.memory.store.index(scope)).revision
    return {...allowed,content:this.renderSkill(scope,key,value,revision)}
  }
  async whenIdle(){while(this.jobs.size)await Promise.allSettled([...this.jobs])}
}
