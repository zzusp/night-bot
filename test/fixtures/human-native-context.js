import {piRequestContext,piRequestEvent,piRequestSource} from '../../src/runtime/pi-request-context.js'

const parts=message=>typeof message.content==='string'?[{type:'text',text:message.content}]:message.content??[]
// The scripted model observes the same Night custom-instruction boundary as the
// real provider. A free customType/source field is never instruction provenance.
export {requestSystemText} from './session-persistence.js'
// Capture provenance before the common harness detaches/clones its observations;
// opaque native request associations deliberately do not survive structuredClone.
export function taskSessionMessages(request){
 const native=!!piRequestContext(request)
 return request.messages.flatMap(message=>{
  const entry=native?piRequestSource(request,message):undefined,event=native?piRequestEvent(request,message):undefined
  const source=native?(entry?.type==='message'&&entry.message.role==='user'&&event?.type==='user/message'?event.data.source:undefined):message.source
  return source?.taskSession?[{role:message.role,text:parts(message).filter(part=>part.type==='text').map(part=>part.text).join('')}]:[]
 })
}
