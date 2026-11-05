import test from 'node:test'
import assert from 'node:assert/strict'
import {writeFile,readFile} from 'node:fs/promises'
import {join} from 'node:path'
import {subagentFixture} from './fixtures/pi-subagent-fixture.js'
async function actor(f,id){
 const handle=await f.host.ctx.agents.create({sessionId:id,agentOptions:{provider:'fixture',model:'m'},meta:{cwd:join(f.root,'work')},authorizeInput:packet=>packet.source.kind==='filesystem-fixture',setup:async ctx=>{await ctx.get('agentPresets').mount(ctx,'night-bot')}})
 f.handles.push(handle);return handle
}
const run=async(handle,text)=>{await handle.enqueue({id:'filesystem-proof',source:{kind:'filesystem-fixture'},content:text});await handle.deliver('filesystem-proof');await handle.whenIdle()}
const stored=(f,id)=>f.host.ctx.sessionPersistence.readNative(id,{requireComplete:true})
test('actual Pi native filesystem preserves observation CAS, stale refusal and durable mutation receipts',{timeout:20000},async t=>{
 let file
 const f=await subagentFixture(t,async(_body,f)=>{
  const n=f.requests.length,tool=(name,args)=>({tools:[{id:'fs-'+n,name,args}]})
  if(n===1)return tool('edit',{file_path:'observed.txt',old_string:'original',new_string:'must not happen'})
  if(n===2||n===4)return tool('read',{file_path:'observed.txt'})
  if(n===3){await writeFile(file,'external content');return tool('edit',{file_path:'observed.txt',old_string:'original',new_string:'stale overwrite'})}
  if(n===5)return tool('edit',{file_path:'observed.txt',old_string:'external',new_string:'final'})
  if(n===6)return tool('write',{file_path:'new.txt',content:'new durable content'})
  return{text:'files verified'}
 }),handle=await actor(f,'native-fs-actor')
 file=join(f.root,'work','observed.txt');await writeFile(file,'original content')
 assert.equal(f.host.ctx.get('fs').constructor.name,'NativeSandboxedFileSystem')
 await run(handle,'verify observed file changes')
 assert.equal(f.requests.length,7);assert.equal(await readFile(file,'utf8'),'final content');assert.equal(await readFile(join(f.root,'work','new.txt'),'utf8'),'new durable content')
 const saved=await stored(f,handle.actor.id),results=saved.context.piMessages.filter(message=>message.role==='toolResult')
 assert.equal(results.length,6)
 for(const id of ['fs-1','fs-3'])assert.equal(results.find(message=>message.toolCallId===id).isError,true)
 for(const id of ['fs-2','fs-4','fs-5','fs-6'])assert.notEqual(results.find(message=>message.toolCallId===id).isError,true)
 assert.match(JSON.stringify(f.requests[1]),/reading.*first|read.*first/);assert.match(JSON.stringify(f.requests[3]),/changed since|version/)
 assert.equal(saved.context.piMessages.at(-1).stopReason,'stop')
 assert.equal(saved.audit.filter(receipt=>receipt.domain==='admission'&&receipt.kind==='admitted').length,1)
})
test('actual Pi native filesystem read-only policy rejects a new file without granting escalation',{timeout:20000},async t=>{
 const f=await subagentFixture(t,(_body,f)=>f.requests.length===1?{tools:[{id:'read-only-write',name:'write',args:{file_path:'denied.txt',content:'must not write'}}]}:{text:'denial observed'}),handle=await actor(f,'read-only-filesystem')
 await handle.actor.ctx.get('permissionPresets').set(handle.actor,'read-only')
 await run(handle,'check read-only refusal')
 await assert.rejects(readFile(join(f.root,'work','denied.txt')),{code:'ENOENT'})
 const saved=await stored(f,handle.actor.id),result=saved.context.piMessages.find(message=>message.role==='toolResult')
 assert.equal(result.isError,true);assert.match(JSON.stringify(f.requests[1]),/read-only|sandbox/)
 assert.equal(saved.audit.filter(receipt=>receipt.domain==='approval'&&receipt.kind==='decided').length,0)
 assert.equal(handle.actor.ctx.get('sandboxPolicy').resolve({actor:handle.actor}).mode,'read-only')
})
