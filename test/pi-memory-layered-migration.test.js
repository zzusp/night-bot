import {symlink} from './fixtures/filesystem-link.js'
import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,mkdir,writeFile,readFile,readdir,rm,lstat,realpath,link,readlink} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {spawnSync} from 'node:child_process'
import {checkMemoryMigration,applyMemoryMigration} from '../src/memory/layered-migration.js'
import {hash,encodeTopic} from '../src/memory/format.js'
import {MarkdownMemoryStore} from '../src/memory/store.js'
import {acquireLock} from '../src/runtime/files.js'
import {InstalledSkillPrevious} from '../src/memory/installed-previous.js'
const scope={kind:'bot',id:hash('bot:shared'),actor:hash('fixture-user')}
const entry={id:'12345678-1234-1234-1234-123456789012',key:'style',text:'Use concise explanations.',revision:7,scope:'bot',createdAt:'2026-01-01T00:00:00.000Z',updatedAt:'2026-02-01T00:00:00.000Z',expiresAt:'2036-01-01T00:00:00.000Z',source:{messageId:'fixture-message',sessionId:'fixture-session',actor:scope.actor},originSource:{messageId:'candidate-source',sessionId:'candidate-session',actor:scope.actor},provenance:{channelId:'fixture',conversationId:'conversation',conversationType:'chat',taskId:'task',taskTitle:'Fixture task'},origins:[{channelId:'fixture',conversationId:'original'}],previous:{text:'Use explanations.',revision:6,updatedAt:'2026-01-01T00:00:00.000Z'},context:{version:1,subject:{kind:'actor',actor:scope.actor},background:{status:'source-excerpt',source:'message',messageId:'fixture-message',quote:'I prefer concise explanations.',quoteSha256:hash('I prefer concise explanations.')},interpretation:{status:'inference',scenario:'Answering questions',boundaries:['Personal preference']}}}
const meta={version:1,revision:18,seen:[hash('seen-fixture')],forgotten:[hash('forgotten-fixture')],migration:{version:1,receipts:['original-import']}}
async function fixture(t){const root=await mkdtemp(join(await realpath(tmpdir()),'night-memory-migration-')),dir=join(root,'data/memory/v2/bot');t.after(()=>rm(root,{recursive:true,force:true}));await mkdir(join(dir,'topics'),{recursive:true});await writeFile(join(dir,'scope.json'),JSON.stringify(meta));await writeFile(join(dir,'index.md'),'# Legacy index\n');await writeFile(join(dir,'topics',hash('preferences')+'.md'),encodeTopic('preferences',18,[entry],scope));await writeFile(join(dir,'candidates.md'),encodeTopic('candidates',18,[{...entry,id:'22345678-1234-1234-1234-123456789012',topic:'preferences',key:'candidate'}],scope));return {root,dir}}
async function snapshot(root,prefix=''){const out={};for(const name of (await readdir(root)).sort()){const path=join(root,name),s=await lstat(path);out[prefix+name]={mode:s.mode,mtime:s.mtimeMs};if(s.isSymbolicLink())out[prefix+name].link=await readlink(path);else if(s.isDirectory())Object.assign(out,await snapshot(path,prefix+name+'/'));else out[prefix+name].text=await readFile(path,'utf8')}return out}
test('check and default CLI are read-only, apply retains every record field and backups',async t=>{
 const {root,dir}=await fixture(t),before=await snapshot(root)
 assert.equal((await checkMemoryMigration(root)).entries,1)
 const cli=spawnSync(process.execPath,['scripts/migrate-memory.mjs','--install-root',root],{encoding:'utf8'});assert.equal(cli.status,0,cli.stderr);assert.equal(JSON.parse(cli.stdout).status,'ready')
 assert.deepEqual(await snapshot(root),before)
 const result=await applyMemoryMigration(root);assert.equal(result.status,'completed')
 const store=new MarkdownMemoryStore(join(root,'data/memory'))
 const actual=await store.transaction(scope,s=>({meta:s.meta,entry:s.topics.get('preferences').entries[0],candidates:s.candidates}))
 assert.deepEqual(actual.entry,entry);assert.deepEqual(actual.meta,{...meta,layoutVersion:3});assert.deepEqual(actual.candidates,[{...entry,id:'22345678-1234-1234-1234-123456789012',topic:'preferences',key:'candidate'}])
 for(const name of ['scope.json','index.md','candidates.md','topics/'+hash('preferences')+'.md'])assert.equal(await readFile(join(root,result.receipt.backup,name),'utf8'),before['data/memory/v2/bot/'+name].text)
 assert.equal(await readFile(join(dir,'topics',hash('preferences')+'.md'),'utf8'),before['data/memory/v2/bot/topics/'+hash('preferences')+'.md'].text)
 await store.forget(scope,{topic:'preferences',key:'style',source:{messageId:'forget-fixture',sessionId:'fixture'}})
 assert.equal((await applyMemoryMigration(root)).status,'already-layered');assert.equal((await store.read(scope,{topic:'preferences'})).entries.length,0)
})
test('interrupted apply resumes explicitly after process restart and never changes source',async t=>{
 const {root,dir}=await fixture(t)
 await assert.rejects(applyMemoryMigration(root,{afterWrite:()=>{throw Error('simulated interruption')}}),/simulated/)
 assert.equal((await checkMemoryMigration(root)).status,'interrupted')
 const cli=spawnSync(process.execPath,['scripts/migrate-memory.mjs','--install-root',root,'--apply'],{encoding:'utf8'});assert.equal(cli.status,0,cli.stderr);assert.equal(JSON.parse(cli.stdout).status,'completed')
 assert.equal((await applyMemoryMigration(root)).status,'already-layered');await assert.rejects(lstat(join(dir,'layout-migration.pending.json')),{code:'ENOENT'})
})
for(const kind of ['unknown','malformed','hash','collision','symlink','hardlink','destination','pending'])test('fails closed before mutation: '+kind,async t=>{
 const {root,dir}=await fixture(t),topic=join(dir,'topics',hash('preferences')+'.md')
 if(kind==='unknown')await writeFile(join(dir,'unexpected.md'),'extra')
 if(kind==='malformed')await writeFile(topic,'broken envelope')
 if(kind==='hash')await writeFile(topic,(await readFile(topic,'utf8')).replace('Use concise explanations.','Changed fact.'))
 if(kind==='collision')await writeFile(join(dir,'topics',hash('other')+'.md'),encodeTopic('other',18,[entry],scope))
 if(kind==='symlink'){await rm(topic);await symlink(process.platform==='win32'?dir:join(dir,'index.md'),topic)}
 if(kind==='hardlink'){await rm(topic);await link(join(dir,'index.md'),topic)}
 if(kind==='destination'){await mkdir(join(dir,'categories'));await writeFile(join(dir,'categories/owned.md'),'do not overwrite')}
 if(kind==='pending')await writeFile(join(dir,'pending.json'),'{}')
 const before=await snapshot(root)
 await assert.rejects(checkMemoryMigration(root));await assert.rejects(applyMemoryMigration(root));assert.deepEqual(await snapshot(root),before)
})
test('installation lease refuses active runtime without creating backups or writes',async t=>{
 const {root}=await fixture(t),release=await acquireLock(join(root,'data/runtime/.host.lock'))
 try{const before=await snapshot(root);await assert.rejects(checkMemoryMigration(root),/RUNTIME_ACTIVE/);await assert.rejects(applyMemoryMigration(root),/NIGHT_DATA_IN_USE/);assert.deepEqual(await snapshot(root),before)}finally{await release()}
})
test('resume refuses backup or partial target tampering',async t=>{
 const {root,dir}=await fixture(t);let first
 await assert.rejects(applyMemoryMigration(root,{afterWrite:name=>{first=name;throw Error('pause')}}),/pause/)
 await writeFile(join(dir,first),'foreign contents')
 const before=await snapshot(root);await assert.rejects(applyMemoryMigration(root),/DESTINATION_CONFLICT/);assert.deepEqual(await snapshot(root),before)
})
test('interruption after scope commit remains resumable and backup tampering fails closed',async t=>{
 const {root}=await fixture(t)
 await assert.rejects(applyMemoryMigration(root,{afterWrite:name=>{if(name==='scope.json')throw Error('scope committed')}}),/scope committed/)
 const checked=await checkMemoryMigration(root);assert.equal(checked.status,'interrupted')
 const backup=join(root,checked.backup,'index.md');await writeFile(backup,'tampered backup')
 const before=await snapshot(root);await assert.rejects(applyMemoryMigration(root),/BACKUP_CHANGED/);assert.deepEqual(await snapshot(root),before)
})
test('wrong legacy filename hash and unsafe installation alias are refused',async t=>{
 const {root,dir}=await fixture(t)
 await writeFile(join(dir,'topics',hash('not-preferences')+'.md'),encodeTopic('preferences',18,[entry],scope))
 await assert.rejects(checkMemoryMigration(root))
 const link=root+'-alias';await symlink(root,link);t.after(()=>rm(link,{force:true}))
 await assert.rejects(applyMemoryMigration(link),/UNSAFE_PATH/)
})
test('abrupt process exit leaves leases and journal; explicit rerun reclaims dead owners',async t=>{
 const {root}=await fixture(t)
 const module=new URL('../src/memory/layered-migration.js',import.meta.url).href
 const crashed=spawnSync(process.execPath,['--input-type=module','-e',`import {applyMemoryMigration} from ${JSON.stringify(module)};await applyMemoryMigration(process.argv[1],{afterWrite:()=>process.exit(23)});`,root],{encoding:'utf8'})
 assert.equal(crashed.status,23,crashed.stderr)
 await assert.rejects(checkMemoryMigration(root),/RUNTIME_ACTIVE_OR_UNCERTAIN/)
 const resumed=spawnSync(process.execPath,['scripts/migrate-memory.mjs','--install-root',root,'--apply'],{encoding:'utf8'})
 assert.equal(resumed.status,0,resumed.stderr);assert.equal(JSON.parse(resumed.stdout).status,'completed')
})

