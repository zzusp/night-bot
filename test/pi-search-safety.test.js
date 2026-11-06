import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdir,writeFile,symlink} from 'node:fs/promises'
import {join} from 'node:path'
import {memoryHost} from './fixtures/memory-host.js'
import {enumerateSearchFiles} from '../src/native-tool-fs-search.js'
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
test('official find and safe grep authorize every file before dispatch; task, Host state and symlink escapes stay out of raw search',async t=>{
 const f=await fixture(t),own=join(f.own,'work','public.txt'),secret=join(f.foreign,'work','foreign.txt'),state=join(f.paths.state,'search-private.txt')
 await writeFile(own,'PUBLIC_SEARCH_MARKER');await writeFile(secret,'FORBIDDEN_SEARCH_MARKER');await writeFile(state,'FORBIDDEN_SEARCH_MARKER');await writeFile(join(f.own,'sessions','private.txt'),'FORBIDDEN_SEARCH_MARKER')
 await symlink(join(f.foreign,'work'),join(f.own,'work','foreign-link'));await symlink(f.paths.state,join(f.own,'work','state-link'))
 assert.equal(f.actor.ctx.get('tools').get('glob',f.actor),undefined);const definition=f.actor.ctx.get('tools').get('find',f.actor);assert.ok(definition.parameters.properties.limit)
 for(const name of ['find','grep']){
  const result=await f.run(name,{pattern:name==='find'?'**/*.txt':'SEARCH_MARKER',path:'.'});assert.equal(result.isError,false,JSON.stringify(result));assert.match(JSON.stringify(result),/public.txt/);assert.doesNotMatch(JSON.stringify(result),/FORBIDDEN_SEARCH_MARKER|foreign.txt/)
 }
 assert.ok(f.launched.length>=2)
 for(const spec of f.launched){assert.equal(spec.argv[1],'--no-config');const files=spec.argv.slice(spec.argv.indexOf('--')+1);assert.ok(files.length);assert.ok(files.every(path=>path===own));assert.equal(spec.cwd,f.own)}
 for(const path of [secret,state,join(f.own,'sessions'),join(f.own,'work','foreign-link')]){
  const before=f.launched.length,result=await f.run('grep',{pattern:'FORBIDDEN',path});assert.equal(result.isError,true,JSON.stringify(result));assert.equal(f.launched.length,before,'denied roots never start a search process')
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
test('actual packaged search starts producing matches, then cancellation joins its real process range', {timeout:15000},async t=>{
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
