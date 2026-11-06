import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,rm} from 'node:fs/promises'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {openNativeDomains} from '../src/native-domain.js'
import {openResidentStore} from '../packages/dingtalk-core/store.js'
import {openTaskResidentRuntime} from '../packages/dingtalk-core/task-resident-runtime.js'

test('actual resident timezone roundtrip survives cold reopen and invalid IANA input changes no settings',async t=>{
 const root=await mkdtemp(join(tmpdir(),'night-resident-timezone-'));let facility,runtime
 t.after(async()=>{await runtime?.close();await facility?.closeAll();await rm(root,{recursive:true,force:true})})
 let defaultWrites=0,modelChecks=0
 const ctx={get:name=>name==='officialAgentFactory'?{}:undefined,
  agentDefaultModel:{currentSelection:()=>({provider:'test',model:'explicit'}),saveSelection:async()=>{defaultWrites++}},
  nativeModelRoutes:{validateSelection:async()=>{modelChecks++}}}
 const start=async()=>{
  facility=await openNativeDomains({root:join(root,'state')})
  const store=await openResidentStore(facility)
  runtime=await openTaskResidentRuntime(ctx,store,root)
  return store
 }
 let store=await start()
 assert.equal(runtime.getAgentConfig().timezone,undefined)
 const first=await runtime.updateAgentConfig({timezone:'America/New_York',agentNames:['Night'],maxConcurrentTasks:3})
 assert.equal(first.timezone,'America/New_York');assert.equal(store.getTimezone(),'America/New_York')
 const before=runtime.getAgentConfig()
 await assert.rejects(runtime.updateAgentConfig({timezone:'not-a-zone',agentNames:['Wrong'],maxConcurrentTasks:9,provider:'other',model:'other'}),RangeError)
 assert.deepEqual(runtime.getAgentConfig(),before)
 assert.equal(defaultWrites,0);assert.equal(modelChecks,0)
 await store.subscribe({groupId:'group',responsibility:'timezone',timezone:'Asia/Shanghai'})
 assert.equal(store.getGroup('group').timezone,'Asia/Shanghai')
 await runtime.close();await facility.closeAll();runtime=undefined;facility=undefined
 store=await start()
 assert.deepEqual(runtime.getAgentConfig(),before)
 assert.equal(store.getGroup('group').timezone,'Asia/Shanghai')
 assert.equal((await runtime.updateAgentConfig({timezone:'UTC'})).timezone,'UTC')
 assert.deepEqual(runtime.getAgentConfig().agentNames,['Night']);assert.equal(runtime.getAgentConfig().maxConcurrentTasks,3)
})
