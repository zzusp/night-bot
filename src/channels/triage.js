import {z} from 'zod'
import {checkedText} from '../memory/format.js'

export const TRIAGE_BATCH_LIMIT=15
const disposition=z.object({sourceId:z.string().min(1),messageVersion:z.number().int().positive(),needsHandling:z.boolean(),reply:z.string().min(1).max(1000).optional(),reason:z.string().min(1).max(2000)}).strict()
export const triageDecisionSchema=z.object({dispositions:z.array(disposition).min(1).max(TRIAGE_BATCH_LIMIT)}).strict()
export const triageParameters={type:'object',additionalProperties:false,required:['dispositions'],properties:{dispositions:{type:'array',minItems:1,maxItems:TRIAGE_BATCH_LIMIT,items:{type:'object',additionalProperties:false,required:['sourceId','messageVersion','needsHandling','reason'],properties:{sourceId:{type:'string'},messageVersion:{type:'integer',minimum:1},needsHandling:{type:'boolean'},reply:{type:'string',minLength:1,maxLength:1000},reason:{type:'string',minLength:1,maxLength:2000}}}}}}

/** A triage decision covers original sources, never model-created topics/tasks. */
export function validateTriageDecision(messages,input){
  if(!messages.length||messages.length>TRIAGE_BATCH_LIMIT)throw Error('TRIAGE_BATCH_LIMIT')
  const result=triageDecisionSchema.parse(input),covered=new Set()
  for(const item of result.dispositions){
    const source=messages.find(source=>source.sourceId===item.sourceId&&(source.version??source.messageVersion)===item.messageVersion)
    if(!source)throw Error('TRIAGE_SOURCE_OUTSIDE_BATCH')
    if(covered.has(item.sourceId))throw Error('TRIAGE_DUPLICATE_SOURCE')
    covered.add(item.sourceId)
    if(item.reply!==undefined)item.reply=checkedText(item.reply)
  }
  if(messages.some(source=>!covered.has(source.sourceId)))throw Error('TRIAGE_BATCH_INCOMPLETE')
  return result
}

// Historical Topic journals remain readable, but cannot re-enter active routing.
export const feedbackParameters=triageParameters
export function triageState(request){return {messages:request.messages.map(message=>({sourceId:message.sourceId,messageVersion:message.version??message.messageVersion})),sessionId:request.sessionId,sealed:request.sealed===true}}
export function createTriageFeedback(){return async()=>{throw Error('TOPIC_ROUTING_RETIRED')}}
export function appendTriagePacket(){throw Error('TOPIC_ROUTING_RETIRED')}
