import {registerPartialCompatiblePostPolicy} from '../../src/runtime/tool-partial-policy.js'
import {createHash} from 'node:crypto'
import {z} from 'zod'
import {isNativeSkillLoader} from '../../src/native-tool-skill.js'
import {scopeOf} from '../../src/native-scope.js'
import {AgentSession} from '@earendil-works/pi-coding-agent'

const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex')
const resultDigest=result=>digest({value:result.value,content:result.content})
const skillDigest=value=>digest([value.provider,value.resourceBase,value.content])
const base={key:z.string().min(1),name:z.string().min(1),version:z.string().min(1)}
const resource=z.strictObject({kind:z.literal('directory'),path:z.string().min(1)})
const recordSchema=z.discriminatedUnion('kind',[
 z.strictObject({kind:z.literal('skill'),...base,resourceBase:resource.optional()}),
 z.strictObject({kind:z.literal('reference'),...base,path:z.string().min(1)}),
])
const receiptSchema=z.strictObject({callId:z.string().min(1),resultEntryId:z.string().min(1),record:recordSchema})
export const skillObservationAuditKinds=Object.freeze({'skill-observation/read':value=>receiptSchema.safeParse(value).success})
const installed=new WeakMap()
const fail=code=>Object.assign(new Error(code),{code})

/** Business read-version receipts only. Pi owns history, tool calls/results and
 * the custom-message notification. An old successful tool result without a
 * version receipt is not promoted into current instruction evidence. */
