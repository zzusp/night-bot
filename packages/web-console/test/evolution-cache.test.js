import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp, rm, readFile, writeFile, readdir, chmod, symlink, link, stat} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createHash} from 'node:crypto'
import {openEvolutionCache, EVOLUTION_REFRESH_MS} from '../server/evolution-cache.js'

const dto = name => ({status:'ready', memory:{acceptedCount:1,candidateCount:0}, skills:{activeCount:0,candidateCount:0}, usageCoverage:{status:'ready'}, items:[{id:'a', kind:'memory', name, status:'applied'}]})
const hash = value => createHash('sha256').update(value).digest('hex')
const encode = (summary, items = [], overrides = {}) => {
  let offset = 0
  const blocks = items.map(item => Buffer.from(JSON.stringify(item) + '\n'))
  const rows = blocks.map((block, i) => {const row = {kind: items[i].kind, offset, length: block.length, hash: hash(block)}; offset += block.length; return row})
  const header = Buffer.from(JSON.stringify({version: 2, identity: hash('reader'), updatedAt: 1000, summary, rows, ...overrides}))
  return Buffer.concat([Buffer.from(header.length.toString(16).padStart(8, '0') + '\n'), header, ...blocks])
}
const encodeDto = value => {const {items, ...summary} = value; return encode(summary, items)}
const filename = identity => `evolution-${createHash('sha256').update(identity).digest('hex')}.pages`
async function setup(t, options = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'web-evolution-cache-'))
  t.after(() => rm(directory, {recursive:true, force:true}))
  let clock = 1000, calls = 0, callback, canceled = 0
  const cache = await openEvolutionCache({directory, identity:'reader', collect:async()=>dto(String(++calls)), now:()=>clock,
    sleep:async()=>{}, setInterval(fn, ms) {assert.equal(ms, 300000); callback = fn; return 1}, clearInterval(id) {assert.equal(id, 1); canceled++}, ...options})
  t.after(() => cache.close())
  return {directory, cache, tick:()=>{clock += EVOLUTION_REFRESH_MS}, advance:ms=>{clock += ms}, calls:()=>calls, interval:()=>callback(), canceled:()=>canceled}
}

test('first load deduplicates, persists private indexed metadata, and restart serves without collection', async t => {
  const f = await setup(t)
  const [a,b] = await Promise.all([f.cache.read(), f.cache.read()])
  assert.deepEqual(a,b); assert.equal(f.calls(),1); assert.equal(a.cache.stale,false)
  const path = join(f.directory, filename('reader'))
  if (process.platform !== 'win32') assert.equal((await stat(path)).mode & 0o777,0o600)
  await f.cache.close()
  const restored = await openEvolutionCache({directory:f.directory, identity:'reader', now:()=>1001, collect:()=>{throw Error('must not collect')}})
  t.after(()=>restored.close())
  assert.deepEqual((await restored.read()).snapshot,a.snapshot)
  assert.deepEqual(await readdir(f.directory),[filename('reader')])
})

test('cached expiry returns immediately, refresh is single flight, force waits for that refresh', async t => {
  let release, calls = 0
  const f = await setup(t,{collect:async()=>{calls++; if(calls===2) await new Promise(resolve=>{release=resolve}); return dto(String(calls))}})
  await f.cache.read(); f.tick()
  const a = await f.cache.read(), b = await f.cache.read()
  assert.equal(a.snapshot.items[0].name,'1'); assert.equal(a.cache.stale,true); assert.equal(b.cache.refreshing,true)
  const forced = f.cache.read({force:true}); release()
  const fresh = await forced
  assert.equal(calls,2); assert.equal(fresh.snapshot.items[0].name,'2'); assert.equal(fresh.cache.stale,false)
  fresh.snapshot.items[0].name='mutated'
  assert.equal((await f.cache.read()).snapshot.items[0].name,'2')
})

test('timer refreshes independently of page reads, start is idempotent and close drains', async t => {
  const f = await setup(t)
  f.cache.start(); f.cache.start(); await f.cache.read()
  f.tick(); f.interval(); await f.cache.read({force:true})
  assert.equal(f.calls(),2)
  await f.cache.close(); assert.equal(f.canceled(),1)
  await assert.rejects(f.cache.read(),{code:'EVOLUTION_CACHE_CLOSED'})
})

