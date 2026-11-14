import test from 'node:test'
import assert from 'node:assert/strict'
import {triageSessionId} from '../../../src/channels/triage.js'
import {triageSessionView,triageSessionMessageView} from '../server/session-view.js'

const conversationId='conversation-fixture',sessionId=triageSessionId(conversationId)
const project=(id,message)=>({sourceEntry:{id,timestamp:'2026-11-14T01:00:00Z'},messages:[message]})
function snapshot() {return {header:{id:sessionId,runtimeOwner:'channel-triage',conversationId},entries:[{id:'commit'}],context:{projection:{entries:[
 project('private',{role:'system',content:'PRIVATE_SYSTEM'}),
 project('input',{role:'custom',customType:'night.business-input',details:{source:{kind:'channel-triage',conversationId}},content:[{type:'text',text:'一级分诊请求：'+JSON.stringify({conversationId,background:{sources:[{text:'PRIVATE_BACKGROUND'}]},messages:[{sourceId:'source-1',version:1,conversationId,text:'请核对进度 SECRET_REGISTERED'}]})}]}),
 project('assistant',{role:'assistant',content:[{type:'thinking',thinking:'需要核对已有安排'},{type:'toolCall',name:'channel_triage_submit',id:'decision',arguments:{dispositions:[{sourceId:'PRIVATE_SOURCE_ID',messageVersion:1,needsHandling:true,reason:'需要路由继续处理',reply:'正在核对'}],unknown:'PRIVATE_FIELD'}}]}),
 project('result',{role:'toolResult',toolName:'channel_triage_submit',toolCallId:'decision',content:[{type:'text',text:JSON.stringify({dispositions:[{state:'committed',id:'PRIVATE_RECORD',decision:{needsHandling:true,reason:'需要路由继续处理',reply:'正在核对'}}],notifications:[{payload:{token:'PRIVATE_CREDENTIAL'}}]})}]}),
]}}}}
const options=value=>({conversationId,secrets:['SECRET_REGISTERED'],persistence:{readNative:async id=>{assert.equal(id,sessionId);return value}}})
test('triage uses shared stable native identity and only selected current-source/decision bodies',async()=>{
 const value=snapshot(),result=await triageSessionView(options(value))
 assert.equal(result.status,'ready');assert.equal(result.items.length,4);assert.equal(result.items[0].text,'请核对进度 [已隐藏]')
 assert.match(result.items[2].text,/needsHandling/);assert.match(result.items[3].text,/committed/)
 assert.doesNotMatch(JSON.stringify(result),/PRIVATE_|SECRET_REGISTERED|background|一级分诊请求/)
 assert.deepEqual(value,snapshot())
})
test('triage rejects foreign header, runtime owner and source identity',async()=>{
 for(const mutate of [s=>s.header.id='foreign',s=>s.header.runtimeOwner='conversation-router',s=>s.header.conversationId='foreign',s=>s.context.projection.entries[1].messages[0].details.source.conversationId='foreign',s=>{const m=s.context.projection.entries[1].messages[0];m.content[0].text=m.content[0].text.replace('"conversationId":"conversation-fixture","text"','"conversationId":"foreign","text"')}]){
  const value=snapshot();mutate(value);await assert.rejects(triageSessionView(options(value)),e=>['SESSION_IDENTITY_INVALID','SESSION_SOURCE_IDENTITY_INVALID'].includes(e.code))
 }
})
test('triage pending and unavailable states do not manufacture history',async()=>{
 for(const [error,reason] of [[{name:'SessionPersistenceNotFoundError'},'SESSION_NOT_STARTED'],[{code:'PI_SESSION_UNCOMMITTED_TAIL'},'SESSION_COMMIT_PENDING'],[{},'SESSION_UNAVAILABLE']]) {
  const result=await triageSessionView({conversationId,persistence:{readNative:async()=>{throw Object.assign(Error('private'),error)}}})
  assert.equal(result.reason,reason);assert.deepEqual(result.items,[])
 }
})
test('triage shares bounded history/body pagination, final revocation and compaction invalidation',async()=>{
 const value=snapshot();value.context.projection.entries.push(project('long',{role:'assistant',content:'正文'.repeat(10000)}))
 const opts=options(value),page=await triageSessionView({...opts,stream:true,limit:2}),row=page.items.at(-1)
 assert.equal(page.items.length,2);assert.ok(page.before);assert.equal(row.text.length,16000)
 const tail=await triageSessionMessageView({...opts,messageId:row.id,revision:page.revision,offset:16000})
 assert.equal(row.text+tail.text,'正文'.repeat(10000))
 await assert.rejects(triageSessionView({...opts,guard:async()=>{throw Object.assign(Error(),{code:'AUTH_REQUIRED'})}}),{code:'AUTH_REQUIRED'})
 value.entries.push({id:'compaction'});value.context.projection.entries.shift()
 await assert.rejects(triageSessionMessageView({...opts,messageId:row.id,revision:page.revision}),{code:'SESSION_PAGE_STALE'})
})
