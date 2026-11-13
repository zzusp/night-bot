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
import {encodeEntry,entryPath,categoryPath} from '../src/memory/layered-format.js'
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
 assert.deepEqual(actual.entry,entry);for(const [key,value]of Object.entries(meta))assert.deepEqual(actual.meta[key],value);assert.equal(actual.meta.layoutVersion,4);assert.deepEqual(actual.candidates,[{...entry,id:'22345678-1234-1234-1234-123456789012',topic:'preferences',key:'candidate'}])
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

async function v3Fixture(t){
 const {root,dir}=await fixture(t),topic='preferences',encoded=encodeEntry(topic,entry,scope)
 const envelope=(meta,body)=>'---\n'+JSON.stringify({...meta,metadataSha256:hash(JSON.stringify(meta)),bodySha256:hash(body)},null,2)+'\n---\n\n'+body
 const descriptor={id:entry.id,key:entry.key,topic,title:entry.key,summary:'Answering questions: use concise explanations.',path:'entries/style.md',sha256:hash(encoded.text),revision:entry.revision,createdAt:entry.createdAt,updatedAt:entry.updatedAt,expiresAt:entry.expiresAt}
 const category=envelope({format:'night-bot-memory-category-v3',scope:{kind:scope.kind,id:scope.id},topic,revision:meta.revision,entries:[descriptor]},'# preferences\n\n- [style](entries/style.md) — Answering questions: use concise explanations.\n')
 const index=envelope({format:'night-bot-memory-index-v3',scope:{kind:scope.kind,id:scope.id},revision:meta.revision,topics:[{topic,title:topic,summary:'style',path:categoryPath(topic),sha256:hash(category),count:1,expiries:[entry.expiresAt]}],candidateCount:1,candidateExpiries:[entry.expiresAt]},'# Memory index\n\n- [preferences](categories/preferences/index.md) — style\n')
 await mkdir(join(dir,'categories/preferences/entries'),{recursive:true})
 await writeFile(join(dir,entryPath(topic,entry.key)),encoded.text);await writeFile(join(dir,categoryPath(topic)),category)
 if(encoded.sourceText){await mkdir(join(dir,'sources'),{recursive:true});await writeFile(join(dir,'sources',entry.id+'.md'),encoded.sourceText)}
 await writeFile(join(dir,'scope.json'),JSON.stringify({...meta,layoutVersion:3}));await writeFile(join(dir,'index.md'),index)
 const digest='a'.repeat(64),receipt={version:1,layoutVersion:3,status:'completed',sourceDigest:digest,backup:'backups/memory-layout-'+digest}
 await writeFile(join(dir,'layout-migration.json'),JSON.stringify(receipt))
 return {root,dir}
}
test('v3 JSON indices explicitly migrate to direct Markdown links with original source and receipts backed up',async t=>{
 const {root,dir}=await v3Fixture(t),before=await snapshot(root)
 const check=await checkMemoryMigration(root);assert.equal(check.status,'ready');assert.equal(check.entries,1);assert.deepEqual(await snapshot(root),before)
 const result=await applyMemoryMigration(root);assert.equal(result.receipt.layoutVersion,4)
 const index=await readFile(join(dir,'index.md'),'utf8');assert.doesNotMatch(index,/night-bot-memory-index|metadataSha256|\n---\n|categories\/preferences\/index/);assert.match(index,/\[style\]\(categories\/preferences\/entries\/style\.md\)/)
 await assert.rejects(lstat(join(dir,categoryPath('preferences'))),{code:'ENOENT'})
 for(const name of ['scope.json','index.md','layout-migration.json',categoryPath('preferences'),entryPath('preferences','style'),'sources/'+entry.id+'.md'])assert.equal(await readFile(join(root,result.receipt.backup,name),'utf8'),before['data/memory/v2/bot/'+name].text)
 const store=new MarkdownMemoryStore(join(root,'data/memory'));assert.deepEqual((await store.read(scope,{topic:'preferences',key:'style',includePrevious:true})).entries[0],entry)
 assert.equal((await applyMemoryMigration(root)).status,'already-layered')
})
test('v3 migration resumes after removing an obsolete category index without replacing edited targets',async t=>{
 const {root,dir}=await v3Fixture(t)
 await assert.rejects(applyMemoryMigration(root,{afterWrite:name=>{if(name===categoryPath('preferences'))throw Error('pause after category retirement')}}),/pause after/)
 assert.equal((await checkMemoryMigration(root)).status,'interrupted')
 assert.equal((await applyMemoryMigration(root)).status,'completed')
 assert.equal((await checkMemoryMigration(root)).status,'already-layered')
})
test('v3 index hash corruption is rejected without writing a migration backup',async t=>{
 const {root,dir}=await v3Fixture(t)
 await writeFile(join(dir,categoryPath('preferences')),'tampered category')
 const before=await snapshot(root);await assert.rejects(checkMemoryMigration(root));await assert.rejects(applyMemoryMigration(root));assert.deepEqual(await snapshot(root),before)
})
test('v3 migration refuses undeclared category files instead of retiring or importing them',async t=>{
 const {root,dir}=await v3Fixture(t)
 await mkdir(join(dir,'categories/unknown'),{recursive:true});await writeFile(join(dir,'categories/unknown/index.md'),'unregistered content')
 const before=await snapshot(root);await assert.rejects(checkMemoryMigration(root),/DESTINATION_CONFLICT/);await assert.rejects(applyMemoryMigration(root),/DESTINATION_CONFLICT/);assert.deepEqual(await snapshot(root),before)
})
test('old unfinished layout migration cannot be silently repurposed for a new target layout',async t=>{
 const {root,dir}=await fixture(t)
 await writeFile(join(dir,'layout-migration.pending.json'),JSON.stringify({version:1,installRoot:root,now:Date.now(),sourceDigest:'a'.repeat(64),backup:'backups/memory-layout-'+'a'.repeat(64)}))
 const before=await snapshot(root);await assert.rejects(checkMemoryMigration(root),/JOURNAL_TARGET_UNSUPPORTED/);await assert.rejects(applyMemoryMigration(root),/JOURNAL_TARGET_UNSUPPORTED/);assert.deepEqual(await snapshot(root),before)
})

