import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, readFile, appendFile, writeFile, symlink, readdir, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { SessionStore } from '../packages/capability-compat/session/index.js'
import { createUserMessage, createDeveloperMessage } from '../packages/capability-compat/llm/index.js'
import { SessionManager } from '@earendil-works/pi-coding-agent'
import PiPersistence from '../src/pi-session-persistence.js'
import * as Authority from '../src/pi-authority.js'
const user = text => createUserMessage({source:{kind:'user'},content:[{type:'text',text}]})
async function fixture(t) {
  const root=await mkdtemp('/tmp/night-pi-authority-'),contexts=[]
  t.after(async()=>{const failures=[];for(const ctx of contexts.reverse())try{await ctx.fiber.dispose()}catch(e){failures.push(e)}await rm(root,{recursive:true,force:true});if(failures.length)throw new AggregateError(failures,'fixture close')})
  const host=async()=>{
    const ctx=new Context();contexts.push(ctx);new SessionStore(ctx)
    await ctx.plugin(Authority)
    const backend=new PiPersistence(ctx,{root:join(root,'sessions'),compression:'none'})
    return{ctx,backend,session:id=>ctx.sessions.prepare(id,{meta:{cwd:root}})}
  }
  return{root,host}
}
test('Pi native branch is authoritative while retired authorization remains in immutable audit',async t=>{
  const f=await fixture(t),h=await f.host(),session=h.session('authority')
  const first=session.append('user/message',user('ORIGINAL_AUTHORITY'),{surfaceOp:'append'})
  session.append('user/message',user('RETAINED_EVIDENCE'),{surfaceOp:'append'})
  session.append('turn/start',{turn:1});session.append('step/start',{turn:1,step:1})
  session.append('developer/message',{turn:1,step:1,message:createDeveloperMessage({source:{kind:'retirement'},content:[]})},{surfaceOp:{op:'replace',startSeq:first.seq,endSeq:first.seq},sourceEventSeqs:[first.seq]})
  session.append('step/end',{turn:1,step:1});session.append('turn/end',{turn:1,reason:{kind:'completed'}})
  const writer=await h.backend.create(session.header);await writer.append(session.snapshotEvents())
  const description=h.ctx.get('piAuthority').describe('authority'),native=SessionManager.inMemory(f.root);native.setSessionFile(description.path)
  const visible=JSON.stringify(native.buildSessionContext().messages.map(m=>m.content))
  assert.ok(visible.includes('RETAINED_EVIDENCE'));assert.ok(!visible.includes('ORIGINAL_AUTHORITY'))
  assert.ok(JSON.stringify((await writer.read()).events).includes('ORIGINAL_AUTHORITY'))
  assert.equal(JSON.parse((await readFile(description.path,'utf8')).split('\n')[0]).version,3)
  await writer.close();const resumed=await h.backend.open('authority','write')
  assert.deepEqual((await resumed.read()).events,session.snapshotEvents());await resumed.close()
})
test('Pi journal restores only complete commit batches; read-only inspection never repairs the tail',async t=>{
  const f=await fixture(t),h=await f.host(),session=h.session('torn-tail')
  session.append('user/message',user('COMMITTED'),{surfaceOp:'append'})
  const writer=await h.backend.create(session.header);await writer.append(session.snapshotEvents());const path=h.ctx.get('piAuthority').describe('torn-tail').path;await writer.close()
  const before=await readFile(path,'utf8'),last=JSON.parse(before.trim().split('\n').at(-1))
  await appendFile(path,JSON.stringify({type:'custom',id:'orphan-id',parentId:last.id,timestamp:new Date().toISOString(),customType:'uncommitted',data:{text:'NOT_ADMITTED'}})+'\n{"torn":')
  const reader=await h.backend.open('torn-tail','read');assert.equal((await reader.read()).events.length,1);await reader.close()
  assert.ok((await readFile(path,'utf8')).endsWith('{"torn":'))
  const recovered=await h.backend.open('torn-tail','write');assert.equal(await readFile(path,'utf8'),before);await recovered.close()
})
test('Pi history checksum refuses modified complete records without rewriting evidence',async t=>{
  const f=await fixture(t),h=await f.host(),session=h.session('checksum')
  session.append('user/message',user('ORIGINAL_TEXT'),{surfaceOp:'append'})
  const writer=await h.backend.create(session.header);await writer.append(session.snapshotEvents());const path=h.ctx.get('piAuthority').describe('checksum').path;await writer.close()
  const tampered=(await readFile(path,'utf8')).replace('ORIGINAL_TEXT','TAMPERED_TEXT');await writeFile(path,tampered)
  await assert.rejects(h.backend.open('checksum','read'),e=>e.code==='PI_SESSION_CHECKSUM_MISMATCH')
  assert.equal(await readFile(path,'utf8'),tampered)
})
test('closing a read handle preserves the active writer and failed pre-validation does not poison it',async t=>{
  const f=await fixture(t),h=await f.host(),session=h.session('ownership')
  const writer=await h.backend.create(session.header),reader=await h.backend.open('ownership','read')
  await reader.close();assert.equal(h.backend.writers.get('ownership'),writer)
  await assert.rejects(writer.append([{seq:8,time:Date.now(),type:'invented',data:{}}]))
  session.append('user/message',user('VALID_NEXT'),{surfaceOp:'append'});await writer.append(session.snapshotEvents())
  assert.equal((await writer.read()).events.length,1);await writer.close()
})
test('unpublished creation can be rolled back without leaving an empty durable identity',async t=>{
  const f=await fixture(t),h=await f.host(),session=h.session('unpublished')
  const writer=await h.backend.create(session.header);assert.ok(await h.backend.stat('unpublished'));await writer.close()
  assert.equal(await h.backend.stat('unpublished'),undefined)
  assert.deepEqual(await readdir(join(f.root,'sessions')),[])
})

