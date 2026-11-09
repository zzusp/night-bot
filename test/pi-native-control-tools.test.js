import test from 'node:test'
import assert from 'node:assert/strict'
import {memoryHost} from './fixtures/memory-host.js'
import * as todo from '../src/native-tool-todo.js'
import * as wd from '../src/native-tool-working-directory.js'
function fixture(impl,config={},agents){const tools=new Map(),calls=[];const ctx={tools:{register:t=>tools.set(t.name,t)},agents,workingDirectory:{ensure:async(...args)=>{calls.push(['ensure',...args]);return'/work'},set:async(...args)=>{calls.push(['set',...args]);return'/work/next'}}};impl.apply(ctx,config);return{ctx,tools,calls}}
test('native todo exposes a closed item/output contract, canonical counts and explicit parallel policy',async t=>{
 const native=await memoryHost(t),handle=await native.agent('todo-contract')
 t.after(()=>handle.dispose())
 const h=fixture(todo,{allowParallelInProgress:true},native.host.ctx.agents),tool=h.tools.get('todo_write')
 const receipts=async()=>(await handle.actor.receipts.read()).filter(row=>row.domain==='planning'&&row.kind==='todos')
 assert.deepEqual([...h.tools.keys()],['todo_write']);assert.equal(tool.parameters.type,'object');assert.deepEqual(tool.parameters.required,['todos'])
 const item=tool.parameters.properties.todos.items;assert.equal(tool.parameters.properties.todos.type,'array');assert.equal(item.type,'object');assert.equal(item.additionalProperties,false);assert.deepEqual(item.required,['content','status']);assert.equal(item.properties.content.type,'string');assert.deepEqual(item.properties.status.enum,['pending','in_progress','completed'])
 const schema=tool.output.schema;assert.equal(schema.type,'object');assert.equal(schema.additionalProperties,false);assert.deepEqual(schema.required,['todos','counts']);assert.equal(schema.properties.todos.items.additionalProperties,false);assert.deepEqual(schema.properties.todos.items.required,['content','status']);assert.deepEqual(schema.properties.todos.items.properties.status.enum,['pending','in_progress','completed']);assert.equal(schema.properties.counts.additionalProperties,false);assert.deepEqual(schema.properties.counts.required,['pending','inProgress','completed']);for(const key of schema.properties.counts.required)assert.equal(schema.properties.counts.properties[key].type,'integer')
 const exec={agent:handle.actor,signal:new AbortController().signal}
 for(const args of [{},{todos:[{content:'task'}]},{todos:[{content:'task',status:'foreign'}]},{todos:[{content:'task',status:'pending',extra:true}]}])await assert.rejects(tool.execute(args,exec),{code:'INVALID_ARGS'})
 assert.deepEqual(await receipts(),[])
 const args={todos:[{content:'  first  ',status:'in_progress'},{content:'second',status:'in_progress'},{content:'pending task',status:'pending'},{content:'finished task',status:'completed'}]},original=structuredClone(args),value=await tool.execute(args,exec)
 assert.deepEqual(args,original,'canonicalization must not modify caller arguments');assert.deepEqual(value,{todos:[{content:'first',status:'in_progress'},{content:'second',status:'in_progress'},{content:'pending task',status:'pending'},{content:'finished task',status:'completed'}],counts:{pending:1,inProgress:2,completed:1}});assert.deepEqual(await receipts(),[{version:1,domain:'planning',kind:'todos',payload:{todos:value.todos}}]);assert.equal((await receipts()).length,1);assert.deepEqual(tool.output.render(args,value),[{type:'text',text:'Updated todo list: 1 pending, 2 in progress, 1 completed.'}])
 const sequential=fixture(todo,{allowParallelInProgress:false},native.host.ctx.agents).tools.get('todo_write');assert.match(sequential.description,/exactly one/);assert.match(tool.description,/several only when work runs in parallel/);await assert.rejects(sequential.execute(args,exec),/at most one/);assert.equal((await receipts()).length,1,'denied parallel policy cannot commit a list')
})
test('native working directory publishes an optional string input and closed required cwd output',async()=>{
 const h=fixture(wd),tool=h.tools.get('working_directory');assert.deepEqual([...h.tools.keys()],['working_directory']);assert.equal(tool.parameters.type,'object');assert.equal(tool.parameters.properties.cd.type,'string');assert.equal(tool.parameters.required?.includes('cd')??false,false)
 assert.equal(tool.output.schema.type,'object');assert.equal(tool.output.schema.additionalProperties,false);assert.deepEqual(tool.output.schema.required,['cwd']);assert.equal(tool.output.schema.properties.cwd.type,'string')
 const exec={agent:{id:'exact-unit-caller'},signal:new AbortController().signal};await assert.rejects(tool.execute({cd:42},exec),{code:'INVALID_ARGS'});assert.deepEqual(h.calls,[])
 const current=await tool.execute({},exec),changed=await tool.execute({cd:'next'},exec);assert.deepEqual(current,{cwd:'/work'});assert.deepEqual(changed,{cwd:'/work/next'});assert.deepEqual(tool.output.render({},current),[{type:'text',text:'/work'}]);assert.deepEqual(tool.output.render({cd:'next'},changed),[{type:'text',text:'/work/next'}]);assert.deepEqual(h.calls,[['ensure',exec.agent,exec.signal],['set',exec.agent,'next',exec.signal]])
})
test('native todo whole-list validation commits only canonical typed receipts owned by the real actor',async t=>{
 const native=await memoryHost(t),handle=await native.agent('todo-replacement');t.after(()=>handle.dispose())
 const h=fixture(todo,{allowParallelInProgress:false},native.host.ctx.agents),tool=h.tools.get('todo_write'),exec={agent:handle.actor}
 const read=async()=>(await handle.actor.receipts.read()).filter(row=>row.domain==='planning'&&row.kind==='todos')
 for(const todos of [[{content:' ',status:'pending'}],[{content:'task',status:'pending'},{content:' task ',status:'completed'}],[{content:'a',status:'in_progress'},{content:'b',status:'in_progress'}]])await assert.rejects(tool.execute({todos},exec))
 assert.deepEqual(await read(),[])
 await assert.rejects(tool.execute({todos:[]},{}),/owning agent/)
 await tool.execute({todos:[{content:' a ',status:'pending'}]},exec);await tool.execute({todos:[]},exec)
 assert.deepEqual((await read()).map(row=>row.payload.todos),[[{content:'a',status:'pending'}],[]])
 assert.equal(native.requests.length,0)
})
test('native working directory binding passes exact caller and cancellation to capability owner',async()=>{const h=fixture(wd),tool=h.tools.get('working_directory'),exec={agent:{id:'caller'},signal:new AbortController().signal};assert.deepEqual(await tool.execute({},exec),{cwd:'/work'});assert.deepEqual(await tool.execute({cd:'next'},exec),{cwd:'/work/next'});assert.deepEqual(h.calls,[['ensure',exec.agent,exec.signal],['set',exec.agent,'next',exec.signal]]);await assert.rejects(tool.execute({},{}),/requires an agent/);assert.equal(h.calls.length,2)})

