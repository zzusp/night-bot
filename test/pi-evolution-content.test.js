import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,rm,mkdir,writeFile,readFile,symlink,link} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {entryPath} from '../src/memory/layered-format.js'
import {MarkdownMemoryStore} from '../src/memory/store.js'
import {memoryScope} from '../src/memory/scope.js'
import {hash} from '../src/memory/format.js'
import {inspectEvolutionItem,latestComparison} from '../src/memory/evolution-content.js'
import {InstalledSkillPrevious} from '../src/memory/installed-previous.js'
import {installedSkills} from '../src/memory/skill-inventory.js'
import {boundedRead,CONTENT_LIMIT} from '../src/memory/previous.js'

async function fixture(t){
 const root=await mkdtemp(join(tmpdir(),'night-latest-diff-')),store=new MarkdownMemoryStore(join(root,'memory')),binding={actorId:'operator'},scope=memoryScope(binding)
 const paths={installRoot:root,mode:'portable',skills:join(root,'skills'),memory:join(root,'memory')};await mkdir(paths.skills)
 const tracker=new InstalledSkillPrevious(store.directory(scope),paths)
 const reflection={directory:()=>join(store.directory(scope),'evolution'),state:async()=>({skills:{}})}
 const memory={store,installedPrevious:tracker};let id=0
 const remember=text=>store.remember(scope,{topic:'facts',key:'choice',text,source:{sessionId:'session',messageId:'message-'+(++id)}})
 const content=(revision,kind='memory',key='choice')=>inspectEvolutionItem(memory,reflection,binding,{id:hash(JSON.stringify([scope.kind,scope.id,kind,...kind==='memory'?['applied','facts',key]:[key]])),revision:String(revision)})
 t.after(async()=>{await tracker.close();await store.close();await rm(root,{recursive:true,force:true})})
 return {root,store,binding,scope,paths,tracker,reflection,memory,remember,content}
}
const skill=body=>'---\nname: evidence\ndescription: Local evidence checks\n---\n'+body+'\n'

test('memory keeps only immediately previous content, hides it from tools, survives restart and forgets both',async t=>{
 const f=await fixture(t)
 await f.remember('ONE');assert.equal((await f.content(1)).previous,null)
 await f.remember('TWO');let view=await f.content(2);assert.equal(view.previous.text,'ONE');assert.equal(view.comparison.added,1);assert.equal(view.comparison.removed,1)
 await f.remember('THREE');view=await f.content(3);assert.equal(view.previous.text,'TWO');assert.equal(view.current.text,'THREE')
 assert.doesNotMatch(JSON.stringify(await f.store.read(f.scope,{topic:'facts'})),/previous|TWO|ONE/)
 assert.doesNotMatch(JSON.stringify(await f.store.search(f.scope,{query:'THREE'})),/previous|TWO|ONE/)
 const raw=await readFile(join(f.store.directory(f.scope),entryPath('facts','choice')),'utf8');assert.doesNotMatch(raw,/ONE/);assert.match(raw,/TWO/)
 await assert.rejects(f.content(2),{code:'EVOLUTION_VERSION_STALE'})
 const cold=new MarkdownMemoryStore(f.store.root);assert.equal((await cold.transaction(f.scope,s=>s.topics.get('facts').entries[0])).previous.text,'TWO');await cold.close()
 await f.store.forget(f.scope,{topic:'facts',key:'choice'});await assert.rejects(f.content(3),{code:'EVOLUTION_ITEM_NOT_FOUND'})
 await f.remember('FOUR');assert.equal((await f.content(1)).previous,null)
})

test('redo recovery commits current and previous together, and concurrent revisions cannot overwrite each other',async t=>{
 const f=await fixture(t);await f.remember('ONE');f.store.beforeApply=()=>{throw new Error('interrupt')}
 await assert.rejects(f.remember('TWO'),{code:'MEMORY_COMMIT_UNCERTAIN'});f.store.beforeApply=undefined
 assert.equal((await f.content(2)).previous.text,'ONE')
 const outcomes=await Promise.allSettled(['THREE','FOUR'].map((text,i)=>f.store.remember(f.scope,{topic:'facts',key:'choice',text,expectedRevision:2,source:{sessionId:'concurrent',messageId:String(i)}})))
 assert.equal(outcomes.filter(row=>row.status==='fulfilled').length,1);assert.equal(outcomes.filter(row=>row.status==='rejected'&&row.reason.code==='MEMORY_REVISION_CONFLICT').length,1)
 assert.equal((await f.content(3)).previous.text,'TWO')
})

