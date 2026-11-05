import test from 'node:test'
import assert from 'node:assert/strict'
import {Context} from '@deepseek-ai/cordis'
import {z} from 'zod'
import {createChildCatalogProjection} from '../src/runtime/child-catalog.js'
import NativeProjections from '../src/native-projections.js'
import NativeSessions from '../src/native-sessions.js'

const payload=z.object({version:z.literal(0),childId:z.string(),childCreatedAt:z.number().int().nonnegative(),mode:z.literal('continuable'),label:z.string()}).strict()
const view=z.array(z.object({id:z.string(),createdAt:z.number(),mode:z.literal('continuable'),label:z.string()}).strict())
const event=index=>({type:'subagent/catalog',seq:index,data:{version:0,childId:'child-'+index,childCreatedAt:index,mode:'continuable',label:'entry '+index}})

test('owned catalog keeps ordered flat checkpoints with bounded active-page copies and sealed-page sharing',()=>{
 const def=createChildCatalogProjection(payload,view)
 let state=def.init({},0)
 for(let index=0;index<2048;index++){
  const prior=state
  state=def.apply(state,event(index))
  assert.ok(state.pending.length<128)
  if(state.pending.length)assert.equal(state.pages,prior.pages)
  else if(prior.pages.length)assert.equal(state.pages[0],prior.pages[0])
  assert.equal(prior.pending.length,index%128)
 }
 assert.equal(state.pages.length,16)
 assert.equal(state.pending.length,0)
 const restored=def.stateSchema.parse(JSON.parse(JSON.stringify(state)))
 const rows=view.parse(def.wire.view(restored))
 assert.deepEqual(rows.map(row=>row.id),Array.from({length:2048},(_,index)=>'child-'+index))
 assert.deepEqual(rows.at(-1),{id:'child-2047',createdAt:2047,mode:'continuable',label:'entry 2047'})
 assert.equal('head' in restored,false)
 for(const invalid of [{...restored,pages:[[event(0).data]]},{...restored,pending:Array(128).fill(event(0).data)},{...restored,head:{}},{...restored,inheritedEventCount:-1}])assert.equal(def.stateSchema.safeParse(invalid).success,false)
})

test('catalog ignores inherited and unrelated events; rejected payloads cannot partially mutate state',()=>{
 const def=createChildCatalogProjection(payload,view),initial=def.init({},3)
 assert.equal(def.apply(initial,event(2)),initial)
 assert.equal(def.apply(initial,{type:'tool/result',seq:3,data:{}}),initial)
 assert.throws(()=>def.apply(initial,{...event(3),data:{...event(3).data,version:999}}))
 assert.deepEqual(initial,{inheritedEventCount:3,pages:[],pending:[]})
 const input=event(3),next=def.apply(initial,input);input.data.label='changed by caller'
 assert.equal(next.pending[0].label,'entry 3')
})

test('earlier Night Bot checkpoints rebuild from complete Pi audit history and missing history refuses restoration',async t=>{
 const ctx=new Context();ctx.logger={warn(){}};new NativeSessions(ctx);new NativeProjections(ctx)
 t.after(()=>ctx.fiber.dispose())
 const def=createChildCatalogProjection(payload,view);ctx.sessionProjections.register(def)
 const session=ctx.sessions.create('owned-catalog-upgrade')
 for(let index=0;index<260;index++)session.append('subagent/catalog',event(index).data)
 const events=session.snapshotEvents(),legacyCheckpoint={subagentCatalog:{ver:6,seq:259,val:{inheritedEventCount:0,head:{values:[event(0).data]}}}}
 assert.equal(ctx.sessionProjections.restoreFloor(legacyCheckpoint),0)
 const restored=ctx.sessionProjections.restore(legacyCheckpoint,events,0,session.header,0)
 assert.equal(restored.snapshot.values.subagentCatalog.length,260)
 assert.equal(restored.checkpoint.subagentCatalog.ver,7)
 assert.deepEqual(restored.snapshot.values.subagentCatalog,ctx.sessionProjections.snapshot(session).values.subagentCatalog)
 assert.throws(()=>ctx.sessionProjections.restore(legacyCheckpoint,events.slice(10),10,session.header,0),/cannot restore/)
 const current=ctx.sessionProjections.checkpoint(session)
 assert.equal(current.subagentCatalog.ver,7)
 assert.deepEqual(ctx.sessionProjections.viewCheckpoint(current).subagentCatalog,restored.snapshot.values.subagentCatalog)
 const corrupt=structuredClone(current);corrupt.subagentCatalog.val.pages[0].pop()
 assert.throws(()=>ctx.sessionProjections.restore(corrupt,events.slice(259),259,session.header,0))
})

test('cold Pi journal discovery preserves all page boundaries without starting missing children or a model',async t=>{
 const {memoryHost}=await import('./fixtures/memory-host.js')
 const f=await memoryHost(t),parent=await f.agent('flat-catalog-cold')
 for(let index=0;index<260;index++)parent.agent.session.append('subagent/catalog',event(index).data)
 await f.host.ctx.sessions.flush(parent.agent.session)
 await parent.dispose();await f.close();await f.boot()
 const before=f.host.ctx.agents.list().length
 const rows=await f.host.ctx.subagents.listDescendants('flat-catalog-cold')
 assert.equal(rows.length,260)
 assert.deepEqual(rows.map(row=>row.id),Array.from({length:260},(_,index)=>'child-'+index))
 assert.ok(rows.every(row=>row.kind==='diagnostic'&&row.reason==='unavailable'))
 assert.equal(f.host.ctx.agents.list().length,before)
 assert.equal(f.requests.length,0)
})
