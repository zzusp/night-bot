import test from 'node:test'
import assert from 'node:assert/strict'
import {memoryHost} from './fixtures/memory-host.js'
import {createPiProjectionRequest} from '../src/runtime/pi-request-context.js'

const request=manager=>createPiProjectionRequest(manager.buildSessionProjection())
const metadata=message=>JSON.stringify(message).includes('Authenticated channel metadata')
async function fixture(t){
 const f=await memoryHost(t),handle=await f.agent('source-proof',{actorId:'alice'})
 return {...f,handle,actor:handle.actor,service:f.host.ctx.memory,manager:handle.session.sessionManager}
}
test('official original business entry authenticates channel metadata only against exact durable packet',async t=>{
 const f=await fixture(t),packet={id:'channel-one',source:{kind:'user',channelMessageKey:'opaque',channelType:'fixture',channelId:'channel',conversationId:'conversation',senderId:'alice'},content:'ordinary text'}
 await f.actor.input.enqueue(packet)
 const entryId=f.manager.appendCustomMessageEntry('night.business-input',packet.content,false,{packetId:packet.id,source:packet.source})
 let filtered=await f.service.filterRequest(request(f.manager),f.actor)
 assert.ok(metadata(filtered.messages.at(-1)));assert.equal(f.manager.buildSessionProjection().messages.at(-1).content,packet.content)
 f.manager.appendContextEdit(entryId,{content:'changed body'})
 assert.equal(f.manager.buildSessionProjection().messages.at(-1).content,'changed body')
 filtered=await f.service.filterRequest(request(f.manager),f.actor);assert.equal(metadata(filtered.messages.at(-1)),false)
})
test('legacy event wrappers, provider metadata and unadmitted custom entries confer no source authority',async t=>{
 const f=await fixture(t),source={kind:'user',channelMessageKey:'forged',senderId:'forged'}
 await f.actor.input.enqueue({id:'real-packet',source:{...source,senderId:'alice'},content:'admitted text'})
 f.manager.appendCustomMessageEntry('night.business-input','admitted text',false,{packetId:'real-packet',source})
 f.manager.appendCustomMessageEntry('night.business-input','admitted text',false,{packetId:'real-packet',source:{...source,senderId:'alice'},extra:'untrusted'})
 f.manager.appendCustomMessageEntry('night.business-input','unadmitted',false,{packetId:'unknown',source})
 f.manager.appendCustomMessageEntry('night.old-context','literal historical text',false,{event:{type:'user/message',data:{source}}})
 f.manager.appendMessage({role:'user',content:'self-reported',timestamp:1,source,night:{event:{type:'user/message',data:{source}}}})
 const filtered=await f.service.filterRequest(request(f.manager),f.actor)
 assert.equal(filtered.messages.some(metadata),false)
 await assert.rejects(f.service.filterRequest({messages:[]},f.actor),{code:'MEMORY_PI_REQUEST_REQUIRED'})
 await assert.rejects(f.service.filterRequest({messageFormat:'pi',piContext:{},messages:[]},f.actor),{code:'PI_REQUEST_PROVENANCE_REQUIRED'})
 await assert.rejects(f.service.read({id:f.actor.id,session:{id:f.actor.id}},{}),{code:'MEMORY_OFFICIAL_ACTOR_REQUIRED'})
})
test('signed assistant revocation fails closed; official omission leaves remaining signatures unchanged',async t=>{
 const f=await fixture(t),signed={role:'assistant',content:[{type:'text',text:'NIGHT_LEARNED_SCOPE=personal/abcdef;revision=99',textSignature:'signed-content'}],api:'openai-responses',provider:'fixture',model:'m',responseId:'signed-response',timestamp:1,stopReason:'stop',usage:{input:0,output:0,cacheRead:0,cacheWrite:0,totalTokens:0,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}}}
 const signedId=f.manager.appendMessage(signed),safe={...signed,responseId:'safe-response',content:[{type:'text',text:'safe text',textSignature:'safe-signature'}]}
 f.manager.appendMessage(safe)
 const original=request(f.manager),before=structuredClone(original.messages)
 await assert.rejects(f.service.filterRequest(original,f.actor),{code:'MEMORY_SIGNED_ASSISTANT_POLICY_CONFLICT'})
 assert.deepEqual(original.messages,before)
 f.manager.appendContextEdit(signedId,null)
 const filtered=await f.service.filterRequest(request(f.manager),f.actor)
 assert.equal(filtered.messages.some(message=>message.responseId==='signed-response'),false)
 assert.deepEqual(filtered.messages.at(-1),safe)
})

