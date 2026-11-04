import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, readFile, writeFile, readdir, symlink } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'
import { openNativeDomains, defineDomain, domainTable } from '../src/native-domain.js'
import { openNativeModelSelection } from '../src/native-state.js'
import { openResidentStore } from '../packages/dingtalk-core/store.js'
const spec = () => defineDomain({ name: 'fixture', version: 2, tables: { items: domainTable(z.object({ count: z.number() })) }, global: { schema: z.object({ ready: z.boolean() }), initial: { ready: false } } })
async function fixture(t, options = {}) {
  const root = await mkdtemp('/tmp/night-native-state-'), facilities = []
  t.after(async () => { try { for (const f of facilities) await f.closeAll() } finally { await rm(root,{recursive:true,force:true}) } })
  const create = async opts => { const f = await openNativeDomains({ root, ...options, ...opts }); facilities.push(f); return f }
  return {root,create}
}
test('native state reads legacy JSON, serializes concurrent updates and persists workspace global', async t => {
  const f = await fixture(t)
  await writeFile(join(f.root,'fixture.json'),JSON.stringify({unit:{name:'fixture',version:2},global:{ready:true},tables:{items:{a:{count:1}}}}))
  const events=[], facility=await f.create({onChange:e=>events.push(e)}), domain=await facility.open(spec())
  await Promise.all(Array.from({length:40},()=>domain.table('items').update('a',current=>({count:current.count+1}))))
  assert.equal(domain.table('items').get('a').count,41)
  assert.equal(events.length,40); assert.equal(events.at(-1).value.count,41)
  assert.equal(domain.global.get().ready,true)
  await domain.global.set({ready:false});await facility.closeAll()
  const reopened=await(await f.create()).open(spec())
  assert.deepEqual(reopened.table('items').get('a'),{count:41});assert.equal(reopened.global.get().ready,false)
  assert.deepEqual((await readdir(f.root)).sort(),['fixture.json'])
})
test('pre-commit failure preserves disk and memory, later valid writes and observer failures remain usable', async t=>{
  let fail=false
  const f=await fixture(t,{beforeCommit:()=>{if(fail)throw new Error('fixture I/O failure')},onChange:()=>{throw new Error('observer failure')}})
  const domain=await(await f.create()).open(spec());await domain.table('items').put('a',{count:1});const before=await readFile(join(f.root,'fixture.json'),'utf8')
  fail=true;await assert.rejects(domain.table('items').put('a',{count:9}),/fixture I\/O failure/)
  assert.equal(domain.table('items').get('a').count,1);assert.equal(await readFile(join(f.root,'fixture.json'),'utf8'),before)
  fail=false;await domain.table('items').update('a',()=>({count:2}));assert.equal(domain.table('items').get('a').count,2)
})
test('post-rename uncertainty poisons the handle and reopens from durable evidence',async t=>{
  let fail=false;const f=await fixture(t,{afterRename:()=>{if(fail)throw new Error('fixture directory sync failure')}})
  const facility=await f.create(),domain=await facility.open(spec());await domain.table('items').put('a',{count:1});fail=true
  await assert.rejects(domain.table('items').put('a',{count:2}),e=>e.code==='NATIVE_DOMAIN_COMMIT_UNCERTAIN'&&e.committed)
  assert.throws(()=>domain.table('items').get('a'),/COMMIT_UNCERTAIN/)
  await assert.rejects(domain.global.set({ready:true}),/COMMIT_UNCERTAIN/)
  await facility.closeAll();fail=false
  const reopened=await(await f.create()).open(spec());assert.equal(reopened.table('items').get('a').count,2)
})
test('native state rejects duplicate writers, unknown layout, corrupt records and version mismatch without overwriting',async t=>{
  const f=await fixture(t),a=await f.create(),b=await f.create(),domain=await a.open(spec())
  await assert.rejects(b.open(spec()),e=>e.code==='already-open')
  await domain.close()
  await assert.rejects(a.open({...spec(),layout:'per-record'}),e=>e.code==='facet-unsupported')
  for(const document of [{unit:{name:'fixture',version:1},tables:{}},{unit:{name:'fixture',version:2},tables:{items:{bad:{count:'invalid'}}}}]){
    const text=JSON.stringify(document);await writeFile(join(f.root,'fixture.json'),text)
    await assert.rejects(a.open(spec()));assert.equal(await readFile(join(f.root,'fixture.json'),'utf8'),text)
  }
})
test('native close drains accepted writes, rejects new writes, and stable table snapshots do not change',async t=>{
  const latch=Promise.withResolvers();let hold=false
  const f=await fixture(t,{beforeCommit:()=>hold?latch.promise:undefined}),domain=await(await f.create()).open(spec()),table=domain.table('items')
  await table.put('a',{count:1});const iterator=table.entries();hold=true
  const write=table.put('b',{count:2}),close=domain.close();await assert.rejects(table.put('c',{count:3}),e=>e.code==='closed')
  latch.resolve();await write;await close;assert.deepEqual([...iterator],[['a',{count:1}]]);assert.throws(()=>table.get('a'),e=>e.code==='closed')
})
test('native model changes survive restart and invalid selections preserve the original',async t=>{
  const f=await fixture(t),facility=await f.create(),initial={provider:'initial',model:'first'},service=await openNativeModelSelection(facility,initial)
  await Promise.all([service.saveSelection({provider:'next',model:'second'}),service.saveSelection({provider:'final',model:'third',reasoningEffort:'high'})])
  await assert.rejects(service.saveSelection({provider:'',model:'broken'}));assert.equal(service.currentSelection().provider,'final')
  await facility.closeAll();const restarted=await openNativeModelSelection(await f.create(),initial)
  assert.deepEqual(restarted.currentSelection(),{provider:'final',model:'third',reasoningEffort:'high'})
})
test('the complete resident store retains group configuration and ingress on the native backend',async t=>{
  const f=await fixture(t),facility=await f.create(),store=await openResidentStore(facility)
  await store.subscribe({groupId:'fixture-group',name:'Fixture',responsibility:'Read-only fixture'})
  await store.setAgentNames(['Fixture bot']);await store.close();await facility.closeAll()
  const reopened=await openResidentStore(await f.create())
  assert.equal(reopened.getGroup('fixture-group').responsibility,'Read-only fixture')
  assert.deepEqual(reopened.getAgentNames(),['Fixture bot']);await reopened.close()
})
test('native state refuses symlink targets',async t=>{
  const f=await fixture(t);const outside=join(f.root,'outside.json');await writeFile(outside,'{}');await symlink(outside,join(f.root,'fixture.json'))
  await assert.rejects((await f.create()).open(spec()),/regular file/);assert.equal(await readFile(outside,'utf8'),'{}')
})
