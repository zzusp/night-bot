import {createSkillCommandInput,skillCommand,skillCommandAuditKinds} from './pi-skill-command-input.js'
import {z} from 'zod'
import {isDeepStrictEqual} from 'node:util'
import {snapshotJsonValue,deepFreeze} from '../native-values.js'

const text=z.strictObject({type:z.literal('text'),text:z.string()})
const image=z.strictObject({type:z.literal('image'),data:z.string(),mimeType:z.string().min(1)})
const packetSchema=z.strictObject({id:z.string().min(1),source:z.looseObject({kind:z.string().min(1)}),content:z.union([z.string(),z.array(z.union([text,image]))])})
const admittedSchema=z.strictObject({id:z.string().min(1),entryId:z.string().min(1)})
const cancelledSchema=z.strictObject({id:z.string().min(1),reason:z.string().min(1)})
export const admissionAuditKinds=Object.freeze({
 ...skillCommandAuditKinds,
 'admission/enqueued':value=>packetSchema.safeParse(value).success,
 'admission/enqueued-internal':value=>packetSchema.safeParse(value).success,
 'admission/admitted':value=>admittedSchema.safeParse(value).success,
 'admission/cancelled':value=>cancelledSchema.safeParse(value).success,
})
const fail=code=>Object.assign(new Error(code),{code})

/** A durable application delivery outbox, not an agent inbox or conversation.
 * Pi's public sendCustomMessage/steer/followUp own all model scheduling. Recovery
 * restores delivery facts only and never invokes a model or repeats an effect.
 */
