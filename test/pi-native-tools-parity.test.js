import test from 'node:test'
import assert from 'node:assert/strict'
import {Context} from '@deepseek-ai/cordis'
import {createScope} from '@deepseek-ai/dsh-scope'
import OriginalTools from '@deepseek-ai/dsh-tools'
import NativeTools from '../src/native-tools.js'
const definition=name=>({name,description:'Tool '+name,parameters:{type:'object',additionalProperties:true},output:{schema:{type:'object',required:['ok'],properties:{ok:{type:'boolean'}},additionalProperties:false},render:(_args,value)=>[{type:'text',text:JSON.stringify(value)}]},execute:async args=>args})
async function scenario(Runtime){
 const ctx=new Context();ctx.provide('systemPrompt',{tools:()=>()=>{},section:()=>()=>{},getSectionOrder:()=>0});new Runtime(ctx)
 try{
  ctx.tools.register(definition('read'));ctx.tools.register(definition('write'));const parent={},child={},p=createScope(ctx,parent),c=createScope(ctx,child,{parent});p.ctx.tools.register(definition('ancestor'));c.ctx.tools.restrict({allow:['read','write','ancestor'],deny:['write']});c.ctx.tools.register(definition('submit'));const schema=ctx.tools.schemas(child),wire=ctx.tools.wireSchemas(child),results=[]
  ctx.tools.guard(exec=>exec.name==='ancestor'?'role_denied':undefined)
  for(const [name,args]of [['read',{ok:true}],['read',{wrong:true}],['ancestor',{ok:true}],['write',{ok:true}],['submit',{ok:true}],['unknown',{}]])results.push(await ctx.tools.execute({callId:name,name,arguments:args,agent:child,signal:new AbortController().signal}))
  const cancelled=new AbortController();cancelled.abort();results.push(await ctx.tools.execute({callId:'cancelled',name:'read',arguments:{ok:true},agent:child,signal:cancelled.signal}));await c.dispose();await p.dispose();return{schema,wire,results}
 }finally{await ctx.fiber.dispose()}
}
test('native registry and pipeline preserve valid public metadata, role denials, output failures and cancellation contracts',async()=>assert.deepEqual(await scenario(NativeTools),await scenario(OriginalTools)))
