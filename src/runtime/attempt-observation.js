import {deepFreeze,snapshotJsonValue} from '../native-values.js'
import {createAssistantAudit} from './assistant-audit.js'

const supported=new Set(['block-start','block-end','text-delta','reasoning-delta','tool-call-delta','usage','finish'])
function snapshot(value){
 const copy=snapshotJsonValue(value)
 if(copy===undefined)throw new TypeError('Pi observation requires lossless JSON')
 return deepFreeze(copy)
}
function indexOf(chunk){
 if(!Number.isSafeInteger(chunk.index)||chunk.index<0||Object.is(chunk.index,-0))throw new TypeError('Pi observation index must be a non-negative safe integer')
 return chunk.index
}
const nativeType=type=>type==='reasoning'?'thinking':type==='tool-call'?'toolCall':type
function nativeContent(block){
 if(block.type==='text')return {type:'text',text:block.text}
 if(block.type==='reasoning')return {type:'thinking',thinking:block.text}
 if(block.type==='tool-call')return {type:'toolCall',id:block.id,name:block.name,argumentsText:block.arguments}
 return block
}
function auditContent(block,index){
 if(block.type==='thinking')return {type:'reasoning',text:block.thinking}
 if(block.type==='toolCall')return {type:'tool-call',id:block.id??`call-${index}`,name:block.name??'',arguments:block.argumentsText}
 return block
}

/** One-way application observation of admitted Pi provider output. Pi owns
 * execution and durable model history. Slots use Pi's text/thinking/toolCall
 * vocabulary; the chunk input and blocks() projection are Night's policy/audit
 * boundary, not an alternative inference protocol.
 *
 * Audit writes use an application-owned producer of the existing Night compact
 * format. Historical decoding remains in native-message-protocol with its source
 * notice; this observer runs no derived assembler or stream writer.
 */
export function createAttemptObservation(){
 const slots=new Map(),audit=createAssistantAudit()
 let usage,finish,replay
 function put(index,value){slots.set(index,value)}
 function reduce(chunk){
  if(chunk.type==='usage'){usage=chunk.usage;return}
  if(chunk.type==='finish'){finish=chunk.reason;replay=chunk.replayState;return}
  const index=indexOf(chunk),current=slots.get(index)
  if(current?.closed)return
  if(chunk.type==='block-end'){put(index,{closed:true,content:nativeContent(chunk.block)});return}
  if(chunk.type==='block-start'){
   if(!current)put(index,{content:{type:nativeType(chunk.blockType),...(chunk.blockType==='text'?{text:''}:chunk.blockType==='reasoning'?{thinking:''}:chunk.blockType==='tool-call'?{argumentsText:''}:{})}})
   return
  }
  const type=chunk.type==='text-delta'?'text':chunk.type==='reasoning-delta'?'thinking':'toolCall'
  const content=current?.content??{type,...(type==='text'?{text:''}:type==='thinking'?{thinking:''}:{argumentsText:''})}
  // Build a replacement value: previously returned snapshots never alias slots.
  if(type==='text')put(index,{content:{...content,text:(content.text??'')+chunk.text}})
  else if(type==='thinking')put(index,{content:{...content,thinking:(content.thinking??'')+chunk.text}})
  else put(index,{content:{...content,id:chunk.id,...chunk.name?{name:chunk.name}:{},argumentsText:(content.argumentsText??'')+chunk.argumentsDelta}})
 }
 function projection(){
  const all=[...slots].map(([index,slot])=>{
   if(!slot.closed&&!['text','thinking','toolCall'].includes(slot.content.type))throw new Error(`Cannot observe incomplete Pi content ${slot.content.type}`)
   return auditContent(slot.content,index)
  })
  // Native error/abort partial content is diagnostic; Pi terminal status prevents
  // tool execution. Preserve it for native response/signature matching.
  const unsafe=finish?.kind==='max-tokens'
  const keep=all.map(block=>!unsafe||block.type!=='tool-call')
  const blocks=all.filter((_,i)=>keep[i])
  let replayState=replay
  if(replay?.blocks!==undefined){
   if(replay.blocks.length!==all.length)replayState=undefined
   else if(blocks.length!==all.length)replayState={response:replay.response,blocks:replay.blocks.filter((_,i)=>keep[i])}
  }
  return {blocks:deepFreeze(blocks),replayState:replayState===undefined?undefined:deepFreeze(replayState)}
 }
 return Object.freeze({
  push(value){
   const chunk=snapshot(value)
   if(!supported.has(chunk.type))throw new TypeError(`Unsupported Pi observation chunk ${chunk.type}`)
   if(['text-delta','reasoning-delta'].includes(chunk.type)&&typeof chunk.text!=='string')throw new TypeError('Pi text delta must be a string')
   if(chunk.type==='tool-call-delta'&&(typeof chunk.id!=='string'||typeof chunk.argumentsDelta!=='string'||Object.hasOwn(chunk,'name')&&typeof chunk.name!=='string'))throw new TypeError('Invalid Pi tool delta')
   const time=Date.now()
   if(!Number.isSafeInteger(time))throw new TypeError('Pi audit time must be a safe integer')
   reduce(chunk)
   audit.append(time,chunk)
  },
  blocks:()=>projection().blocks,
  get stream(){return audit.snapshot()},
  get usage(){return usage},
  get finish(){return finish??Object.freeze({kind:'stop'})},
  get replayState(){return projection().replayState},
 })
}
