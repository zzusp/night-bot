import test from 'node:test'
import assert from 'node:assert/strict'
import {tmpdir} from 'node:os'
import * as native from '../src/native-sandbox-protocol.js'
import * as original from '@deepseek-ai/dsh-sandbox'

// The SDK is retained only for its public error class; exported helper references
// must differ, so this differential cannot accidentally compare an alias to itself.
test('sandbox protocol retains independent algorithms and canonical public error identity',()=>{
 assert.notEqual(native.approveEscalation,original.approveEscalation)
 assert.equal(native.SandboxUnavailableError,original.SandboxUnavailableError)
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