test('global Pi journal refuses symbolic file targets before reads or writes',async t=>{
  const f=await fixture(t),h=await f.host(),session=h.session('linked')
  await h.backend.checkedRoot(true);const outside=join(f.root,'outside.jsonl');await writeFile(outside,'unchanged')
  await symlink(outside,h.backend.path('linked'))
  await assert.rejects(h.backend.open('linked','read'),e=>e.code==='PI_SESSION_PATH_UNSAFE')
  await assert.rejects(h.backend.create(session.header),e=>e.code==='PI_SESSION_PATH_UNSAFE')
  assert.equal(await readFile(outside,'utf8'),'unchanged')
})
test('Pi projection carries actual multimodal bytes and structured operational content',async()=>{
  const {projectPiMessage}=await import('../src/pi-session-persistence.js')
  const bytes=Buffer.from([137,80,78,71]),attachment={id:'isolated-image'}
  const ctx={get:name=>name==='attachments'?{readImage:async ref=>{assert.deepEqual(ref,attachment);return{data:bytes,ref:{mediaType:'image/png'}}}}:undefined}
  const message={role:'user',source:{kind:'user'},content:[{type:'text',text:'ACTUAL_USER_INPUT'},{type:'image',attachment}]}
  const native=await projectPiMessage(message,ctx)
  assert.deepEqual(native.content,[{type:'text',text:'ACTUAL_USER_INPUT'},{type:'image',data:bytes.toString('base64'),mimeType:'image/png'}])
  assert.ok(!JSON.stringify(native).includes('[host'))
})



test('DSH directory histories are neither discovered nor imported and remain untouched',async t=>{
  const f=await fixture(t),h=await f.host(),id='old-session'
  const directory=join(f.root,'sessions',id);await mkdir(directory,{recursive:true})
  const path=join(directory,'0.jsonl'),bytes='{"type":"session","version":4,"id":"old-session"}\n'
  await writeFile(path,bytes)
  assert.deepEqual(await h.backend.list(),[])
  assert.equal(await h.backend.stat(id),undefined)
  for(const access of ['read','write','write'])await assert.rejects(h.backend.open(id,access),{name:'SessionPersistenceNotFoundError'})
  assert.equal(await readFile(path,'utf8'),bytes)
  assert.deepEqual(await readdir(join(f.root,'sessions')),[id])
  const session=h.session(id);session.append('user/message',user('NEW_PI_HISTORY'),{surfaceOp:'append'})
  const writer=await h.backend.create(session.header);await writer.append(session.snapshotEvents());await writer.close()
  assert.equal((await h.backend.list()).length,1)
  assert.equal(await readFile(path,'utf8'),bytes)
})

test('former DSH-imported Pi snapshots are refused without reopening the source or modifying evidence',async t=>{
  const {createHash}=await import('node:crypto')
  const f=await fixture(t),h=await f.host(),session=h.session('retired-import')
  await h.backend.checkedRoot(true)
  const manager=SessionManager.inMemory(f.root);manager.newSession({id:session.id})
  manager.appendCustomEntry('night.header',{header:session.header,inheritedEventCount:0,importedFrom:'dsh-jsonl'})
  const header=manager.getHeader(),records=manager.getEntries()
  const entriesHash=createHash('sha256').update(JSON.stringify(header)+'\n'+records.map(e=>JSON.stringify(e)).join('\n')).digest('hex')
  manager.appendCustomEntry('night.commit',{eventCount:0,previousCommit:null,entriesHash})
  const bytes=[header,...manager.getEntries()].map(e=>JSON.stringify(e)).join('\n')+'\n',path=h.backend.path(session.id)
  await writeFile(path,bytes)
  for(const access of ['read','write','write'])await assert.rejects(h.backend.open(session.id,access),{code:'PI_SESSION_IMPORT_UNSUPPORTED'})
  assert.equal(await readFile(path,'utf8'),bytes)
  assert.deepEqual(await readdir(join(f.root,'sessions')),[path.split('/').at(-1)])
})
