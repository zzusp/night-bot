import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,rm,readFile,appendFile,writeFile,symlink,readdir,mkdir} from 'node:fs/promises'
import {join} from 'node:path'
import {createHash} from 'node:crypto'
import {Context} from '@deepseek-ai/cordis'
import {SessionManager} from '@earendil-works/pi-coding-agent'
import PiPersistence from '../src/pi-session-persistence.js'
import {apply as authority} from '../src/pi-authority.js'
import {nativeSessionHeader} from './fixtures/native-session-header.js'
const user=text=>({role:'user',content:[{type:'text',text}],timestamp:1})
async function fixture(t){
 const root=await mkdtemp('/tmp/night-pi-authority-'),ctx=new Context();authority(ctx)
 const backend=new PiPersistence(ctx,{root:join(root,'sessions')})
 t.after(async()=>{try{await ctx.fiber.dispose()}finally{await rm(root,{recursive:true,force:true})}})
 return{root,ctx,backend,header:id=>nativeSessionHeader(id,{cwd:root})}
}
test('official context edits retire visibility while original evidence stays in immutable Pi entries',async t=>{
 const f=await fixture(t),writer=await f.backend.createNative(f.header('authority'))
 const target=writer.manager.appendMessage(user('ORIGINAL_AUTHORITY'));writer.manager.appendMessage(user('RETAINED_EVIDENCE'))
 writer.manager.appendContextEdit(target,null);await writer.close()
 const before=await f.backend.readNative('authority',{requireComplete:true})
 assert.ok(JSON.stringify(before.context.piMessages).includes('RETAINED_EVIDENCE'));assert.ok(!JSON.stringify(before.context.piMessages).includes('ORIGINAL_AUTHORITY'))
 assert.equal(before.entries.find(entry=>entry.id===target).message.content[0].text,'ORIGINAL_AUTHORITY')
 const resumed=await f.backend.openNative('authority');assert.deepEqual(resumed.manager.buildSessionProjection(),before.context.projection);await resumed.close()
})
test('Pi committed reads never repair a tail and strict native writer reopening refuses it',async t=>{
 const f=await fixture(t),writer=await f.backend.createNative(f.header('tail'));writer.manager.appendMessage(user('COMMITTED'));await writer.close()
 const path=f.backend.path('tail'),before=await readFile(path,'utf8'),last=JSON.parse(before.trim().split('\n').at(-1))
 const tail=JSON.stringify({type:'custom',id:'orphan',parentId:last.id,timestamp:new Date().toISOString(),customType:'uncommitted',data:{text:'NOT_ADMITTED'}})+'\n{"torn":'
 await appendFile(path,tail)
 assert.deepEqual((await f.backend.readNative('tail')).context.piMessages,[user('COMMITTED')])
 await assert.rejects(f.backend.readNative('tail',{requireComplete:true}),{code:'PI_SESSION_UNCOMMITTED_TAIL'})
 await assert.rejects(f.backend.openNative('tail'),{code:'PI_SESSION_UNCOMMITTED_TAIL'})
 assert.equal(await readFile(path,'utf8'),before+tail)
})
test('Pi history checksum refuses modified complete records without rewriting evidence',async t=>{
 const f=await fixture(t),writer=await f.backend.createNative(f.header('checksum'));writer.manager.appendMessage(user('ORIGINAL_TEXT'));await writer.close()
 const path=f.backend.path('checksum'),tampered=(await readFile(path,'utf8')).replace('ORIGINAL_TEXT','TAMPERED_TEXT');await writeFile(path,tampered)
 await assert.rejects(f.backend.readNative('checksum'),{code:'PI_SESSION_CHECKSUM_MISMATCH'});assert.equal(await readFile(path,'utf8'),tampered)
})
test('detached native reads preserve the writer and failed receipt pre-validation does not poison it',async t=>{
 const f=await fixture(t),writer=await f.backend.createNative(f.header('ownership'));await writer.commit()
 const read=await f.backend.readNative('ownership');read.header.id='foreign';assert.equal(f.backend.writers.get('ownership'),writer)
 assert.throws(()=>writer.appendAudit({version:1,domain:'message',kind:'user',payload:{}}),{code:'PI_SESSION_AUDIT_INVALID'})
 writer.manager.appendMessage(user('VALID_NEXT'));await writer.commit()
 assert.deepEqual((await f.backend.readNative('ownership')).context.piMessages,[user('VALID_NEXT')]);await writer.close()
})
test('pre-aborted native creation leaves no empty durable identity or ownership',async t=>{
 const f=await fixture(t);await assert.rejects(f.backend.createNative(f.header('unpublished'),{signal:AbortSignal.abort()}),{name:'AbortError'})
 assert.equal(await f.backend.stat('unpublished'),undefined);assert.equal(f.ctx.piAuthority.describe('unpublished'),undefined)
 assert.deepEqual(await f.backend.list(),[])
})
test('global Pi journal refuses symbolic file targets before reads or writes',async t=>{
 const f=await fixture(t);await f.backend.checkedRoot(true);const outside=join(f.root,'outside.jsonl');await writeFile(outside,'unchanged');await symlink(outside,f.backend.path('linked'))
 await assert.rejects(f.backend.readNative('linked'),{code:'PI_SESSION_PATH_UNSAFE'});await assert.rejects(f.backend.createNative(f.header('linked')),{code:'PI_SESSION_PATH_UNSAFE'})
 assert.equal(await readFile(outside,'utf8'),'unchanged')
})
test('official Pi native projection preserves multimodal bytes without a Host role mapper',async t=>{
 const f=await fixture(t),writer=await f.backend.createNative(f.header('media')),message={role:'user',content:[{type:'text',text:'ACTUAL_USER_INPUT'},{type:'image',data:Buffer.from([137,80,78,71]).toString('base64'),mimeType:'image/png'}],timestamp:1}
 writer.manager.appendMessage(message);await writer.close();assert.deepEqual((await f.backend.readNative('media')).context.piMessages,[message])
})
test('DSH directory histories are neither discovered nor imported and remain untouched',async t=>{
 const f=await fixture(t),id='old-session',directory=join(f.root,'sessions',id);await mkdir(directory,{recursive:true})
 const path=join(directory,'0.jsonl'),bytes='{"type":"session","version":4,"id":"old-session"}\n';await writeFile(path,bytes)
 assert.deepEqual(await f.backend.list(),[]);assert.equal(await f.backend.stat(id),undefined)
 for(const read of [()=>f.backend.readNative(id),()=>f.backend.openNative(id)])await assert.rejects(read(),{name:'SessionPersistenceNotFoundError'})
 assert.equal(await readFile(path,'utf8'),bytes);assert.deepEqual(await readdir(join(f.root,'sessions')),[id])
 const writer=await f.backend.createNative(f.header(id));writer.manager.appendMessage(user('NEW_PI_HISTORY'));await writer.close()
 assert.equal((await f.backend.list()).length,1);assert.equal(await readFile(path,'utf8'),bytes)
})
test('foreign imported metadata is refused without reopening any source or modifying bytes',async t=>{
 const f=await fixture(t);await f.backend.checkedRoot(true)
 const manager=SessionManager.inMemory(f.root);manager.newSession({id:'retired-import'})
 manager.appendCustomEntry('night.header',{storage:{engine:'pi-native',version:1},header:f.header('retired-import'),importedFrom:'dsh-jsonl'})
 const header=manager.getHeader(),records=manager.getEntries(),entriesHash=createHash('sha256').update(JSON.stringify(header)+'\n'+records.map(entry=>JSON.stringify(entry)).join('\n')).digest('hex')
 manager.appendCustomEntry('night.commit',{version:2,entryCount:records.length,auditCount:0,previousCommit:null,entriesHash})
 const bytes=[header,...manager.getEntries()].map(entry=>JSON.stringify(entry)).join('\n')+'\n',path=f.backend.path('retired-import');await writeFile(path,bytes)
 for(const read of [()=>f.backend.readNative('retired-import'),()=>f.backend.openNative('retired-import')])await assert.rejects(read(),{code:'PI_SESSION_IMPORT_UNSUPPORTED'})
 assert.equal(await readFile(path,'utf8'),bytes);assert.deepEqual(await readdir(join(f.root,'sessions')),[path.split('/').at(-1)])
})
