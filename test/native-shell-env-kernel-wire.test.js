import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,rm} from 'node:fs/promises'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {createServer} from 'node:http'
import {createHost} from '../src/host.js'
import {createUserMessage} from '@deepseek-ai/dsh-llm'
const quote=text=>"'"+text.replaceAll("'","'\\''")+"'"
test('actual Pi bash execution uses native trusted facts and strips ambient DSH authority',{timeout:20000,skip:process.platform!=='linux'},async t=>{
 const root=await mkdtemp(join(tmpdir(),'night-shell-facts-')),keys=['DSH_SESSION_ID','DSH_EXTRA','DSH_UNDECLARED'],saved=new Map(keys.map(k=>[k,process.env[k]])),requests=[],results=[];let host,handle
 for(const name of keys)process.env[name]='ambient-spoof-fixture'
 const script='const e=process.env;process.stdout.write(JSON.stringify({DSH_HOME:e.DSH_HOME,DSH_SHELL:e.DSH_SHELL,DSH_SESSION_ID:e.DSH_SESSION_ID,DSH_EXTRA:e.DSH_EXTRA,hasUndeclared:Object.hasOwn(e,"DSH_UNDECLARED")}))',command=quote(process.execPath)+' -e '+quote(script)
 const server=createServer(async(req,res)=>{for await(const _ of req){}requests.push(req.url);res.writeHead(200,{'content-type':'text/event-stream'});const chunk=(delta,finish_reason=null)=>res.write('data: '+JSON.stringify({id:'shell-facts-proof',object:'chat.completion.chunk',model:'m',choices:[{index:0,delta,finish_reason}]})+'\n\n');if(requests.length===1){chunk({role:'assistant',tool_calls:[{index:0,id:'trusted-shell-call',type:'function',function:{name:'bash',arguments:JSON.stringify({description:'Inspect the trusted shell environment snapshot',command})}}]});chunk({},'tool_calls')}else{chunk({role:'assistant',content:'trusted shell verified'});chunk({},'stop')}res.end('data: [DONE]\n\n')})
 t.after(async()=>{try{await handle?.dispose()}finally{try{await host?.close()}finally{try{await new Promise(r=>server.close(r));await rm(root,{recursive:true,force:true})}finally{for(const [name,value]of saved)if(value===undefined)delete process.env[name];else process.env[name]=value}}}})
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const work=join(root,'work'),home=join(root,'legacy-home')
 host=await createHost({stateDir:join(root,'state'),workspaceDir:work,model:{provider:'fixture',model:'m'},providers:{fixture:{api:'openai-completions',apiKeyEnv:'FIXTURE_SHELL_FACTS_KEY',baseURL:`http://127.0.0.1:${server.address().port}/v1`,retryPolicy:{mode:'normal',maxRetries:0},models:[{id:'m',contextWindow:8192,maxTokens:256}]}}},{environmentOptions:{cwd:root,home:root,inherited:{DSH_HOME:home,FIXTURE_SHELL_FACTS_KEY:'fixture'}}})
 assert.equal(host.ctx.get('shell').constructor.name,'NativeSandboxBashExecutor');
 host.ctx.on('tools/result',(exec,result)=>{if(exec.name==='bash')results.push(result)})
 handle=await host.ctx.agents.create({sessionId:'shell-env-wire',agentOptions:{provider:'fixture',model:'m'},meta:{cwd:work},setup:async ctx=>{await host.ctx.agentPresets.mount(ctx,'night-bot')}})
 const registry=host.ctx.agentPresets.serviceFor(handle.agent,'shellEnv');assert.equal(registry.constructor.name,'NativeShellEnvironment');registry.register({name:'fixture-shell-fact',variables:{DSH_EXTRA:{description:'Current execution identity'}},resolve:exec=>({DSH_EXTRA:'verified_'+exec.agent.id})})
 handle.agent.steer(createUserMessage({source:{kind:'user'},content:[{type:'text',text:'Inspect the trusted shell facts'}]}));await handle.agent.whenIdle();assert.equal(results.length,1);assert.equal(results[0].isError,false,JSON.stringify(results[0]));assert.equal(results[0].value.exitCode,0,JSON.stringify(results[0]));assert.deepEqual(JSON.parse(results[0].value.stdout.text),{DSH_HOME:home,DSH_SHELL:'1',DSH_SESSION_ID:'shell-env-wire',DSH_EXTRA:'verified_shell-env-wire',hasUndeclared:false});assert.equal(requests.length,2);assert.equal(handle.agent.providerStreamProtocol,'pi-native');assert.equal(handle.agent.session.snapshotEvents().findLast(e=>e.type==='turn/end').data.reason.kind,'completed')
})
