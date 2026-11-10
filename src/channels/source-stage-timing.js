import {randomUUID} from 'node:crypto'

/** Observed Host work, including preparation and SDK retries, never model-only
 * latency. Source membership is captured at acceptance, not reconstructed from
 * the final mutable batch. Missing joins deliberately leave open spans. */
export function sourceStageTiming({recordStage,stage,sessionId,requestId,groupId,attempt=0,clock=()=>new Date().toISOString(),onError=()=>{}}){
  const spans=new Map(),runId=randomUUID()
  let tail=Promise.resolve(),closed=false,settledAt,segment=0
  const write=(ref,value)=>{
    if(typeof recordStage!=='function')return
    tail=tail.then(()=>recordStage(ref,structuredClone(value))).catch(error=>{try{onError(error)}catch{}})
  }
  const result={
    observe(session){return session.subscribe(event=>{if(event.type==='agent_start')settledAt=undefined;if(event.type==='agent_settled')settledAt=clock()})},
    finishIfSettled(){return settledAt===undefined?tail:result.finish(settledAt)},
    start(sources,startedAt=clock()){
      if(closed)return
      const refs=new Map(sources.filter(source=>source?.sourceId&&Number.isSafeInteger(source.version??source.messageVersion)).map(source=>[source.sourceId,Object.freeze({sourceId:source.sourceId,messageId:source.messageId,version:source.version??source.messageVersion,groupId})]))
      const added=[...refs.values()].filter(ref=>!spans.has(ref.sourceId))
      if(!added.length)return
      // A settled signal preceding newly accepted Host work cannot prove that
      // the new cohort finished if its later join/disposal fails.
      settledAt=undefined
      // A late source changes the shared-work cohort. Close the old cohort at
      // the observed acceptance boundary and reopen it with immutable sharing.
      if(spans.size){for(const {ref,value}of spans.values())write(ref,{...value,completedAt:startedAt});segment++}
      const members=[...[...spans.values()].map(item=>item.ref),...added]
      spans.clear()
      for(const ref of members){
        const value={spanId:`${stage}:${runId}:${segment}:${ref.sourceId}`,stage,sessionId,requestId,attempt,startedAt,completedAt:null,shared:members.length>1}
        spans.set(ref.sourceId,{ref,value});write(ref,value)
      }
    },
    async finish(completedAt=clock()){
      if(!closed){closed=true;for(const {ref,value}of spans.values())write(ref,{...value,completedAt})}
      await tail
    },
    flush:()=>tail,
  }
  return result
}
