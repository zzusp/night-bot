import test from 'node:test'
import assert from 'node:assert/strict'
import {Context} from '@deepseek-ai/cordis'
import {mkdtemp,rm,readFile,appendFile} from 'node:fs/promises'
import {join} from 'node:path'
import PiPersistence from '../src/pi-session-persistence.js'
import {apply as authority} from '../src/pi-authority.js'
import {buildSessionProjection} from '@earendil-works/pi-coding-agent'

async function fixture(t){
 const root=await mkdtemp('/tmp/night-official-observation-'),ctx=new Context();authority(ctx)
 const backend=new PiPersistence(ctx,{root:join(root,'sessions')})
 const writer=await backend.createNative({version:4,id:'observed',createdAt:Date.now(),isSeeded:false,cwd:root})
 t.after(async()=>{await writer.close();await ctx.fiber.dispose();await rm(root,{recursive:true,force:true})})
 return{ctx,backend,writer}
}
test('strict native observation preserves official media, signatures and provenance without Session publication',async t=>{
 const {ctx,backend,writer}=await fixture(t)
 const original={role:'user',content:[{type:'text',text:'authorized original'},{type:'image',mimeType:'image/png',data:'aW1hZ2U='}],timestamp:1}
 writer.manager.appendMessage(original);await writer.commit()
 const expected=buildSessionProjection(writer.manager.getEntries(),writer.manager.getLeafId()),bytes=await readFile(backend.path(writer.id))
 const read=await backend.readNative(writer.id,{requireComplete:true})
 assert.deepEqual(read.context.projection,expected);assert.deepEqual(read.context.piMessages,[original])
 assert.equal(ctx.get('sessions'),undefined);assert.equal(ctx.get('sessionQuery'),undefined)
 assert.deepEqual(await readFile(backend.path(writer.id)),bytes)
 read.context.piMessages[0].content[1].data='mutated'
 assert.equal((await backend.readNative(writer.id)).context.piMessages[0].content[1].data,original.content[1].data)
})
test('native observation rejects cancellation before I/O and after a borrowed read without acquiring or releasing the writer',async t=>{
 const {ctx,backend,writer}=await fixture(t);await writer.commit()
 const before=await readFile(backend.path(writer.id)),owner=ctx.piAuthority.describe(writer.id),checked=backend.checkedFile.bind(backend)
 let checks=0;backend.checkedFile=async(...args)=>{checks++;return checked(...args)}
 const early=new AbortController();early.abort()
 await assert.rejects(backend.readNative(writer.id,{signal:early.signal}),{name:'AbortError'});assert.equal(checks,0)
 const entered=Promise.withResolvers(),release=Promise.withResolvers(),late=new AbortController()
 backend.checkedFile=async(...args)=>{await checked(...args);entered.resolve();await release.promise}
 const pending=backend.readNative(writer.id,{signal:late.signal});const rejected=assert.rejects(pending,{name:'AbortError'})
 await entered.promise;late.abort();release.resolve();await rejected;backend.checkedFile=checked
 assert.deepEqual(ctx.piAuthority.describe(writer.id),owner);assert.deepEqual(await readFile(backend.path(writer.id)),before)
 await assert.rejects(backend.openNative(writer.id),{name:'SessionAlreadyOwnedError'})
})
test('strict native observation rejects a physical tail without repairing evidence',async t=>{
 const {backend,writer}=await fixture(t);await writer.close()
 const file=backend.path(writer.id);await appendFile(file,'{"unfinished":');const before=await readFile(file)
 await assert.rejects(backend.readNative(writer.id,{requireComplete:true}),{code:'PI_SESSION_UNCOMMITTED_TAIL'})
 assert.deepEqual(await readFile(file),before)
})
