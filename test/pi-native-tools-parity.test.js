import test from 'node:test'
import assert from 'node:assert/strict'
import {Context} from '@deepseek-ai/cordis'
import {createScope} from '../src/native-scope.js'
import NativeTools from '../src/native-tools.js'
const entered=[]
const definition=name=>({name,description:'Tool '+name,parameters:{type:'object',additionalProperties:true},output:{schema:{type:'object',required:['ok'],properties:{ok:{type:'boolean'}},additionalProperties:false},render:(_args,value)=>[{type:'text',text:JSON.stringify(value)}]},execute:async args=>{entered.push(name);return args}})
async function scenario(){
 const ctx=new Context();ctx.provide('systemPrompt',{tools:()=>()=>{},section:()=>()=>{},getSectionOrder:()=>0});new NativeTools(ctx)
 try{
  ctx.tools.register(definition('read'));ctx.tools.register(definition('write'));const parent={},child={},p=createScope(ctx,parent),c=createScope(ctx,child,{parent});p.ctx.tools.register(definition('ancestor'));c.ctx.tools.restrict({allow:['read','write','ancestor'],deny:['write']});c.ctx.tools.register(definition('submit'));const schema=ctx.tools.schemas(child),wire=ctx.tools.wireSchemas(child),results=[]
  ctx.tools.guard(exec=>exec.name==='ancestor'?'role_denied':undefined)
  for(const [name,args]of [['read',{ok:true}],['read',{wrong:true}],['ancestor',{ok:true}],['write',{ok:true}],['submit',{ok:true}],['unknown',{}]])results.push(await ctx.tools.execute({callId:name,name,arguments:args,agent:child,signal:new AbortController().signal}))
  const cancelled=new AbortController();cancelled.abort();results.push(await ctx.tools.execute({callId:'cancelled',name:'read',arguments:{ok:true},agent:child,signal:cancelled.signal}));await c.dispose();await p.dispose();return{schema,wire,results}
 }finally{await ctx.fiber.dispose()}
}
test('scoped tools deny before body entry, validate outputs, and preserve pre-dispatch cancellation',async()=>{
 entered.length=0
 const {schema,wire,results}=await scenario()
 assert.deepEqual(schema.map(row=>row.name),['read','ancestor','submit'])
 assert.deepEqual(wire.schemas.map(row=>row.name),['read','ancestor','submit'])
 assert.deepEqual(wire.knownNames,['read','write','ancestor','submit'])
 assert.deepEqual(entered,['read','read','submit'])
 assert.deepEqual(results.map(row=>row.isError),[false,true,true,true,false,true,true])
 assert.deepEqual(results[0].value,{ok:true})
 assert.deepEqual(results[4].value,{ok:true})
 assert.equal(results[1].error.info.code,'INVALID_TOOL_OUTPUT')
 assert.equal(results[2].error.message,'role_denied')
 assert.equal(results[3].error.info.code,'UNKNOWN_TOOL')
 assert.equal(results[5].error.info.code,'UNKNOWN_TOOL')
 assert.equal(results[6].error.info.code,'ABORTED_BEFORE_DISPATCH')
})
