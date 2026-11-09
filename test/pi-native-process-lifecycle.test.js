import test from 'node:test'
import assert from 'node:assert/strict'
import {PassThrough} from 'node:stream'
import {setTimeout as delay} from 'node:timers/promises'
import {once} from 'node:events'
import {bindManagedProcess} from '../src/process/managed-process.js'
import {T as spawnSubprocess} from '../src/process/runner-launch-B2zsQ1Dz.js'
const tick=()=>new Promise(resolve=>setImmediate(resolve))
const specification=extra=>({argv:[process.execPath],cwd:process.cwd(),graceMs:15,stdio:{stdin:'ignore',stdout:{maxBytes:100},stderr:{maxBytes:100}},...extra})
function fixture(extra={}) {
  const direct=Promise.withResolvers(),range=Promise.withResolvers(),signals=[]
  let cleanups=0,waits=0
  const owner={signal:value=>signals.push(value),waitForExit:()=>{waits++;return range.promise},cleanup:()=>{cleanups++},terminateForHostExit:()=>signals.push('HOST-KILL'),...extra}
  const stdout=new PassThrough(),stderr=new PassThrough()
  const launch={stdout,stderr,stdin:null,control:new PassThrough(),direct:direct.promise,owner}
  const handle=bindManagedProcess(specification(),launch)
  return {handle,direct,range,signals,stdout,stderr,launch,get cleanups(){return cleanups},get waits(){return waits}}
}
test('owned lifecycle separates direct result from shared range drain and reader cancellation',async()=>{
  const f=fixture();f.stdout.end('result');f.stderr.end();f.direct.resolve({exitCode:0,signal:null})
  assert.equal((await f.handle.done).exitCode,0);assert.equal(f.cleanups,0)
  const reader=new AbortController(),cancelled=f.handle.waitForExit(reader.signal),joined=f.handle.waitForExit()
  reader.abort();assert.equal(await cancelled,false);assert.equal(f.waits,1);assert.equal(f.cleanups,0)
  f.range.resolve();assert.equal(await joined,true);await tick();assert.equal(f.cleanups,1)
  assert.equal(await f.handle.waitForExit(),true);assert.equal(f.cleanups,1)
  assert.equal(f.handle.control,f.launch.control);assert.equal(f.handle.control.destroyed,false);f.handle.control.destroy()
})
test('owned lifecycle postpones owner cleanup until direct settlement even after range drain',async()=>{
  const f=fixture();const joined=f.handle.waitForExit();f.range.resolve();await joined;await tick();assert.equal(f.cleanups,0)
  f.stdout.end();f.stderr.end();f.direct.resolve({exitCode:0,signal:null});await f.handle.done;await tick();assert.equal(f.cleanups,1)
  f.handle.terminate();await delay(25);assert.deepEqual(f.signals,[]);f.handle.control.destroy()
})
test('owned lifecycle stages TERM before KILL and cancels escalation after proven range exit',async()=>{
  const f=fixture();f.handle.terminate();f.handle.terminate();assert.deepEqual(f.signals,['SIGTERM'])
  await delay(30);assert.deepEqual(f.signals,['SIGTERM','SIGKILL'])
  f.range.resolve();await f.handle.waitForExit();f.stdout.end();f.stderr.end();f.direct.resolve({exitCode:null,signal:'SIGKILL'});await f.handle.done;f.handle.control.destroy()
  const g=fixture();g.handle.terminate();g.range.resolve();await g.handle.waitForExit();await delay(30);assert.deepEqual(g.signals,['SIGTERM'])
  g.stdout.end();g.stderr.end();g.direct.resolve({exitCode:0,signal:null});await g.handle.done;g.handle.control.destroy()
})
test('owned lifecycle retains failed range proof after direct settlement and evidence cleanup',async()=>{
  const failure=new Error('unreadable owner state');let calls=0
  const f=fixture({waitForExit:()=>{calls++;return Promise.reject(failure)}})
  f.stdout.end();f.stderr.end();f.direct.resolve({exitCode:0,signal:null});await f.handle.done
  await assert.rejects(f.handle.waitForExit(),error=>error===failure);await tick();assert.equal(f.cleanups,1)
  await assert.rejects(f.handle.waitForExit(),error=>error===failure);assert.equal(calls,1);f.handle.control.destroy()
})
test('owned lifecycle retries failed pre-result observation without cleaning evidence early',async()=>{
  const failure=new Error('temporary owner read');let calls=0
  const f=fixture({waitForExit:()=>++calls===1?Promise.reject(failure):Promise.resolve()})
  await assert.rejects(f.handle.waitForExit(),error=>error===failure);assert.equal(f.cleanups,0)
  assert.equal(await f.handle.waitForExit(),true);assert.equal(calls,2)
  f.stdout.end();f.stderr.end();f.direct.resolve({exitCode:0,signal:null});await f.handle.done;await tick();assert.equal(f.cleanups,1);f.handle.control.destroy()
})
test('owned lifecycle seals bounded output after direct exit grace while descendant pipe remains open',async()=>{
  const f=fixture();f.stdout.write('before');f.direct.resolve({exitCode:0,signal:null})
  assert.equal((await f.handle.done).exitCode,0);assert.equal(f.handle.collected.stdout.readFrom(0).text,'before');assert.equal(f.stdout.destroyed,true)
  assert.equal(f.cleanups,0);f.range.resolve();await f.handle.waitForExit();f.stderr.destroy();f.handle.control.destroy()
})
test('real ordinary process ignoring TERM is killed and cancellation waits for its group', {timeout:10000},async t=>{
  if(process.platform!=='linux')return t.skip('Linux process-group fallback')
  const abort=new AbortController()
  const handle=spawnSubprocess(specification({argv:[process.execPath,'-e','process.on("SIGTERM",()=>{});process.stdout.write("ready");setInterval(()=>{},1000)'],signal:abort.signal,graceMs:30,stdio:{stdin:'ignore',stdout:'pipe',stderr:{maxBytes:100}}}))
  t.after(async()=>{handle.terminate();await handle.waitForExit(AbortSignal.timeout(1000))})
  await once(handle.stdout,'data');abort.abort(new Error('authorized cancellation'))
  assert.equal((await handle.done).signal,'SIGKILL');assert.equal(await handle.waitForExit(AbortSignal.timeout(1000)),true)
})

