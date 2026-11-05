import {z} from 'zod'

// A flat page directory avoids recursive checkpoints. Only the active page is
// copied per append; sealed pages are shared until the next page is sealed.
const PAGE_SIZE=128
export function createChildCatalogProjection(payloadSchema,viewSchema){
  const stateSchema=z.object({
    inheritedEventCount:z.number().int().nonnegative(),
    pages:z.array(z.array(payloadSchema).length(PAGE_SIZE)),
    pending:z.array(payloadSchema).max(PAGE_SIZE-1),
  }).strict()
  return {
    key:'subagentCatalog',stateVersion:7,stateSchema,
    init:(_header,inheritedEventCount)=>({inheritedEventCount,pages:[],pending:[]}),
    apply(state,event){
      if(event.type!=='subagent/catalog'||event.seq<state.inheritedEventCount)return state
      const pending=[...state.pending,payloadSchema.parse(event.data)]
      return pending.length===PAGE_SIZE
        ? {...state,pages:[...state.pages,pending],pending:[]}
        : {...state,pending}
    },
    wire:{viewSchema,view(state){
      const rows=[]
      for(const page of [...state.pages,state.pending])for(const payload of page){
        const {version,childId,childCreatedAt,...descriptor}=payload
        rows.push({id:childId,createdAt:childCreatedAt,...descriptor})
      }
      return rows
    }},
  }
}