test('retired skill usage database and all sidecars remain untouched during migration',async t=>{
 const {root,dir}=await fixture(t)
 const files=['','-wal','-shm','-journal'].map(suffix=>'skill-usage.sqlite'+suffix)
 for(const name of files)await writeFile(join(dir,name),'RETIRED:'+name)
 assert.equal((await checkMemoryMigration(root)).status,'ready')
 assert.equal((await applyMemoryMigration(root)).status,'completed')
 for(const name of files)assert.equal(await readFile(join(dir,name),'utf8'),'RETIRED:'+name)
})

test('explicit no-backup CLI upgrades v3 without copying source bodies or creating backups',async t=>{
 const {root,dir}=await v3Fixture(t),before=await snapshot(root)
 const args=['scripts/migrate-memory.mjs','--install-root',root,'--no-backup']
 const check=spawnSync(process.execPath,[...args,'--check'],{encoding:'utf8'})
 assert.equal(check.status,0,check.stderr);assert.equal(JSON.parse(check.stdout).backup,null);assert.deepEqual(await snapshot(root),before)
 const apply=spawnSync(process.execPath,[...args,'--apply'],{encoding:'utf8'})
 assert.equal(apply.status,0,apply.stderr);const result=JSON.parse(apply.stdout)
 assert.equal(result.receipt.backup,null);assert.equal(result.receipt.version,2)
 await assert.rejects(lstat(join(root,'backups')),{code:'ENOENT'});await assert.rejects(lstat(join(dir,'layout-migration.pending.json')),{code:'ENOENT'})
 for(const name of ['candidates.md',entryPath('preferences','style'),'sources/'+entry.id+'.md'])assert.equal(await readFile(join(dir,name),'utf8'),before['data/memory/v2/bot/'+name].text)
 const store=new MarkdownMemoryStore(join(root,'data/memory'))
 const state=await store.transaction(scope,s=>({meta:s.meta,entry:s.topics.get('preferences').entries[0],candidates:s.candidates}))
 assert.deepEqual(state.entry,entry);for(const [key,value]of Object.entries(meta))assert.deepEqual(state.meta[key],value);assert.deepEqual(state.candidates,[{...entry,id:'22345678-1234-1234-1234-123456789012',topic:'preferences',key:'candidate'}])
 assert.equal((await checkMemoryMigration(root)).status,'already-layered')
})

