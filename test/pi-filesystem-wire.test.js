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
  if(n===1)return tool('edit',{path:'observed.txt',edits:[{oldText:'original',newText:'must not happen'}]})
  if(n===2||n===4)return tool('read',{path:'observed.txt'})
  if(n===3){await writeFile(file,'external content');return tool('edit',{path:'observed.txt',edits:[{oldText:'original',newText:'stale overwrite'}]})}
  if(n===5)return tool('edit',{path:'observed.txt',edits:[{oldText:'external',newText:'final'}]})
  if(n===6)return tool('write',{path:'new.txt',content:'new durable content'})
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
 const f=await subagentFixture(t,(_body,f)=>f.requests.length===1?{tools:[{id:'read-only-write',name:'write',args:{path:'denied.txt',content:'must not write'}}]}:{text:'denial observed'}),handle=await actor(f,'read-only-filesystem')
 await handle.actor.ctx.get('permissionPresets').set(handle.actor,'read-only')
 await run(handle,'check read-only refusal')
 await assert.rejects(readFile(join(f.root,'work','denied.txt')),{code:'ENOENT'})
 const saved=await stored(f,handle.actor.id),result=saved.context.piMessages.find(message=>message.role==='toolResult')
 assert.equal(result.isError,true);assert.match(JSON.stringify(f.requests[1]),/read-only|sandbox/)
 assert.equal(saved.audit.filter(receipt=>receipt.domain==='approval'&&receipt.kind==='decided').length,0)
 assert.equal(handle.actor.ctx.get('sandboxPolicy').resolve({actor:handle.actor}).mode,'read-only')
})
test('default file catalog uses official path and edits schemas and rejects retired parameter aliases',{timeout:20000},async t=>{
 const f=await subagentFixture(t,(_body,f)=>f.requests.length===1?{tools:[{id:'old-write-schema',name:'write',args:{file_path:'retired-alias.txt',content:'must not write'}}]}:{text:'retired arguments refused'}),handle=await actor(f,'official-file-schema')
 const registry=handle.actor.ctx.get('tools'),read=registry.schemaOf(registry.get('read',handle.actor)),edit=registry.schemaOf(registry.get('edit',handle.actor))
 assert.ok(read.parameters.properties.path);assert.equal(read.parameters.properties.file_path,undefined)
 assert.ok(edit.parameters.properties.edits);assert.equal(edit.parameters.properties.old_string,undefined)
 await run(handle,'Reject old file tool arguments')
 assert.equal(f.requests.length,2);await assert.rejects(readFile(join(f.root,'work','retired-alias.txt')),{code:'ENOENT'})
 const result=(await stored(f,handle.actor.id)).context.piMessages.find(message=>message.role==='toolResult')
 assert.equal(result.isError,true);assert.match(JSON.stringify(result),/path|file_path|arguments/i)
})
test('default large-file reads use explicit bounded read_window with honest final continuation',{timeout:20000},async t=>{
 const f=await subagentFixture(t,(_body,f)=>f.requests.length===1?{tools:[{id:'read-large-buffer',name:'read',args:{path:'large-window.txt'}}]}:f.requests.length===2?{tools:[{id:'read-bounded-tail',name:'read_window',args:{path:'large-window.txt',offset:10999,limit:2}}]}:{text:'bounded read verified'}),handle=await actor(f,'official-bounded-file')
 await writeFile(join(f.root,'work','large-window.txt'),Array.from({length:11000},(_,i)=>`${i+1}:`+'x'.repeat(1000)).join('\n'))
 await run(handle,'Read the large local fixture through the bounded native window')
 assert.equal(f.requests.length,3)
 const results=(await stored(f,handle.actor.id)).context.piMessages.filter(message=>message.role==='toolResult')
 assert.equal(results[0].isError,true);assert.match(JSON.stringify(results[0]),/PI_FILE_USE_READ_WINDOW/)
 assert.notEqual(results[1].isError,true,JSON.stringify(results[1]));assert.match(JSON.stringify(results[1].content),/10999:|11000:/);assert.match(JSON.stringify(results[1].content),/End of file/)
 assert.ok(Buffer.byteLength(JSON.stringify(results[1].content))<10000,'bounded output cannot contain the full file')
})