test('failed refresh preserves file and snapshot, masks errors and prevents hot retry', async t => {
  let calls=0
  const f=await setup(t,{collect:()=>{if(++calls>1) throw Error('/private/token'); return dto('old')}})
  await f.cache.read()
  const path=join(f.directory,filename('reader')), original=await readFile(path,'utf8')
  f.tick()
  const failed=await f.cache.read({force:true})
  assert.equal(failed.cache.error,'EVOLUTION_CACHE_REFRESH_FAILED'); assert.equal(failed.cache.stale,true)
  assert.equal(await readFile(path,'utf8'),original)
  for(let i=0;i<5;i++) await f.cache.read()
  assert.equal(calls,5); assert.doesNotMatch(JSON.stringify(failed),/private|token/)
  await f.cache.read({force:true}); assert.equal(calls,9)
})

test('cold collection failure is deduplicated and throttled until explicit retry', async t => {
  let calls=0
  const f=await setup(t,{collect:()=>{calls++; throw Error('secret')}})
  await assert.rejects(f.cache.read(),{code:'EVOLUTION_CACHE_REFRESH_FAILED'})
  await assert.rejects(f.cache.read(),{code:'EVOLUTION_CACHE_REFRESH_FAILED'}); assert.equal(calls,4)
  await assert.rejects(f.cache.read({force:true}),{code:'EVOLUTION_CACHE_REFRESH_FAILED'}); assert.equal(calls,8)
  assert.deepEqual(await readdir(f.directory),[])
})

test('safe corrupt JSON, invalid schema and wrong identity are recollected', async t => {
  const f=await setup(t)
  await f.cache.read(); await f.cache.close()
  const path=join(f.directory,filename('reader'))
  for(const contents of ['{', encode({status:'ready'}), encode(dto('wrong'), [], {identity:'other'})]) {
    await writeFile(path,contents)
    const cache=await openEvolutionCache({directory:f.directory,identity:'reader',now:()=>1000,collect:()=>dto('recollected')})
    assert.equal((await cache.read()).snapshot.items[0].name,'recollected'); await cache.close()
  }
})

test('different identity never replays prior snapshot', async t => {
  const f=await setup(t); await f.cache.read()
  const cache=await openEvolutionCache({directory:f.directory,identity:'changed-token',collect:()=>dto('new')})
  t.after(()=>cache.close())
  assert.equal((await cache.read()).snapshot.items[0].name,'new')
  assert.equal((await readdir(f.directory)).length,2)
})

test('unsafe symlinks and hardlinks are rejected without modifying their targets', async t => {
  const f=await setup(t); await f.cache.close()
  const source=join(f.directory,'source.json'), path=join(f.directory,filename('reader'))
  await writeFile(source,'private source',{mode:0o600})
  for(const create of [symlink,link]) {
    await create(source,path)
    await assert.rejects(openEvolutionCache({directory:f.directory,identity:'reader',collect:()=>dto('never')}),{code:'EVOLUTION_CACHE_PATH_UNSAFE'})
    assert.equal(await readFile(source,'utf8'),'private source'); await rm(path)
  }
})

test('unsafe file replacement after opening cannot overwrite linked source', async t => {
  const f=await setup(t); await f.cache.read()
  const path=join(f.directory,filename('reader')), source=join(f.directory,'source.json')
  await writeFile(source,'protected',{mode:0o600}); await rm(path); await link(source,path)
  const result=await f.cache.read({force:true})
  assert.equal(result.cache.stale,true); assert.equal(await readFile(source,'utf8'),'protected')
})

test('nonprivate directory or cache file is rejected on POSIX', {skip:process.platform==='win32'}, async t => {
  const f=await setup(t); await f.cache.read(); await f.cache.close()
  const options={directory:f.directory,identity:'reader',collect:()=>dto('never')}
  await chmod(join(f.directory,filename('reader')),0o644)
  await assert.rejects(openEvolutionCache(options),{code:'EVOLUTION_CACHE_PATH_UNSAFE'})
  await chmod(join(f.directory,filename('reader')),0o600); await chmod(f.directory,0o755)
  await assert.rejects(openEvolutionCache(options),{code:'EVOLUTION_CACHE_PATH_UNSAFE'})
})

test('invalid collected DTO cannot replace a valid snapshot', async t => {
  let calls=0
  const f=await setup(t,{collect:()=>++calls===1?dto('old'):{status:'error',items:[]}})
  await f.cache.read(); const before=await readFile(join(f.directory,filename('reader')),'utf8')
  const result=await f.cache.read({force:true})
  assert.equal(result.snapshot.items[0].name,'old'); assert.equal(result.cache.stale,true)
  assert.equal(await readFile(join(f.directory,filename('reader')),'utf8'),before)
})