test('file skills keep two observed bodies, replace old prior, clear deleted and secret-bearing snapshots',async t=>{
 const f=await fixture(t),file=join(f.paths.skills,'evidence','SKILL.md');await mkdir(join(file,'..'));await writeFile(file,skill('ONE'))
 let {inventory,state}=await f.tracker.scan(),item=inventory.items[0];assert.equal(state.items[item.id].previous,null)
 const get=revision=>inspectEvolutionItem(f.memory,f.reflection,f.binding,{id:item.id,revision})
 await writeFile(file,skill('TWO'));({inventory}=await f.tracker.scan());let result=await get(inventory.items[0].revision);assert.match(result.previous.text,/ONE/);assert.equal(result.comparison.basis,'observed')
 await writeFile(file,skill('THREE'));({inventory}=await f.tracker.scan());result=await get(inventory.items[0].revision);assert.match(result.previous.text,/TWO/)
 assert.doesNotMatch(await readFile(f.tracker.file,'utf8'),/ONE/)
 await assert.rejects(get(item.revision),{code:'EVOLUTION_VERSION_STALE'})
 const cold=new InstalledSkillPrevious(f.store.directory(f.scope),f.paths);assert.match((await cold.scan()).state.items[item.id].previous.text,/TWO/);await cold.close()
 await writeFile(file,skill('api_key=do-not-save-this'));({inventory,state}=await f.tracker.scan());assert.equal(Object.keys(state.items).length,0);assert.doesNotMatch(await readFile(f.tracker.file,'utf8'),/do-not-save|THREE|TWO/);await assert.rejects(get(inventory.items[0].revision),{code:'EVOLUTION_BODY_FORBIDDEN'})
 await rm(file);await f.tracker.scan();await assert.rejects(get(item.revision),{code:'EVOLUTION_ITEM_NOT_FOUND'})
 await writeFile(file,skill('NEW'));({inventory}=await f.tracker.scan());assert.equal((await get(inventory.items[0].revision)).previous,null)
})

test('watcher captures new files and edits without opening dashboard; deletion purges retained bodies',async t=>{
 const f=await fixture(t);await f.tracker.start();const file=join(f.paths.skills,'evidence.md')
 const wait=async check=>{for(let i=0;i<100;i++){try{if(await check())return}catch(error){if(error.code!=='EVOLUTION_VERSION_STALE')throw error}await new Promise(r=>setTimeout(r,25))}assert.fail('watcher did not settle')}
 await writeFile(file,skill('BEFORE'));await wait(async()=>Object.values((await f.tracker.readState()).items).some(row=>row.current.text.includes('BEFORE')))
 await writeFile(file,skill('AFTER'));await wait(async()=>Object.values((await f.tracker.readState()).items).some(row=>row.current.text.includes('AFTER')&&row.previous.text.includes('BEFORE')))
 await rm(file);await wait(async()=>Object.keys((await f.tracker.readState()).items).length===0)
})

test('unsafe file paths, hardlinks, oversize, forged identifiers and secrets fail closed',async t=>{
 const f=await fixture(t),outside=join(f.root,'outside.md');await writeFile(outside,skill('OUTSIDE'))
 await link(outside,join(f.paths.skills,'hard.md'));await writeFile(join(f.paths.skills,'large.md'),'a'.repeat(CONTENT_LIMIT+1))
 assert.equal((await installedSkills(f.paths)).complete,false);assert.equal(Object.keys((await f.tracker.scan()).state.items).length,0)
 await assert.rejects(boundedRead(join(f.paths.skills,'large.md')),{code:'EVOLUTION_CONTENT_TOO_LARGE'})
 await assert.rejects(inspectEvolutionItem(f.memory,f.reflection,f.binding,{id:'../outside.md',revision:'1'}),{code:'EVOLUTION_ITEM_NOT_FOUND'})
 await assert.rejects(f.remember('password=do-not-save'),{code:'MEMORY_SECRET_REFUSED'})
})

test('symbolic skill files cannot expose external content',async t=>{
 const f=await fixture(t),outside=join(f.root,'outside.md');await writeFile(outside,skill('OUTSIDE'))
 try{await symlink(outside,join(f.paths.skills,'linked.md'))}catch(error){if(process.platform==='win32'&&error.code==='EPERM'){t.skip('当前 Windows 账号无文件 symlink 权限；此边界另在 Linux 实跑');return}throw error}
 assert.equal((await installedSkills(f.paths)).complete,false);assert.equal(Object.keys((await f.tracker.scan()).state.items).length,0)
})