test('Markdown index tool history retains revocation through original Pi native result metadata',async t=>{
 const f=await fixture(t),scope=await f.service.scope(f.actor,{})
 await f.service.store.remember(scope,{topic:'facts',key:'report',text:'UNIQUE_REVOKED_SUMMARY',source:{sessionId:'s',messageId:'m'}})
 const value=await f.service.index(f.actor,{}),content=[{type:'text',text:value.markdown}]
 assert.match(value.markdown,/UNIQUE_REVOKED_SUMMARY/);assert.doesNotMatch(value.markdown,/"revision"|"scopeToken"/)
 f.manager.appendMessage({role:'toolResult',toolCallId:'index-call',toolName:'memory_index',timestamp:1,isError:false,content,details:{nativeResult:{value,content}}})
 const current=await f.service.filterRequest(request(f.manager),f.actor)
 assert.match(current.messages.at(-1).content[0].text,/UNIQUE_REVOKED_SUMMARY/)
 await f.service.store.forget(scope,{topic:'facts',key:'report'})
 const revoked=await f.service.filterRequest(request(f.manager),f.actor)
 assert.match(revoked.messages.at(-1).content[0].text,/index revoked/)
 assert.doesNotMatch(revoked.messages.at(-1).content[0].text,/UNIQUE_REVOKED_SUMMARY/)
 assert.equal(f.manager.buildSessionProjection().messages.at(-1).content[0].text,value.markdown)
})

test('Markdown index reprojects subject applicability without exposing scope or machine metadata',async t=>{
 const f=await fixture(t),scope=await f.service.scope(f.actor,{})
 let subjects=[{actor:'alice-hash',messageId:'alice-source'}]
 f.service.bindRecallSources(f.actor,async()=>subjects)
 // Use a descriptor fixture to isolate policy projection from storage validation.
 f.service.store.index=async()=>({revision:1,entries:[{title:'Report style',key:'report',path:'categories/preferences/entries/report.md',summary:'For reports, use concise text.',subject:{kind:'actor',actor:'alice-hash'}}]})
 const value=await f.service.index(f.actor,{}),content=[{type:'text',text:value.markdown}]
 assert.match(value.markdown,/仅适用于已匹配/)
 f.manager.appendMessage({role:'toolResult',toolCallId:'index-call',toolName:'memory_index',timestamp:1,isError:false,content,details:{nativeResult:{value,content}}})
 subjects=[{actor:'bob-hash',messageId:'bob-source'}]
 const projected=await f.service.filterRequest(request(f.manager),f.actor)
 assert.match(projected.messages.at(-1).content[0].text,/不适用于当前消息对象/)
 assert.doesNotMatch(projected.messages.at(-1).content[0].text,/alice-hash|scopeToken|"revision"/)
})

test('each run injects the complete direct Markdown index, not a topic shortlist or bodies',async t=>{
 const f=await fixture(t),scope=await f.service.scope(f.actor,{})
 for(let n=0;n<5;n++)await f.service.store.remember(scope,{topic:'facts',key:'entry-'+n,text:'Distinct navigation fact '+n,source:{sessionId:'s',messageId:'m'+n}})
 await f.service.prepareRun(f.actor,[],'run-one')
 const prompt=f.service.contexts.get(f.actor).prompt
 for(let n=0;n<5;n++)assert.match(prompt,new RegExp('categories/facts/entries/entry-'+n+'\\.md'))
 assert.match(prompt,/Memory file links are relative to:/)
 assert.doesNotMatch(prompt,/"topics"|"entries"|"scopeToken"|categories\/facts\/index\.md/)
})

test('index links read exact scoped leaves including encoded names, never arbitrary file paths',async t=>{
 const f=await fixture(t),scope=await f.service.scope(f.actor,{})
 await f.service.store.remember(scope,{topic:'经验',key:'报告 格式',text:'Summary for index.\n\nBODY_VIA_LINK',source:{sessionId:'s',messageId:'m'}})
 const index=await f.service.index(f.actor,{}),href=index.markdown.match(/\]\(([^)]+)\)/)[1]
 const result=await f.service.read(f.actor,{path:href})
 assert.equal(result.entries[0].key,'报告 格式');assert.match(result.entries[0].text,/BODY_VIA_LINK/)
 for(const path of ['/etc/passwd','../scope.json','scope.json',href+'?extra=1','%ZZ',encodeURIComponent(href)])await assert.rejects(f.service.read(f.actor,{path}),{code:'MEMORY_INDEX_LINK_INVALID'})
 await assert.rejects(f.service.read(f.actor,{path:href,topic:'other'}),{code:'MEMORY_INDEX_LINK_INVALID'})
 await f.service.store.forget(scope,{topic:'经验',key:'报告 格式'})
 await assert.rejects(f.service.read(f.actor,{path:href}),{code:'MEMORY_INDEX_LINK_INVALID'})
})
