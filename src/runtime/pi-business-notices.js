import {AgentSession} from '@earendil-works/pi-coding-agent'
const publishers=new WeakMap()
const fail=()=>Object.assign(new Error('PI_BUSINESS_NOTICE_CAPABILITY_REQUIRED'),{code:'PI_BUSINESS_NOTICE_CAPABILITY_REQUIRED'})
/** Only trusted application producers use this port. Input source strings and
 * equal session IDs never select or grant an internal publisher capability. */
export function bindBusinessNotices(actor,port){
 if(!(actor?.piSession instanceof AgentSession)||typeof port?.enqueue!=='function'||typeof port.isLive!=='function')throw fail()
 if(publishers.has(actor))throw fail()
 const cell={enqueue:port.enqueue.bind(port),isLive:port.isLive.bind(port)};publishers.set(actor,cell)
 return()=>{if(publishers.get(actor)===cell)publishers.delete(actor)}
}
export async function enqueueBusinessNotice(actor,packet){
 const port=publishers.get(actor);if(!port||port.isLive(actor)!==true)throw fail()
 return port.enqueue(packet)
}
