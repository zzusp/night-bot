import {estimateTokens} from '@earendil-works/pi-coding-agent'
import {getCurrentSystemMessage} from '@earendil-works/pi-ai'
import {officialConversationContextBudget} from '../../../src/runtime/pi-official-settings.js'

// Keep only numeric detail for the current Pi leaf. A polling request never
// re-estimates the same projection or opens a cold session.
const breakdowns=new WeakMap()
const skillReads=new Set(['skill','resident_skill_query'])
const memoryReads=new Set(['memory_index','memory_read','memory_search','resident_memory_review'])
function estimateBreakdown(messages){
 const counts={messages:0,skills:0,memory:0,systemTools:0,system:0,tools:0}
 const current=getCurrentSystemMessage(messages)
 if(current){
  const {toolsAdded,sections,...prompt}=current, remaining={...sections}
  const estimate=()=>estimateTokens({...prompt,sections:remaining})
  let tokens=estimateTokens(current)
  // Subtract native token estimates of successive disjoint prompt parts, so
  // independent rounding never manufactures extra tokens.
  const take=(key,section)=>{delete remaining[section];const next=estimate();counts[key]+=tokens-next;tokens=next}
  take('systemTools','tools')
  take('skills','skills')
  take('memory','night_memory_index')
  take('messages','night_current_input_reference')
  counts.system=tokens
 }
 for(const message of messages){
  switch(message.role){
   case 'custom':
    if(message.customType==='night.business-input'||message.customType==='night.router-handoff')counts.messages+=estimateTokens(message)
    else if(message.customType==='night.skill-version-notice')counts.skills+=estimateTokens(message)
    break
   case 'user':case 'assistant':case 'branchSummary':case 'compactionSummary':
    counts.messages+=estimateTokens(message);break
   case 'toolResult':
    counts[!message.isError&&skillReads.has(message.toolName)?'skills':!message.isError&&memoryReads.has(message.toolName)?'memory':'tools']+=estimateTokens(message);break
   case 'bashExecution':counts.tools+=estimateTokens(message);break
  }
 }
 return counts
}
function classify(session,total){
 const manager=session.sessionManager,leaf=manager?.getLeafId?.()
 let detail=breakdowns.get(session)
 if(leaf&&!(detail?.manager===manager&&detail.leaf===leaf)){
  const {messages}=manager.buildSessionProjection()
  detail={manager,leaf,counts:estimateBreakdown(messages)}
  breakdowns.set(session,detail)
 }
 const classified=leaf&&detail?Object.entries(detail.counts):[]
 const sum=classified.reduce((n,[,tokens])=>n+tokens,0)
 // Pi's measured aggregate and its per-message estimates can disagree.
 // Never force a fit by scaling categories or arbitrarily dropping one.
 const usable=classified.every(([,tokens])=>Number.isSafeInteger(tokens)&&tokens>=0)&&sum<=total
 const rows=usable?classified.filter(([,tokens])=>tokens>0).map(([key,tokens])=>({key,tokens})):[]
 const remainder=usable?total-sum:total
 if(remainder)rows.push({key:'unclassified',tokens:remainder})
 return rows
}

const unavailable={status:'unavailable'}

export async function routerContextWindow(tasks, agents, conversationId) {
 if(!tasks?.store?.query||!agents?.get)return unavailable
 const row=await tasks.store.query({kind:'router.get',conversationId})
 if(!row)return {...unavailable,reason:'not-started'}
 if(row.id!==conversationId||row.phase!=='active'||!Number.isSafeInteger(row.generation)||row.generation<1||!row.activeSessionId)return unavailable
 const actor=agents.get(row.activeSessionId),session=actor?.piSession,meta=actor?.metadata
 if(!actor)return {...unavailable,reason:'not-loaded'}
 if(actor.id!==row.activeSessionId||session?.sessionId!==row.activeSessionId||meta?.runtimeOwner!=='conversation-router'||meta.conversationId!==conversationId||meta.generation!==row.generation||actor.lifecycle?.signal.aborted||typeof session.getContextUsage!=='function')return unavailable
 const current=await tasks.store.query({kind:'router.get',conversationId})
 if(current?.activeSessionId!==row.activeSessionId||current.generation!==row.generation||current.phase!=='active'||agents.get(row.activeSessionId)!==actor||actor.lifecycle?.signal.aborted)return unavailable
 return nativeContextWindow(session,model=>officialConversationContextBudget(model,'ROUTER').budgetTokens)
}

export async function taskContextWindow(readTask, agents, taskId) {
 const task=await readTask()
 if(!task||task.taskId!==taskId)return null
 const sessionId=task.session?.sessionId??task.sessionId
 const bound=task.session?.sessionBound??task.sessionBound
 if(!sessionId||bound===false)return {...unavailable,reason:'task-not-started'}
 const actor=agents?.get?.(sessionId),session=actor?.piSession
 if(!actor)return {...unavailable,reason:'task-not-loaded'}
 if(actor.id!==sessionId||session?.sessionId!==sessionId||actor.metadata?.agentPreset!=='night-bot-task'||actor.lifecycle?.signal.aborted)return unavailable
 const current=await readTask()
 if(!current||current.taskId!==taskId)return null
 if(current.groupId!==task.groupId||(current.session?.sessionId??current.sessionId)!==sessionId||
    (current.session?.sessionBound??current.sessionBound)!==bound||agents.get(sessionId)!==actor||actor.lifecycle?.signal.aborted)return unavailable
 return nativeContextWindow(session,model=>model.contextWindow)
}

function nativeContextWindow(session,windowFor) {
 let usage,budget
 try{
  usage=session.getContextUsage()
  const model=session.routedModel?.model??session.model
  if(model?.contextWindow!==usage?.contextWindow||!Number.isSafeInteger(usage?.contextWindow)||usage.contextWindow<=0)return unavailable
  budget=windowFor(model)
 }catch{return unavailable}
 if(usage.tokens===null)return {...unavailable,reason:'awaiting-model-usage'}
 if(!Number.isSafeInteger(usage.tokens)||usage.tokens<=0)return unavailable
 let categories
 try{categories=classify(session,usage.tokens)}catch{categories=[{key:'unclassified',tokens:usage.tokens}]}
 return {status:'ready',basis:'pi-context-estimate',tokens:usage.tokens,contextWindow:budget,modelWindow:usage.contextWindow,categories}
}
