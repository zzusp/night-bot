import {randomUUID} from 'node:crypto'
import {AgentSession} from '@earendil-works/pi-coding-agent'

// Ephemeral native-event mirror only. It is never a journal, task state, or
// another message history. Web access still requires the committed identity.
const readers = new WeakMap()
const MAX_TEXT = 262144, MAX_TOOLS = 64, MAX_BLOCKS = 64, TTL = 120000
const content = blocks => {let remaining=MAX_TEXT;return (Array.isArray(blocks)?blocks:[]).slice(0,MAX_BLOCKS).filter(block=>block?.type==='text'&&typeof block.text==='string').map(block=>{const text=block.text.slice(0,remaining);remaining-=text.length;return {type:'text',text}})}
export function createPiLiveOutputBuffer(sessionId, {clock=Date.now}={}) {
 let active=false, revision=0, current, sequence=0, lastEvent=clock(), expiry
 const tools=new Map(), epoch=randomUUID()
 const key=kind=>`${epoch}:${kind}:${++sequence}`
 function accept(event) {
  revision++;lastEvent=clock()
  if(event.type==='agent_start') {active=true;current=undefined;tools.clear();return}
  if(event.type==='agent_end'||event.type==='agent_settled') {active=false;current=undefined;tools.clear();return}
  if((event.type==='message_start'||event.type==='message_update')&&event.message?.role==='assistant') {
   active=true
   if(!current)current={id:key('assistant'),done:new Set()}
   const update=event.assistantMessageEvent
   if(['text_end','thinking_end'].includes(update?.type)&&Number.isSafeInteger(update.contentIndex)&&update.contentIndex>=0&&update.contentIndex<MAX_BLOCKS)current.done.add(update.contentIndex)
   current.message={role:'assistant',timestamp:event.message.timestamp,content:(Array.isArray(event.message.content)?event.message.content:[]).slice(0,MAX_BLOCKS).flatMap((block,index)=>{
    if(block?.type==='text'&&typeof block.text==='string')return [{type:'text',text:block.text.slice(0,MAX_TEXT),complete:current.done.has(index)&&block.text.length<=MAX_TEXT}]
    if(block?.type==='thinking'&&typeof block.thinking==='string'&&block.redacted!==true)return [{type:'thinking',thinking:block.thinking.slice(0,MAX_TEXT),complete:current.done.has(index)&&block.thinking.length<=MAX_TEXT}]
    return []
   })}
  }
  if(event.type==='message_end') {
   if(event.message?.role==='assistant')current=undefined
   if(event.message?.role==='toolResult')tools.delete(event.message.toolCallId)
  }
  if(['tool_execution_start','tool_execution_update','tool_execution_end'].includes(event.type)&&typeof event.toolCallId==='string'&&typeof event.toolName==='string') {
   active=true
   if(!tools.has(event.toolCallId)&&tools.size>=MAX_TOOLS)return
   const previous=tools.get(event.toolCallId)
   if(previous&&previous.toolName!==event.toolName){tools.delete(event.toolCallId);return}
   const result=event.type==='tool_execution_end'?event.result:event.partialResult
   tools.set(event.toolCallId,{id:previous?.id??key('tool'),toolCallId:event.toolCallId,toolName:event.toolName,content:result?content(result.content):previous?.content??[],complete:event.type==='tool_execution_end'&&(result?.content??[]).length<=MAX_BLOCKS&&(result?.content??[]).filter(block=>block?.type==='text').reduce((sum,block)=>sum+String(block.text??'').length,0)<=MAX_TEXT,isError:event.isError===true})
  }
 }
 const expire=()=>{if(clock()-lastEvent>TTL&&(active||current||tools.size)){active=false;current=undefined;tools.clear();revision++}}
 const trim=()=>{
  let remaining=MAX_TEXT
  if(current?.message)for(const block of current.message.content){const field=block.type==='text'?'text':'thinking';if(block[field].length>remaining){block[field]=block[field].slice(0,remaining);block.complete=false}remaining-=block[field].length}
  for(const tool of tools.values())for(const block of tool.content){if(block.text.length>remaining){block.text=block.text.slice(0,remaining);tool.complete=false}remaining-=block.text.length}
 }
 return {accept(event){expire();accept(event);trim();clearTimeout(expiry);if(active)expiry=setTimeout(()=>{active=false;current=undefined;tools.clear();revision++},TTL).unref()},snapshot(){expire();return structuredClone({sessionId,active,revision:`${epoch}:${revision}`,assistant:current?{id:current.id,message:current.message}:null,tools:[...tools.values()]})},close(){clearTimeout(expiry);active=false;current=undefined;tools.clear();revision++}}
}
const validations=new WeakMap(),withdrawers=new WeakMap()
export function setPiLiveToolValidation(actor,callId,validator){
 if(!withdrawers.has(actor))return true
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
 const off=session.agent.subscribe(observe)
 const offSession=session.subscribe(event=>{if(event.type==='agent_settled')observe(event)})
 withdrawers.set(actor,callId=>buffer.accept({type:'message_end',message:{role:'toolResult',toolCallId:callId}}))
 readers.set(actor,()=>{
  const snapshot=buffer.snapshot(),checks=validations.get(actor)
  for(const tool of snapshot.tools){const check=checks?.get(tool.toolCallId);if(check){let valid=false;try{valid=check()===true}catch{}if(!valid)withdrawPiLiveTool(actor,tool.toolCallId)}}
  return buffer.snapshot()
 })
 return {close(){off();offSession();buffer.close();readers.delete(actor);validations.delete(actor);withdrawers.delete(actor)}}
}
export function readPiLiveOutput(actor) {return readers.get(actor)?.()??null}
