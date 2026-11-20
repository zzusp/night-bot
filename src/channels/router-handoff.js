export const ROUTER_HANDOFF_POLICY='faithful-handoff-v1'
export const MAX_ROUTER_HANDOFF_LENGTH=8000

/** The handoff describes the work; source identity and permissions are assigned by the Host. */
export function normalizeRouterHandoff(value){
 const text=typeof value==='string'?value.trim():''
 if(!text||text.length>MAX_ROUTER_HANDOFF_LENGTH){
  throw Object.assign(new Error('ROUTER_HANDOFF_INVALID'),{code:'ROUTER_HANDOFF_INVALID'})
 }
 return text
}

/** Keep already queued handoffs immutable. The execution view filters by revision. */
export function recordRouterHandoff(task,source,operationId,value){
 const text=normalizeRouterHandoff(value)
 const {routerSourceSelection:_,routerHandoffs=[],...metadata}=task.metadata??{}
 task.metadata={...metadata,routerInputPolicy:ROUTER_HANDOFF_POLICY,routerHandoffs:[...routerHandoffs,{
  id:operationId,sourceId:source.sourceId,messageVersion:source.version,
  requirementRevision:task.requirementRevision,contextRevision:task.contextRevision??0,text,
 }]}
}
