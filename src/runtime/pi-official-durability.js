/** Awaited business durability around the public AgentSession agent events.
 * SessionManager owns every message. This adapter neither projects nor replays
 * history. A failed commit permanently fences this instance until reconciliation.
 */
export function bindOfficialDurability({session,store,tools,beforeRequest}) {
 if(!session?.agent||store?.kind!=='pi-native'||session.sessionManager!==store.manager)throw new TypeError('Exact official session and native store required')
 let failure,closed=false,closing
 const previousPrepare=session.agent.prepareRequest,previousFinish=session.agent.finishTurn
 const fence=cause=>{failure??=cause;tools?.fence(failure);return failure}
 const assertOpen=()=>{if(failure)throw failure;if(closed)throw Object.assign(new Error('Official durability closed'),{code:'PI_OFFICIAL_DURABILITY_CLOSED'})}
 const commit=async()=>{assertOpen();try{await store.commit()}catch(cause){throw fence(cause)}}
 const prepare=async(...args)=>{assertOpen();await beforeRequest?.(...args);assertOpen();await commit();return previousPrepare?.(...args)}
 const finish=async(...args)=>tools?.finishTurn(...args)??await previousFinish?.(...args)
 session.agent.prepareRequest=prepare
 session.agent.finishTurn=finish
 // AgentSession registered its internal append subscriber during construction.
 // Agent-core awaits this later subscriber before executing the next tool.
 const unsubscribe=session.agent.subscribe(async event=>{
  if(event.type==='message_end'||event.type==='agent_end')await commit()
 })
 return {
  commit,
  fence,
  get failure(){return failure},
  async close(){return closing??=(async()=>{
   // Keep subscribers and resource leases alive until execution really drains.
   // An abort/drain error cannot be converted into a successful store close.
   await session.abort();await tools?.close();await commit()
   closed=true;unsubscribe()
   if(session.agent.prepareRequest===prepare)session.agent.prepareRequest=previousPrepare
   if(session.agent.finishTurn===finish)session.agent.finishTurn=previousFinish
   session.dispose();await store.close()
  })()},
 }
}
