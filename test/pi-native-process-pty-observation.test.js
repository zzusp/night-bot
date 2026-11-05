import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {PassThrough} from 'node:stream'
import {setTimeout as delay} from 'node:timers/promises'
import {trackDynamicProcesses} from '../packages/dingtalk-core/dynamic-process-scope.js'

// Exercise the retained, non-exported production classes without changing their
// public module surface. Native PTY and /proc races are simulated, not kernel UAT.
function definition(source,start,end) {const first=source.indexOf(start);assert.ok(first>=0);const last=source.indexOf(end,first);assert.ok(last>first);return source.slice(first,last)}
const terminalSource=readFileSync(new URL('../src/process/index.js',import.meta.url),'utf8')
import {LinuxProcessSample as Snapshot} from '../src/process/linux-observation.js'
const Terminal=new Function('PassThrough','Buffer','signalName','delay',definition(terminalSource,'var LocalTerminalHandle = class {','//#endregion')+';return LocalTerminalHandle')(PassThrough,Buffer,()=>null,delay)
const root={pid:41,started:'100',parentPid:1,session:41,state:'S'},child={pid:42,started:'200',parentPid:41,session:41,state:'S'}
function fixture() {
  let rows=[root,child],complete=true,exit
  const signals=[]
  const inspector={snapshot:()=>new Snapshot(rows,complete),signalProcess(identity,signal){const current=rows.find(row=>row.pid===identity.pid);if(current?.started===identity.started)signals.push({identity,signal})}}
  const native={pid:41,onData:()=>({dispose(){}}),onExit:callback=>{exit=callback;return{dispose(){}}},resume(){},pause(){}}
  const handle=new Terminal(native,inspector,2,'linux')
  handle.descendants(inspector.snapshot())
  return {handle,signals,observe(nextRows,nextComplete){rows=nextRows;complete=nextComplete},exit(){exit({exitCode:0,signal:0})}}
}
test('application Linux snapshot class distinguishes unknown missing row from complete absence and pid reuse',()=>{
  assert.equal(new Snapshot([],false).alive(child),undefined)
  assert.equal(new Snapshot([],true).alive(child),false)
  assert.equal(new Snapshot([{...child,started:'201'}],false).alive(child),false)
  assert.equal(new Snapshot([{...child,state:'Z'}],false).alive(child),false)
})
test('real PTY class retains unknown tracked identity and refuses partial-observation drain',async()=>{
  const f=fixture();f.observe([],false);f.exit()
  await assert.rejects(f.handle.terminate(),{code:'execution_process_drain_failed',executionDrained:false})
  assert.equal(f.handle.quiescent,false)
  assert.deepEqual(f.handle.trackedDescendants,[{pid:42,started:'200'}])
  assert.deepEqual(f.signals,[])
  assert.equal((await f.handle.inspectActivity()).state,'busy')
  f.observe([],true);await f.handle.terminate();assert.equal(f.handle.quiescent,true)
})
test('real dynamic process scope refuses false PTY drain and can retry complete evidence',async t=>{
  const f=fixture();f.observe([],false);f.exit()
  const service={spawnTerminal:async()=>f.handle},tracker=trackDynamicProcesses(service),scope=tracker.scope();t.after(()=>tracker.close())
  await scope.run(()=>service.spawnTerminal())
  await assert.rejects(scope.close(),{code:'execution_process_drain_failed',executionDrained:false})
  assert.equal(f.handle.quiescent,false)
  f.observe([],true);await scope.close();assert.equal(f.handle.quiescent,true)
})
test('real PTY class rejects incomplete empty evidence even with no tracked descendants',async()=>{
  const f=fixture();f.handle.trackedDescendants=[];f.observe([],false);f.exit()
  await assert.rejects(f.handle.terminate(),{executionDrained:false})
  assert.equal(f.handle.quiescent,false)
})
test('real PTY class never signals a reused tracked pid and accepts complete empty range',async()=>{
  const f=fixture();f.observe([{...child,started:'201',parentPid:1,session:99}],true);f.exit()
  await f.handle.terminate();assert.equal(f.handle.quiescent,true);assert.deepEqual(f.signals,[])
})
