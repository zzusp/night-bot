import test from 'node:test'
import assert from 'node:assert/strict'
import {memoryHost} from './fixtures/memory-host.js'
import {openTaskSessionService} from '../packages/dingtalk-core/task-session-service.js'

test('a model actor cannot establish the trusted task-service scheduler context',async t=>{
 const f=await memoryHost(t),handle=await f.agent('scheduler-init-owner')
 await assert.rejects(f.host.ctx.agents.withInitiator(handle.agent,()=>openTaskSessionService({ctx:f.host.ctx})),{message:'TASK_SESSION_HOST_CONTEXT_REQUIRED'})
 assert.equal(f.requests.length,0)
 assert.equal(f.host.ctx.agents.get(handle.agent.id),handle.agent)
})
