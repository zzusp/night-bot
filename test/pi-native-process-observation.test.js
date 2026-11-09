import test from 'node:test'
import assert from 'node:assert/strict'
import {spawn} from 'node:child_process'
import {once} from 'node:events'
import {decodeLinuxStat,observeLinuxPid,sampleLinuxProcesses,LinuxProcessInspector,LinuxProcessSample,linuxProcessGroupHasLiveMembers} from '../src/process/linux-observation.js'
function stat(pid,{parent=1,group=pid,session=pid,start='100',state='S',comm='test (nested) name'}={}) {
  const values=Array(49).fill('0');Object.assign(values,{0:String(parent),1:String(group),2:String(session),3:'0',4:String(group),18:start})
  return `${pid} (${comm}) ${state} ${values.join(' ')}\n`
}
function ioFixture(rows,errors={}) {
  const signals=[]
  return {signals,readDir:()=>Object.keys(rows),readFile(path){const pid=Number(path.split('/')[2]);if(errors[pid])throw Object.assign(new Error('read failed'),{code:errors[pid]});if(!(pid in rows))throw Object.assign(new Error('gone'),{code:'ENOENT'});return rows[pid]},kill:(pid,signal)=>signals.push({pid,signal})}
}
test('owned Linux decoder preserves kernel identity and rejects malformed or mismatched pid records',()=>{
  assert.deepEqual(decodeLinuxStat(stat(12,{start:'99999999999999999999'}),12),{pid:12,parentPid:1,pgrp:12,session:12,ttyDevice:0,tpgid:12,state:'S',started:'99999999999999999999'})
  for(const text of ['garbage',stat(12).replace(' 0 0 0',' a 0 0'),stat(12,{start:'x'}),stat(12,{start:'-1'}),stat(12,{parent:-1}),stat(12).slice(0,20)])assert.equal(decodeLinuxStat(text,12),undefined)
  assert.equal(decodeLinuxStat(stat(13),12),undefined)
})
test('owned Linux observation distinguishes gone, denied, malformed, live and zombie',()=>{
  const io=ioFixture({12:stat(12),13:stat(13,{state:'Z'}),14:'bad'},{15:'EACCES',16:'EIO'})
  assert.equal(observeLinuxPid(12,io).state,'alive');assert.equal(observeLinuxPid(13,io).state,'dead')
  for(const pid of [14,15,16])assert.equal(observeLinuxPid(pid,io).state,'unknown')
  assert.equal(observeLinuxPid(17,io).state,'dead')
  const inspector=new LinuxProcessInspector(io)
  assert.equal(inspector.isAlive({pid:15,started:'100'}),undefined)
  inspector.signalProcess({pid:15,started:'100'},'SIGKILL');inspector.signalProcess({pid:12,started:'99'},'SIGKILL');assert.deepEqual(io.signals,[])
  inspector.signalProcess({pid:12,started:'100'},'SIGTERM');assert.deepEqual(io.signals,[{pid:12,signal:'SIGTERM'}])
})
test('owned Linux snapshot has immutable identities and children-first membership without recycled-parent adoption',()=>{
  const io=ioFixture({10:stat(10,{start:'100'}),11:stat(11,{parent:10,start:'101',session:10}),12:stat(12,{parent:11,start:'102',session:10}),13:stat(13,{parent:10,start:'99'})})
  const sample=sampleLinuxProcesses(io)
  assert.equal(sample.complete,true);assert.deepEqual(sample.tree(10).map(row=>row.pid),[12,11,10]);assert.deepEqual(sample.session(10).map(row=>row.pid),[10,11,12])
  const member=sample.tree(10)[0];assert.throws(()=>{member.started='changed'},TypeError)
  assert.equal(sample.alive({pid:11,started:'other'}),undefined)
  assert.equal(sample.alive({pid:11,started:'100'}),false);assert.equal(sample.alive({pid:11,started:'101'}),true)
  assert.equal(sample.status({pid:404,started:'100'}),'dead')
})
test('owned Linux sampling preserves unknown on partial reads, pid reuse and newly appearing processes',()=>{
  const io=ioFixture({10:stat(10),11:stat(11)},{11:'EACCES'})
  const sample=sampleLinuxProcesses(io);assert.equal(sample.complete,false);assert.equal(sample.status({pid:11,started:'100'}),'unknown')
  let calls=0
  const reused={readDir:()=>['10'],readFile:()=>stat(10,{start:String(++calls)}),kill(){}}
  const changed=sampleLinuxProcesses(reused);assert.equal(changed.complete,false);assert.deepEqual(changed.tree(10),[])
  let lists=0
  const appeared={...ioFixture({10:stat(10)}),readDir:()=>++lists===1?['10']:['10','11']}
  assert.equal(sampleLinuxProcesses(appeared).complete,false)
  let reads=0
  const closingFailure={...ioFixture({10:stat(10)}),readDir(){if(++reads===2)throw new Error('denied');return ['10']}}
  assert.equal(sampleLinuxProcesses(closingFailure).complete,false)
})
test('owned Linux group evidence never treats unknown members as a dead group',()=>{
  assert.equal(linuxProcessGroupHasLiveMembers(10,ioFixture({10:stat(10,{state:'Z'})})),false)
  assert.equal(linuxProcessGroupHasLiveMembers(10,ioFixture({10:stat(10,{state:'Z'}),11:stat(11,{group:10})})),true)
  assert.equal(linuxProcessGroupHasLiveMembers(10,ioFixture({10:stat(10,{state:'Z'}),11:stat(11)},{11:'EACCES'})),undefined)
  assert.equal(linuxProcessGroupHasLiveMembers(10,{readDir(){throw new Error('unreadable')}}),undefined)
})
test('owned Linux sampling uses iterative membership for deep chains and cycles',()=>{
  const rows=Array.from({length:12000},(_,index)=>({pid:index+1,parentPid:index,pgrp:1,session:1,started:String(index+1),state:'S'}))
  assert.equal(new LinuxProcessSample(rows,true).tree(1).length,12000)
  const cyclic=new LinuxProcessSample([{pid:1,parentPid:2,started:'1',state:'S'},{pid:2,parentPid:1,started:'1',state:'S'}],true)
  assert.equal(cyclic.tree(1).length,2)
})
test('real Linux proc observes current process and a child identity without signaling a reused identity',{timeout:10000},async t=>{
  if(process.platform!=='linux')return t.skip('Linux /proc only')
  const own=observeLinuxPid(process.pid);assert.equal(own.state,'alive');assert.equal(own.row.pid,process.pid)
  const child=spawn(process.execPath,['-e','process.stdout.write("ready");setInterval(()=>{},1000)'],{stdio:['ignore','pipe','pipe']})
  t.after(()=>child.kill('SIGKILL'))
  await once(child.stdout,'data')
  const inspector=new LinuxProcessInspector(),observed=observeLinuxPid(child.pid)
  assert.equal(observed.state,'alive');assert.equal(observed.row.parentPid,process.pid)
  const member={pid:child.pid,started:observed.row.started}
  const sample=inspector.snapshot();assert.equal(sample.status(member),'alive');assert.ok(sample.tree(process.pid).some(row=>row.pid===child.pid))
  inspector.signalProcess({...member,started:String(BigInt(member.started)+1n)},'SIGKILL');assert.equal(inspector.observe(member),'alive')
  const exit=once(child,'exit');inspector.signalProcess(member,'SIGKILL');await exit;assert.equal(inspector.observe(member),'dead')
})

