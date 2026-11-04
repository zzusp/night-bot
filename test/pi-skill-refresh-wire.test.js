import test from 'node:test'
import assert from 'node:assert/strict'
import {createServer} from 'node:http'
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createHost} from '../src/host.js'
import {createUserMessage} from '@deepseek-ai/dsh-llm'
import {installSessionSkillRefresh} from '../packages/dingtalk-core/session-skill-refresh.js'
const sleep=ms=>new Promise(r=>setTimeout(r,ms))
test('external body-only skill edits notify the next real Pi request and require an explicit reread', {timeout:15000},async t=>{
 const root=await mkdtemp(join(tmpdir(),'night-skill-refresh-wire-')),work=join(root,'work'),dir=join(work,'skills'),file=join(dir,'fixture.md'),requests=[];let host,handle,serverFailure
 const doc=body=>'---\nname: fixture\ndescription: Stable description\n---\n'+body+'\n'
 await mkdir(dir,{recursive:true});await writeFile(file,doc('ORIGINAL_TRUSTED_BODY'))
 const server=createServer(async(req,res)=>{try{let body='';for await(const chunk of req)body+=chunk;const request=JSON.parse(body);requests.push(request);const index=requests.length,rendered=JSON.stringify(request)
  if(index===2){assert.ok(rendered.includes('ORIGINAL_TRUSTED_BODY'));const before=host.ctx.skills.revision;await writeFile(file,doc('UPDATED_TRUSTED_BODY'));for(let i=0;i<150&&host.ctx.skills.revision===before;i++)await sleep(10);assert.ok(host.ctx.skills.revision>before,'OS watcher must invalidate a body-only change')}
  if(index===3){assert.ok(rendered.includes('本会话已读技能或引用有变化'));assert.ok(!rendered.includes('UPDATED_TRUSTED_BODY'),'change notice must not silently load the new instructions')}
  if(index===4)assert.ok(rendered.includes('UPDATED_TRUSTED_BODY'))
  const name=index===2?'checkpoint':'skill',args=index===2?{}:{name:'fixture'},delta=index<4?{role:'assistant',tool_calls:[{index:0,id:'skill-wire-'+index,type:'function',function:{name,arguments:JSON.stringify(args)}}]}:{role:'assistant',content:'verified'}
  res.writeHead(200,{'content-type':'text/event-stream'});for(const [change,finish_reason]of [[delta,null],[{},index<4?'tool_calls':'stop']])res.write('data: '+JSON.stringify({id:'skill-refresh-wire',object:'chat.completion.chunk',model:'m',choices:[{index:0,delta:change,finish_reason}]})+'\n\n');res.end('data: [DONE]\n\n')
 }catch(e){serverFailure=e;res.writeHead(500,{'content-type':'application/json'});res.end(JSON.stringify({error:{message:'fixture assertion failed'}}))}})
 t.after(async()=>{try{await handle?.dispose()}finally{try{await host?.close()}finally{await new Promise(r=>server.close(r));await rm(root,{recursive:true,force:true})}}})
 await new Promise(r=>server.listen(0,'127.0.0.1',r))
 host=await createHost({stateDir:join(root,'state'),workspaceDir:work,skillDirs:[dir],model:{provider:'fixture',model:'m'},providers:{fixture:{api:'openai-completions',apiKeyEnv:'FIXTURE_SKILL_KEY',baseURL:`http://127.0.0.1:${server.address().port}/v1`,retryPolicy:{mode:'normal',maxRetries:0},models:[{id:'m',contextWindow:32000,maxTokens:512}]}}},{environmentSnapshot:{get(name){return name==='FIXTURE_SKILL_KEY'?{value:'fixture',source:'process'}:undefined},getFrom(name,sources){return sources.includes('process')?this.get(name):undefined}}})
 handle=await host.ctx.agents.create({sessionId:'skill-refresh-proof',agentOptions:{provider:'fixture',model:'m'},meta:{cwd:work},setup:async(ctx,agent)=>{await host.ctx.agentPresets.mount(ctx,'night-bot');ctx.tools.register({name:'checkpoint',description:'Read-only fixture checkpoint',parameters:{type:'object',properties:{}},output:{schema:{type:'object'},render:()=>[{type:'text',text:'checkpoint'}]},execute:async()=>({ok:true})});installSessionSkillRefresh(ctx,agent,{cwd:work,signal:new AbortController().signal})}})
 handle.agent.steer(createUserMessage({source:{kind:'user'},content:[{type:'text',text:'Load fixture, checkpoint, then follow the latest applicable instructions.'}]}));await handle.agent.whenIdle()
 assert.equal(serverFailure,undefined,serverFailure?.stack);assert.equal(requests.length,4);assert.equal(handle.agent.providerStreamProtocol,'pi-native');const events=handle.agent.session.snapshotEvents();assert.equal(events.filter(e=>e.type==='tool/call'&&e.data.name==='skill').length,2);assert.equal(events.filter(e=>e.type==='user/message'&&e.data.source?.kind==='dingtalk-skill-read').length,2)
})
