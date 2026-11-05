import {visibilityContext} from './fixtures/pi-coordination-visibility.js'
import assert from 'node:assert/strict'
import test from 'node:test'
import { createToolResultMessage } from '../packages/capability-compat/llm/index.js'
import { coordinationMessages, visibleToolOutputs, visiblePromptRefs, visibleSectionLength, visibleCoordinatorText } from '../packages/dingtalk-dsh-assistant/coordination-context.js'

const call = (id, name) => ({ role: 'assistant', content: [{ type: 'tool-call', id, name, arguments: '{}' }] })
const result = (callId, value, isError = false) => createToolResultMessage({ callId, isError, content: [{ type: 'text', text: JSON.stringify(value) }] })
const agentFor = messages => ({id:'visibility',session:{},ctx:{get:name=>name==='piAuthority'?{context:id=>{assert.equal(id,'visibility');return visibilityContext(messages)}}:undefined}})

test('V4 visible materials require a successful tool-role result paired with an allowed call', () => {
  const prompt = { id: 'p', name: 'prompt', description: '', prompt: 'read this', revision: 1 }
  const payload = { prompts: [prompt] }
  const messages = [
    call('good', 'group_task_prompt_get'), result('good', payload),
    call('failed', 'group_task_prompt_get'), result('failed', { prompts: [{ ...prompt, id: 'failed' }] }, true),
    call('other', 'unrelated_tool'), result('other', { text: 'unrelated' }),
    result('unknown', { text: 'unpaired' }),
    { role: 'user', content: [{ type: 'text', text: JSON.stringify({ text: 'user retelling' }) }] },
    { role: 'user', content: [{ type: 'tool-result', toolCallId: 'good', content: [{ type: 'text', text: JSON.stringify({ text: 'legacy wrapper' }) }] }] },
  ]
  assert.deepEqual(visibleToolOutputs(agentFor(messages)), [payload])
  assert.deepEqual(visiblePromptRefs(agentFor(messages), [prompt, { ...prompt, revision: 2 }]), [{ id: 'p', revision: 1 }])
})

