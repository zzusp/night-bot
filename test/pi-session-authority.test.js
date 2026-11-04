import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, readFile, appendFile, writeFile, symlink, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { SessionStore } from '@deepseek-ai/dsh-session'
import { createUserMessage, createDeveloperMessage } from '@deepseek-ai/dsh-llm'
import LegacyPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import { SessionManager } from '@earendil-works/pi-coding-agent'
import PiPersistence from '../src/pi-session-persistence.js'
import * as Authority from '../src/pi-authority.js'
const user = text => createUserMessage({source:{kind:'user'},content:[{type:'text',text}]})
async function fixture(t) {
  const root=await mkdtemp('/tmp/night-pi-authority-'),contexts=[]
  t.after(async()=>{const failures=[];for(const ctx of contexts.reverse())try{await ctx.fiber.dispose()}catch(e){failures.push(e)}await rm(root,{recursive:true,force:true});if(failures.length)throw new AggregateError(failures,'fixture close')})
  const host=async({legacy=false}={})=>{
    const ctx=new Context();contexts.push(ctx);new SessionStore(ctx)
    if(!legacy)await ctx.plugin(Authority)
    const backend=new (legacy?LegacyPersistence:PiPersistence)(ctx,{root:join(root,'sessions'),compression:'none'})
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
test('legacy import preserves source events, fences the old writer, and resumes from Pi without replay',async t=>{
  const f=await fixture(t),legacy=await f.host({legacy:true}),original=legacy.session('legacy-session')
  original.append('user/message',user('LEGACY_EVIDENCE_NO_REPLAY'),{surfaceOp:'append'})
  const old=await legacy.backend.create(original.header);await old.append(original.snapshotEvents());await old.flush();await old.close()
  const h=await f.host(),read=await h.backend.open('legacy-session','read');assert.deepEqual((await read.read()).events,original.snapshotEvents());await read.close()
  const imported=await h.backend.open('legacy-session','write')
  await assert.rejects(legacy.backend.open('legacy-session','write'),{name:'SessionAlreadyOwnedError'})
  assert.equal(h.ctx.get('piAuthority').describe('legacy-session').engine,'pi-session-manager')
  assert.deepEqual((await imported.read()).events,original.snapshotEvents());await imported.close()
  const resumed=await h.backend.open('legacy-session','write');assert.deepEqual((await resumed.read()).events,original.snapshotEvents());await resumed.close()
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
test('a legacy writer changing imported history between Pi leases blocks resume without rewriting Pi evidence',async t=>{
  const f=await fixture(t),old=await f.host({legacy:true}),session=old.session('legacy-divergence')
  session.append('user/message',user('ORIGINAL'),{surfaceOp:'append'})
  const initial=await old.backend.create(session.header);await initial.append(session.snapshotEvents());await initial.close()
  const native=await f.host(),imported=await native.backend.open(session.id,'write')
  const path=native.ctx.get('piAuthority').describe(session.id).path;await imported.close();const before=await readFile(path,'utf8')
  const oldWriter=await old.backend.open(session.id,'write')
  const extra=session.append('user/message',user('CHANGED_BY_OLD_RUNTIME'),{surfaceOp:'append'});await oldWriter.append([extra]);await oldWriter.close()
  await assert.rejects(native.backend.open(session.id,'write'),e=>e.code==='PI_LEGACY_SOURCE_DIVERGED')
  assert.equal(await readFile(path,'utf8'),before)
  const released=await old.backend.open(session.id,'write');await released.close()
})
test('failed legacy image import releases native authority and both writer fences',async t=>{
  const f=await fixture(t),old=await f.host({legacy:true}),session=old.session('failed-image-import')
  const message={...user('image'),content:[{type:'image',attachment:{id:'missing-image'}}]}
  session.append('user/message',message,{surfaceOp:'append'})
  const initial=await old.backend.create(session.header);await initial.append(session.snapshotEvents());await initial.close()
  const native=await f.host()
  for(let attempt=0;attempt<2;attempt++)await assert.rejects(native.backend.open(session.id,'write'),e=>e.code==='PI_SESSION_ATTACHMENT_PROVIDER_REQUIRED')
  assert.equal(native.ctx.get('piAuthority').describe(session.id),undefined)
  const released=await old.backend.open(session.id,'write');await released.close()
})
