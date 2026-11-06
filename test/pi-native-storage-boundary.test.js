import test from 'node:test'
import assert from 'node:assert/strict'
import {Context} from '@deepseek-ai/cordis'
import {mkdtemp,rm,readFile,writeFile} from 'node:fs/promises'
import {join} from 'node:path'
import {SessionManager} from '@earendil-works/pi-coding-agent'
import * as storage from '../src/pi-session-persistence.js'
import {apply as authority} from '../src/pi-authority.js'
import {decodePiJournal} from '../src/runtime/pi-journal.js'

async function fixture(t){
 const root=await mkdtemp('/tmp/night-storage-boundary-'),ctx=new Context();authority(ctx)
 const backend=new storage.default(ctx,{root:join(root,'sessions')})
 t.after(async()=>{await ctx.fiber.dispose();await rm(root,{recursive:true,force:true})})
 const header=id=>({version:4,id,createdAt:1,isSeeded:false,cwd:root})
 return{root,ctx,backend,header}
}
test('native storage has no generic event writer, message mapper or lifecycle event sink',async t=>{
 const f=await fixture(t),writer=await f.backend.createNative(f.header('native'))
 assert.equal(f.backend.create,undefined);assert.equal(f.backend.open,undefined);assert.equal(storage.projectPiMessage,undefined)
 writer.manager.appendMessage({role:'user',content:[{type:'text',text:'official history'}],timestamp:1});await writer.commit()
 const bytes=await readFile(f.backend.path(writer.id)),entries=structuredClone(writer.manager.getEntries())
 f.ctx.emit('session/event',{id:writer.id},{seq:0,type:'user/message',surfaceOp:'append',data:{role:'user',content:[{type:'text',text:'forged old event'}]}})
 await f.backend.flush()
 assert.deepEqual(writer.manager.getEntries(),entries);assert.deepEqual(await readFile(f.backend.path(writer.id)),bytes)
 await writer.close()
})
test('unmarked night.event journals are unsupported evidence, never an automatic upgrade',async t=>{
 const f=await fixture(t);await f.backend.checkedRoot(true)
 const foreign=SessionManager.inMemory(f.root);foreign.newSession({id:'unmarked'})
 foreign.appendCustomEntry('night.header',{header:f.header('unmarked'),inheritedEventCount:0})
 foreign.appendCustomEntry('night.event',{event:{seq:0,type:'turn/start',data:{turn:1}}})
 const bytes=Buffer.from([foreign.getHeader(),...foreign.getEntries()].map(row=>JSON.stringify(row)).join('\n')+'\n')
 const path=f.backend.path('unmarked');await writeFile(path,bytes)
 for(const read of [()=>f.backend.readNative('unmarked'),()=>f.backend.openNative('unmarked'),()=>f.backend.stat('unmarked'),()=>f.backend.list()]){
  await assert.rejects(read(),{code:'PI_SESSION_FORMAT_UNSUPPORTED'});assert.deepEqual(await readFile(path),bytes)
 }
 assert.throws(()=>decodePiJournal(bytes,'unmarked',{requireComplete:true}),{code:'PI_SESSION_FORMAT_UNSUPPORTED'})
})
test('native storage preserves opaque signed assistant fields and Pi entry bytes across strict reopen',async t=>{
 const f=await fixture(t),writer=await f.backend.createNative(f.header('signed'))
 const message={role:'assistant',api:'openai-responses',provider:'fixture',model:'signed-model',responseId:'opaque-response',content:[{type:'text',text:'original signed text',textSignature:'opaque-signature'}],stopReason:'stop',timestamp:2,usage:{input:1,output:1,cacheRead:0,cacheWrite:0,totalTokens:2,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}}}
 writer.manager.appendMessage(message);await writer.close()
 const bytes=await readFile(f.backend.path('signed')),before=await f.backend.readNative('signed',{requireComplete:true})
 assert.deepEqual(before.context.piMessages,[message]);assert.equal(before.header.version,4)
 const opened=await f.backend.openNative('signed');assert.deepEqual(opened.manager.buildSessionProjection().messages,[message]);await opened.close()
 assert.deepEqual(await readFile(f.backend.path('signed')),bytes)
 const after=await f.backend.readNative('signed',{requireComplete:true});assert.deepEqual(after.entries,before.entries)
})
