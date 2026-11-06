import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,rm,readFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {openNativeDomains} from '../src/native-domain.js'
import {openResidentStore,residentDomainSpec} from '../packages/dingtalk-core/store.js'

test('resident native document commits survive reopen and failed writes change neither memory nor disk',async t=>{
 const root=await mkdtemp(join(tmpdir(),'night-resident-domain-'))
 let rejectWrite=false,domains=await openNativeDomains({root,beforeCommit(){if(rejectWrite)throw new Error('INJECTED_PRE_RENAME_FAILURE')}}),store=await openResidentStore(domains)
 t.after(async()=>{await store.close();await domains.closeAll();await rm(root,{recursive:true,force:true})})
 await store.subscribe({groupId:'persisted',responsibility:'Original scoped responsibility'})
 const file=join(root,residentDomainSpec.name+'.json'),bytes=await readFile(file,'utf8'),before=structuredClone(store.getGroup('persisted'))
 rejectWrite=true
 await assert.rejects(store.subscribe({groupId:'uncommitted'}),/INJECTED_PRE_RENAME_FAILURE/)
 assert.equal(store.getGroup('uncommitted'),undefined)
 assert.deepEqual(store.getGroup('persisted'),before)
 assert.equal(await readFile(file,'utf8'),bytes)
 await store.close();await domains.closeAll()
 domains=await openNativeDomains({root});store=await openResidentStore(domains)
 assert.equal(store.getGroup('uncommitted'),undefined)
 assert.deepEqual(store.getGroup('persisted'),residentDomainSpec.tables.groups.valueSchema.parse(before))
 assert.deepEqual(JSON.parse(await readFile(file,'utf8')).unit,{name:residentDomainSpec.name,version:residentDomainSpec.version})
})


test('a queued completion checks the committed request status and cannot erase supersession',async t=>{
 const root=await mkdtemp(join(tmpdir(),'night-resident-terminal-'))
 let block=false
 const gate=Promise.withResolvers(),started=Promise.withResolvers()
 const domains=await openNativeDomains({root,beforeCommit:async()=>{if(block){block=false;started.resolve();await gate.promise}}})
 let store=await openResidentStore(domains)
 t.after(async()=>{gate.resolve();await store.close();await domains.closeAll();await rm(root,{recursive:true,force:true})})
 await store.subscribe({groupId:'g'})
 await store.updateCoordinationRequest('g','exact-request',{status:'pending',attempt:0,messageId:'exact-packet'})
 block=true
 const supersede=store.updateCoordinationRequest('g','exact-request',{status:'superseded',supersedeReason:'task-result-context-changed'})
 await started.promise
 assert.equal(store.getCoordinationRequest('g','exact-request').status,'pending')
 const staleCompletion=store.updateCoordinationRequest('g','exact-request',{status:'completed'},undefined,{expectedStatus:'pending'})
 gate.resolve();await supersede;await staleCompletion
 assert.equal(store.getCoordinationRequest('g','exact-request').status,'superseded')
 const bytes=await readFile(join(root,residentDomainSpec.name+'.json'),'utf8')
 await store.updateCoordinationRequest('g','exact-request',{status:'completed'})
 assert.equal(await readFile(join(root,residentDomainSpec.name+'.json'),'utf8'),bytes)
 assert.equal(store.getCoordinationRequest('g','exact-request').messageId,'exact-packet')
 await store.close()
 store=await openResidentStore(domains)
 assert.equal(store.getCoordinationRequest('g','exact-request').status,'superseded')
})
