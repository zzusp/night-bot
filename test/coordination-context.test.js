import assert from 'node:assert/strict'
import test from 'node:test'
import {officialToolsFixture} from './fixtures/pi-official-tools.js'
import {bindBusinessInputAuthority} from '../src/runtime/pi-business-inputs.js'
import {coordinationMessages,visibleToolOutputs,visiblePromptRefs,visibleSectionLength,visibleCoordinatorText} from '../packages/dingtalk-core/coordination-context.js'
const usage={input:0,output:0,cacheRead:0,cacheWrite:0,totalTokens:0,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}}
async function fixture(t){
 const f=await officialToolsFixture(t,()=>{}),packets=new Map(),agent=f.owner
 t.after(bindBusinessInputAuthority(agent,{lookupPacket:id=>packets.get(id),isLive:value=>value===agent}))
 const call=(id,name)=>f.manager.appendMessage({role:'assistant',content:[{type:'toolCall',id,name,arguments:{}}],api:'openai-responses',provider:'fixture',model:'m',stopReason:'toolUse',timestamp:1,usage})
 const result=(id,value,isError=false)=>f.manager.appendMessage({role:'toolResult',toolCallId:id,toolName:'fixture',content:[{type:'text',text:JSON.stringify(value)}],isError,timestamp:2})
 const input=async(id,text)=>{const source={kind:'coordinator'},content=[{type:'text',text}];packets.set(id,{id,source,content});await f.session.sendCustomMessage({customType:'night.business-input',content,display:false,details:{packetId:id,source}},{triggerTurn:false});return f.manager.getLeafId()}
 return {...f,agent,call,result,input}
}
test('official visible materials require a successful paired native result and exact source text',async t=>{
 const f=await fixture(t),prompt={id:'p',name:'prompt',description:'',prompt:'read this',revision:1},payload={prompts:[prompt]}
 f.call('good','group_task_prompt_get');f.result('good',payload)
 f.call('failed','group_task_prompt_get');f.result('failed',{text:'failed'},true)
 f.call('other','unrelated_tool');f.result('other',{text:'unrelated'})
 f.result('unknown',{text:'unpaired'})
 f.manager.appendMessage({role:'user',content:JSON.stringify(payload),timestamp:3})
 assert.deepEqual(visibleToolOutputs(f.agent),[payload])
 assert.deepEqual(visiblePromptRefs(f.agent,[prompt,{...prompt,revision:2}]),[{id:'p',revision:1}])
 assert.equal(visibleCoordinatorText(f.agent,JSON.stringify(payload)),false)
 const hybrid={...f.agent,session:{}}
 assert.throws(()=>coordinationMessages(hybrid),/COORDINATION_PI_AUTHORITY_REQUIRED/)
 assert.throws(()=>visibleCoordinatorText(hybrid,'body'),/COORDINATION_PI_AUTHORITY_REQUIRED/)
})
test('official context edits and compaction revoke pages and authenticated body while retaining raw evidence',async t=>{
 const f=await fixture(t),body='ORIGINAL_COORDINATOR_TEXT',entry=await f.input('original',body)
 f.call('page','group_topic_context_get');const first=f.result('page',{offset:0,nextOffset:3,text:'abc'})
 f.call('next','group_decision_context_get');f.result('next',{offset:3,nextOffset:6,text:'def'})
 assert.equal(visibleSectionLength(f.agent,'abcdef'),6);assert.equal(visibleSectionLength(f.agent,'different'),0)
 assert.equal(visibleCoordinatorText(f.agent,body),true)
 const original=structuredClone(f.manager.getEntry(first))
 f.manager.appendContextEdit(first,null);f.manager.appendContextEdit(entry,null)
 assert.equal(visibleSectionLength(f.agent,'abcdef'),0);assert.equal(visibleCoordinatorText(f.agent,body),false)
 assert.deepEqual(f.manager.getEntry(first),original)
 f.call('reread','group_topic_context_get');f.result('reread',{offset:0,nextOffset:6,text:'abcdef'});await f.input('new',body)
 assert.equal(visibleSectionLength(f.agent,'abcdef'),6);assert.equal(visibleCoordinatorText(f.agent,body),true)
 const anchor=f.manager.appendMessage({role:'user',content:'ANCHOR',timestamp:4})
 f.manager.appendCompaction('Summary claims original body was read',anchor,100)
 assert.equal(visibleCoordinatorText(f.agent,body),false);assert.deepEqual(visibleToolOutputs(f.agent),[])
 assert.ok(f.manager.getEntry(first))
 f.call('after','group_task_prompt_get');f.result('after',{prompts:[]});assert.deepEqual(visibleToolOutputs(f.agent),[{prompts:[]}])
})
test('legacy session shapes and injected authority readers cannot substitute for official projection',()=>{
 let reads=0
 for(const actor of [{session:{}},{session:{snapshotEvents(){reads++}}},{ctx:{get(){reads++;return{context(){reads++}}}}},{session:undefined}]){
  assert.throws(()=>coordinationMessages(actor),/COORDINATION_PI_AUTHORITY_REQUIRED/)
  assert.throws(()=>visibleCoordinatorText(actor,'body'),/COORDINATION_PI_AUTHORITY_REQUIRED/)
 }
 assert.equal(reads,0)
 assert.throws(()=>coordinationMessages({id:'fake',piSession:{sessionId:'fake'}}),{code:'BUSINESS_PI_ACTOR_REQUIRED'})
 assert.throws(()=>coordinationMessages(undefined),/COORDINATION_PI_AGENT_REQUIRED/)
 assert.equal(coordinationMessages({}),undefined)
})
