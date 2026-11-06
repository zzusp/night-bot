import {Context} from '@deepseek-ai/cordis'
import {mkdtemp,rm} from 'node:fs/promises'
import {join} from 'node:path'
import * as Authority from '../../src/pi-authority.js'
import PiPersistence from '../../src/pi-session-persistence.js'
import {createNativeBusinessState,nativeBusinessAuditKinds} from '../../src/runtime/pi-business-state.js'
import {bindApprovalAudit} from '../../src/native-approval.js'

// Actual native journal and production typed business ports, without Session,
// projection, synthetic eventAt/seq, or invented conversation/turn history.
export async function nativeBusinessPolicyFixture(t,{ctx=new Context()}={}){
 const root=await mkdtemp('/tmp/night-policy-journal-'),backend=new PiPersistence(ctx,{root:join(root,'sessions')}),actors=[]
 await ctx.plugin(Authority)
 ctx.logger={warn(){},error(){}}
 t.after(async()=>{for(const item of actors){item.store.commit=item.originalCommit;item.store.appendAudit=item.originalAppend;item.detach()}try{await ctx.fiber.dispose()}finally{await rm(root,{recursive:true,force:true})}})
 return {ctx,root,backend,async actor(id,{cwd='/project',seeded=false,turnOpen=false,admitNotice=async()=>{},initialFacts=[]}={}){
  const store=await backend.createNative({version:4,id,createdAt:Date.now(),isSeeded:seeded,cwd},{auditKinds:nativeBusinessAuditKinds});for(const fact of initialFacts)store.appendAudit(fact);if(initialFacts.length)await store.commit();const state=await createNativeBusinessState(store),actor={id,ctx},control={live:true,turnOpen},originalCommit=store.commit.bind(store),originalAppend=store.appendAudit.bind(store)
  const audit=state.audit({isLive:()=>control.live,isTurnOpen:()=>control.turnOpen}),detachState=state.bindActor(actor,{isLive:()=>control.live,admitNotice}),detachApproval=bindApprovalAudit(actor,audit)
  actor.audit=audit
  const item={actor,control,state,audit,store,originalCommit,originalAppend,detach(){detachApproval();detachState()},facts:()=>store.readAudit()};actors.push(item);return item
 }}
}