test('owned Linux closing directory cannot turn a failed pid read into proof of death',()=>{
  const stillListed={readDir:()=>['10'],readFile(){throw Object.assign(new Error('replaced during read'),{code:'ENOENT'})}}
  const unknown=sampleLinuxProcesses(stillListed)
  assert.equal(unknown.complete,false);assert.equal(unknown.status({pid:10,started:'100'}),'unknown')
  let lists=0
  const departed={...stillListed,readDir:()=>++lists===1?['10']:[]}
  const gone=sampleLinuxProcesses(departed)
  assert.equal(gone.complete,true);assert.equal(gone.status({pid:10,started:'100'}),'dead')
})
test('owned Linux sample does not adopt descendants after the root identity is missing',()=>{
  const sample=sampleLinuxProcesses(ioFixture({12:stat(12,{parent:11,start:'102',session:10})}))
  assert.deepEqual(sample.tree(10),[])
  assert.deepEqual(sample.session(10),[{pid:12,started:'102'}])
  // Session membership is observation only. The PTY owner must retain and check
  // the original root identity before adopting those members as descendants.
  assert.equal(sample.status({pid:10,started:'100'}),'dead')
})
test('owned Linux inspector preserves foreground and attributed stdin-readiness seam',async()=>{
  const calls=[],io=ioFixture({10:stat(10,{group:13})})
  const inspector=new LinuxProcessInspector(io,(group,shell)=>{calls.push([group,shell]);return true})
  assert.equal(inspector.foregroundPgid(10),13);assert.equal(inspector.foregroundPgid(404),undefined)
  assert.equal(inspector.isStdinWaiting(13,10),true);assert.deepEqual(calls,[[13,10]])
  inspector.signalGroup(13,'SIGINT');assert.deepEqual(io.signals,[{pid:-13,signal:'SIGINT'}])
  assert.throws(()=>inspector.signalGroup(-1,'SIGINT'),/invalid/)
  const {D:createProcessInspector}=await import('../src/process/runner-launch-B2zsQ1Dz.js')
  assert.ok(createProcessInspector('linux','x64',io) instanceof LinuxProcessInspector)
})