test('V4 paginated visible context keeps exact text matching and invalidates on surface changes', () => {
  const messages = [call('page', 'group_topic_context_get'), result('page', { offset: 0, nextOffset: 3, text: 'abc' })]
  const agent = agentFor(messages)
  agent.session.surface = { replaceGeneration: 0, nodes: [1] }
  assert.equal(visibleSectionLength(agent, 'abcdef'), 3)
  messages.push(call('next', 'group_decision_context_get'), result('next', { offset: 3, nextOffset: 6, text: 'def' }))
  agent.session.surface.nodes.push(2)
  assert.equal(visibleSectionLength(agent, 'abcdef'), 6)
  assert.equal(visibleSectionLength(agent, 'different'), 0)
  messages.splice(0)
  agent.session.surface.replaceGeneration++
  assert.deepEqual(visibleToolOutputs(agent), [])
})
test('production visibility requires a working Pi writer and never falls back to audit',async()=>{
 const {Session}=await import('../src/native-session-protocol.js')
 const session=Session.create('visibility-writer-required')
 assert.throws(()=>visibleToolOutputs({id:session.id,session}),/COORDINATION_PI_AUTHORITY_REQUIRED/)
 assert.throws(()=>visibleCoordinatorText({id:'missing',ctx:{get:()=>undefined},session:{}},'body'),/COORDINATION_PI_AUTHORITY_REQUIRED/)
 const failure=new Error('PI_SESSION_WRITER_REQUIRED:missing')
 assert.throws(()=>visibleToolOutputs({id:'missing',ctx:{get:()=>({context(){throw failure}})},session:{deriveMessages(){throw Error('audit fallback')}}}),error=>error===failure)
 assert.throws(()=>coordinationMessages({id:'invalid',ctx:{get:()=>({context:()=>({hostMessages:{}})})}}),/COORDINATION_PI_CONTEXT_INVALID/)
 assert.throws(()=>coordinationMessages(undefined),/COORDINATION_PI_AGENT_REQUIRED/)
 assert.equal(coordinationMessages({session:{}}),undefined,'pure composition fixture has no history evidence')
})
test('actual Pi context edits and compaction revoke original-text and paired-tool visibility until reread',async()=>{
 const {visibilityAgent,visibilityManager,appendVisible,compactVisible}=await import('./fixtures/pi-coordination-visibility.js')
 const session={id:'pi-context-edits',snapshotEvents:()=>{throw Error('audit is not model history')}},agent=visibilityAgent(session)
 const prompt={id:'p',name:'p',description:'',prompt:'read exactly',revision:1}
 const body='ORIGINAL_COORDINATOR_TEXT'
 const userEntry=appendVisible(session,{role:'user',source:{kind:'coordinator'},content:[{type:'text',text:body}]})
 appendVisible(session,call('visible','group_task_prompt_get'))
 const resultEntry=appendVisible(session,result('visible',{prompts:[prompt],offset:0,nextOffset:6,text:'abcdef'}))
 assert.equal(visibleCoordinatorText(agent,body),true);assert.equal(visibleSectionLength(agent,'abcdef'),6)
 assert.deepEqual(visiblePromptRefs(agent,[prompt]),[{id:'p',revision:1}])
 const manager=visibilityManager(session)
 manager.appendContextEdit(resultEntry,{content:[{type:'text',text:'Summary claims the source was already read'}]})
 manager.appendContextEdit(userEntry,null)
 assert.equal(visibleCoordinatorText(agent,body),false);assert.deepEqual(visiblePromptRefs(agent,[prompt]),[])
 assert.equal(visibleSectionLength(agent,'abcdef'),0)
 appendVisible(session,call('reread','group_task_prompt_get'));appendVisible(session,result('reread',{prompts:[prompt],offset:0,nextOffset:6,text:'abcdef'}))
 appendVisible(session,{role:'user',source:{kind:'coordinator'},content:[{type:'text',text:body}]})
 assert.equal(visibleCoordinatorText(agent,body),true);assert.equal(visibleSectionLength(agent,'abcdef'),6)
 compactVisible(session)
 assert.ok(manager.getEntries().some(entry=>entry.type==='message'&&entry.message.role==='toolResult'))
 assert.equal(visibleCoordinatorText(agent,body),false);assert.deepEqual(visibleToolOutputs(agent),[])
 appendVisible(session,call('post-compaction','group_task_prompt_get'));appendVisible(session,result('post-compaction',{prompts:[prompt]}))
 assert.deepEqual(visiblePromptRefs(agent,[prompt]),[{id:'p',revision:1}])
})
test('actual Host authority revokes replaced material while its audit receipts remain',async t=>{
 const {subagentFixture}=await import('./fixtures/pi-subagent-fixture.js')
 const f=await subagentFixture(t),agent=await f.parent('coordination-authority-owner'),session=agent.session
 const prompt={id:'host-prompt',name:'host',description:'',prompt:'HOST_ORIGINAL_BODY',revision:1}
 const user={id:'host-coordinator',role:'user',source:{kind:'coordinator'},content:[{type:'text',text:'HOST_COORDINATOR_BODY'}]}
 const append=()=>{
  session.append('user/message',user,{surfaceOp:'append'})
  session.append('assistant/message',{turn:1,step:1,stream:[],message:{id:'host-assistant-'+session.seq,role:'assistant',source:{kind:'model',provider:'fixture',model:'m'},content:[{type:'tool-call',id:'host-proof-'+session.seq,name:'group_task_prompt_get',arguments:'{}'}]}},{surfaceOp:'append'})
  const assistant=session.snapshotEvents().at(-1).data.message
  session.append('tool/result',{turn:1,step:1,message:result(assistant.content[0].id,{prompts:[prompt],offset:0,nextOffset:6,text:'abcdef'})},{surfaceOp:'append'})
 }
 append()
 assert.deepEqual(visiblePromptRefs(agent,[prompt]),[],'unflushed audit append is not model authority')
 await f.host.ctx.sessions.flush(session)
 assert.deepEqual(visiblePromptRefs(agent,[prompt]),[{id:'host-prompt',revision:1}]);assert.equal(visibleCoordinatorText(agent,'HOST_COORDINATOR_BODY'),true)
 assert.equal(visibleSectionLength(agent,'abcdef'),6)
 const nodes=[...session.surface.nodes]
 session.append('user/message',{id:'host-summary',role:'user',source:{kind:'coordinator'},content:[{type:'text',text:'Summary: the body and pages were previously read.'}]},{surfaceOp:{op:'replace',startSeq:nodes[0],endSeq:nodes.at(-1)},sourceEventSeqs:nodes})
 await f.host.ctx.sessions.flush(session)
 assert.ok(session.snapshotEvents().some(event=>event.type==='tool/result'))
 assert.deepEqual(visiblePromptRefs(agent,[prompt]),[]);assert.equal(visibleCoordinatorText(agent,'HOST_COORDINATOR_BODY'),false);assert.equal(visibleSectionLength(agent,'abcdef'),0)
 append();await f.host.ctx.sessions.flush(session)
 assert.deepEqual(visiblePromptRefs(agent,[prompt]),[{id:'host-prompt',revision:1}]);assert.equal(visibleSectionLength(agent,'abcdef'),6)
})
