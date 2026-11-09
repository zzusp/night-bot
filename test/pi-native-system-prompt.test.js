import test from 'node:test'
import assert from 'node:assert/strict'
import {Context} from '@deepseek-ai/cordis'
import {createScope} from '../src/native-scope.js'
import NativePrompt from '../src/native-system-prompt.js'
function fixture(t,config={}){const ctx=new Context();t.after(()=>ctx.fiber.dispose());new NativePrompt(ctx,{includeHarnessIdentity:false,...config});return ctx}
test('official business sections refresh model variables and dynamic instructions for each actor run',async t=>{
 const ctx=fixture(t),actor={},other={},scope=createScope(ctx,actor);let model='first',instruction='before'
 const provider=()=>{throw Error('legacy variable must not run')};provider.official=()=>model
 ctx.systemPrompt.variable('model',provider)
 scope.ctx.systemPrompt.section({name:'instruction',order:1,text:()=>{throw Error('legacy callback must not run')},officialText:()=>instruction+' {{model}}'})
 assert.match(JSON.stringify(await ctx.systemPrompt.officialSections(actor)),/before first/)
 model='second';instruction='after'
 assert.match(JSON.stringify(await ctx.systemPrompt.officialSections(actor)),/after second/)
 assert.doesNotMatch(JSON.stringify(await ctx.systemPrompt.officialSections(other)),/after/)
 await scope.dispose();assert.doesNotMatch(JSON.stringify(await ctx.systemPrompt.officialSections(actor)),/after/)
})
test('official sections leave tool catalog and resource construction to Pi',async t=>{
 const ctx=fixture(t);ctx.systemPrompt.tools(()=>{throw Error('legacy catalog provider must not run')})
 const definition={name:'stable',order:1,text:'original'};ctx.systemPrompt.section(definition);definition.text='changed'
 assert.deepEqual(Object.values(await ctx.systemPrompt.officialSections({})),['original'])
})

test('nearest scoped contributions override by name with deterministic instruction order',async t=>{
 const ctx=fixture(t),parent={},child={},a=createScope(ctx,parent),b=createScope(ctx,child,{parent})
 ctx.systemPrompt.section({name:'z',order:2,text:'global'});ctx.systemPrompt.section({name:'a',order:1,text:'first'})
 a.ctx.systemPrompt.section({name:'z',order:2,text:'parent'});b.ctx.systemPrompt.section({name:'z',order:2,text:'child'})
 assert.deepEqual(Object.values(await ctx.systemPrompt.officialSections(child)),['first','child'])
 await b.dispose();assert.deepEqual(Object.values(await ctx.systemPrompt.officialSections(child)),['first','parent']);await a.dispose()
})
test('optional context suppression preserves required live policy and disposers are independent',async t=>{
 const ctx=fixture(t),actor={},scope=createScope(ctx,actor);let value='before'
 ctx.systemPrompt.context({name:'required',order:1,required:true,officialText:()=>value})
 ctx.systemPrompt.context({name:'optional',order:2,text:'optional'})
 const one=scope.ctx.systemPrompt.suppressRuntimeContext(),two=scope.ctx.systemPrompt.suppressRuntimeContext()
 value='after';assert.deepEqual(Object.values(await ctx.systemPrompt.officialSections(actor)),['after'])
 one();assert.deepEqual(Object.values(await ctx.systemPrompt.officialSections(actor)),['after']);two()
 assert.deepEqual(Object.values(await ctx.systemPrompt.officialSections(actor)),['after','optional']);await scope.dispose()
})
test('registration rejects invalid and duplicate contributions; legacy complete prompt cannot override Pi',async t=>{
 const ctx=fixture(t),p=ctx.systemPrompt
 assert.throws(()=>p.section({name:'bad',order:Infinity,text:''}),/finite/)
 assert.throws(()=>p.context({name:'bad',order:NaN,text:''}),/finite/)
 assert.throws(()=>p.variable('__proto__',()=>''),/variable/)
 p.section({name:'same',order:1,text:'first'});assert.throws(()=>p.section({name:'same',order:2,text:'second'}),/registered/)
 p.section({name:'complete',order:3,complete:true,text:'override'});await assert.rejects(p.officialSections({}),{code:'PI_OFFICIAL_PROMPT_ADAPTER_REQUIRED'})
 assert.equal(p.assemble,undefined);assert.equal(p.refreshContext,undefined)
 assert.throws(()=>fixture(t,{toolOrder:['read']}),{code:'NIGHT_PROMPT_TOOL_ORDER_RETIRED'})
})