for(const boundary of ['index.md',categoryPath('preferences'),'scope.json'])test('no-backup redo survives a process exit after '+boundary,async t=>{
 const {root,dir}=await v3Fixture(t)
 const module=new URL('../src/memory/layered-migration.js',import.meta.url).href
 const child=spawnSync(process.execPath,['--input-type=module','-e',`import {applyMemoryMigration} from ${JSON.stringify(module)};await applyMemoryMigration(process.argv[1],{backup:false,afterWrite:name=>{if(name===process.argv[2])process.exit(23)}});`,root,boundary],{encoding:'utf8'})
 assert.equal(child.status,23,child.stderr)
 const journal=JSON.parse(await readFile(join(dir,'layout-migration.pending.json'),'utf8'))
 assert.equal(journal.backup,null);assert.equal(journal.version,2)
 assert.ok(journal.writes.every(([name])=>name==='index.md'||name==='scope.json'||name===categoryPath('preferences')))
 assert.ok(journal.sourceFiles.every(([,digest])=>/^[a-f0-9]{64}$/.test(digest)));assert.doesNotMatch(JSON.stringify(journal),/night-bot-memory-entry-v3|night-bot-memory-sources-v3/);await assert.rejects(lstat(join(root,'backups')),{code:'ENOENT'})
 const cli=spawnSync(process.execPath,['scripts/migrate-memory.mjs','--install-root',root,'--apply','--no-backup'],{encoding:'utf8'})
 assert.equal(cli.status,0,cli.stderr);assert.equal(JSON.parse(cli.stdout).status,'completed')
 const store=new MarkdownMemoryStore(join(root,'data/memory'));assert.deepEqual((await store.read(scope,{topic:'preferences',key:'style',includePrevious:true})).entries[0],entry)
 assert.equal((await checkMemoryMigration(root)).status,'already-layered');await assert.rejects(lstat(join(root,'backups')),{code:'ENOENT'})
})
for(const mutation of ['source','target','added','journal-path','journal-body'])test('no-backup redo refuses foreign '+mutation+' without further writes',async t=>{
 const {root,dir}=await v3Fixture(t)
 await assert.rejects(applyMemoryMigration(root,{backup:false,afterWrite:()=>{throw Error('pause')}}),/pause/)
 if(mutation==='source')await writeFile(join(dir,entryPath('preferences','style')),'changed source')
 if(mutation==='target')await writeFile(join(dir,'index.md'),'changed target')
 if(mutation==='added')await writeFile(join(dir,'categories/preferences/entries/foreign.md'),'foreign')
 if(mutation.startsWith('journal-')){
  const path=join(dir,'layout-migration.pending.json'),journal=JSON.parse(await readFile(path,'utf8'))
  if(mutation==='journal-path')journal.writes[0][0]='../outside.md'
  else journal.writes[0][1]+='changed'
  await writeFile(path,JSON.stringify(journal))
 }
 const before=await snapshot(root)
 await assert.rejects(checkMemoryMigration(root,{backup:false}));await assert.rejects(applyMemoryMigration(root,{backup:false}));assert.deepEqual(await snapshot(root),before)
})
test('no-backup keeps runtime, source-version and existing transaction policy fences',async t=>{
 const legacy=await fixture(t),before=await snapshot(legacy.root)
 await assert.rejects(applyMemoryMigration(legacy.root,{backup:false}),/NO_BACKUP_REQUIRES_V3/);assert.deepEqual(await snapshot(legacy.root),before)
 const {root}=await v3Fixture(t),release=await acquireLock(join(root,'data/runtime/.host.lock'))
 try{const locked=await snapshot(root);await assert.rejects(applyMemoryMigration(root,{backup:false}),/NIGHT_DATA_IN_USE/);assert.deepEqual(await snapshot(root),locked)}finally{await release()}
 await assert.rejects(applyMemoryMigration(root,{afterWrite:()=>{throw Error('pause')}}),/pause/)
 const partial=await snapshot(root);await assert.rejects(applyMemoryMigration(root,{backup:false}),/BACKUP_POLICY_CONFLICT/);assert.deepEqual(await snapshot(root),partial)
 assert.equal((await applyMemoryMigration(root)).status,'completed')
 const other=await v3Fixture(t)
 await assert.rejects(applyMemoryMigration(other.root,{backup:false,afterWrite:()=>{throw Error('pause')}}),/pause/)
 const without=await snapshot(other.root);await assert.rejects(applyMemoryMigration(other.root),/BACKUP_POLICY_CONFLICT/);assert.deepEqual(await snapshot(other.root),without)
})
