import {createHash} from 'node:crypto'
import {isDeepStrictEqual} from 'node:util'
import {z} from 'zod'

const fail=code=>Object.assign(new Error(code),{code})
const startSchema=z.strictObject({id:z.string().min(1),name:z.string().min(1),beforeEntryIds:z.array(z.string().min(1))})
const ackSchema=z.strictObject({id:z.string().min(1),entryId:z.string().min(1),bodyDigest:z.string().regex(/^[a-f0-9]{64}$/)})
export const skillCommandAuditKinds=Object.freeze({
 'admission/command-started':value=>startSchema.safeParse(value).success,
 'admission/command-admitted':value=>ackSchema.safeParse(value).success,
})
export const commandBodyDigest=content=>createHash('sha256').update(JSON.stringify(content)).digest('hex')
// This parses only the public Pi command prefix. Pi owns expansion and rendering.
export function skillCommand(packet){
 const parts=typeof packet.content==='string'?[{type:'text',text:packet.content}]:packet.content
 if(!Array.isArray(parts)||parts[0]?.type!=='text')return
 const match=/^\/skill:([^\s]+)(?:\s|$)/.exec(parts[0].text)
 if(!match)return
 if(parts.slice(1).some(part=>part.type!=='image'))throw fail('PI_SKILL_COMMAND_CONTENT_INVALID')
 return {name:match[1],text:parts[0].text,images:parts.slice(1)}
}

/** Correlate one authorized Host command with Pi's actual user entry. The
 * original packet remains authority; expanded skill text never becomes input
 * authority. Incomplete starts are deliberately not repaired or replayed. */
export async function createSkillCommandInput({store,lookupPacket,authorize}){
 const starts=new Map(),acks=new Map(),byEntry=new Map();let session,unsubscribe,detachAbort,active,tail=Promise.resolve(),closed=false,failure
 const append=(kind,payload)=>store.appendAudit({version:1,domain:'admission',kind,payload})
 const healthy=()=>{if(failure)throw failure;if(closed)throw fail('PI_SKILL_COMMAND_CLOSED')}
 for(const receipt of await store.readAudit()){
  if(receipt.domain!=='admission')continue
  if(receipt.kind==='command-started'){
   const value=startSchema.parse(receipt.payload),packet=lookupPacket(value.id)
   if(starts.has(value.id)||!packet||skillCommand(packet)?.name!==value.name||new Set(value.beforeEntryIds).size!==value.beforeEntryIds.length)throw fail('PI_SKILL_COMMAND_RECEIPT_INVALID')
   starts.set(value.id,value)
  }else if(receipt.kind==='command-admitted'){
   const value=ackSchema.parse(receipt.payload)
   if(!starts.has(value.id)||acks.has(value.id)||byEntry.has(value.entryId))throw fail('PI_SKILL_COMMAND_RECEIPT_INVALID')
   const entry=store.manager.getEntries().find(entry=>entry.id===value.entryId)
   if(entry?.type!=='message'||entry.message.role!=='user'||commandBodyDigest(entry.message.content)!==value.bodyDigest||starts.get(value.id).beforeEntryIds.includes(entry.id))throw fail('PI_SKILL_COMMAND_ACK_INVALID')
   acks.set(value.id,value);byEntry.set(value.entryId,value)
  }
 }
 async function acknowledge(){
  healthy()
  if(!active)return
  if(await authorize(active.packet,active.command.name)!==true)throw fail('PI_SKILL_COMMAND_DENIED')
  const entries=store.manager.getEntries().filter(entry=>!active.before.has(entry.id)&&entry.type==='message'&&entry.message.role==='user')
  if(!entries.length)return
  if(entries.length!==1||active.observed.length!==1||!isDeepStrictEqual(entries[0].message.content,active.observed[0]))throw fail('PI_SKILL_COMMAND_CORRELATION_INVALID')
  const entry=entries[0],ack={id:active.packet.id,entryId:entry.id,bodyDigest:commandBodyDigest(entry.message.content)}
  append('command-admitted',ack)
  try{await store.commit()}catch(error){failure=error;throw error}
  acks.set(ack.id,ack);byEntry.set(ack.entryId,ack)
  const completed=active;active=undefined;completed.resolve(ack)
 }
 return {
  bindSession(value,{signal}={}){
   if(session&&session!==value)throw fail('PI_SKILL_COMMAND_SESSION_CONFLICT')
   if(signal&&!detachAbort){const abort=()=>{active?.reject(fail('PI_SKILL_COMMAND_CANCELLED'));active=undefined};signal.addEventListener('abort',abort,{once:true});detachAbort=()=>signal.removeEventListener('abort',abort);if(signal.aborted)abort()}
   if(session)return
   session=value
   unsubscribe=session.subscribe(event=>{if(active&&event.type==='message_end'&&event.message.role==='user')active.observed.push(structuredClone(event.message.content))})
  },
  has:id=>starts.has(id),
  status:id=>acks.has(id)?'admitted':starts.has(id)?'uncertain':undefined,
  lookupEntry(entryId){const ack=byEntry.get(entryId);return ack?{...ack,packet:structuredClone(lookupPacket(ack.id))}:undefined},
  async beforeRequest(){
   try{for(const id of starts.keys())if(!acks.has(id)&&active?.packet.id!==id)throw fail('PI_SKILL_COMMAND_UNCERTAIN');await acknowledge();if(active)throw fail('PI_SKILL_COMMAND_ACK_REQUIRED')}
   catch(error){failure=error;active?.reject(error);throw error}
  },
  deliver(packet,command,{deliverAs}){
   const operation=tail.then(async()=>{
    healthy();if(!session)throw fail('PI_SKILL_COMMAND_SESSION_REQUIRED')
    if(acks.has(packet.id))return {id:packet.id,duplicate:true,admitted:true}
    if(starts.has(packet.id))throw fail('PI_SKILL_COMMAND_UNCERTAIN')
    if(await authorize(packet,command.name)!==true)throw fail('PI_SKILL_COMMAND_DENIED')
    const prior=store.manager.getEntries().map(entry=>entry.id),started={id:packet.id,name:command.name,beforeEntryIds:prior}
    append('command-started',started);await store.commit();starts.set(packet.id,started)
    const ack=Promise.withResolvers();ack.promise.catch(()=>{})
    active={packet,command,before:new Set(prior),observed:[],...ack}
    let running,preflight
    try{
     running=Promise.resolve(session.prompt(command.text,{images:command.images,streamingBehavior:deliverAs,source:'interactive',preflightResult:result=>{preflight=result}}))
     running.then(async()=>{if(preflight==='queued')return;if(active?.packet.id===packet.id){try{await acknowledge();if(active?.packet.id===packet.id){active.reject(fail('PI_SKILL_COMMAND_UNCERTAIN'));active=undefined}}catch(error){active?.reject(error);active=undefined}}},error=>{if(active?.packet.id===packet.id){active.reject(error);active=undefined}}).catch(error=>{failure??=error})
     await ack.promise
     return {id:packet.id,duplicate:false,admitted:true,running}
    }catch(error){if(active?.packet.id===packet.id)active=undefined;throw error}
   })
   tail=operation.then(()=>{},()=>{})
   return operation.then(async result=>{await result.running;const {running,...out}=result;return out})
  },
  async close(){closed=true;unsubscribe?.();detachAbort?.();active?.reject(fail('PI_SKILL_COMMAND_CLOSED'));active=undefined;await tail},
 }
}