test('todo receipts reject copied or cancelled actors and remain isolated across official turns and cold resume',async t=>{
 const native=await memoryHost(t),one=await native.agent('todo-owner-one'),two=await native.agent('todo-owner-two')
 let resumed;t.after(async()=>{await resumed?.dispose();await one.dispose();await two.dispose()})
 const tool=fixture(todo,{allowParallelInProgress:true},native.host.ctx.agents).tools.get('todo_write')
 const list=[{content:'Retained planning fact',status:'pending'}]
 const read=async actor=>(await actor.receipts.read()).filter(row=>row.domain==='planning'&&row.kind==='todos')
 await assert.rejects(tool.execute({todos:list},{agent:{...one.actor}}),/PI_TODO_ACTOR_REQUIRED/)
 await assert.rejects(tool.execute({todos:list},{agent:{session:{append(){assert.fail('legacy append must never be called')}}}}),/PI_TODO_ACTOR_REQUIRED/)
 assert.deepEqual(await read(one.actor),[]);assert.deepEqual(await read(two.actor),[])
 await tool.execute({todos:list},{agent:one.actor})
 await native.say(one.actor,'Read the current planning evidence without changing it.')
 assert.deepEqual((await read(one.actor)).map(row=>row.payload.todos),[list],'an official turn cannot clear a durable business receipt')
 assert.deepEqual(await read(two.actor),[])
 const cancelled=new AbortController(),cause=new Error('exact caller cancellation');cancelled.abort(cause)
 await assert.rejects(tool.execute({todos:[]},{agent:one.actor,signal:cancelled.signal}),error=>error===cause)
 await one.cancel();await assert.rejects(tool.execute({todos:[]},{agent:one.actor}))
 assert.equal((await read(one.actor)).length,1)
 await one.dispose()
 await assert.rejects(tool.execute({todos:[]},{agent:one.actor}),/PI_TODO_ACTOR_REQUIRED/)
 const requests=native.requests.length
 resumed=await native.host.ctx.agents.resume({sessionId:one.actor.id,authorizeInput:packet=>packet.source.kind==='user'})
 assert.deepEqual((await read(resumed.actor)).map(row=>row.payload.todos),[list])
 assert.deepEqual(await read(two.actor),[]);assert.equal(native.requests.length,requests)
})
