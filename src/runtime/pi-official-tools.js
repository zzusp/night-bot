import {snapshotJsonValue,deepFreeze} from '../native-values.js'
import {validateJsonSchemaValue,ToolArgsError} from '../native-tool-protocol.js'

const stopped=message=>Object.assign(new Error(message),{name:'AbortError'})

/** Business resource leases only. Pi retains batching, message order and tool
 * iteration. A writer at the FIFO head cannot be bypassed by later readers.
 * Aborting an admitted body does not release its lease until execute settles.
 */
class ToolLeases {
 constructor(capacity){this.capacity=capacity;this.active=0;this.writer=false;this.queue=[];this.waiters=[];this.closed=false}
 acquire(classify,signal){
  if(this.closed||signal.aborted)return Promise.reject(stopped('Tool resource admission cancelled'))
  return new Promise((resolve,reject)=>{
   const ticket={classify,signal,resolve,reject}
   ticket.abort=()=>{const index=this.queue.indexOf(ticket);if(index>=0){this.queue.splice(index,1);signal.removeEventListener('abort',ticket.abort);reject(stopped('Tool resource admission cancelled'));this.pump()}}
   signal.addEventListener('abort',ticket.abort,{once:true});this.queue.push(ticket);this.pump()
  })
 }
 pump(){
  while(!this.closed&&!this.writer&&this.active<this.capacity&&this.queue.length){
   const next=this.queue[0]
   if(next.signal.aborted){next.abort();continue}
   let writer=true;try{writer=next.classify()!=='parallel'}catch{}
   if(writer&&this.active)break
   this.queue.shift();next.signal.removeEventListener('abort',next.abort);this.active++;this.writer=writer
   let released=false
   next.resolve(()=>{if(released)return;released=true;this.active--;if(writer)this.writer=false;this.pump()})
   if(writer)break
  }
  if(!this.active&&!this.queue.length)for(const resolve of this.waiters.splice(0))resolve()
 }
 drain(){return this.active||this.queue.length?new Promise(resolve=>this.waiters.push(resolve)):Promise.resolve()}
 close(){this.closed=true;for(const ticket of this.queue.splice(0)){ticket.signal.removeEventListener('abort',ticket.abort);ticket.reject(stopped('Tool resource admission closed'))}this.pump();return this.drain()}
}

const resultFor=message=>({isError:true,content:[{type:'text',text:message}],details:{businessAdmission:'closed'}})
const contextActors=new WeakMap()
/** A factory capability using only the official context-only message API.
 * The actor/session pointer, not a string id, binds the destination. */
export function createOfficialToolContextDelivery({session,actor,fence}){
 if(!session||actor?.piSession!==session||session.sessionManager?.getSessionId()!==actor.id||typeof session.sendCustomMessage!=='function'||typeof fence!=='function')throw new TypeError('Exact official actor/session and failure fence required')
 const send=session.sendCustomMessage.bind(session),manager=session.sessionManager,id=actor.id
 const port=Object.freeze({publish:message=>{if(actor.piSession!==session||actor.id!==id||session.sessionManager!==manager||manager.getSessionId()!==id)throw new Error('Official tool context destination changed');return send(message,{triggerTurn:false})},fence})
 contextActors.set(port,actor)
 return port
}

async function officialContent(content,ctx,signal){
 const result=[]
 for(const block of content){
  if(block.type==='text'){result.push({type:'text',text:block.text});continue}
  if(block.type==='image'&&typeof block.data==='string'&&typeof block.mimeType==='string'){result.push({type:'image',data:block.data,mimeType:block.mimeType});continue}
  if(block.type==='image'&&block.attachment){
   const attachments=ctx.get('attachments');if(!attachments)throw new Error('Official tool image requires the attachment provider')
   const image=await attachments.readImage(block.attachment,signal)
   result.push({type:'image',data:Buffer.from(image.data).toString('base64'),mimeType:image.ref.mediaType});continue
  }
  throw new TypeError('Unsupported content in official tool result: '+block.type)
 }
 return result
}

/** Supply these actual customTools to createAgentSession, and compose finishTurn
 * with the official agent's public hook. No session/message/loop is implemented.
 * beginTurn is a host business-admission boundary before a new public prompt.
 */