export async function installSessionSkillRefresh(ctx,actor,{cwd,signal}){
 const get=name=>ctx.get(name),skills=get('skills'),tools=get('tools'),agents=get('agents'),session=actor?.piSession
 if(!(session instanceof AgentSession)||typeof actor.receipts?.read!=='function'||typeof actor.receipts?.commit!=='function'||typeof actor.requestPolicy?.addBeforeRequest!=='function')throw fail('PI_SKILL_OBSERVATION_PORT_REQUIRED')
 if(scopeOf(ctx)!==actor||scopeOf(actor.ctx)!==actor||agents?.get(actor.id)!==actor||session.sessionId!==actor.id||actor.lifecycle?.isLive()!==true||actor.lifecycle.signal.aborted||signal?.aborted)throw fail('PI_SKILL_OBSERVATION_ACTOR_NOT_LIVE')
 if(installed.has(actor))return installed.get(actor)
 const loader=tools?.get('skill',actor),trustedLoader=isNativeSkillLoader(loader);if(!skills||!loader)return {async close(){},async refresh(){}}
 const currentCwd=()=>get('workingDirectory')?.get(actor)??cwd
 const filesystem=get('agentPresets')?.serviceFor?.(actor,'fs')??get('fs'),readers=new Map(['read','read_window'].map(name=>[name,tools.get(name,actor)]).filter(([,tool])=>tool)),loaded=new Map(),references=new Map(),observations=new WeakMap(),prepared=new WeakMap(),legacy=new Set(),pendingResults=new Map(),disposers=[]
 let closed=false,tail=Promise.resolve(),failure,pending=[],lastNotice,renderedPromptKey
 const alive=()=>{if(closed||signal?.aborted||actor.lifecycle?.isLive()!==true||actor.lifecycle.signal.aborted||actor.piSession!==session||scopeOf(ctx)!==actor||agents?.get(actor.id)!==actor)throw fail('PI_SKILL_OBSERVATION_ACTOR_NOT_LIVE')}
 const remember=record=>{if(record.kind==='skill'){if(digest(loaded.get(record.key)?.resourceBase??null)!==digest(record.resourceBase??null))for(const [key,ref]of references)if(ref.name===record.name)references.delete(key);loaded.set(record.key,record);legacy.delete(record.name)}else references.set(record.key,record)}
 // Official entries provide successful call/result pairing; receipts carry only
 // Night's version fact. No message conversion, context replay or event fold.
 const calls=new Map(),success=new Map()
 for(const {sourceEntry:entry,messages} of session.sessionManager.buildSessionProjection().entries)for(const message of messages){
  if(message.role==='assistant')for(const block of message.content)if(block.type==='toolCall')calls.set(block.id,block)
  if(message.role==='toolResult'&&!message.isError){const call=calls.get(message.toolCallId);if(call&&call.name===message.toolName){success.set(entry.id,{call,message});if(call.name==='skill'&&typeof call.arguments?.name==='string')legacy.add(call.arguments.name)}}
 }
 for(const receipt of await actor.receipts.read())if(receipt.domain==='skill-observation'&&receipt.kind==='read'){
  const data=receiptSchema.parse(receipt.payload)
  const evidence=success.get(data.resultEntryId)
  if(evidence?.message.toolCallId===data.callId&&(data.record.kind==='skill'?evidence.call.name==='skill'&&evidence.call.arguments?.name===data.record.name:['read','read_window'].includes(evidence.call.name)))remember(data.record)
 }
 const text=()=>[
  pending.length?`本会话已读技能或引用有变化：${JSON.stringify(pending)}。继续相关操作前，用原生 skill 重读对应入口、read 按需重读相关引用；缺失或读取失败如实说明。此提示不是已读取的证据，不扩大授权，也不要求重做已经有效完成的操作。`:'',
  legacy.size?`历史成功技能调用尚无可核对版本记录：${JSON.stringify([...legacy])}。先按当前目录判断本阶段适用项，再用原生 skill 重读；不把旧同名工具回执当成当前规则。`:'',
 ].filter(Boolean).join('\n')
 const prompt=get('systemPrompt');if(prompt)disposers.push(prompt.context({name:'dingtalk:skill-refresh',order:21,required:true,text:()=>text(),officialText:async()=>{await refresh();const value=text();renderedPromptKey=digest(value);return value}}))
 async function refresh(){
  alive();await tail;if(failure)throw failure
  const changed=[]
  for(const record of loaded.values()){
   let version
   try{const value=await agents.withInitiator(actor,()=>skills.get(record.name,{cwd:currentCwd(),scope:actor,signal}));version=value&&value.invocation?.modelInvocable!==false?skillDigest(value):'unavailable'}catch(error){if(signal?.aborted)throw error;version='unreadable'}
   if(version!==record.version)changed.push({key:record.key,name:record.name,version})
  }
  if(filesystem)for(const record of references.values()){
   let version
   try{version=await agents.withInitiator(actor,async()=>{const root=await filesystem.resolve(loaded.get(record.name).resourceBase.path,{cwd:currentCwd(),signal}),target=await filesystem.resolve(record.path,{cwd:currentCwd(),signal});return filesystem.contains(root,target)?(await filesystem.stat(target,signal))?.version??'unavailable':'unavailable'})}catch(error){if(signal?.aborted)throw error;version='unreadable'}
   if(version!==record.version)changed.push({key:record.key,name:record.name,path:record.path,version})
  }
  pending=changed;alive()
  const notice=text(),key=digest(notice)
  if(notice&&key!==lastNotice){await session.sendCustomMessage({customType:'night.skill-version-notice',content:notice,display:false,details:{kind:'skill-version-change'}},{triggerTurn:false});lastNotice=key}
  if(!notice)lastNotice=undefined
 }
 disposers.push(ctx.on('fs/observed',(target,observation,exec)=>{
  if(exec?.agent===actor&&readers.has(exec.name)&&tools.get(exec.name,actor)===readers.get(exec.name)&&observation.kind==='present'&&typeof observation.version==='string')observations.set(exec,{path:filesystem.processPath(target),version:observation.version})
 }))
 disposers.push(registerPartialCompatiblePostPolicy(ctx,async(exec,result,next)=>{
  const decision=await next(),observation=observations.get(exec);observations.delete(exec)
  if(exec.agent!==actor||result.isError||decision.kind!=='accept')return decision
  alive();let record
  if(trustedLoader&&exec.name==='skill'&&tools.get('skill',actor)===loader&&result.value?.name===exec.arguments.name&&typeof result.value.content==='string'){
   const value=result.value;record={kind:'skill',key:value.name,name:value.name,version:skillDigest(value),...value.resourceBase?{resourceBase:value.resourceBase}:{}}
  }else if(observation&&filesystem){
   try{const target=await filesystem.resolve(observation.path,{cwd:currentCwd(),signal});for(const skill of loaded.values())if(skill.resourceBase?.kind==='directory'){const root=await filesystem.resolve(skill.resourceBase.path,{cwd:currentCwd(),signal});if(filesystem.contains(root,target)){record={kind:'reference',key:observation.path,name:skill.name,...observation};break}}}catch(error){if(signal?.aborted)throw error;for(const skill of loaded.values())legacy.add(skill.name)}
  }
  if(record)prepared.set(exec,{record:recordSchema.parse(record),valueDigest:resultDigest(result)})
  return decision
 },exec=>{alive();return exec.agent===actor&&['bash','pwsh'].includes(exec.name)}))
 disposers.push(ctx.on('tools/result',(exec,result)=>{
  const item=prepared.get(exec);prepared.delete(exec)
  if(!item||exec.agent!==actor||result.isError||resultDigest(result)!==item.valueDigest)return
  pendingResults.set(exec.callId,{...item,toolName:exec.name})
 }))
 disposers.push(session.agent.subscribe(async event=>{
  if(event.type!=='message_end'||event.message.role!=='toolResult')return
  const message=event.message,item=pendingResults.get(message.toolCallId);pendingResults.delete(message.toolCallId)
  if(!item||message.isError||message.toolName!==item.toolName)return
  const entry=session.sessionManager.getEntries().findLast(entry=>entry.type==='message'&&entry.message.role==='toolResult'&&entry.message.toolCallId===message.toolCallId&&entry.message.toolName===message.toolName&&!entry.message.isError)
  if(!entry)throw fail('PI_SKILL_OBSERVATION_RESULT_ENTRY_REQUIRED')
  const operation=tail.then(async()=>{alive();const previous=(item.record.kind==='skill'?loaded:references).get(item.record.key);if(previous&&digest(previous)===digest(item.record)){await actor.receipts.commit();return;}await actor.receipts.append({version:1,domain:'skill-observation',kind:'read',payload:{callId:message.toolCallId,resultEntryId:entry.id,record:item.record}});await actor.receipts.commit();remember(item.record)})
  tail=operation.catch(cause=>{failure??=cause})
  await operation
 }))
 disposers.push(actor.requestPolicy.addBeforeRequest(async()=>{
  await refresh();const notice=text()
  if(notice&&renderedPromptKey!==digest(notice)&&!session.sessionManager.buildSessionProjection().messages.some(message=>message.role==='custom'&&message.customType==='night.skill-version-notice'&&message.content===notice))throw fail('PI_SKILL_VERSION_NOTICE_PENDING')
 }))
 // The public Agent finishTurn hook is awaited before SDK turn_end flushes
 // context-only custom messages. AgentSession UI subscribers are synchronous.
 const previousFinish=session.agent.finishTurn
 const finish=async function(...args){const result=await previousFinish?.apply(this,args);if(!closed&&!signal?.aborted)await refresh();return result}
 session.agent.finishTurn=finish
 disposers.push(()=>{if(session.agent.finishTurn===finish)session.agent.finishTurn=previousFinish})
 const handle={refresh,async close(){if(closed)return;closed=true;installed.delete(actor);for(const dispose of disposers.reverse())if(typeof dispose==='function')dispose();await tail;if(failure)throw failure}}
 installed.set(actor,handle)
 return handle
}
