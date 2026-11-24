import {estimateTokens} from '@earendil-works/pi-coding-agent'
import {getCurrentSystemMessage,toToolDeclaration} from '@earendil-works/pi-ai'
import {officialConversationContextBudget} from './pi-official-settings.js'

const conversationStateSection='night_'+Buffer.from('conversation-state').toString('hex')
// Pi's appendCompaction checkpoints the effective system message. Only the
// per-turn Router state patch can follow the snapshot, not instructions/tools.
const isConversationStatePatch=message=>message.role==='system'&&message.content===''&&!message.toolsAdded?.length&&!message.toolsRemoved?.length
 &&Object.keys(message.sections??{}).length===1&&Object.hasOwn(message.sections,conversationStateSection)

/** Disposable native Pi snapshots never own business effects. Adoption appends
 * an official compaction and commits it before admitting another model turn. */
export function createBackgroundCompaction({session,store,admission,compact,commit,signal,isHealthy=()=>true,isInputHealthy=isHealthy,measurePhase=(_phase,run)=>run(),onError=()=>{},onAdopted=()=>{},outputReserveTokens,getInitialPromptTokens=()=>0}) {
 let candidate,adopting,closed=false,timer,lastAttempt,preflight,initialPromptTokens=0
 const running=new Set()
 const settingsKey=()=>JSON.stringify({model:session.model,thinking:session.thinkingLevel,tools:session.getActiveToolNames(),prompt:session.systemPrompt,settings:session.settingsManager?.getSettings()})
 const canAdopt=()=>!closed&&!signal?.aborted&&isHealthy()&&session.isIdle&&!session.pendingMessageCount&&!session.isRetrying&&!admission.paused
 const idle=()=>canAdopt()&&!preflight&&!admission.pending().length
 const checkpoint=()=>({leaf:store.manager.getLeafId(),count:store.manager.getEntryCount(),revision:store.snapshot().revision,settings:settingsKey()})
 const compatible=base=>{
  const manager=store.manager
  if(settingsKey()!==base.settings)return false
  let id=manager.getLeafId(),remaining=manager.getEntryCount()-base.count
  if(remaining===0)return id===base.leaf&&store.snapshot().revision===base.revision
  // 验证新增条目就是原 leaf 的线性后缀；分支、编辑及提示变化不能被旧摘要覆盖。
  if(remaining<0)return false
  for(;remaining>0;remaining--){
   if(id===base.leaf)return false
   const entry=manager.getEntry(id)
   if(!(entry?.type==='custom'&&['night.audit','night.commit'].includes(entry.customType)
    ||entry?.type==='custom_message'&&entry.customType==='night.business-input'
    ||entry?.type==='message'&&(['user','assistant','toolResult'].includes(entry.message.role)||isConversationStatePatch(entry.message))))return false
   id=entry.parentId
  }
  return id===base.leaf
 }
 const report=(phase,attempt)=>{void Promise.resolve(measurePhase(phase,async()=>{},attempt.runId)).catch(onError)}
 const invalidate=()=>{
  clearTimeout(timer);timer=undefined
  if(candidate){const old=candidate;candidate=undefined;old.controller.abort();report('background-compaction-cancelled',old)}
 }
 const budgetFor=()=>officialConversationContextBudget(session.model,'CONVERSATION',{outputReserveTokens})
 const assertLive=()=>{signal?.throwIfAborted();if(closed||!isInputHealthy())throw Object.assign(new Error('Compaction owner unavailable'),{code:'PI_OFFICIAL_ACTOR_NOT_LIVE'})}
 const fixedTokens=(messages=session.sessionManager.buildSessionProjection().messages)=>{
  const system=getCurrentSystemMessage(messages)??{role:'system',content:session.systemPrompt??'',timestamp:0}
  return estimateTokens({...system,toolsAdded:session.agent?.state.tools.map(toToolDeclaration)??system.toolsAdded})+initialPromptTokens
 }
 const projectedTokens=()=>{
  const messages=session.sessionManager.buildSessionProjection().messages
  return fixedTokens(messages)+messages.reduce((sum,message)=>sum+(message.role==='system'?0:estimateTokens(message)),0)
 }
 const beforeInput=async packet=>{
  if(!packet)invalidate()
  if(adopting)await adopting
  if(preflight)await preflight
  assertLive()
  if(!packet)return
  if(!session.sessionManager.buildSessionProjection().messages.some(message=>message.role==='system'))initialPromptTokens=await getInitialPromptTokens()
  else initialPromptTokens=0
  if(preflight)await preflight
  assertLive()
  const packets=Array.isArray(packet)?packet:[packet],budget=budgetFor()
  const incoming=packets.reduce((sum,input)=>sum+estimateTokens({role:'user',content:input.content,timestamp:Date.now()}),0)
  const available=budget.budgetTokens-budget.outputHeadroomTokens
  const tooLarge=()=>Object.assign(new Error('Message exceeds the available model context; pending input retained'),{code:'PI_CONTEXT_INPUT_TOO_LARGE'})
  if(fixedTokens()+incoming>available)throw tooLarge()
  // 正在运行的 steer 也必须检查单包；压缩只能在 Pi 空闲时进行。
  if(!session.isIdle)return
  const current=Math.max(session.getContextUsage()?.tokens??0,projectedTokens())
  if(current+incoming>budget.foregroundTokens){
   preflight=(async()=>{
    const attempt=candidate
    if(attempt&&canAdopt()&&compatible(attempt.base)){
     await attempt.work
     assertLive()
     if(!session.isIdle)return
     if(await adopt(attempt,true)&&projectedTokens()+incoming<=available)return
    }
    invalidate()
    const settings=session.settingsManager,model=session.model,key=`${model.provider}/${model.id}`
    const previous=settings.getCompactionSettings(model).keepRecentTokens
    // 固定提示及新输入不可压缩；剩余额度由近期历史和摘要共享。
    const keepRecentTokens=Math.min(previous,Math.floor((available-fixedTokens()-incoming)/2))
    settings.applyOverrides({compaction:{modelOverrides:{[key]:{keepRecentTokens}}}})
    try{await session.compact()}
    catch(error){
     // Pi 1.5 also reports abortCompaction as an ordinary cancellation Error.
     // Preserve the owning cancellation reason, not a replacement SDK error.
     if(error?.name==='AbortError'||error?.message==='Compaction cancelled')signal?.throwIfAborted()
     // Pinned Pi 1.5 reports recent-only history as a no-op, not model failure.
     if(!['Nothing to compact (session too small)','Already compacted'].includes(error?.message))throw error
    }finally{settings.applyOverrides({compaction:{modelOverrides:{[key]:{keepRecentTokens:previous}}}})}
    assertLive();await commit()
   })()
   try{await preflight}finally{preflight=undefined}
  }
  if(projectedTokens()+incoming>available)throw tooLarge()
 }
 async function adopt(attempt,forInput=false){
  if(candidate!==attempt||!attempt.result||!(forInput?canAdopt():idle()))return false
  if(!compatible(attempt.base)){invalidate();return false}
  const {result,elapsedMs}=attempt
  // 采用始终在原会话上追加；之后的新业务条目仍位于 Pi 保留的原始尾部。
  const entryId=store.manager.appendCompaction(result.summary,result.firstKeptEntryId,result.tokensBefore,result.details,false,result.usage)
  candidate=undefined
  const work=adopting=(async()=>{await commit();session.refreshContext();report('background-compaction-adopted',attempt)
   if(typeof entryId==='string')try{onAdopted(entryId,elapsedMs)}catch(error){onError(error)}
  })()
  try{await work;return true}finally{if(adopting===work)adopting=undefined}
 }
 async function start(){
  timer=undefined
  try{
   if(!idle()||adopting)return
   if(candidate){
    if(compatible(candidate.base)){await adopt(candidate);return}
    invalidate()
   }
   const tokens=session.getContextUsage()?.tokens,budget=budgetFor()
   if(!Number.isFinite(tokens)||tokens<budget.backgroundTokens)return
   const base=checkpoint(),key=JSON.stringify(base)
   if(lastAttempt===key)return
   lastAttempt=key
   // 摘要与采用可能跨业务轮；沿用启动时的阶段归属，不能借用新输入的运行 ID。
   const attempt={base,runId:admission.current?.()?.id??'host-lifecycle',controller:new AbortController()};candidate=attempt
   const begin=performance.now()
   attempt.work=(async()=>{
    try{
     const result=await measurePhase('background-compaction',()=>compact({signal:attempt.controller.signal}),attempt.runId)
     if(candidate!==attempt)return
     if(!compatible(base)){invalidate();return}
     if(typeof result?.summary!=='string'||!store.manager.getBranch().some(entry=>entry.id===result.firstKeptEntryId))throw new Error('PI_BACKGROUND_COMPACTION_RESULT_INVALID')
     attempt.result=result;attempt.elapsedMs=performance.now()-begin
    }catch(error){if(candidate===attempt)candidate=undefined;if(!attempt.controller.signal.aborted)onError(error)}
   })()
   await attempt.work
   await adopt(attempt)
  }catch(error){onError(error)}
 }
 const settled=()=>{
  if(closed||signal?.aborted||timer)return
  timer=setTimeout(()=>{const work=start();running.add(work);void work.finally(()=>running.delete(work)).catch(onError)},0)
  timer.unref?.()
 }
 let foregroundStart
 const unsubscribe=session.subscribe(event=>{
  if(event.type==='agent_settled')settled()
  if(event.type==='compaction_start'){invalidate();if(closed||signal?.aborted)session.abortCompaction();foregroundStart=Promise.withResolvers();const wait=foregroundStart.promise;void measurePhase('foreground-compaction',()=>wait).catch(onError)}
  if(event.type==='compaction_end'){if(event.aborted||event.errorMessage)foregroundStart?.reject(new Error('Pi foreground compaction did not complete'));else foregroundStart?.resolve();foregroundStart=undefined}
 })
 const abort=()=>{closed=true;invalidate();if(preflight)session.abortCompaction()}
 signal?.addEventListener('abort',abort,{once:true})
 return {invalidate,beforeInput,settled,get pending(){return !!candidate||!!adopting},
  async close(){abort();await Promise.allSettled([...running]);if(adopting)await adopting;if(preflight)await preflight.catch(()=>{});foregroundStart?.reject(new Error('Compaction owner closed'));foregroundStart=undefined;unsubscribe();signal?.removeEventListener('abort',abort)},
 }
}
