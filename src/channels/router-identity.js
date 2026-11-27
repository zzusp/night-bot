export const GLOBAL_ROUTER_SCOPE='night-bot-global-router'
export const GLOBAL_ROUTER_SESSION='router-global-v1'
export const isGlobalRouter=header=>header?.id===GLOBAL_ROUTER_SESSION&&header.conversationId===GLOBAL_ROUTER_SCOPE
  &&header.generation===1&&header.runtimeOwner==='conversation-router'
