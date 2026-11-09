import test from 'node:test'
import assert from 'node:assert/strict'
import {runManagedShell} from '../src/runtime/managed-shell-execution.js'
const reader=text=>({readFrom:offset=>({text:Buffer.from(text).subarray(offset).toString(),nextOffset:Buffer.byteLength(text),lossy:false})})
const spec=extra=>({onExpiry:'kill',timeoutMs:1000,stdoutMaxBytes:32,...extra})
function provider(){const direct=Promise.withResolvers(),range=Promise.withResolvers();let stops=0;return {direct,range,get stops(){return stops},handle:{done:direct.promise,waitForExit:()=>range.promise,collected:{stdout:reader('out'),stderr:reader('err')},terminate(){stops++}}}}
test('shell settlement retains descendant ownership after direct exit and kill waits for range proof',async()=>{
 const p=provider(),terminal=await runManagedShell({spec:spec({onExpiry:'none'}),prepare:['exact','argv'],spawn:()=>p.handle})
 p.direct.resolve({exitCode:0,signal:null});let done=false;terminal.done.then(()=>{done=true});await new Promise(r=>setImmediate(r));assert.equal(done,false);assert.equal(terminal.status,'running')
 assert.equal(terminal.kill(),true);assert.equal(p.stops,1);await new Promise(r=>setImmediate(r));assert.equal(done,false);p.range.resolve(true);await terminal.result();assert.equal(done,true);assert.equal(terminal.kill(),false)
})
test('caller cancellation before the local deadline is reported as aborted and cannot hide provider failure',async()=>{
 const p=provider(),controller=new AbortController(),terminal=await runManagedShell({spec:spec({signal:controller.signal}),prepare:['literal'],spawn:()=>p.handle})
 controller.abort();const failure=Error('unknown range observation');p.direct.reject(failure);p.range.resolve(true);await terminal.done;await assert.rejects(terminal.result(),error=>error===failure)
 const next=provider(),second=await runManagedShell({spec:spec({signal:AbortSignal.timeout(1)}),prepare:['literal'],spawn:()=>next.handle});await new Promise(r=>setTimeout(r,5));next.direct.resolve({exitCode:null,signal:'SIGTERM'});next.range.resolve(true);const result=await second.result();assert.equal(result.aborted,true);assert.equal(result.timedOut,false)
})
test('abort after proved completion cannot rewrite the settled cause',async()=>{
 const p=provider(),controller=new AbortController(),terminal=await runManagedShell({spec:spec({signal:controller.signal}),prepare:['literal'],spawn:()=>p.handle})
 p.direct.resolve({exitCode:0,signal:null});p.range.resolve(true);await terminal.done;controller.abort();const result=await terminal.result();assert.equal(result.aborted,false);assert.equal(result.timedOut,false)
})
test('missing or negative range evidence is an infrastructure error, never success',async()=>{
 for(const evidence of [false,undefined]){const p=provider();if(evidence===undefined)delete p.handle.waitForExit;const terminal=await runManagedShell({spec:spec(),prepare:['literal'],spawn:()=>p.handle});p.direct.resolve({exitCode:0,signal:null});p.range.resolve(false);await terminal.done;await assert.rejects(terminal.result(),/range drain is unproven/);assert.equal(terminal.status,'killed')}
})
