import {symlink} from './fixtures/filesystem-link.js'
import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdir,writeFile} from 'node:fs/promises'
import {join} from 'node:path'
import {memoryHost} from './fixtures/memory-host.js'
import {enumerateSearchFiles,isNativeSearchObservationalTool} from '../src/native-tool-fs-search.js'
async function fixture(t){
 const f=await memoryHost(t),paths=f.host.ctx.runtimePaths,own=join(paths.workspaces,'tasks','search-own'),foreign=join(paths.workspaces,'tasks','search-other')
 for(const root of [own,foreign])for(const name of ['work','tmp','sessions'])await mkdir(join(root,name),{recursive:true})
 const handle=await f.host.ctx.agents.create({sessionId:'search-actual-scope',meta:{cwd:own},agentOptions:{provider:'fixture',model:'m'},setup:async ctx=>ctx.get('agentPresets').mount(ctx,'night-bot')});t.after(()=>handle.dispose())
 const actor=handle.actor,launched=[],original=f.host.ctx.subprocess.spawn
 f.host.ctx.subprocess.spawn=function(spec){launched.push(spec);return original.call(this,spec)}
 let count=0
 async function run(name,args){const callId='search-safety-'+ ++count;actor.piSession.sessionManager.appendMessage({role:'assistant',content:[{type:'toolCall',id:callId,name,arguments:args}],api:'openai-completions',provider:'fixture',model:'m',stopReason:'toolUse',timestamp:1,usage:{input:0,output:0,cacheRead:0,cacheWrite:0,totalTokens:0,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}}});return f.host.ctx.agents.withInitiator(actor,()=>actor.ctx.get('tools').execute({agent:actor,name,arguments:args,callId,businessAudit:actor.audit,signal:new AbortController().signal}))}
 return{...f,own,foreign,paths,actor,run,launched}
}
test('full-access find and grep enumerate the supplied root without following directory symlinks',{skip:process.platform!=='linux'?'Requires Linux portable model-process privacy namespace; Windows remains fail-closed':false},async t=>{
 const f=await fixture(t),own=join(f.own,'work','public.txt'),secret=join(f.foreign,'work','foreign.txt'),state=join(f.paths.state,'search-private.txt')
 await writeFile(own,'PUBLIC_SEARCH_MARKER');await writeFile(secret,'FORBIDDEN_SEARCH_MARKER');await writeFile(state,'FORBIDDEN_SEARCH_MARKER');await writeFile(join(f.own,'sessions','private.txt'),'FORBIDDEN_SEARCH_MARKER')
 await symlink(join(f.foreign,'work'),join(f.own,'work','foreign-link'));await symlink(f.paths.state,join(f.own,'work','state-link'))
 assert.equal(f.actor.ctx.get('tools').get('glob',f.actor),undefined);const definition=f.actor.ctx.get('tools').get('find',f.actor);assert.ok(definition.parameters.properties.limit)
 for(const name of ['find','grep']){
  const result=await f.run(name,{pattern:name==='find'?'**/*.txt':'SEARCH_MARKER',path:'.'});assert.equal(result.isError,false,JSON.stringify(result));assert.match(JSON.stringify(result),/public.txt/);assert.doesNotMatch(JSON.stringify(result),/foreign.txt|state-link|foreign-link/)
 }
 assert.equal(f.launched.length,1,'only grep starts a bounded search process')
 for(const spec of f.launched){assert.equal(spec.argv[1],'--no-config');const files=spec.argv.slice(spec.argv.indexOf('--')+1);assert.ok(files.length);assert.deepEqual(files.sort(),[own,join(f.own,'sessions','private.txt')].sort());assert.equal(spec.cwd,f.own)}
 for(const path of [secret,state,join(f.own,'sessions')]){
  const result=await f.run('grep',{pattern:'FORBIDDEN',path});assert.equal(result.isError,false,JSON.stringify(result));assert.match(result.value.text,/FORBIDDEN_SEARCH_MARKER/)
 }
 assert.equal(f.requests.length,0)
})
test('safe search enumeration fails closed at entry/depth budgets before spawning',async t=>{
 const f=await fixture(t),nested=join(f.own,'work','one','two');await mkdir(nested,{recursive:true});await writeFile(join(nested,'file.txt'),'text')
 const fs=f.actor.ctx.get('fs'),caps={maxEntries:1,maxDepth:64,rawOutputMaxBytes:10000},signal=new AbortController().signal
 await assert.rejects(f.host.ctx.agents.withInitiator(f.actor,()=>enumerateSearchFiles(fs,'.',f.own,signal,caps)),e=>e.code==='SEARCH_ENUMERATION_LIMIT')
 await assert.rejects(f.host.ctx.agents.withInitiator(f.actor,()=>enumerateSearchFiles(fs,'.',f.own,signal,{...caps,maxEntries:100,maxDepth:1})),e=>e.code==='SEARCH_ENUMERATION_LIMIT')
 assert.equal(f.launched.length,0)
})
test('actual packaged search starts producing matches, then cancellation joins its real process range', {skip:process.platform!=='linux'?'Requires Linux portable model-process privacy namespace; Windows remains fail-closed':false,timeout:15000},async t=>{
 const f=await fixture(t),{open}=await import('node:fs/promises'),{runRipgrep}=await import('../src/native-tool-fs-search.js'),path=join(f.own,'work','cancel.txt'),file=await open(path,'w')
 try{const chunk='CANCEL_SEARCH_MARKER text line\n'.repeat(32768);for(let n=0;n<16;n++)await file.writeFile(chunk)}finally{await file.close()}
 const c=new AbortController(),started=Promise.withResolvers(),spawn=f.host.ctx.subprocess.spawn;let actual,drained=false,finished=false;t.after(()=>c.abort())
 f.host.ctx.subprocess.spawn=function(spec){actual=spawn.call(this,spec);started.resolve();actual.done.finally(()=>{finished=true}).catch(()=>{});return {done:actual.done,collected:actual.collected,waitForExit:async()=>{await actual.waitForExit();drained=true}}}
 const pending=f.host.ctx.agents.withInitiator(f.actor,()=>runRipgrep(f.host.ctx,{agent:f.actor,signal:c.signal},'grep',['--json','--regexp=CANCEL_SEARCH_MARKER','--',path],20_000_000,100,65536,f.own))
 const rejection=assert.rejects(pending,e=>e.code==='SEARCH_ABORTED');await started.promise
 const until=Date.now()+7000
 while(!actual.collected.stdout.readFrom(0).text.includes('CANCEL_SEARCH_MARKER')){if(Date.now()>until)throw Error('real rg never emitted its marker');await new Promise(resolve=>setTimeout(resolve,1))}
 assert.equal(finished,false,'cancel occurs while the actual search process is still running');c.abort();await rejection;assert.equal(drained,true);await actual.waitForExit()
})
test('native find matches authorized hidden and nested files without a process or a transferable marker',async t=>{
 const f=await fixture(t)
 for(const name of ['work/nested/deep','work/.hidden'])await mkdir(join(f.own,name),{recursive:true})
 for(const name of ['work/public.txt','work/.dot.txt','work/nested/deep/public.txt','work/.hidden/proof.txt'])await writeFile(join(f.own,name),'PUBLIC_SEARCH_MARKER')
 await writeFile(join(f.foreign,'work/foreign.txt'),'FORBIDDEN_SEARCH_MARKER')
 await symlink(join(f.foreign,'work'),join(f.own,'work/foreign-link'),'dir')
 for(const [pattern,expected]of [['public.txt',/nested[\\/]deep[\\/]public.txt/],['**/*.txt',/\.hidden[\\/]proof.txt/],['work/.dot.txt',/\.dot.txt/]]){
  const result=await f.run('find',{pattern,path:'.'});assert.equal(result.isError,false,JSON.stringify(result));assert.match(JSON.stringify(result),expected);assert.doesNotMatch(JSON.stringify(result),/foreign.txt|sessions[\\/]/)
 }
 const missing=await f.run('find',{pattern:'missing.txt',path:'work'});assert.equal(missing.isError,false);assert.match(JSON.stringify(missing),/No files found/)
 const incomplete=await f.run('find',{pattern:'missing.txt',path:'.'});assert.equal(incomplete.isError,false);assert.match(JSON.stringify(incomplete),/No files found/)
 const definition=f.actor.ctx.get('tools').get('find',f.actor)
 assert.equal(isNativeSearchObservationalTool(definition,f.actor),true)
 assert.equal(isNativeSearchObservationalTool({...definition},f.actor),false)
 assert.equal(isNativeSearchObservationalTool(definition,{id:f.actor.id}),false)
 assert.equal(f.launched.length,0);assert.equal(f.requests.length,0)
})
test('find probes a fixed authorized path without walking unrelated entries',async t=>{
 const f=await fixture(t),root=join(f.own,'work')
 await mkdir(join(root,'noise'));await mkdir(join(root,'fixed','nested'),{recursive:true})
 await Promise.all(Array.from({length:280},(_,i)=>writeFile(join(root,'noise','other-'+i+'.txt'),'irrelevant')))
 await writeFile(join(root,'fixed','nested','proof.txt'),'proof')
 await symlink(join(f.foreign,'work'),join(root,'alias'),'dir')
 await writeFile(join(f.foreign,'work','hidden.txt'),'private')
 for(const pattern of ['fixed/nested/proof.txt','./fixed/nested/proof.txt','fixed/nested/*.txt']){
  const result=await f.run('find',{path:'work',pattern})
  assert.equal(result.isError,false,JSON.stringify(result))
  assert.match(JSON.stringify(result),/fixed\/nested\/proof.txt/)
  assert.doesNotMatch(JSON.stringify(result),/Search incomplete|cursor=/)
 }
 const forbidden=await f.run('find',{path:'work',pattern:'alias/hidden.txt'})
 assert.equal(forbidden.isError,false,JSON.stringify(forbidden));assert.match(JSON.stringify(forbidden),/symbolic link paths were not checked/);assert.doesNotMatch(JSON.stringify(forbidden),/hidden.txt/)
 const suffix=await f.run('find',{path:'work',pattern:'**/fixed/nested/proof.txt',limit:1})
 assert.equal(suffix.isError,false,JSON.stringify(suffix));assert.match(JSON.stringify(suffix),/fixed\/nested\/proof.txt.*cursor=/)
 assert.equal(f.launched.length,0)
})
test('find reports partial coverage and resumes a large directory without duplicate matches',async t=>{
 const f=await fixture(t),root=join(f.own,'work','large')
 await mkdir(root)
 await Promise.all(Array.from({length:275},(_,i)=>writeFile(join(root,'other-'+i+'.out'),'irrelevant')))
 for(let i=0;i<3;i++)await writeFile(join(root,'match-'+i+'.txt'),'proof')
 const args={path:'work/large',pattern:'*.txt',limit:1},found=[],seen=new Set()
 let cursor
 for(let page=0;page<8;page++){
  const result=await f.run('find',{...args,...cursor?{cursor}:{}})
  const text=JSON.stringify(result)
  assert.equal(result.isError,false,text)
  if(text.includes('Search incomplete'))assert.doesNotMatch(text,/No files found matching pattern/)
  found.push(...new Set(text.match(/match-\d\.txt/g)??[]))
  const next=/cursor=([\da-f-]{36})/.exec(text)?.[1]
  if(!next){assert.doesNotMatch(text,/Search incomplete/);break}
  assert.match(text,/Search incomplete.*pending/)
  assert.ok(!seen.has(next));seen.add(next);cursor=next
  if(page===0){
   const invalid=await f.run('find',{...args,pattern:'*.out',cursor})
   assert.equal(invalid.isError,true);assert.match(JSON.stringify(invalid),/SEARCH_CURSOR_INVALID/)
  }
 }
 assert.ok(seen.size>=3)
 assert.deepEqual(found.sort(),['match-0.txt','match-1.txt','match-2.txt'])
 assert.equal(f.launched.length,0)
})
test('find cannot resume an open directory after the inspected scope changes',async t=>{
 const f=await fixture(t),root=join(f.own,'work')
 await writeFile(join(root,'first.txt'),'proof');await writeFile(join(root,'second.txt'),'proof')
 const args={path:'work',pattern:'*.txt',limit:1},initial=await f.run('find',args)
 const cursor=/cursor=([\da-f-]{36})/.exec(JSON.stringify(initial))?.[1];assert.ok(cursor)
 await writeFile(join(root,'changed.txt'),'proof')
 const result=await f.run('find',{...args,cursor})
 assert.equal(result.isError,true,JSON.stringify(result));assert.match(JSON.stringify(result),/SEARCH_STALE_PATH/)
 const reused=await f.run('find',{...args,cursor})
 assert.equal(reused.isError,true);assert.match(JSON.stringify(reused),/SEARCH_CURSOR_INVALID/)
})
test('find returns every long UTF-8 path once across Pi output pages',async t=>{
 const f=await fixture(t),root=join(f.own,'work','测'.repeat(64),'试'.repeat(64),'长'.repeat(64))
 const expected=Array.from({length:100},(_,i)=>'long-'+String(i).padStart(3,'0')+'.txt')
 await mkdir(root,{recursive:true})
 await Promise.all(expected.map(name=>writeFile(join(root,name),'fixture')))
 const args={path:'work',pattern:'**/long-*.txt',limit:100},seen=[]
 let cursor,pages=0
 do{
  const result=await f.run('find',{...args,...cursor?{cursor}:{}})
  assert.equal(result.isError,false,JSON.stringify(result))
  const text=result.content[0].text
  assert.doesNotMatch(text,/KB limit reached/)
  seen.push(...(text.match(/long-\d{3}\.txt/g)??[]))
  cursor=/cursor=([\da-f-]{36})/.exec(text)?.[1]
  assert.ok(++pages<=4,'search should finish in a few pages')
 }while(cursor)
 assert.ok(pages>1)
 assert.deepEqual(seen.sort(),expected)
})
test('operator full grep executes real packaged search across workspace external roots and every argv batch',async t=>{
 const f=await fixture(t),external=join(f.root,'external-business')
 await mkdir(external);await writeFile(join(f.own,'work','full-own.txt'),'FULL_GREP_OWN_PHYSICAL\n');await writeFile(join(external,'full-external.txt'),'FULL_GREP_EXTERNAL_PHYSICAL\n')
 await mkdir(join(f.root,'data','config'),{recursive:true});await writeFile(join(f.root,'data','config','config.json'),JSON.stringify(f.config,null,2)+String.fromCharCode(10))
 const safe=value=>JSON.stringify(value).split(JSON.stringify(f.root).slice(1,-1)).join('<fixture>')
 const search=async(stage,pattern,path)=>{
  const before=f.launched.length,result=await f.run('grep',{pattern,path})
  t.diagnostic(safe({case:'full-native-grep',stage,spawnRequests:f.launched.length-before,isError:result.isError,...result.isError?{code:result.error.info?.code,message:result.error.message}:{summary:result.value.text.split('\n',1)[0]}}))
  assert.equal(result.isError,false,safe(result));return result.value.text
 }
 const own=await search('workspace','FULL_GREP_OWN','work')
 assert.match(own,/^Found 1 matches\n/);assert.match(own,/full-own\.txt:1: FULL_GREP_OWN_PHYSICAL/)
 const outside=await search('external','FULL_GREP_EXTERNAL',external)
 assert.match(outside,/^Found 1 matches\n/);assert.match(outside,/full-external\.txt:1: FULL_GREP_EXTERNAL_PHYSICAL/)
 const beforeMissing=f.launched.length
 assert.equal(await search('no-match','FULL_GREP_ABSENT',external),'No matches found');assert.equal(f.launched.length,beforeMissing+1)
 const directory=join(external,'batches'),files=[];await mkdir(directory)
 let pathBytes=0
 while(pathBytes<=16000){
  const file=join(directory,'batch-'+String(files.length).padStart(3,'0')+'-'+'x'.repeat(96)+'.txt')
  await writeFile(file,'FULL_GREP_BATCH_'+files.length+'\n');files.push(file);pathBytes+=Buffer.byteLength(file)+1
 }
 const beforeBatches=f.launched.length,text=await search('multiple-batches','FULL_GREP_BATCH_',directory),batches=f.launched.slice(beforeBatches)
 assert.ok(pathBytes>16000);assert.ok(batches.length>=2,'The real filename byte total must launch multiple rg processes')
 const dispatched=[]
 for(const spec of batches){
  assert.equal(spec.argv[1],'--no-config');assert.equal(spec.cwd,f.own);const separator=spec.argv.indexOf('--');assert.ok(separator>1)
  const paths=spec.argv.slice(separator+1);assert.ok(paths.length);assert.ok(paths.reduce((sum,path)=>sum+Buffer.byteLength(path)+1,0)<=16000);dispatched.push(...paths)
 }
 assert.deepEqual(dispatched.sort(),[...files].sort())
 const found=[...text.matchAll(/:1: FULL_GREP_BATCH_(\d+)(?:\n|$)/g)].map(match=>Number(match[1])).sort((a,b)=>a-b)
 assert.deepEqual(found,files.map((_,index)=>index));assert.match(text,new RegExp('^Found '+files.length+' matches\n'))
 t.diagnostic(JSON.stringify({case:'full-native-grep-batches',pathBytes,fileCount:files.length,rgBatches:batches.length,physicalMatches:found.length}))
 assert.equal(f.requests.length,0)
})
