import {estimateTokens} from '@earendil-works/pi-coding-agent'
import {officialConversationContextBudget} from './pi-official-settings.js'

/** Disposable native Pi snapshots never own business effects. Adoption appends
 * an official compaction and commits it before admitting another model turn. */
export function createBackgroundCompaction({session,store,admission,compact,commit,signal,isHealthy=()=>true,measurePhase=(_phase,run)=>run(),onError=()=>{},outputReserveTokens}) {
 let generation=0,candidate,adopting,closed=false,timer,lastAttempt,preflight
 const running=new Set()
 const fingerprint=()=>JSON.stringify({leaf:store.manager.getLeafId(),count:store.manager.getEntries().length,revision:store.snapshot().revision,model:session.model,thinking:session.thinkingLevel,tools:session.getActiveToolNames(),prompt:session.systemPrompt,settings:session.settingsManager?.getSettings()})
 const idle=()=>!closed&&!signal?.aborted&&isHealthy()&&session.isIdle&&!session.pendingMessageCount&&!session.isRetrying&&!admission.paused&&!admission.pending().length
 const report=phase=>{void Promise.resolve(measurePhase(phase,async()=>{})).catch(onError)}
 const invalidate=()=>{
  generation++;clearTimeout(timer);timer=undefined
  if(candidate){const old=candidate;candidate=undefined;old.controller.abort();report('background-compaction-cancelled')}
 }
 const budgetFor=()=>officialConversationContextBudget(session.model,'CONVERSATION',{outputReserveTokens})
 const assertLive=()=>{signal?.throwIfAborted();if(closed||!isHealthy())throw Object.assign(new Error('Compaction owner unavailable'),{code:'PI_OFFICIAL_ACTOR_NOT_LIVE'})}
 const projectedTokens=()=>session.sessionManager.buildSessionProjection().messages.reduce((sum,message)=>sum+estimateTokens(message),0)
 const beforeInput=async packet=>{
  invalidate();if(adopting)await adopting
  if(preflight)await preflight
  assertLive()
  if(!packet||!session.isIdle)return
  const budget=budgetFor(),incoming=estimateTokens({role:'user',content:packet.content,timestamp:Date.now()})
  const tooLarge=()=>Object.assign(new Error('Message exceeds the available model context; pending input retained'),{code:'PI_CONTEXT_INPUT_TOO_LARGE'})
  if(incoming>budget.budgetTokens-budget.outputHeadroomTokens)throw tooLarge()
  const current=session.getContextUsage()?.tokens??projectedTokens()
  // Native Pi checks old history before adding a trigger. Reserve space for a
  // large new durable packet before its very first model request as well.
  if(current>0&&current<=budget.foregroundTokens&&current+incoming>budget.foregroundTokens){
   preflight=(async()=>{
    try{await session.compact()}
    catch(error){
     // Pinned Pi 1.5 reports recent-only history as a no-op, not model failure.
     if(!['Nothing to compact (session too small)','Already compacted'].includes(error?.message))throw error
    }
    assertLive();await commit()
   })()
   try{await preflight}finally{preflight=undefined}
   if(projectedTokens()+incoming>budget.budgetTokens-budget.outputHeadroomTokens)throw tooLarge()
  }
 }
 async function start(){
  timer=undefined
  if(candidate||adopting||!idle())return
  const tokens=session.getContextUsage()?.tokens,budget=budgetFor()
  if(!Number.isFinite(tokens)||tokens<budget.backgroundTokens)return
  const key=fingerprint()
  if(lastAttempt===key)return
  lastAttempt=key
  const attempt={generation,key,controller:new AbortController()};candidate=attempt
  const current=()=>candidate===attempt&&generation===attempt.generation&&!attempt.controller.signal.aborted&&idle()&&fingerprint()===attempt.key
  let ownAdoption
  try{
   const result=await measurePhase('background-compaction',()=>compact({signal:attempt.controller.signal}))
   if(!current())return
   // The fence and append have no asynchronous gap. New ingress waits only
   // for the short durability barrier, never for background summarization.
   if(typeof result?.summary!=='string'||!store.manager.getBranch().some(entry=>entry.id===result.firstKeptEntryId))throw new Error('PI_BACKGROUND_COMPACTION_RESULT_INVALID')
   store.manager.appendCompaction(result.summary,result.firstKeptEntryId,result.tokensBefore,result.details,false,result.usage)
   candidate=undefined
   ownAdoption=adopting=(async()=>{await commit();session.refreshContext();report('background-compaction-adopted')})()
   await ownAdoption
  }catch(error){if(!attempt.controller.signal.aborted)onError(error)}
  finally{if(candidate===attempt)candidate=undefined;if(adopting===ownAdoption)adopting=undefined}
 }
 const settled=()=>{
  if(closed||signal?.aborted||timer)return
  timer=setTimeout(()=>{const work=start();running.add(work);void work.finally(()=>running.delete(work)).catch(onError)},0)
  timer.unref?.()
 }
 let foregroundStart
 const unsubscribe=session.subscribe(event=>{
  if(event.type==='agent_settled')settled()
  if(event.type==='compaction_start'){invalidate();foregroundStart=Promise.withResolvers();const wait=foregroundStart.promise;void measurePhase('foreground-compaction',()=>wait).catch(onError)}
  if(event.type==='compaction_end'){if(event.aborted||event.errorMessage)foregroundStart?.reject(new Error('Pi foreground compaction did not complete'));else foregroundStart?.resolve();foregroundStart=undefined}
 })
 const abort=()=>{closed=true;invalidate();if(preflight)session.abortCompaction()}
 signal?.addEventListener('abort',abort,{once:true})
 return {invalidate,beforeInput,settled,get pending(){return !!candidate||!!adopting},
  async close(){abort();foregroundStart?.reject(new Error('Compaction owner closed'));foregroundStart=undefined;unsubscribe();signal?.removeEventListener('abort',abort);await Promise.allSettled([...running]);if(adopting)await adopting;if(preflight)await preflight.catch(()=>{})},
 }
}