test('owned lifecycle keeps direct startup failure distinct from owner drain and cleanup',async()=>{
  const failure=new Error('private bootstrap failed'),f=fixture()
  const rejected=assert.rejects(f.handle.done,error=>error===failure)
  f.direct.reject(failure);await rejected;assert.deepEqual(f.signals,['SIGTERM']);assert.equal(f.cleanups,0)
  f.range.resolve();assert.equal(await f.handle.waitForExit(),true);await tick();assert.equal(f.cleanups,1);f.handle.control.destroy()
})
test('owned lifecycle does not turn a signal delivery failure into a successful drain',async()=>{
  const failure=new Error('signal delivery unknown'),f=fixture({signal(){throw failure}})
  assert.throws(()=>f.handle.terminate(),error=>error===failure)
  f.range.resolve();await assert.rejects(f.handle.waitForExit(),error=>error===failure)
  f.stdout.end();f.stderr.end();f.direct.resolve({exitCode:0,signal:null});await f.handle.done
  await delay(25);await assert.rejects(f.handle.waitForExit(),error=>error===failure);f.handle.control.destroy()
})
test('owned lifecycle preserves literal stdin input and pipe endpoint dispositions',async()=>{
  const stdin=new PassThrough(),stdout=new PassThrough(),stderr=new PassThrough(),control=new PassThrough(),direct=Promise.withResolvers(),range=Promise.withResolvers()
  let input='';stdin.on('data',chunk=>input+=chunk)
  const handle=bindManagedProcess(specification({stdio:{stdin:{data:'literal\n$(argv)'},stdout:'pipe',stderr:'inherit'}}),{stdin,stdout,stderr,control,direct:direct.promise,owner:{waitForExit:()=>range.promise,signal(){},terminateForHostExit(){}}})
  assert.equal(handle.stdin,undefined);assert.equal(handle.stdout,stdout);assert.equal(handle.stderr,undefined);assert.equal(handle.control,control)
  assert.equal(input,'literal\n$(argv)');stdout.end();direct.resolve({exitCode:0,signal:null});await handle.done;assert.equal(stdout.destroyed,false)
  range.resolve();await handle.waitForExit();control.destroy();stdout.destroy();stderr.destroy()
})
