import test from 'node:test'
import assert from 'node:assert/strict'
import {prepareJobJournal,JOB_REGISTERED,JOB_SETTLED,JOB_NOT_STARTED} from '../src/runtime/job-ledger.js'

test('cold job receipt projection refuses mismatched, duplicate and unsupported terminal facts',async()=>{
 const {unresolvedJobReceipts}=await import('../src/runtime/job-ledger.js')
 const registered={type:JOB_REGISTERED,data:{version:1,jobId:'job-1',owner:'session',kind:'bash',label:'command',startedAt:100,toolCall:{callId:'call',rootCallId:'call',toolName:'bash'}}}
 const settled={type:JOB_SETTLED,data:{...registered.data,producerReported:true,status:'completed',finishedAt:101}}
 assert.deepEqual(unresolvedJobReceipts([registered,settled],'session'),[])
 assert.equal(unresolvedJobReceipts([registered],'session').length,1)
 for(const change of [s=>s.data.version=99,s=>s.data.producerReported=false,s=>s.data.startedAt++,s=>s.data.finishedAt=99,s=>s.data.toolCall={...s.data.toolCall,callId:'other'}]){
  const altered=structuredClone(settled);change(altered);assert.equal(unresolvedJobReceipts([registered,altered],'session').length,1)
 }
 assert.equal(unresolvedJobReceipts([registered,settled,registered],'session').length,1)
 assert.equal(unresolvedJobReceipts([settled,registered],'session').length,1)
})


test('a legacy Session-shaped job owner cannot activate append or flush fallback',async()=>{
 let writes=0,reads=0
 const owner={id:'legacy-owner',session:{append(){writes++},snapshotEvents(){reads++;return[]}}}
 const identity={owner:owner.id,callId:'call',rootCallId:'call',name:'launch'}
 const ctx={get(name){if(name==='tools')return{executionIdentity:()=>identity};if(name==='sessions'){reads++;return{flush(){writes++}}}if(name==='agents')return{get:()=>owner}}}
 await assert.rejects(prepareJobJournal(ctx,{agent:owner,signal:new AbortController().signal},{owner:owner.id,kind:'fixture',label:'blocked'},{id:'job',startedAt:1}),{code:'NIGHT_JOB_CALL_OWNERSHIP_REQUIRED'})
 assert.equal(writes,0);assert.equal(reads,0)
})