export async function createBusinessAdmission({store,authorize,bindInternal,authorizeSkillCommand}) {
 if(store?.kind!=='pi-native'||typeof authorize!=='function')throw new TypeError('Native store and explicit admission authority required')
 const packets=new Map(),admitted=new Map(),inflight=new Set(),internalPackets=new Set(),cancelled=new Set()
 let tail=Promise.resolve(),failure,paused=false,current,closed=false
 const healthy=()=>{if(failure)throw failure;if(closed)throw fail('PI_BUSINESS_ADMISSION_CLOSED')}
 const append=(kind,payload)=>store.appendAudit({version:1,domain:'admission',kind,payload})
 function restore(receipt){
  if(receipt.domain!=='admission')return
  if(receipt.kind==='enqueued'||receipt.kind==='enqueued-internal'){
   const packet=deepFreeze(packetSchema.parse(receipt.payload)),prior=packets.get(packet.id)
   if(prior&&!isDeepStrictEqual(prior,packet))throw fail('PI_BUSINESS_ADMISSION_ID_CONFLICT')
   packets.set(packet.id,packet)
   if(receipt.kind==='enqueued-internal')internalPackets.add(packet.id)
  }else if(receipt.kind==='admitted'){
   const ack=admittedSchema.parse(receipt.payload)
   if(!packets.has(ack.id)||admitted.has(ack.id))throw fail('PI_BUSINESS_ADMISSION_ACK_INVALID')
   admitted.set(ack.id,ack.entryId)
  }else if(receipt.kind==='cancelled'){
   const ack=cancelledSchema.parse(receipt.payload)
   if(!packets.has(ack.id)||admitted.has(ack.id)||cancelled.has(ack.id))throw fail('PI_BUSINESS_ADMISSION_ACK_INVALID')
   cancelled.add(ack.id)
  }
 }
 for(const receipt of await store.readAudit())restore(receipt)
 const commands=await createSkillCommandInput({store,lookupPacket:id=>packets.get(id),authorize:async(packet,name)=>!internalPackets.has(packet.id)&&await authorize(packet)===true&&typeof authorizeSkillCommand==='function'&&await authorizeSkillCommand(packet,name)===true})
 for(const id of packets.keys())if(commands.has(id)&&(admitted.has(id)||cancelled.has(id)))throw fail('PI_BUSINESS_ADMISSION_ACK_INVALID')
 const serialize=action=>{const operation=tail.then(()=>{healthy();return action()});tail=operation.catch(()=>{});return operation}
 const commit=async()=>{try{await store.commit()}catch(cause){failure??=cause;throw failure}}
 const findEntry=packet=>{
  const entries=store.manager.getEntries().filter(entry=>entry.type==='custom_message'&&entry.customType==='night.business-input'&&entry.details?.packetId===packet.id)
  if(entries.length>1)throw fail('PI_BUSINESS_ADMISSION_DUPLICATE_ENTRY')
  const entry=entries[0]
  if(entry&&(!isDeepStrictEqual(entry.details,{packetId:packet.id,source:packet.source})||!isDeepStrictEqual(entry.content,packet.content)))throw fail('PI_BUSINESS_ADMISSION_ENTRY_CONFLICT')
  return entry
 }
 for(const [id,entryId]of admitted){if(findEntry(packets.get(id))?.id!==entryId)throw fail('PI_BUSINESS_ADMISSION_ACK_INVALID')}
 async function acknowledge(){
  healthy();const acknowledgements=[]
  for(const packet of packets.values())if(!admitted.has(packet.id)&&!cancelled.has(packet.id)){
   const entry=findEntry(packet)
   if(entry){const ack={id:packet.id,entryId:entry.id};append('admitted',ack);acknowledgements.push(ack)}
  }
  await commit()
  for(const ack of acknowledgements)admitted.set(ack.id,ack.entryId)
 }
 async function enqueue(input,internal=false){
   const packet=deepFreeze(packetSchema.parse(snapshotJsonValue(input)))
   return serialize(async()=>{
    if(!internal&&await authorize(packet)!==true)throw fail('PI_BUSINESS_ADMISSION_DENIED')
    const previous=packets.get(packet.id)
    if(previous){if(!isDeepStrictEqual(previous,packet))throw fail('PI_BUSINESS_ADMISSION_ID_CONFLICT');return {id:packet.id,duplicate:true,admitted:admitted.has(packet.id)||commands.status(packet.id)==='admitted'}}
    append(internal?'enqueued-internal':'enqueued',packet);await commit();packets.set(packet.id,packet);if(internal)internalPackets.add(packet.id)
    return {id:packet.id,duplicate:false,admitted:false}
   })
 }
 // This constructor callback receives the producer capability. It is never
 // exposed on the actor's public outbox, nor selected by self-reported source.
 if(bindInternal!==undefined){if(typeof bindInternal!=='function')throw new TypeError('Internal publisher receiver required');bindInternal(input=>enqueue(input,true))}
 return {
  enqueue:input=>enqueue(input),
  has:id=>packets.has(id),
  status:id=>commands.status(id)??(admitted.has(id)?'admitted':cancelled.has(id)?'cancelled':packets.has(id)?'pending':undefined),
  bindSession:(session,options)=>commands.bindSession(session,options),
  lookupCommandEntry:entryId=>commands.lookupEntry(entryId),
  lookupPacket:id=>packets.has(id)?structuredClone(packets.get(id)):undefined,
  pending:()=>[...packets.keys()].filter(id=>!admitted.has(id)&&!cancelled.has(id)&&commands.status(id)!=='admitted'),
  current:()=>current===undefined?undefined:structuredClone(current),
  pause(){healthy();paused=true},
  resume(){healthy();paused=false},
  get paused(){return paused},
  beforeRequest:()=>serialize(async()=>{if(paused)throw fail('PI_BUSINESS_ADMISSION_PAUSED');await acknowledge();await commands.beforeRequest()}),
  cancelPending(reason='user'){
   return serialize(async()=>{
    if(typeof reason!=='string'||!reason)throw new TypeError('Cancellation reason required')
    await acknowledge()
    const ids=[...packets.keys()].filter(id=>!admitted.has(id)&&!cancelled.has(id)&&!commands.has(id))
    for(const id of ids)append('cancelled',{id,reason})
    await commit();for(const id of ids)cancelled.add(id)
    return ids
   })
  },
  async deliver(session,id,{deliverAs='steer'}={}){
   healthy();if(paused)throw fail('PI_BUSINESS_ADMISSION_PAUSED')
   if(!['steer','followUp'].includes(deliverAs))throw fail('PI_BUSINESS_ADMISSION_MODE_INVALID')
   const packet=packets.get(id);if(!packet)throw fail('PI_BUSINESS_ADMISSION_MISSING')
   if(cancelled.has(id))throw fail('PI_BUSINESS_INPUT_CANCELLED')
   // A previous process may have committed the SDK entry before its caller saw
   // the acknowledgment. Repair only the business receipt, never redeliver it.
   await serialize(acknowledge)
   if(admitted.has(id)||inflight.has(id))return {id,duplicate:true}
   if(!internalPackets.has(id)&&await authorize(packet)!==true)throw fail('PI_BUSINESS_ADMISSION_DENIED')
   healthy();if(paused)throw fail('PI_BUSINESS_ADMISSION_PAUSED')
   if(admitted.has(id)||inflight.has(id))return {id,duplicate:true}
   const command=!internalPackets.has(id)?skillCommand(packet):undefined
   if(command){
    if(typeof authorizeSkillCommand!=='function')throw fail('PI_SKILL_COMMAND_DENIED')
    commands.bindSession(session);current={id,messages:[structuredClone(packet)]}
    return commands.deliver(packet,command,{deliverAs})
   }
   inflight.add(id);current={id,messages:[structuredClone(packet)]}
   try{
    await session.sendCustomMessage({customType:'night.business-input',content:packet.content,display:false,details:{packetId:id,source:packet.source}},{triggerTurn:true,deliverAs})
    await serialize(acknowledge)
    return {id,duplicate:false,admitted:admitted.has(id)}
   }finally{inflight.delete(id)}
  },
  async close(){paused=true;await commands.close();await tail;closed=true},
 }
}