export function createPiOfficialTools({registry,owner,businessAudit,maxParallelToolCalls}){
 if(!registry||!owner||!Number.isInteger(maxParallelToolCalls)||maxParallelToolCalls<1)throw new TypeError('Official tools need a registry, owner and positive maxParallelToolCalls')
 if(!businessAudit||typeof businessAudit.flush!=='function'||typeof businessAudit.isLive!=='function')throw new TypeError('Official tools require a durable business audit port')
 const leases=new ToolLeases(maxParallelToolCalls),lifetime=new AbortController()
 let concluded=false,fenced,contextDelivery
 const customTools=registry.wireSchemas(owner).schemas.map(schema=>{
  const definition=registry.get(schema.name,owner),outputSchema=registry.contracts.get(definition)?.output??definition?.output.schema
  return{
  name:schema.name,label:schema.name,description:schema.description,parameters:schema.parameters,
  ...outputSchema===undefined?{}:{outputSchema},
  // Official Pi invokes this before its permissive coercion pass. Preserve the
  // captured raw JSON type contract and never default or coerce model inputs.
  prepareArguments(input){const args=snapshotJsonValue(input);const issues=args===undefined?['arguments must be lossless JSON']:validateJsonSchemaValue(schema.parameters,args,'');if(issues.length)throw new ToolArgsError(issues);return deepFreeze(args)},
  executionMode:'parallel',replay:'never',
  async execute(callId,args,signal){
   const operation=async()=>{
   const combined=signal?AbortSignal.any([signal,lifetime.signal]):lifetime.signal
   if(concluded||fenced||!businessAudit.isLive())return resultFor('Tool effect admission closed for this business turn')
   let release
   try{
    release=await leases.acquire(()=>registry.executionMode({name:schema.name,agent:owner,arguments:args}).kind,combined)
    if(concluded||fenced||!businessAudit.isLive())return resultFor('Tool effect admission closed for this business turn')
    // All durable effect receipts must settle inside this awaited pipeline. An
    // unawaited SDK event/result observer is not a receipt or an admission proof.
    const result=await registry.execute({agent:owner,name:schema.name,callId,arguments:args,signal:combined,businessAudit})
    if(result.concludesTurn)concluded=true
    if(result.additionalContexts?.length){
     try{
      if(!contextDelivery)throw Object.assign(new Error('Official tool supplemental context delivery is not bound'),{code:'PI_OFFICIAL_TOOL_CONTEXT_DELIVERY_REQUIRED'})
      const drafts=[]
      for(const context of result.additionalContexts){
       if(!context||typeof context!=='object'||Array.isArray(context)||!Array.isArray(context.content)||context.role!==undefined&&context.role!=='user')throw new TypeError('Tool supplemental context must be user-role content')
       const {content,...metadata}=context
       // These are already admitted post-policy contexts, including safety
       // fences preserved on error/abort. Do not discard them with caller abort.
       drafts.push({customType:'night.tool-context',content:await officialContent(content,registry.ctx),display:false,details:{toolCallId:callId,toolName:schema.name,metadata}})
      }
      for(const draft of drafts)await contextDelivery.publish(draft)
     }catch(cause){
      fenced??=cause
      try{contextDelivery?.fence(cause)}catch{}
      return{isError:true,content:[{type:'text',text:'Tool supplemental context delivery failed: '+cause.message}],details:{nativeResult:result,contextDeliveryError:{message:cause.message,...cause.code?{code:cause.code}:{}}}}
     }
    }
    return{content:await officialContent(result.content,registry.ctx,combined),details:{nativeResult:result},isError:result.isError===true,...result.isError?{}:{structuredContent:result.value},...result.concludesTurn?{terminate:true}:{}}
   }finally{release?.()}
   }
   const agents=registry.ctx.get('agents')
   if(agents){if(typeof agents.withInitiator!=='function')throw new Error('Trusted agent initiator capability required');return agents.withInitiator(owner,operation)}
   // Small isolated registry fixtures may intentionally omit NativeAgents.
   // Production composition supplies its existing trusted dynamic slot.
   return operation()
  },
 }})
 return{
  customTools,
  bindContextDelivery(port){if(contextActors.get(port)!==owner)throw new Error('Foreign official tool context destination');if(contextDelivery&&contextDelivery!==port)throw new Error('Official tool context delivery already bound');contextDelivery=port},
  beginTurn(){if(leases.active||leases.queue.length)throw new Error('Previous business tool effects have not drained');if(lifetime.signal.aborted)throw new Error('Official tools closed');concluded=false},
  finishTurn(){if(concluded||fenced)return{action:'end'}},
  fence(reason){fenced=reason??new Error('Business effects fenced')},
  drain:()=>leases.drain(),
  async close(){lifetime.abort(stopped('Official tools closed'));await leases.close();contextDelivery=undefined},
 }
}
