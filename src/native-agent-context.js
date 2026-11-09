import {scopeTarget} from './native-scope.js'
export const agentCarrier=agent=>scopeTarget(agent,agent)
export const assembleContextFor=(agent,signal)=>({agent,scope:agent,...signal===undefined?{}:{signal}})
/** The subject and scope are inseparable. Payload fields cannot replace agent. */
export function agentEvents(ctx,agent,carrier=agentCarrier(agent)){
 const fused=payload=>({...payload,agent})
 return{
  emit(name,payload){const args=[carrier,name,fused(payload)];for(const callback of ctx.events.dispatch('emit',args))try{Promise.resolve(callback(...args)).catch(error=>ctx.logger.warn(error))}catch(error){ctx.logger.warn(error)}},
  async serial(name,payload){return ctx.serial(carrier,name,fused(payload))},
  waterfall(name,payload,...rest){return ctx.waterfall(carrier,name,fused(payload),...rest)}
 }
}
export const emitAgentEvent=(ctx,agent,name,payload)=>agentEvents(ctx,agent).emit(name,payload)