test('learned current and previous are scoped, and unsupported/forgotten skills do not disclose old text',async t=>{
 const f=await fixture(t);await f.remember('support')
 let value={revision:2,updatedAt:'2026-11-10T00:00:00Z',active:true,supports:[{memoryKey:'choice'}],steps:['New step'],previous:{text:'Old step',revision:1,updatedAt:'2026-11-09T00:00:00Z'}}
 f.reflection.state=async()=>({skills:value?{check:value}:{}});f.reflection.renderSkill=(scope,_key,row,revision)=>'NIGHT_LEARNED_SCOPE='+scope.kind+'/'+scope.id+';revision='+revision+'\n'+row.steps.join('\n')
 // Real learned support is in experience, so this remains unavailable.
 await assert.rejects(f.content(2,'skill','check'),{code:'EVOLUTION_BODY_FORBIDDEN'})
 await f.store.remember(f.scope,{topic:'experience',key:'choice',text:'support',source:{sessionId:'review',messageId:'event'}})
 const file=join(f.reflection.directory(f.scope),'skills','check','SKILL.md');await mkdir(join(file,'..'),{recursive:true});await writeFile(file,f.reflection.renderSkill(f.scope,'check',value,2))
 assert.equal((await f.content(2,'skill','check')).previous.text,'Old step')
 await writeFile(file,'tampered derived file');await assert.rejects(f.content(2,'skill','check'),{code:'EVOLUTION_BODY_FORBIDDEN'})
 value=null;await assert.rejects(f.content(2,'skill','check'),{code:'EVOLUTION_ITEM_NOT_FOUND'})
})

test('diff preserves additions, removals, unchanged text and trailing-newline changes without interpreting HTML',()=>{
 const result=latestComparison({text:'same\n<script>new</script>\n'},{text:'same\nold\n'})
 assert.deepEqual(result.lines,[{type:'unchanged',text:'same'},{type:'removed',text:'old'},{type:'added',text:'<script>new</script>'}])
 assert.equal(latestComparison({text:'same'},{text:'same'}).added,0)
})

test('one unsafe file does not discard a valid sibling, and watcher bursts coalesce',async t=>{
 const f=await fixture(t),good=join(f.paths.skills,'z.md');await writeFile(good,skill('GOOD BEFORE'));await f.tracker.scan()
 await writeFile(good,skill('GOOD AFTER'));await f.tracker.scan();await writeFile(join(f.paths.skills,'a.md'),'x'.repeat(CONTENT_LIMIT+1))
 const result=await f.tracker.scan();assert.equal(result.inventory.items.length,1);assert.equal(result.inventory.complete,false);assert.match(Object.values(result.state.items)[0].previous.text,/GOOD BEFORE/)
 let calls=0,release;const gate=new Promise(resolve=>release=resolve),scan=f.tracker.scan.bind(f.tracker)
 f.tracker.scan=async()=>{calls++;if(calls===1)await gate;return scan()}
 const first=f.tracker.requestScan();for(let i=0;i<100;i++)f.tracker.requestScan();release();await first
 assert.equal(calls,2);assert.equal(f.tracker.pending.size,0)
})

test('installations without watchable skill roots initialize without waiting for a nonexistent watcher',async t=>{
 const f=await fixture(t),tracker=new InstalledSkillPrevious(f.store.directory(f.scope),{installRoot:f.root,skills:join(f.root,'..','outside')})
 await Promise.race([tracker.start(),new Promise((_,reject)=>{const timer=setTimeout(()=>reject(Error('empty watcher did not settle')),1000);timer.unref()})]);assert.equal(tracker.watcher,undefined);await tracker.close()
})


test('memory details resolve metadata and read only the requested entry, preserving previous content',async t=>{
 const f=await fixture(t)
 await f.remember('BEFORE');await f.remember('AFTER')
 await f.store.remember(f.scope,{topic:'facts',key:'unrelated',text:'Unrelated body',source:{sessionId:'other',messageId:'other'}})
 await writeFile(join(f.store.directory(f.scope),entryPath('facts','unrelated')),'BROKEN UNRELATED BODY')
 f.store.transaction=()=>{throw Error('detail must not scan full inventory')}
 const view=await f.content(2)
 assert.equal(view.current.text,'AFTER');assert.equal(view.previous.text,'BEFORE')
 await assert.rejects(f.content(1),{code:'EVOLUTION_VERSION_STALE'})
})

test('candidate detail lookup is not capped by the Bot read window or confused by same-key topics',async t=>{
 const f=await fixture(t),{randomUUID}=await import('node:crypto')
 await f.store.remember(f.scope,{topic:'facts',key:'choice',text:'Candidate target',candidate:true,source:{sessionId:'candidate',messageId:'target'}})
 await f.store.transaction(f.scope,state=>{
  const template=state.candidates[0]
  state.candidates.unshift(...Array.from({length:55},(_,i)=>({...template,id:randomUUID(),topic:'other-'+i,text:'Other candidate'})))
  state.mark()
 })
 const id=hash(JSON.stringify([f.scope.kind,f.scope.id,'memory','candidate','facts','choice']))
 const result=await inspectEvolutionItem(f.memory,f.reflection,f.binding,{id,revision:'1'})
 assert.equal(result.name,'facts/choice');assert.equal(result.current.text,'Candidate target')
})
