import test from 'node:test'
import assert from 'node:assert/strict'
import * as search from '../src/native-tool-fs-search.js'
function stream(text,lossy=false){return{readFrom:()=>({text,lossy,nextOffset:Buffer.byteLength(text)})}}
function mock(handle){return{subprocess:{spawn(spec){this.spec=spec;return handle}},workingDirectory:{ensure:async()=>'/fixture cwd'}}}
const handle=()=>({done:Promise.resolve({exitCode:0,signal:null}),waitForExit:async()=>{},collected:{stdout:stream('full text'),stderr:stream('')}})
test('independent search preserves literal argv, no-config and UTF-8 resource boundaries',async()=>{
 const ctx=mock(handle()),signal=new AbortController().signal,argv=['--regexp=-arg;$(touch marker)','--','file with spaces']
 assert.equal((await search.runRipgrep(ctx,{agent:{id:'actor'},signal},'grep',argv,100,10,100)).stdout,'full text')
 assert.equal(ctx.subprocess.spec.argv[1],'--no-config');assert.deepEqual(ctx.subprocess.spec.argv.slice(2),argv);assert.equal(ctx.subprocess.spec.cwd,'/fixture cwd');assert.equal(ctx.subprocess.spec.signal,signal)
 for(const [max,expected]of [[3,'汉'],[10,'汉字😀'],[30,'汉字😀'.repeat(3)]])assert.equal(search.previewLine('汉字😀'.repeat(20),max),expected+' (line truncated)')
})
test('independent search rejects incomplete raw capture and malformed transport records',async()=>{
 const signal=new AbortController().signal,h=handle();h.collected.stdout=stream('partial',true)
 await assert.rejects(search.runRipgrep(mock(h),{signal},'grep',[],100,10,100),e=>e.code==='SEARCH_RAW_OUTPUT_OVERFLOW')
 for(const raw of ['not json','null',JSON.stringify({type:'match',data:{path:{text:'file'},line_number:0,lines:{text:'text'}}})])assert.throws(()=>search.parseGrepMatches(raw),e=>e.code==='SEARCH_FAILED')
 assert.deepEqual(search.parseGrepMatches(JSON.stringify({type:'match',data:{path:{text:'file'},line_number:1,lines:{bytes:'AA=='}}})),[{path:'file',lineNumber:1,line:'(line is not valid UTF-8)'}])
})
test('independent search cancellation waits for real range-drain completion, including done rejection',async()=>{
 for(const rejects of [false,true]){
  const done=Promise.withResolvers(),drain=Promise.withResolvers(),controller=new AbortController(),h={...handle(),done:done.promise,waitForExit:()=>drain.promise},ctx=mock(h);let settled=false
  const result=search.runRipgrep(ctx,{signal:controller.signal},'grep',[],100,10,100).finally(()=>{settled=true})
  const outcome=assert.rejects(result,e=>e.code==='SEARCH_ABORTED')
  await new Promise(resolve=>setImmediate(resolve));controller.abort();if(rejects)done.reject(Error('provider failed'));else done.resolve({exitCode:null,signal:'SIGTERM'})
  await new Promise(resolve=>setImmediate(resolve));assert.equal(settled,false);drain.resolve();await outcome
 }
 const c=new AbortController();c.abort();let starts=0;await assert.rejects(search.runRipgrep({subprocess:{spawn(){starts++}}},{signal:c.signal},'grep',[],100,10,100),e=>e.code==='SEARCH_ABORTED');assert.equal(starts,0)
})
test('search exit one is no-match only with complete empty diagnostics and no termination signal',async()=>{
 const signal=new AbortController().signal,clean=handle();clean.done=Promise.resolve({exitCode:1,signal:null});clean.collected.stdout=stream('')
 assert.equal((await search.runRipgrep(mock(clean),{signal},'grep',[],100,10,64)).noMatches,true)
 for(const diagnostic of ['bwrap: setting up uid map: Read-only file system\n','unrelated isolation/runner failure /private/fixture token=FIXTURE_SECRET',' ']){
  const failed=handle();failed.done=Promise.resolve({exitCode:1,signal:null});failed.collected.stderr=stream(diagnostic);const ctx=mock(failed)
  await assert.rejects(search.runRipgrep(ctx,{signal},'grep',[],100,10,64),e=>{assert.equal(e.code,'SEARCH_FAILED');assert.equal(e.message,'Search process reported diagnostics instead of a clean no-match result');assert.doesNotMatch(e.message,/FIXTURE_SECRET|\/private\/fixture/);return true})
  assert.equal(ctx.subprocess.spec.stdio.stderr.maxBytes,64)
 }
 const lost=handle();lost.done=Promise.resolve({exitCode:1,signal:null});lost.collected.stderr=stream('',true)
 await assert.rejects(search.runRipgrep(mock(lost),{signal},'grep',[],100,10,64),e=>e.code==='SEARCH_FAILED')
 const terminated=handle();terminated.done=Promise.resolve({exitCode:1,signal:'SIGTERM'})
 await assert.rejects(search.runRipgrep(mock(terminated),{signal},'grep',[],100,10,64),e=>e.code==='SEARCH_FAILED')
})