test('fresh data remains fresh until exactly five minutes and clock rollback refreshes', async t => {
  const f=await setup(t); await f.cache.read()
  f.advance(EVOLUTION_REFRESH_MS-1)
  assert.equal((await f.cache.read()).cache.stale,false); assert.equal(f.calls(),1)
  f.advance(1); assert.equal((await f.cache.read()).cache.stale,true)
  await f.cache.read({force:true}); assert.equal(f.calls(),2)
  f.advance(-EVOLUTION_REFRESH_MS)
  assert.equal((await f.cache.read()).cache.stale,true)
  await f.cache.read({force:true}); assert.equal(f.calls(),3)
})

test('close awaits an in-flight refresh before returning', async t => {
  let release
  const f=await setup(t,{collect:()=>new Promise(resolve=>{release=()=>resolve(dto('done'))})})
  const reading=f.cache.read()
  await Promise.resolve()
  let finished=false
  const closing=f.cache.close().then(()=>{finished=true})
  await Promise.resolve(); assert.equal(finished,false)
  release(); await Promise.all([reading,closing]); assert.equal(finished,true)
  assert.equal((await readdir(f.directory)).length,1)
})

test('oversized cache is ignored using bounded reads and recollected', async t => {
  const f=await setup(t); await f.cache.close()
  const path=join(f.directory,filename('reader'))
  await writeFile(path,' '.repeat(32*1024*1024+1),{mode:0o600})
  const cache=await openEvolutionCache({directory:f.directory,identity:'reader',collect:()=>dto('bounded')})
  t.after(()=>cache.close())
  assert.equal((await cache.read()).snapshot.items[0].name,'bounded')
  assert.ok((await stat(path)).size<1000)
})

test('a symlinked cache directory is rejected without writes', async t => {
  const f=await setup(t); await f.cache.close()
  const alias=join(f.directory,'alias')
  await symlink(f.directory,alias)
  await assert.rejects(openEvolutionCache({directory:alias,identity:'reader',collect:()=>dto('never')}),{code:'EVOLUTION_CACHE_PATH_UNSAFE'})
  assert.deepEqual(await readdir(f.directory),['alias'])
})

test('scheduled refresh retries three times at 1/2/4 seconds within one deduped cycle', async t => {
  let calls=0, release
  const sleeps=[]
  const f=await setup(t,{collect:()=>{calls++; if(calls>1 && calls<5) throw Object.assign(Error('busy'),{code:'EVOLUTION_BUSY'}); return dto(String(calls))},
    sleep:async(ms)=>{sleeps.push(ms); if(ms===1000) await new Promise(resolve=>{release=resolve})}})
  await f.cache.read(); f.cache.start(); f.tick(); f.interval()
  while(!release) await Promise.resolve()
  const stale=await f.cache.read(); assert.equal(stale.cache.refreshing,true); assert.equal(stale.snapshot.items[0].name,'1')
  f.interval(); const forced=f.cache.read({force:true}); release()
  const result=await forced
  assert.equal(calls,5); assert.deepEqual(sleeps,[1000,2000,4000]); assert.equal(result.snapshot.items[0].name,'5'); assert.equal(result.cache.stale,false)
})

test('authentication, unsafe paths, invalid data and SyntaxError do not retry', async t => {
  for(const error of [Object.assign(Error(),{status:401}),Object.assign(Error(),{statusCode:403}),Object.assign(Error(),{code:'WEB_STORAGE_ALIAS_UNSAFE'}),Object.assign(Error(),{code:'FORBIDDEN'}),Object.assign(Error(),{code:'EVOLUTION_INVALID'}),new SyntaxError('private')]) {
    let calls=0
    const f=await setup(t,{collect:()=>{calls++; throw error},sleep:()=>{throw Error('must not sleep')}})
    await assert.rejects(f.cache.read(),{code:error.status===401?'AUTH_REQUIRED':error.statusCode===403?'EVOLUTION_FORBIDDEN':'EVOLUTION_CACHE_REFRESH_FAILED'}); assert.equal(calls,1)
  }
})

test('exhausted cold retries retain actionable busy code without source details', async t => {
  let calls=0
  const f=await setup(t,{collect:()=>{calls++; throw Object.assign(Error('/secret/body'),{code:'EVOLUTION_BUSY'})}})
  await assert.rejects(f.cache.read(),error=>error.code==='EVOLUTION_BUSY' && error.message==='EVOLUTION_BUSY')
  assert.equal(calls,4)
  await assert.rejects(f.cache.read(),{code:'EVOLUTION_BUSY'}); assert.equal(calls,4)
})

