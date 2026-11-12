import {symlink} from './fixtures/filesystem-link.js'
import {tmpdir} from 'node:os'
import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,rm,readFile,readdir,writeFile} from 'node:fs/promises'
import {join} from 'node:path'
import {spawn} from 'node:child_process'
import {once} from 'node:events'
import {MarkdownMemoryStore} from '../src/memory/store.js'
import {memoryScope} from '../src/memory/scope.js'
import {hash} from '../src/memory/format.js'
import {entryPath,categoryPath,sourcePath} from '../src/memory/layered-format.js'
const scope=memoryScope({actorId:'alice'},{}),source=id=>({sessionId:'session',messageId:id}),item=(id,key,text)=>({topic:'preferences',key,text,source:source(id)})
async function fixture(t,options){const root=await mkdtemp(join(tmpdir(),'night-memory-store-'));t.after(()=>rm(root,{recursive:true,force:true}));return {root,store:new MarkdownMemoryStore(root,options)}}
test('Markdown topic corrections retain identity/source/time, enforce revisions and survive reopen',async t=>{
  const {root,store}=await fixture(t),a=await store.remember(scope,item('1','style','Concise answers'))
  await store.remember(scope,{...item('2','style','Detailed answers'),expectedRevision:1})
  await assert.rejects(store.remember(scope,{...item('3','style','stale'),expectedRevision:1}),/REVISION_CONFLICT/)
  const [entry]=(await new MarkdownMemoryStore(root).read(scope,{topic:'preferences'})).entries
  assert.equal(entry.text,'Detailed answers');assert.equal(entry.id,a.entry.id);assert.equal(entry.source.messageId,'2');assert.equal(entry.revision,2)
  const text=await readFile(join(store.directory(scope),entryPath('preferences','style')),'utf8');assert.match(text,/# style/);assert.match(text,/Concise answers/);assert.equal(entry.previous,undefined,'ordinary recall never includes the previous body');assert.equal((await store.transaction(scope,state=>state.topics.get('preferences').entries[0])).previous.text,'Concise answers')
})
test('forget removes fact, candidates and short index, invalidates stale extraction, and cannot replay over a newer fact',async t=>{
  const {store}=await fixture(t)
  await store.remember(scope,item('1','style','ORIGINAL_MARKER'))
  await store.remember(scope,{...item('2','candidate','CANDIDATE_MARKER'),candidate:true})
  const baseline=(await store.index(scope)).revision
  await store.forget(scope,{topic:'preferences',key:'style',source:source('forget')})
  await store.forget(scope,{topic:'preferences',key:'candidate',source:source('forget2')})
  await assert.rejects(store.remember(scope,{...item('old','candidate','CANDIDATE_MARKER'),candidate:true,scopeRevision:baseline}),/SCOPE_CHANGED/)
  assert.equal((await store.search(scope,{query:'MARKER'})).entries.length,0)
  assert.equal((await store.read(scope,{candidates:true})).entries.length,0)
  assert.doesNotMatch(await readFile(join(store.directory(scope),'index.md'),'utf8'),/preferences|MARKER/)
  await store.remember(scope,item('new','style','NEW_MARKER'))
  assert.equal((await store.forget(scope,{topic:'preferences',key:'style',source:source('forget')})).duplicate,true)
  assert.equal((await store.read(scope,{topic:'preferences'})).entries[0].text,'NEW_MARKER')
})
test('literal search is bounded, expiry hides records and candidates remain outside accepted recall',async t=>{
  let now=Date.now();const {store}=await fixture(t,{now:()=>now})
  await store.remember(scope,{...item('1','style','Concise Mandarin answers'),expiresAt:new Date(now+1000).toISOString()})
  await store.remember(scope,{...item('2','other','Long prose'),candidate:true})
  assert.equal((await store.search(scope,{query:'MANDARIN concise'})).entries.length,1)
  assert.equal((await store.search(scope,{query:'Chinese'})).entries.length,0,'no semantic matching')
  now+=1001;assert.equal((await store.search(scope,{query:'Mandarin'})).entries.length,0)
  assert.equal((await store.search(scope,{query:'Long'})).entries.length,0)
})
for(const secret of ['password: abc123','API_KEY=fixture-sensitive','密码是123456','Bearer abcdefghijk','-----BEGIN PRIVATE KEY-----'])test('credential material is refused: '+secret.split(/[=:： ]/)[0],async t=>{
  const {store}=await fixture(t);await assert.rejects(store.remember(scope,item('secret','unsafe',secret)),/SECRET_REFUSED/);assert.equal((await store.index(scope)).topics.length,0)
})
test('Bot namespace is shared across selectors and users, but read-only bindings cannot write',async t=>{
  const {store}=await fixture(t),bob=memoryScope({actorId:'bob'},{}),g1=memoryScope({actorId:'alice',groupId:'g1',groupWrite:true},{scope:'group'},true),g2=memoryScope({actorId:'alice',groupId:'g2',groupWrite:true},{scope:'group'},true)
  await store.remember(scope,item('a','style','PRIVATE_ALICE'));await store.remember(g1,item('g','room','GROUP_ONE'))
  assert.equal((await store.search(bob,{query:'PRIVATE'})).entries.length,1);assert.equal((await store.search(g2,{query:'GROUP'})).entries.length,1)
  assert.equal(memoryScope({actorId:'alice',groupId:'g1'},{scope:'personal'}).id,bob.id)
  assert.throws(()=>memoryScope({actorId:'alice',groupId:'g1'},{scope:'group'},true),/FORBIDDEN/)
  assert.equal(memoryScope({actorId:'alice',projects:[{id:'p1',write:true}]},{scope:'project',projectId:'p2'}).id,bob.id)
})
test('concurrent processes merge independent writes under a scope lease rather than losing updates',async t=>{
  const {root,store}=await fixture(t)
  const code=`import {MarkdownMemoryStore} from ${JSON.stringify(new URL('../src/memory/store.js',import.meta.url).href)};const s=new MarkdownMemoryStore(process.argv[1]);const scope=${JSON.stringify(scope)};for(let n=0;n<6;n++)await s.remember(scope,{topic:'parallel',key:process.argv[2]+'-'+n,text:'literal '+n,source:{sessionId:process.argv[2],messageId:String(n)}});`
  const children=['one','two','three'].map(name=>spawn(process.execPath,['--input-type=module','-e',code,root,name],{stdio:['ignore','pipe','pipe']}))
  const results=await Promise.all(children.map(async child=>{let error='';child.stderr.on('data',b=>error+=b);const [exit]=await once(child,'exit');assert.equal(exit,0,error)}))
  assert.equal((await store.read(scope,{topic:'parallel'})).entries.length,18)
})
test('a failed multi-file commit reports uncertainty and redo recovery completes a forget without stale derived data',async t=>{
  const {store}=await fixture(t);await store.remember(scope,item('1','style','REMOVE_ME'))
  store.beforeApply=()=>{throw new Error('disk fault')}
  await assert.rejects(store.forget(scope,{topic:'preferences',key:'style'}),e=>e.code==='MEMORY_COMMIT_UNCERTAIN'&&e.committed==='uncertain')
  store.beforeApply=undefined
  assert.deepEqual((await store.read(scope,{topic:'preferences'})).entries,[])
  assert.doesNotMatch(await readFile(join(store.directory(scope),'index.md'),'utf8'),/preferences/)
  await assert.rejects(readFile(join(store.directory(scope),'pending.json')),/ENOENT/)
})
test('symlinked scope content and modified Markdown checksums are rejected explicitly',async t=>{
  const {root,store}=await fixture(t);await store.remember(scope,item('1','style','original'))
  const path=join(store.directory(scope),entryPath('preferences','style'));await writeFile(path,(await readFile(path,'utf8')).replace('\noriginal\n','\ntampered\n'))
  await assert.rejects(store.read(scope,{topic:'preferences'}),/CONTENT_CHANGED/)
  await rm(path);await symlink(join(root,'outside'),path,process.platform==='win32'?'junction':'file')
  await assert.rejects(store.read(scope,{topic:'preferences'}),/PATH_UNSAFE/)
})

test('preference context survives reopen, is searchable, revisions independently of the quote and is fully forgotten',async t=>{
  const {buildMemoryContext}=await import('../src/memory/format.js'),{root,store}=await fixture(t)
  const context=buildMemoryContext({background:{source:'quote',quote:'An extra deployment report was attached.'},scenario:'Deployment result reporting',boundaries:['Requested deliverables remain required.']},{actor:scope.actor,quote:{messageId:'quoted-report',text:'An extra deployment report was attached. Extra irrelevant text.'}})
  const original=await store.remember(scope,item('1','report','Do not attach unsolicited reports'))
  const updated=await store.remember(scope,{...item('2','report',original.entry.text),context,expectedRevision:1})
  assert.equal(updated.entry.id,original.entry.id);assert.equal(updated.entry.createdAt,original.entry.createdAt);assert.equal(updated.entry.revision,2)
  const reopened=new MarkdownMemoryStore(root),read=await reopened.search(scope,{query:'Deployment result',mode:'fulltext',includeSources:true})
  assert.deepEqual(read.entries[0].context,context);assert.equal(read.entries[0].text,original.entry.text)
  assert.equal((await reopened.search(scope,{query:'Requested deliverables',mode:'fulltext'})).entries.length,1)
  assert.equal((await reopened.search(scope,{query:'irrelevant'})).entries.length,0)
  await store.forget(scope,{topic:'preferences',key:'report',source:source('forget-context')})
  assert.deepEqual((await reopened.search(scope,{query:'Deployment'})).entries,[])
  await assert.rejects(readFile(join(store.directory(scope),entryPath('preferences','report'))),/ENOENT/);await assert.rejects(readFile(join(store.directory(scope),sourcePath(updated.entry.id))),/ENOENT/)
  assert.doesNotMatch(await readFile(join(store.directory(scope),'index.md'),'utf8'),/report|Deployment/)
})
test('context content is checksummed, source excerpts are exact and every explanatory field rejects secrets',async t=>{
  const {buildMemoryContext}=await import('../src/memory/format.js'),{store}=await fixture(t)
  const inputs={scenario:'Result reporting',boundaries:['Requested deliverables remain required.']}
  const context=buildMemoryContext(inputs,{actor:scope.actor})
  assert.equal(context.background.status,'unavailable')
  assert.throws(()=>buildMemoryContext({...inputs,background:{source:'quote',quote:'real background'}},{actor:scope.actor,quote:{messageId:'API_KEY=unsafe-id',text:'real background'}}),/SECRET_REFUSED/)
  assert.throws(()=>buildMemoryContext({...inputs,background:{source:'quote',quote:'invented'}},{actor:scope.actor,quote:{messageId:'quote',text:'real background'}}),/CONTEXT_SOURCE_REQUIRED/)
  for(const unsafe of [{...inputs,scenario:'password: unsafe'},{...inputs,boundaries:['API_KEY=unsafe']},{...inputs,background:{source:'message',quote:'Bearer unsafe'}}]){
    assert.throws(()=>buildMemoryContext(unsafe,{actor:scope.actor,message:{id:'real',content:'Bearer unsafe'}}),/SECRET_REFUSED/)
  }
  await store.remember(scope,{...item('1','report','No unsolicited reports'),context})
  const path=join(store.directory(scope),entryPath('preferences','report')),text=await readFile(path,'utf8')
  await writeFile(path,text.replace('Result reporting','Different scenario'))
  await assert.rejects(store.read(scope,{topic:'preferences'}),/CONTENT_CHANGED/)
})

test('contextual Router memory keeps structured evidence and rendered text consistent before persistence',async t=>{
  const {buildRouterMemory,checkedMemoryContext,encodeTopic,decodeTopic,renderRouterMemory}=await import('../src/memory/format.js')
  const {store}=await fixture(t),original={sourceId:'source-project',version:1,messageId:'native-project',actorId:'alice',text:'后续开发参考这个看板。',quote:{messageId:'announcement',actorId:'bob',text:'编辑器开发看板 https://example.test/projects/6'}}
  const draft={summary:'后续编辑器开发参考 https://example.test/projects/6。',why:'原消息明确要求参考引用中的看板。',howToApply:'编辑器开发前查看该看板，不推广到其他项目。',
    appliesTo:{kind:'context',description:'编辑器开发，不扩大到其他项目。'},
    evidence:[{id:'E1',source:'message',sourceId:original.sourceId,messageVersion:1,quote:original.text},
      {id:'E2',source:'quote',sourceId:original.sourceId,messageVersion:1,quote:original.quote.text}]}
  const options={actor:hash('alice'),message:{id:original.sourceId,content:original.text},sources:[original]},value=buildRouterMemory(draft,options)
  assert.equal(value.context.subject.kind,'context');assert.equal(value.context.evidence[1].actorId,'bob')
  for(const field of ['summary','why','howToApply']){const missing={...draft};delete missing[field];assert.throws(()=>buildRouterMemory(missing,options),/MEMORY_CONTEXT_INVALID/);assert.throws(()=>buildRouterMemory({...draft,[field]:'password: never-store-this'},options),/MEMORY_SECRET_REFUSED/)}
  assert.throws(()=>buildRouterMemory({...draft,hypothesis:'unverified guess'},options),/MEMORY_CONTEXT_INVALID/)
  assert.throws(()=>buildRouterMemory({...draft,appliesTo:{...draft.appliesTo,actor:'somebody-else'}},options),/MEMORY_CONTEXT_INVALID/)
  assert.throws(()=>buildRouterMemory({...draft,evidence:[]},options),/MEMORY_CONTEXT_INVALID/)

  const tampered=structuredClone(value.context);tampered.evidence[1].quote='fabricated quotation'
  assert.throws(()=>checkedMemoryContext(tampered),/MEMORY_CONTEXT_CONTENT_CHANGED/)
  const args={topic:'projects',key:'editor-reference',...value,source:source('context-write')}
  await assert.rejects(store.remember(scope,{...args,text:'only a transcript'}),/MEMORY_CONTEXT_CONTENT_CHANGED/)
  assert.equal((await store.index(scope)).revision,0)
  const longSource={...original,text:'原消息背景'.repeat(350)},longOptions={...options,message:{id:original.sourceId,content:longSource.text},sources:[longSource]}
  const longDraft=structuredClone(draft);longDraft.evidence[0].quote=longSource.text
  const longValue=buildRouterMemory(longDraft,longOptions);assert.ok(longValue.text.length<2048);assert.ok(!longValue.text.includes(longSource.text))
  await store.remember(scope,{...args,...longValue,key:'long-evidence',source:source('long-context-write')})
  assert.equal((await store.read(scope,{topic:'projects',key:'long-evidence'})).entries[0].context.evidence[0].quote,longSource.text,'evidence is not truncated to fit the old literal-body limit')
  await assert.rejects(store.remember(scope,item('long-generic','generic','x'.repeat(2049))),/MEMORY_TEXT_INVALID/)
  const result=await store.remember(scope,args)
  assert.equal((await store.search(scope,{query:'example.test/projects/6',mode:'fulltext'})).entries.find(entry=>entry.key==='editor-reference').text,value.text)
  const legacy={version:2,subject:value.context.subject,observations:[{kind:'user-request',text:draft.summary,evidenceIds:['E1','E2']}],evidence:value.context.evidence}
  const legacyText=renderRouterMemory(legacy)
  await store.remember(scope,{topic:'projects',key:'legacy-v2',text:legacyText,context:legacy,source:source('legacy-v2')})
  const reopened=(await store.read(scope,{topic:'projects',key:'legacy-v2'})).entries[0];assert.equal(reopened.text,legacyText);assert.equal(reopened.context.version,2)
  const invalid=encodeTopic('projects',1,[{...result.entry,text:'different body with its own valid hash'}],scope)
  assert.throws(()=>decodeTopic(invalid),/MEMORY_CONTEXT_CONTENT_CHANGED/)
})

test('long Unicode labels remain portable and cannot poison committed redo recovery',async t=>{
  const {store}=await fixture(t),topic='类'.repeat(80),key='记'.repeat(80)
  await store.remember(scope,{topic,key,text:'Long Unicode identity retained',source:source('unicode')})
  assert.equal((await store.read(scope,{topic,key})).entries[0].key,key)
  assert.ok(entryPath(topic,key).split('/').every(part=>Buffer.byteLength(part)<255))
  assert.equal((await store.index(scope,{topic})).entries[0].key,key)
  await store.remember(scope,{topic:'case',key:'A',text:'Upper',source:source('upper')})
  await store.remember(scope,{topic:'case',key:'a',text:'Lower',source:source('lower')})
  await store.remember(scope,{topic:'case',key:'con',text:'Reserved Windows name',source:source('reserved')})
  assert.notEqual(entryPath('case','A').toLowerCase(),entryPath('case','a').toLowerCase())
  assert.notEqual(entryPath('case','con').split('/').at(-1),'con.md')
  assert.equal((await store.read(scope,{topic:'case'})).entries.length,3)
})

for(const ancestor of ['categories','categories/preferences','categories/preferences/entries'])test('reads and writes reject linked ancestor '+ancestor,async t=>{
  const {rename}=await import('node:fs/promises'),{root,store}=await fixture(t)
  await store.remember(scope,item('1','style','original'))
  const inside=join(store.directory(scope),ancestor),outside=join(root,'outside');await rename(inside,outside);await symlink(outside,inside,'dir')
  await assert.rejects(store.read(scope,{topic:'preferences',key:'style'}),/PATH_UNSAFE/)
  await assert.rejects(store.remember(scope,item('2','style','changed')),/PATH_UNSAFE/)
  assert.equal((await readFile(join(outside,...ancestor==='categories'?['preferences','entries','style.md']:ancestor==='categories/preferences'?['entries','style.md']:['style.md']),'utf8')).includes('changed'),false)
})

test('source and memory-root ancestor links are refused without following external state',async t=>{
  const {rename}=await import('node:fs/promises'),{buildMemoryContext}=await import('../src/memory/format.js'),{root,store}=await fixture(t)
  const context=buildMemoryContext({background:{source:'message',quote:'Actual source'},scenario:'Source safety',boundaries:['Only verified excerpts']},{actor:scope.actor,message:{id:'source',content:'Actual source'}})
  await store.remember(scope,{...item('1','source','Safe body'),context})
  const originals=join(root,'outside-sources'),sources=join(store.directory(scope),'sources');await rename(sources,originals);await symlink(originals,sources,'dir')
  assert.equal((await store.read(scope,{topic:'preferences',key:'source',includeSources:false})).entries[0].text,'Safe body')
  await assert.rejects(store.read(scope,{topic:'preferences',key:'source',includeSources:true}),/PATH_UNSAFE/)
  await rm(sources);await rename(originals,sources)
  const v2=join(root,'v2'),outside=join(root,'outside-v2');await rename(v2,outside);await symlink(outside,v2,'dir')
  await assert.rejects(store.index(scope),/PATH_UNSAFE/)
  await assert.rejects(store.forget(scope,{topic:'preferences',key:'source'}),/PATH_UNSAFE/)
})

test('redo checks every destination ancestor before applying any committed write',async t=>{
  const {rename}=await import('node:fs/promises'),{root,store}=await fixture(t)
  await store.remember(scope,item('1','one','original'))
  store.beforeApply=()=>{throw new Error('power cut')}
  await assert.rejects(store.remember(scope,item('2','two','new content')),/COMMIT_UNCERTAIN/)
  store.beforeApply=undefined
  const category=join(store.directory(scope),'categories'),outside=join(root,'outside');await rename(category,outside);await symlink(outside,category,'dir')
  await assert.rejects(store.index(scope),/PATH_UNSAFE/)
  await assert.rejects(readFile(join(outside,'preferences','entries','two.md')),/ENOENT/)
  await rm(category);await rename(outside,category)
  assert.equal((await store.read(scope,{topic:'preferences',key:'two'})).entries[0].text,'new content')
})

test('standard Markdown links resolve to actual portable filenames after URL decoding',async t=>{
  const {store}=await fixture(t),topic='中文 Topic',key='Prefer Native Teams'
  await store.remember(scope,{topic,key,text:'Use the native feature first.',source:source('markdown-links')})
  const root=await readFile(join(store.directory(scope),'index.md'),'utf8'),rootLink=/^- \[[^\]]+\]\(([^)]+)\) — /m.exec(root)[1]
  assert.equal(decodeURIComponent(rootLink),categoryPath(topic))
  const category=await readFile(join(store.directory(scope),decodeURIComponent(rootLink)),'utf8'),entryLink=/^- \[[^\]]+\]\(([^)]+)\) — /m.exec(category)[1]
  assert.equal(decodeURIComponent(entryLink),entryPath(topic,key).split('/').slice(-2).join('/'))
  assert.match(await readFile(join(store.directory(scope),categoryPath(topic),'..',decodeURIComponent(entryLink)),'utf8'),/Use the native feature first/)
})
