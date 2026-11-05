import test from 'node:test'
import assert from 'node:assert/strict'
import {createOfficialBusinessDrain} from '../src/runtime/pi-business-drain.js'
test('business drain attempts process cleanup even when a job receipt cannot establish settlement',async()=>{
 const calls=[],reason=Error('job receipt uncertain'),actor={id:'owner'}
 const jobs={async drainOwner(value){assert.equal(value,actor);calls.push('jobs');throw reason},list:()=>[]}
 const drain=createOfficialBusinessDrain({get:()=>jobs},{async drainOwner(value){assert.equal(value,actor);calls.push('processes');return{processes:0,scope:'registered-owned-provider-ranges'}}})
 await assert.rejects(drain(actor),{code:'PI_BUSINESS_DRAIN_UNPROVEN'});assert.deepEqual(calls,['jobs','processes'])
})
test('business drain requires explicit provider scope and zero live owner jobs',async()=>{
 const actor={id:'owner'};let report={},rows=[]
 const drain=createOfficialBusinessDrain({get:()=>({async drainOwner(){},list:()=>rows})},{async drainOwner(){return report}})
 await assert.rejects(drain(actor),{code:'PI_BUSINESS_DRAIN_UNPROVEN'})
 report={processes:0,scope:'registered-owned-provider-ranges'};rows=[{owner:'owner',status:'running'}]
 await assert.rejects(drain(actor),{code:'PI_BUSINESS_DRAIN_UNPROVEN'})
 rows=[{owner:'unrelated',status:'running'}];assert.deepEqual(await drain(actor),{...report,jobs:0})
})
test('overlapping maintenance checks retain one owner hold until all commits have finished',async()=>{
 const actor={id:'owner'};let jobResumes=0,processResumes=0
 const jobs={async drainOwner(){},list:()=>[],async resumeOwner(){jobResumes++}}
 const processOwnership={async drainOwner(){return{processes:0,scope:'registered-owned-provider-ranges'}},async resumeOwner(){processResumes++}}
 const drain=createOfficialBusinessDrain({get:()=>jobs},processOwnership)
 const first=await drain(actor,{phase:'maintenance'}),second=await drain(actor,{phase:'maintenance'})
 assert.equal(jobResumes,0);assert.equal(processResumes,0)
 await first.resume();await second.resume();assert.equal(jobResumes,1);assert.equal(processResumes,1)
 const next=await drain(actor,{phase:'maintenance'});await next.resume();assert.equal(jobResumes,2)
})