test('close cancels retry sleep and drains the cycle without another collection', async t => {
  let calls=0, sleeping, signal
  const f=await setup(t,{collect:()=>{calls++; throw Error('transient')},sleep:(_ms,options)=>new Promise((resolve,reject)=>{
    signal=options.signal; sleeping=true; signal.addEventListener('abort',()=>reject(Error('aborted')),{once:true})
  })})
  const reading=assert.rejects(f.cache.read(),{code:'EVOLUTION_CACHE_REFRESH_FAILED'})
  while(!sleeping) await Promise.resolve()
  await f.cache.close(); await reading
  assert.equal(signal.aborted,true); assert.equal(calls,1); assert.deepEqual(await readdir(f.directory),[])
})

test('401/403 revoke cached fallback until a successful authorized refresh', async t => {
  for(const status of [401,403]) {
    let calls=0, authorized=true
    const f=await setup(t,{collect:()=>{calls++; if(!authorized) throw Object.assign(Error('private auth failure'),{status,code:'PRIVATE_ERROR'}); return dto(String(calls))}})
    await f.cache.read()
    const path=join(f.directory,filename('reader')), before=await readFile(path,'utf8')
    authorized=false
    const code=status===401?'AUTH_REQUIRED':'EVOLUTION_FORBIDDEN'
    await assert.rejects(f.cache.read({force:true}),{status,code,message:code}); assert.equal(calls,2,'auth failure must not retry')
    await assert.rejects(f.cache.read(),{status,code}); assert.equal(calls,2,'revoked read cannot serve stale or start collection')
    await assert.rejects(f.cache.read({force:true}),{status,code}); assert.equal(calls,3)
    assert.equal(await readFile(path,'utf8'),before)
    authorized=true
    const recovered=await f.cache.read({force:true})
    assert.equal(calls,4); assert.equal(recovered.snapshot.items[0].name,'4'); assert.equal(recovered.cache.stale,false)
    assert.equal((await f.cache.read()).snapshot.items[0].name,'4')
  }
})

test('malformed summary metadata and private summary bodies on disk are recollected, not replayed', async t => {
  const f=await setup(t); await f.cache.close()
  const path=join(f.directory,filename('reader'))
  for(const mutate of [
    value=>{value.memory.acceptedCount='1'}, value=>{value.skills.candidateCount=-1},
    value=>{value.memory.readCount={private:1}}, value=>{value.skills.inventoryIssues='broken'},
    value=>{value.usageCoverage.status='unknown'}, value=>{value.memoryResources=[]},
  ]) {
    const stored=dto('wrong'); mutate(stored); await writeFile(path,encodeDto(stored),{mode:0o600})
    let calls=0
    const cache=await openEvolutionCache({directory:f.directory,identity:'reader',now:()=>1000,collect:()=>{calls++; return dto('safe')}})
    assert.equal((await cache.read()).snapshot.items[0].name,'safe'); assert.equal(calls,1)
    await cache.close()
  }
})

test('invalid or private item metadata never leaves a requested page', async t => {
  const f=await setup(t); await f.cache.close()
  const path=join(f.directory,filename('reader'))
  for(const mutate of [
    item=>{item.origins='broken'}, item=>{item.taskIds={length:1}},
    item=>{item.provenance={conversationName:{private:1}}},
    item=>{item.memoryUse={lastAccess:{counter:'read',at:'now',provenance:3}}},
    item=>{item.scope='__proto__'}, item=>{item.status='constructor'},
    item=>{item.body='private'}, item=>{item.current={text:'private'}},
  ]) {
    const stored=dto('wrong'); mutate(stored.items[0]); await writeFile(path,encodeDto(stored),{mode:0o600})
    const cache=await openEvolutionCache({directory:f.directory,identity:'reader',now:()=>1000,collect:()=>{throw Error('must not collect')}})
    await assert.rejects(cache.read(),{code:'EVOLUTION_CACHE_INVALID'})
    await cache.close()
  }
})


test('cold background startup readiness failure recovers on the first normal GET', async t => {
  let ready=false, calls=0
  const f=await setup(t,{collect:()=>{calls++; if(!ready) throw Object.assign(Error('starting'),{code:'BOT_NOT_READY'}); return dto('ready')}})
  f.cache.start()
  // Join the startup cycle, including all three retries.
  await assert.rejects(f.cache.read(),{code:'BOT_NOT_READY'})
  assert.equal(calls,4); assert.deepEqual(await readdir(f.directory),[])
  f.advance(8000); ready=true
  const result=await f.cache.read()
  assert.equal(calls,5); assert.equal(result.snapshot.items[0].name,'ready')
  assert.equal(result.cache.stale,false)
})

