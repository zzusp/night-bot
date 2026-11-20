import {officialConversationContextBudget} from '../../../src/runtime/pi-official-settings.js'
// Read the current live Pi projection only: no journal scan, session opening or
// inference. Pi's usage is an estimate of the current context, not lifetime usage.
export async function routerContextWindow(tasks, agents, conversationId) {
 const unavailable={status:'unavailable'}
 if(!tasks?.store?.query||!agents?.get)return unavailable
 const row=await tasks.store.query({kind:'router.get',conversationId})
 if(row?.id!==conversationId||row.phase!=='active'||!Number.isSafeInteger(row.generation)||row.generation<1||!row.activeSessionId)return unavailable
 const actor=agents.get(row.activeSessionId),session=actor?.piSession,meta=actor?.metadata
 if(actor?.id!==row.activeSessionId||session?.sessionId!==row.activeSessionId||meta?.runtimeOwner!=='conversation-router'||meta.conversationId!==conversationId||meta.generation!==row.generation||actor.lifecycle?.signal.aborted||typeof session.getContextUsage!=='function')return unavailable
 let usage,budget
 try{
  usage=session.getContextUsage()
  const model=session.routedModel?.model??session.model
  if(model?.contextWindow!==usage?.contextWindow)return unavailable
  budget=officialConversationContextBudget(model,'ROUTER').budgetTokens
 }catch{return unavailable}
 if(!Number.isSafeInteger(usage?.tokens)||usage.tokens<=0||!Number.isSafeInteger(usage.contextWindow)||usage.contextWindow<=0)return unavailable
 const current=await tasks.store.query({kind:'router.get',conversationId})
 if(current?.activeSessionId!==row.activeSessionId||current.generation!==row.generation||current.phase!=='active'||agents.get(row.activeSessionId)!==actor||actor.lifecycle?.signal.aborted)return unavailable
 // The SDK does not expose a non-overlapping category breakdown. Do not derive
 // categories from lifetime/cached token counters or serialize context content.
 return {status:'ready',basis:'pi-context-estimate',tokens:usage.tokens,contextWindow:budget,modelWindow:usage.contextWindow,categories:[{key:'unclassified',label:'未分类',tokens:usage.tokens}]}
}
