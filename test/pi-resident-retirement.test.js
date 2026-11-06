import test from 'node:test'
import assert from 'node:assert/strict'
import {access} from 'node:fs/promises'
import {createServer} from 'node:net'
import {memoryHost} from './fixtures/memory-host.js'
import {apply,inject} from '../src/application.js'

test('official application serves health and retired workflow HTTP without the predecessor plugin entry',{timeout:20000},async t=>{
 await assert.rejects(access(new URL('../packages/dingtalk-core/resident.js',import.meta.url)),{code:'ENOENT'})
 assert.ok(!inject.includes('sessions'));assert.ok(!inject.includes('llm'))
 const f=await memoryHost(t),probe=createServer();await new Promise(resolve=>probe.listen(0,'127.0.0.1',resolve));const port=probe.address().port;await new Promise(resolve=>probe.close(resolve))
 const key='resident/retirement-fixture';await f.host.ctx.credentials.modifyRecord(key,()=>({kind:'grant',payload:{retained:'opaque fixture'}}));const before=await f.host.ctx.credentials.readRecord(key)
 const config={...f.config,resident:{host:'127.0.0.1',port,taskSessions:{instanceId:'official-resident',ownerActorId:'owner',webActorId:'owner',ingressEpoch:'2026-11-01T00:00:00Z',initialize:true,recoveryIntervalMs:60000}}}
 await apply(f.host.ctx,config)
 const health=await fetch(`http://127.0.0.1:${port}/health`);assert.equal(health.status,200);assert.equal((await health.json()).status,'ok')
 for(const path of ['/state/workflows/catalog','/config/workflow-variables']){const response=await fetch(`http://127.0.0.1:${port}${path}`);assert.equal(response.status,410);assert.equal((await response.json()).error,'WORKFLOW_RETIRED')}
 const response=await fetch(`http://127.0.0.1:${port}/config/workflow-variables/endpoint`,{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify({value:'must-not-save',expectedRevision:0})});assert.equal(response.status,410)
 assert.deepEqual(await f.host.ctx.credentials.readRecord(key),before);assert.equal(f.requests.length,0)
 await f.close();await f.boot();await apply(f.host.ctx,{...config,resident:{...config.resident,taskSessions:{...config.resident.taskSessions,initialize:false}}});assert.deepEqual(await f.host.ctx.credentials.readRecord(key),before);const resumed=await fetch(`http://127.0.0.1:${port}/config/workflow-variables`);assert.equal(resumed.status,410);assert.equal(f.requests.length,0)
 for(const service of ['execution','subagents','goals'])assert.equal(f.host.ctx.get(service),undefined)
})
