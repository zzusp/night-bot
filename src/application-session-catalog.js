import {Service} from '@deepseek-ai/cordis'
import {AgentSession} from '@earendil-works/pi-coding-agent'
import {isDeepStrictEqual} from 'node:util'
const fail=code=>Object.assign(new Error(code),{code})
/** Read-only application metadata over existing authorities. This owns no
 * session instances, writer leases, history, message projection or name state. */
export default class ApplicationSessionCatalog extends Service {
 static inject=['agents','sessionPersistence']
 constructor(ctx){super(ctx,'sessionCatalog')}
 liveHeader(id){
  const actor=this.ctx.agents.get(id)
  if(!actor)return
  if(!(actor.piSession instanceof AgentSession)||actor.id!==id||actor.metadata?.id!==id||actor.piSession.sessionId!==id)throw fail('SESSION_CATALOG_ACTOR_INVALID')
  return structuredClone(actor.metadata)
 }
 merge(stored,live){if(stored&&live&&!isDeepStrictEqual(stored,live))throw fail('SESSION_CATALOG_HEADER_CONFLICT');return structuredClone(live??stored)}
 async header(id){
  if(typeof id!=='string'||!id)throw fail('SESSION_CATALOG_ID_INVALID')
  const live=this.liveHeader(id);if(live)return live
  const stored=(await this.ctx.sessionPersistence.stat(id))?.header
  return this.merge(stored,this.liveHeader(id))
 }
 async listHeaders(){
  const rows=await this.ctx.sessionPersistence.list(),headers=new Map(rows.map(row=>[row.header.id,structuredClone(row.header)]))
  for(const actor of this.ctx.agents.list()){const live=this.liveHeader(actor.id);headers.set(actor.id,this.merge(headers.get(actor.id),live))}
  return [...headers.values()]
 }
 async isKnown(id){return (await this.header(id))!==undefined}
}
