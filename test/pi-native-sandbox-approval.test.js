import test from 'node:test'
import assert from 'node:assert/strict'
import {approveNativeSandbox,validateNativeEscalation} from '../src/native-sandbox-approval.js'
test('sandbox widening is one-shot, approval-scoped and never mutates the standing policy',async()=>{
 const request={requestedMode:'danger-full-access',effectiveMode:'workspace-write',justification:'isolated test',subject:'program'},agent={},controller=new AbortController();let seen
 const mode=await approveNativeSandbox(request,{agent,callId:'call',toolName:'run_code',signal:controller.signal,approver:{request:async value=>{seen=value;return'allowed-once'}}});assert.equal(mode,'danger-full-access');assert.equal(request.effectiveMode,'workspace-write');assert.equal(seen.agent,agent);assert.equal(seen.signal,controller.signal);assert.equal(seen.callId,'call');assert.ok(seen.reason.includes('isolated test'))
})
for(const outcome of ['rejected','cancelled','unavailable','unexpected'])test('sandbox never treats a non-grant as permission: '+outcome,async()=>assert.rejects(approveNativeSandbox({requestedMode:'danger-full-access',effectiveMode:'workspace-write',justification:'test',subject:'program'},{agent:{},approver:{request:async()=>outcome}})))
test('equal modes do not broaden access and narrower or unsupported modes cannot be approved',async()=>{
 assert.equal(await approveNativeSandbox({requestedMode:'workspace-write',effectiveMode:'workspace-write'},{}),'workspace-write');for(const requestedMode of ['read-only','unknown'])await assert.rejects(approveNativeSandbox({requestedMode,effectiveMode:'workspace-write'},{agent:{},approver:{request:async()=>{throw new Error('must not ask')}}}));await assert.rejects(approveNativeSandbox({requestedMode:'danger-full-access',effectiveMode:'workspace-write'},{agent:{}}));await assert.rejects(approveNativeSandbox({requestedMode:'danger-full-access',effectiveMode:'workspace-write'},{approver:{}}))
})
test('sandbox arguments require a paired, nonempty justification',()=>{validateNativeEscalation(undefined,undefined);validateNativeEscalation('workspace-write','test');assert.throws(()=>validateNativeEscalation('workspace-write',undefined));assert.throws(()=>validateNativeEscalation(undefined,'reason'));assert.throws(()=>validateNativeEscalation('workspace-write',' '))})
