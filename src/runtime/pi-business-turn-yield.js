import {AgentSession} from '@earendil-works/pi-coding-agent'

/** A Host scheduling decision over actual public SDK events. Pi still owns the
 * loop, tool results, queued inputs and continuation. No caller can inject events
 * through this port or publish a replacement message/history. */
export function bindBusinessTurnYield({session,actor,onToolResult,fence}){
 if(!(session instanceof AgentSession)||actor?.piSession!==session||actor.id!==session.sessionId||typeof onToolResult!=='function'||typeof fence!=='function')throw new TypeError('Exact official business turn owner required')
 let yielded=false,closed=false
 const previous=session.agent.finishTurn
 const finish=async(...args)=>yielded?{action:'end'}:await previous?.(...args)
 session.agent.finishTurn=finish
 const unsubscribe=session.subscribe(event=>{
  if(closed)return
  if(event.type==='agent_start'){yielded=false;return}
  if(event.type!=='tool_execution_end')return
  try{
   const decision=onToolResult(actor,Object.freeze({toolCallId:event.toolCallId,toolName:event.toolName,isError:event.isError===true}))
   if(decision!==undefined&&typeof decision!=='boolean')throw new TypeError('Business tool-result scheduling must be synchronous and boolean')
   if(decision)yielded=true
  }catch(cause){yielded=true;fence(cause)}
 })
 return{close(){closed=true;unsubscribe();if(session.agent.finishTurn===finish)session.agent.finishTurn=previous}}
}