test('legacy maximum-length Unicode labels migrate with full identities and valid bounded filenames',async t=>{
 const {root,dir}=await fixture(t),topic='类'.repeat(80),key='记'.repeat(80),longEntry={...entry,id:'32345678-1234-1234-1234-123456789012',key}
 await writeFile(join(dir,'topics',hash(topic)+'.md'),encodeTopic(topic,18,[longEntry],scope))
 assert.equal((await checkMemoryMigration(root)).entries,2)
 assert.equal((await applyMemoryMigration(root)).status,'completed')
 const store=new MarkdownMemoryStore(join(root,'data/memory'))
 const actual=await store.transaction(scope,state=>state.topics.get(topic).entries[0]);assert.deepEqual(actual,longEntry)
 assert.equal((await store.read(scope,{topic,key})).entries[0].key,key)
 assert.equal((await applyMemoryMigration(root)).status,'already-layered')
})

test('migration preserves runtime-created installed Skill previous snapshots byte for byte',async t=>{
 const {root,dir}=await fixture(t),skills=join(root,'data/skills'),skill=join(skills,'fixture')
 await mkdir(skill,{recursive:true})
 const body=text=>['---','name: fixture','description: Migration fixture','---',text,''].join(String.fromCharCode(10))
 await writeFile(join(skill,'SKILL.md'),body('Original generic procedure.'))
 const history=new InstalledSkillPrevious(dir,{installRoot:root,skills});t.after(()=>history.close())
 await history.scan();await writeFile(join(skill,'SKILL.md'),body('Updated generic procedure.'));await history.scan()
 const state=await history.readState(),before=await readFile(join(dir,'installed-previous.json'))
 assert.equal(Object.keys(state.items).length,1);assert.ok(Object.values(state.items)[0].previous)
 assert.equal((await checkMemoryMigration(root)).status,'ready')
 assert.equal((await applyMemoryMigration(root)).status,'completed')
 assert.deepEqual(await readFile(join(dir,'installed-previous.json')),before)
 assert.deepEqual(await history.readState(),state)
 assert.equal((await applyMemoryMigration(root)).status,'already-layered')
 assert.deepEqual(await readFile(join(dir,'installed-previous.json')),before)
})
