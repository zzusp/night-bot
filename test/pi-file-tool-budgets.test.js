import test from 'node:test'
import assert from 'node:assert/strict'
import {memoryHost} from './fixtures/memory-host.js'
import {createPiFileToolBudgets} from '../src/runtime/pi-file-tool-budgets.js'
async function fixture(t){
 const f=await memoryHost(t),handle=await f.agent('file-result-budget',{actorId:'owner'}),actor=handle.agent
 const budgets=createPiFileToolBudgets({actor,maxBatchTransportBytes:90})
 const batch=calls=>actor.piSession.sessionManager.appendMessage({role:'assistant',content:calls.map(id=>({type:'toolCall',id,name:'read',arguments:{path:'fixture'}})),api:'openai-completions',provider:'fixture',model:'m',stopReason:'toolUse',timestamp:1,usage:{input:0,output:0,cacheRead:0,cacheWrite:0,totalTokens:0,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}}})
 const run=action=>f.host.ctx.agents.withInitiator(actor,async()=>action())
 return {f,actor,budgets,batch,run}
}
test('file result resource totals share the actual official assistant entry across parallel calls',async t=>{
 const f=await fixture(t);f.batch(['one','two','three'])
 const result={content:[{type:'text',text:'x'.repeat(10)}]},input=id=>({actor:f.actor,callId:id,toolName:'read',result,bytes:Buffer.byteLength(JSON.stringify(result))})
 assert.equal(await f.run(()=>f.budgets.transportBudget.accept(input('one'))),true)
 assert.equal(await f.run(()=>f.budgets.transportBudget.accept(input('two'))),false)
 await assert.rejects(f.run(()=>f.budgets.transportBudget.accept(input('one'))),{code:'PI_FILE_BUDGET_DUPLICATE_RESULT'})
 f.actor.receipts.append({version:1,domain:'directory',kind:'changed',payload:{cwd:f.actor.metadata.cwd,recovered:false}})
 assert.equal(await f.run(()=>f.budgets.transportBudget.accept(input('three'))),false,'an intervening business receipt cannot reset the assistant batch')
 f.batch(['next']);assert.equal(await f.run(()=>f.budgets.transportBudget.accept(input('next'))),true)
})
test('image count and byte limits are deployment limits shared across the real tool batch',async t=>{
 const f=await fixture(t);f.batch(['one','two'])
 const limits=f.actor.ctx.get('attachments').imageLimits,input=id=>({actor:f.actor,callId:id,toolName:'read',images:Array.from({length:limits.maxImagesPerMessage},()=>({bytes:1,mimeType:'image/png'}))})
 assert.equal(await f.run(()=>f.budgets.imageBudget.accept(input('one'))),true)
 assert.equal(await f.run(()=>f.budgets.imageBudget.accept(input('two'))),false)
})
test('file result budgets reject forged actor, missing call, false byte counts and use after close',async t=>{
 const f=await fixture(t);f.batch(['one']);const input={actor:f.actor,callId:'one',toolName:'read',result:{content:[]},bytes:14}
 await assert.rejects(f.run(()=>f.budgets.transportBudget.accept({...input,actor:{...f.actor}})),{code:'PI_FILE_BUDGET_ACTOR_REQUIRED'})
 await assert.rejects(f.run(()=>f.budgets.transportBudget.accept({...input,callId:'missing'})),{code:'PI_FILE_BUDGET_CALL_REQUIRED'})
 await assert.rejects(f.run(()=>f.budgets.transportBudget.accept({...input,bytes:1})),{code:'PI_FILE_TRANSPORT_ACCOUNTING_INVALID'})
 f.budgets.close();await assert.rejects(f.run(()=>f.budgets.transportBudget.accept(input)),{code:'PI_FILE_BUDGET_CLOSED'})
})

test('an explicit preset without a file resource capability is rejected without inheriting the default catalog',async t=>{const f=await memoryHost(t),ctx=f.host.ctx;await ctx.agentPresets.register({id:'no-files',plugins:[]});await assert.rejects(ctx.agents.create({sessionId:'no-file-preset',meta:{cwd:ctx.runtimePaths.workspaces,agentPreset:'no-files'},agentOptions:f.config.model,authorizeInput:()=>false}),{code:'PI_OFFICIAL_RESOURCE_SERVICES_REQUIRED'});assert.equal(ctx.agents.get('no-file-preset'),undefined)})
