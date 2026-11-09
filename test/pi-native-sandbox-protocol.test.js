import test from 'node:test'
import assert from 'node:assert/strict'
import {tmpdir} from 'node:os'
import {v as parseWindowsStartRequest} from '../src/process/runner-launch-B2zsQ1Dz.js'
import * as native from '../src/native-sandbox-protocol.js'
import * as original from './fixtures/legacy-sandbox-interface.mjs'

// Independent original algorithms prevent this differential from comparing aliases to themselves.
test('sandbox protocol retains independent algorithms and canonical public error identity',()=>{
 assert.notEqual(native.approveEscalation,original.approveEscalation)
 assert.notEqual(native.SandboxUnavailableError,original.SandboxUnavailableError)
 for(const api of [native,original]) {
  assert.throws(()=>api.validateEscalationArgs('workspace-write',undefined))
  assert.throws(()=>api.validateEscalationArgs(undefined,'why'))
  assert.throws(()=>api.validateEscalationArgs('workspace-write','  '))
  assert.deepEqual(api.writableRoots({mode:'read-only',workspaceRoot:tmpdir()}),[])
 }
 assert.deepEqual(native.writableRoots({mode:'workspace-write',workspaceRoot:tmpdir()}),original.writableRoots({mode:'workspace-write',workspaceRoot:tmpdir()}))
 for(const mode of ['read-only','workspace-write']) assert.equal(native.sandboxDenialMarker(mode),original.sandboxDenialMarker(mode))
})
test('sandbox escalation performs exactly one approval and never widens on non-grants',async()=>{
 for(const api of [native,original])for(const outcome of ['allowed-once','rejected','cancelled','unavailable']) {
  const agent={},signal=new AbortController().signal,requests=[]
  const request={requestedMode:'danger-full-access',effectiveMode:'read-only',justification:'fixture operation',subject:'command'}
  const approval={agent,signal,callId:'one',toolName:'bash',approver:{request:async r=>{requests.push(r);return outcome}}}
  const result=api.approveEscalation(request,approval)
  if(outcome==='allowed-once')assert.equal(await result,'danger-full-access');else await assert.rejects(result)
  assert.equal(requests.length,1);assert.equal(requests[0].agent,agent);assert.equal(requests[0].signal,signal)
  assert.equal(await api.approveEscalation({...request,requestedMode:'read-only'},{}),'read-only')
  await assert.rejects(api.approveEscalation({...request,effectiveMode:'workspace-write',requestedMode:'read-only'},approval))
  await assert.rejects(api.approveEscalation(request,{agent}))
  assert.equal(requests.length,1)
 }
})
test('runner diagnostics demand executable-specific evidence and ignore informational success',()=>{
 for(const api of [native,original]) {
  assert.equal(api.isRunnerSpawnFailure({code:'ENOENT',path:'runner',syscall:'spawn runner'},'runner',tmpdir()),true)
  assert.equal(api.isRunnerSpawnFailure({code:'ENOENT',path:'other',syscall:'spawn runner'},'runner',tmpdir()),false)
  assert.equal(api.isRunnerSpawnFailure({code:'ENOENT',path:'runner',syscall:'spawn runner'},'runner','/nonexistent-night-bot-cwd'),false)
  const rules=[{allowedExitCodes:[125],fatalSignatures:['fatal:'],informationalLines:['fatal: optional feature unavailable']}]
  assert.equal(api.classifyRunnerFailure(0,'fatal: denied',rules),undefined)
  assert.equal(api.classifyRunnerFailure(1,'fatal: denied',rules),undefined)
  assert.equal(api.classifyRunnerFailure(125,'fatal: optional feature unavailable',rules),undefined)
  assert.deepEqual(api.classifyRunnerFailure(125,'Fatal: denied',rules),{detail:'Fatal: denied'})
 }
})

test('Windows LPAC runner IPC rejects unowned fields, undefined policy and boundary widening',()=>{
 const task=String.raw`C:\night-fixture\data\workspaces\tasks\one`,lpac={kind:'windows-lpac',version:1,mode:'workspace-write',installRoot:String.raw`C:\night-fixture`,tempRoot:String.raw`C:\night-fixture\data\temp`,workspaceRoot:task,taskRoot:task,readRoots:['materials','work','outputs','tmp'].map(name=>task+'\\'+name),writeRoots:[task+String.raw`\work`,task+String.raw`\tmp`],privateRoots:[task+String.raw`\sessions`],networkCapabilities:[]},request={type:'start',cwd:task+String.raw`\work`,env:{},lpac}
 assert.deepEqual(parseWindowsStartRequest(request).lpac,lpac)
 for(const invalid of [
  {...request,unknown:true},{...request,lpac:undefined},{...request,lpac:{...lpac,unknown:true}},
  {...request,cwd:task+String.raw`-other\work`},{...request,cwd:task+String.raw`\sessions`},
  {...request,lpac:{...lpac,workspaceRoot:String.raw`C:\outside`}},
  {...request,lpac:{...lpac,tempRoot:undefined}},
  {...request,lpac:{...lpac,tempRoot:String.raw`C:\outside`}},
  {...request,lpac:{...lpac,readRoots:undefined}},
  {...request,lpac:{...lpac,readRoots:[task+String.raw`\sessions`]}},
  {...request,lpac:{...lpac,readRoots:[lpac.tempRoot]}},
  {...request,lpac:{...lpac,writeRoots:[task+String.raw`\sessions`]}},
  {...request,lpac:{...lpac,writeRoots:[task+String.raw`\materials`]}},
  {...request,lpac:{...lpac,writeRoots:[task]}},
  {...request,lpac:{...lpac,networkCapabilities:['internetClient']}},
  {...request,lpac:{...lpac,mode:'read-only'}},
  {...request,lpac:{...lpac,taskRoot:null,writeRoots:[task+String.raw`\outputs`]}},
  {...request,lpac:{...lpac,workspaceRoot:task.replace('tasks','other'),taskRoot:task.replace('tasks','other')}},
  {...request,lpac:{...lpac,workspaceRoot:task+String.raw`\work`,taskRoot:task+String.raw`\work`,writeRoots:[]}},
  {...request,lpac:{...lpac,workspaceRoot:task.replace('tasks','tasks.'),taskRoot:null,writeRoots:[]}},
  {...request,lpac:{...lpac,workspaceRoot:task.replace('tasks','tasks '),taskRoot:null,writeRoots:[]}}
 ])assert.throws(()=>parseWindowsStartRequest(invalid),/Windows (?:LPAC|policy)|Read-only Windows|invalid Windows/)
 const ordinary={type:'start',cwd:request.cwd,env:{}}
 assert.deepEqual(parseWindowsStartRequest(ordinary),ordinary)
})
