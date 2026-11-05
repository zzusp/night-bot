import test from 'node:test'
import assert from 'node:assert/strict'
import {officialToolsFixture} from './fixtures/pi-official-tools.js'
import {bindBusinessInputAuthority,visibleBusinessInputs,retireBusinessInputs} from '../src/runtime/pi-business-inputs.js'
import {coordinationMessages,visibleCoordinatorText,visibleToolOutputs} from '../packages/dingtalk-core/coordination-context.js'
import {retireTaskContext} from '../packages/dingtalk-core/task-session.js'

async function fixture(t){
 const f=await officialToolsFixture(t,()=>{}),actor={...f.owner,piSession:f.session},packets=new Map()
 const live={value:true}
 const unbind=bindBusinessInputAuthority(actor,{lookupPacket:id=>packets.get(id),isLive:value=>value===actor&&live.value})
 t.after(unbind)
 async function input(id,source,text){
  const packet={id,source,content:[{type:'text',text}]};packets.set(id,packet)
  await f.session.sendCustomMessage({customType:'night.business-input',display:false,content:packet.content,details:{packetId:id,source}},{triggerTurn:false})
  return f.manager.getLeafId()
 }
 return {...f,actor,packets,input,live}
}

test('coordination reads the real official actor projection without a Session or secondary authority',async t=>{
 const f=await fixture(t)
 assert.equal(f.actor.session,undefined)
 await f.input('one',{kind:'coordinator',taskSession:{taskId:'task',sessionId:f.actor.id}},'AUTHORIZED_INPUT')
 assert.ok(coordinationMessages(f.actor).some(message=>message.role==='custom'&&message.content[0].text==='AUTHORIZED_INPUT'))
 assert.equal(visibleCoordinatorText(f.actor,'AUTHORIZED_INPUT'),true)
 assert.equal(visibleBusinessInputs(f.actor)[0].packetId,'one')
 const view=visibleBusinessInputs(f.actor);view[0].source.kind='forged';view[0].content[0].text='tampered'
 assert.equal(visibleCoordinatorText(f.actor,'AUTHORIZED_INPUT'),true)
 assert.throws(()=>visibleBusinessInputs({...f.actor}),{code:'BUSINESS_INPUT_AUTHORITY_REQUIRED'})
 f.packets.delete('one');assert.equal(visibleCoordinatorText(f.actor,'AUTHORIZED_INPUT'),false)
 f.live.value=false;assert.throws(()=>visibleBusinessInputs(f.actor),{code:'BUSINESS_INPUT_ACTOR_NOT_LIVE'})
})

test('unadmitted source metadata, ordinary prompts and tool supplemental context cannot grant input authority',async t=>{
 const f=await fixture(t),source={kind:'coordinator'}
 await f.session.sendCustomMessage({customType:'night.business-input',display:false,content:'UNADMITTED',details:{packetId:'missing',source}},{triggerTurn:false})
 f.packets.set('changed',{id:'changed',source,content:'EXPECTED'})
 await f.session.sendCustomMessage({customType:'night.business-input',display:false,content:'CHANGED',details:{packetId:'changed',source}},{triggerTurn:false})
 f.packets.set('supplement',{id:'supplement',source,content:'TOOL_CONTEXT'})
 await f.session.sendCustomMessage({customType:'night.tool-context',display:false,content:'TOOL_CONTEXT',details:{packetId:'supplement',source}},{triggerTurn:false})
 f.manager.appendMessage({role:'user',content:'ORDINARY',timestamp:1,details:{packetId:'supplement',source}})
 assert.deepEqual(visibleBusinessInputs(f.actor),[])
 assert.equal(visibleCoordinatorText(f.actor,'TOOL_CONTEXT'),false)
})

test('official context edit, branch and compaction remove original source visibility without rebuilding history',async t=>{
 const f=await fixture(t),source={kind:'coordinator'}
 const original=await f.input('edited',source,'ORIGINAL')
 const originalEvidence=structuredClone(f.manager.getEntry(original))
 f.manager.appendContextEdit(original,{role:'custom',customType:'night.business-input',content:[{type:'text',text:'EDITED'}],display:false,details:{packetId:'edited',source},timestamp:2})
 assert.deepEqual(visibleBusinessInputs(f.actor),[])
 assert.deepEqual(f.manager.getEntry(original),originalEvidence)
 f.manager.branch(original);assert.equal(visibleBusinessInputs(f.actor).length,1)
 const keep=f.manager.appendMessage({role:'user',content:'ANCHOR',timestamp:3})
 f.manager.appendCompaction('Summary mentions ORIGINAL',keep,100)
 assert.deepEqual(visibleBusinessInputs(f.actor),[])
})

test('task context retirement uses public context_edit on matching authenticated business input only',async t=>{
 const f=await fixture(t),binding={taskId:'task',sessionId:f.actor.id}
 const selected=await f.input('selected',{kind:'coordinator',taskSession:binding},'OLD_CONTEXT')
 const other=await f.input('other',{kind:'coordinator',taskSession:{taskId:'other',sessionId:f.actor.id}},'OTHER_CONTEXT')
 const assistant=f.manager.appendMessage({role:'assistant',content:[{type:'text',text:'signed response',textSignature:'opaque-signature'}],responseId:'opaque-response',api:'openai-responses',provider:'fixture',model:'m',timestamp:1,stopReason:'stop',usage:{input:0,output:0,cacheRead:0,cacheWrite:0,totalTokens:0,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}}})
 const raw=structuredClone(f.manager.getEntry(assistant))
 assert.deepEqual(retireTaskContext(f.actor,binding),[selected])
 assert.deepEqual(visibleBusinessInputs(f.actor).map(row=>row.entryId),[other])
 assert.deepEqual(f.manager.getEntry(assistant),raw)
 assert.equal(f.manager.getEntries().at(-1).type,'context_edit')
 assert.equal(f.manager.getEntries().at(-1).targetId,selected)
 assert.deepEqual(retireBusinessInputs(f.actor,()=>false),[])
})

test('official current tool evidence requires paired visible native tool call and successful result',async t=>{
 const f=await fixture(t)
 const call=f.manager.appendMessage({role:'assistant',content:[{type:'toolCall',id:'read',name:'group_task_prompt_get',arguments:{}}],api:'openai-responses',provider:'fixture',model:'m',timestamp:1,stopReason:'toolUse',usage:{input:0,output:0,cacheRead:0,cacheWrite:0,totalTokens:0,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}}})
 f.manager.appendMessage({role:'toolResult',toolCallId:'read',toolName:'group_task_prompt_get',content:[{type:'text',text:'{"prompts":[]}'}],isError:false,timestamp:2})
 assert.deepEqual(visibleToolOutputs(f.actor),[{prompts:[]}])
 f.manager.appendContextEdit(call,null)
 assert.deepEqual(visibleToolOutputs(f.actor),[])
})