test('server pagination loads only requested indexed records after restart', async t => {
  const items = Array.from({length: 205}, (_, i) => ({id:String(i), kind:i % 2 ? 'skill' : 'memory', name:`entry-${i}`, status:'applied'}))
  const value={...dto('unused'), items, memory:{acceptedCount:103,candidateCount:0}}
  const f=await setup(t,{collect:()=>value})
  const first=await f.cache.read({kind:'memory'})
  assert.equal(first.snapshot.items.length,10); assert.equal(first.snapshot.limit,10)
  assert.equal(first.snapshot.total,103); assert.equal(first.snapshot.nextOffset,10)
  assert.deepEqual(first.snapshot.items.map(row=>row.id),Array.from({length:10},(_,i)=>String(i*2)))
  const second=await f.cache.read({kind:'memory',offset:10})
  assert.deepEqual(second.snapshot.items.map(row=>row.id),Array.from({length:10},(_,i)=>String((i+10)*2)))
  assert.equal(second.snapshot.memory.acceptedCount,103,'summary stays Bot-wide')
  const skills=await f.cache.read({kind:'skill',offset:100})
  assert.deepEqual(skills.snapshot.items.map(row=>row.id),['201','203']); assert.equal(skills.snapshot.nextOffset,null)
  const beyond=await f.cache.read({kind:'memory',offset:1000})
  assert.deepEqual(beyond.snapshot.items,[]); assert.equal(beyond.snapshot.total,103)
  await f.cache.close()
  const path=join(f.directory,filename('reader')), bytes=await readFile(path)
  const length=Number.parseInt(bytes.subarray(0,9).toString('ascii'),16)
  const header=JSON.parse(bytes.subarray(9,9+length).toString('utf8'))
  assert.equal('items' in header.summary,false)
  // Corrupt a record on a different page. Startup and first-page reads must not
  // read or deserialize it; accessing the affected page detects the mismatch.
  bytes[9+length+header.rows[200].offset]=0x21
  await writeFile(path,bytes)
  let collections=0
  const restarted=await openEvolutionCache({directory:f.directory,identity:'reader',now:()=>1001,collect:()=>{collections++;return value}})
  t.after(()=>restarted.close())
  const page=await restarted.read({kind:'memory',offset:10})
  assert.deepEqual(page.snapshot.items,second.snapshot.items); assert.equal(collections,0)
  await assert.rejects(restarted.read({kind:'memory',offset:100}),{code:'EVOLUTION_CACHE_INVALID'})
  assert.equal(collections,0)
  const repaired=await restarted.read({kind:'memory',offset:100,force:true})
  assert.equal(repaired.snapshot.items.length,3); assert.equal(collections,1)
})

test('page inputs are bounded before collection and cache reads', async t => {
  const f=await setup(t)
  for(const options of [{kind:'__proto__'}, {kind:'unknown'}, {offset:-1}, {offset:1.5}, {limit:0}, {limit:51}, {limit:Infinity}]) {
    await assert.rejects(f.cache.read(options),{code:'PAGE_INVALID'})
  }
  assert.equal(f.calls(),0)
})

test('pages read during a refresh stay on a single immutable generation', async t => {
  let round=0
  const f=await setup(t,{collect:()=>({...dto('unused'),items:Array.from({length:40},(_,i)=>({id:String(i),kind:'memory',name:`${++round}-${i}`,status:'applied'}))})})
  const initial=await f.cache.read({offset:10})
  const [before,after]=await Promise.all([f.cache.read({offset:10}),f.cache.read({offset:10,force:true})])
  assert.deepEqual(before.snapshot.items,initial.snapshot.items)
  assert.notDeepEqual(after.snapshot.items,initial.snapshot.items)
  assert.deepEqual((await f.cache.read({offset:10})).snapshot.items,after.snapshot.items)
})

test('authorization revoked during a page read prevents the in-flight response', async t => {
  let authorized=true
  const f=await setup(t,{collect:()=>{
    if(!authorized) throw Object.assign(Error('private'),{status:403})
    return {...dto('unused'),items:Array.from({length:50},(_,i)=>({id:String(i),kind:'memory',name:`entry-${i}`,status:'applied'}))}
  }})
  await f.cache.read()
  authorized=false
  const reading=f.cache.read({limit:50})
  const refresh=f.cache.read({force:true})
  await assert.rejects(refresh,{code:'EVOLUTION_FORBIDDEN',status:403})
  await assert.rejects(reading,{code:'EVOLUTION_FORBIDDEN',status:403})
})
