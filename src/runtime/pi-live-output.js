import {randomUUID} from 'node:crypto'
import {AgentSession} from '@earendil-works/pi-coding-agent'

// Ephemeral native-event mirror only. It is never a journal, task state, or
// another message history. Web access still requires the committed identity.
const readers = new WeakMap(), modelStarts = new WeakMap()
const MAX_TEXT = 262144, MAX_TOOLS = 64, MAX_BLOCKS = 64, TTL = 120000
const content = blocks => {let remaining=MAX_TEXT;return (Array.isArray(blocks)?blocks:[]).slice(0,MAX_BLOCKS).filter(block=>block?.type==='text'&&typeof block.text==='string').map(block=>{const text=block.text.slice(0,remaining);remaining-=text.length;return {type:'text',text}})}
export function createPiLiveOutputBuffer(sessionId, {clock=Date.now}={}) {
 let active=false, revision=0, current, sequence=0, lastEvent=clock(), expiry,phase,phaseStartedAt,compaction,retry,notice
 const tools=new Map(), epoch=randomUUID()
 const setPhase=value=>{if(phase!==value){phase=value;phaseStartedAt=new Date(clock()).toISOString()}}
 const key=kind=>`${epoch}:${kind}:${++sequence}`
 function accept(event) {
  revision++;lastEvent=clock()
  if(event.type==='compaction_start'){compaction={reason:event.reason,startedAt:new Date(lastEvent).toISOString()};notice=undefined;return}
  if(event.type==='compaction_end'){
   if(!compaction||compaction.reason!==event.reason)return
   compaction=undefined
   if(retry?.source==='compaction')retry=undefined
   if(event.aborted||event.errorMessage)notice={kind:event.aborted?'cancelled':'failed',source:'compaction'}
   return
  }
  if(event.type==='auto_retry_start'||event.type==='summarization_retry_scheduled'&&event.source==='compaction'&&compaction){
   if(Number.isSafeInteger(event.attempt)&&event.attempt>0&&Number.isSafeInteger(event.maxAttempts)&&event.maxAttempts>=event.attempt){
    const source=event.type==='auto_retry_start'?'model':'compaction'
    retry={source,startedAt:new Date(lastEvent).toISOString(),notice:{kind:'retry',source,attempt:event.attempt,maxAttempts:event.maxAttempts}}
    notice=undefined
   }
   return
  }
  if(event.type==='auto_retry_end'){
   if(retry?.source==='model'){retry=undefined;if(!event.success)notice={kind:event.finalError==='Retry cancelled'?'cancelled':'failed',source:'model'}}
   return
  }
  if(event.type==='summarization_retry_finished'){if(retry?.source==='compaction')retry=undefined;return}
  if(event.type==='model_stream_start'){active=true;setPhase('waiting');if(retry?.source==='model')retry.visible=false;return}
  if(event.type==='agent_start') {phase=undefined;setPhase('preparing');active=true;current=undefined;notice=undefined;if(retry?.source==='model')retry.visible=false;tools.clear();return}
  if(event.type==='agent_end'||event.type==='agent_settled') {phase=undefined;phaseStartedAt=undefined;active=false;current=undefined;if(event.type==='agent_settled')retry=undefined;tools.clear();return}
  if((event.type==='message_start'||event.type==='message_update')&&event.message?.role==='assistant') {
   active=true
   if(!current)current={id:key('assistant'),done:new Set()}
   const update=event.assistantMessageEvent
   if(update?.type?.startsWith('thinking_'))setPhase('thinking')
   else if(update?.type?.startsWith('text_'))setPhase('text')
   else if(event.type==='message_start'||!phase)setPhase('waiting')
   if(['text_end','thinking_end'].includes(update?.type)&&Number.isSafeInteger(update.contentIndex)&&update.contentIndex>=0&&update.contentIndex<MAX_BLOCKS)current.done.add(update.contentIndex)
   current.message={role:'assistant',timestamp:event.message.timestamp,content:(Array.isArray(event.message.content)?event.message.content:[]).slice(0,MAX_BLOCKS).flatMap((block,index)=>{
    if(block?.type==='text'&&typeof block.text==='string')return [{type:'text',text:block.text.slice(0,MAX_TEXT),complete:current.done.has(index)&&block.text.length<=MAX_TEXT}]
    if(block?.type==='thinking'&&typeof block.thinking==='string'&&block.redacted!==true)return [{type:'thinking',thinking:block.thinking.slice(0,MAX_TEXT),complete:current.done.has(index)&&block.thinking.length<=MAX_TEXT}]
    return [{type:'omitted'}]
   })}
  }
  if(event.type==='message_end') {
   if(event.message?.role==='assistant'){current=undefined;setPhase('preparing')}
   if(event.message?.role==='toolResult'){tools.delete(event.message.toolCallId);if(![...tools.values()].some(tool=>!tool.complete))setPhase('preparing')}
  }
  if(['tool_execution_start','tool_execution_update','tool_execution_end'].includes(event.type)&&typeof event.toolCallId==='string'&&typeof event.toolName==='string') {
   active=true
   if(event.type!=='tool_execution_end')setPhase('tool')
   if(!tools.has(event.toolCallId)&&tools.size>=MAX_TOOLS)return
   const previous=tools.get(event.toolCallId)
   if(previous&&previous.toolName!==event.toolName){tools.delete(event.toolCallId);return}
   const result=event.type==='tool_execution_end'?event.result:event.partialResult
   const startedAt=previous?.startedAt??(event.type==='tool_execution_start'?new Date(lastEvent).toISOString():undefined)
   tools.set(event.toolCallId,{id:previous?.id??key('tool'),toolCallId:event.toolCallId,toolName:event.toolName,content:result?content(result.content):previous?.content??[],...startedAt?{startedAt}:{},ended:event.type==='tool_execution_end',complete:event.type==='tool_execution_end'&&(result?.content??[]).length<=MAX_BLOCKS&&(result?.content??[]).filter(block=>block?.type==='text').reduce((sum,block)=>sum+String(block.text??'').length,0)<=MAX_TEXT,isError:event.isError===true})
  }
 }
 const latched=()=>active||compaction||retry||notice||current||tools.size
 const clear=()=>{active=false;phase=undefined;phaseStartedAt=undefined;current=undefined;compaction=undefined;retry=undefined;notice=undefined;tools.clear();revision++}
 const expire=()=>{if(clock()-lastEvent>TTL&&latched())clear()}
 const trim=()=>{
  let remaining=MAX_TEXT
  if(current?.message)for(const block of current.message.content){if(block.type!=='text'&&block.type!=='thinking')continue;const field=block.type==='text'?'text':'thinking';if(block[field].length>remaining){block[field]=block[field].slice(0,remaining);block.complete=false}remaining-=block[field].length}
  for(const tool of tools.values())for(const block of tool.content){if(block.text.length>remaining){block.text=block.text.slice(0,remaining);tool.complete=false}remaining-=block.text.length}
 }
 return {withdrawTool(callId){tools.delete(callId);revision++},accept(event){expire();accept(event);trim();clearTimeout(expiry);if(latched())expiry=setTimeout(clear,TTL).unref()},snapshot(){
  expire();const waitingRetry=retry?.visible!==false?retry:undefined,visible=!!(active||compaction||waitingRetry),status=waitingRetry?.notice??notice
  return structuredClone({sessionId,active:visible,...visible?{phase:compaction?'compaction':waitingRetry?'retry':phase,phaseStartedAt:compaction?.startedAt??waitingRetry?.startedAt??phaseStartedAt}:{},...status?{notice:status}:{},revision:`${epoch}:${revision}`,assistant:current?{id:current.id,message:current.message}:null,tools:[...tools.values()]})
 },close(){clearTimeout(expiry);clear()}}
}
const validations=new WeakMap(),withdrawers=new WeakMap()
export function setPiLiveToolValidation(actor,callId,validator){
 let checks=validations.get(actor);if(!checks){checks=new Map();validations.set(actor,checks)}
 if(checks.size>=64&&!checks.has(callId))return false
 checks.set(callId,validator);return true
}
export function withdrawPiLiveTool(actor,callId){withdrawers.get(actor)?.(callId)}
export function bindPiLiveOutput(actor) {
 const session=actor?.piSession
 if(!(session instanceof AgentSession)||actor.id!==session.sessionId)throw new TypeError('Official Pi session required')
 const buffer=createPiLiveOutputBuffer(actor.id)
 const observe=event=>{try{buffer.accept(event);if(event.type==='message_end'&&event.message?.role==='toolResult')validations.get(actor)?.delete(event.message.toolCallId);if(event.type==='agent_end'||event.type==='agent_settled')validations.get(actor)?.clear()}catch{buffer.close();validations.get(actor)?.clear()}}
 modelStarts.set(actor,()=>observe({type:'model_stream_start'}))
 const off=session.agent.subscribe(observe)
 const signals=new Set(['agent_settled','compaction_start','compaction_end','auto_retry_start','auto_retry_end','summarization_retry_scheduled','summarization_retry_finished'])
 const offSession=session.subscribe(event=>{if(signals.has(event.type))observe(event)})
 withdrawers.set(actor,callId=>buffer.withdrawTool(callId))
 readers.set(actor,()=>{
  const snapshot=buffer.snapshot(),checks=validations.get(actor)
  for(const tool of snapshot.tools){const check=checks?.get(tool.toolCallId);if(check){let valid=false;try{valid=check()===true}catch{}if(!valid)withdrawPiLiveTool(actor,tool.toolCallId)}}
  return buffer.snapshot()
 })
 return {close(){off();offSession();buffer.close();readers.delete(actor);modelStarts.delete(actor);validations.delete(actor);withdrawers.delete(actor)}}
}
export function readPiLiveOutput(actor) {return readers.get(actor)?.()??null}
export function markPiLiveModelStart(actor) {modelStarts.get(actor)?.()}
