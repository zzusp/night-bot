import {createServer} from 'node:http'
import {mkdtemp,rm} from 'node:fs/promises'
import {join} from 'node:path'
import {createHost} from '../../src/host.js'
import {createUserMessage} from '../../src/native-message-protocol.js'
export async function memoryHost(t,decide=()=>undefined,{background=false}={}){
  const root=await mkdtemp('/tmp/night-memory-wire-'),requests=[],errors=[];let host
  const server=createServer(async(req,res)=>{
    let raw='';for await(const chunk of req)raw+=chunk
    const body=JSON.parse(raw);requests.push(body);const decision=await decide(body)
    res.writeHead(200,{'content-type':'text/event-stream'})
    const chunk=(delta,finish_reason=null)=>res.write('data: '+JSON.stringify({id:'memory-fixture',object:'chat.completion.chunk',created:1,model:'m',choices:[{index:0,delta,finish_reason}]})+'\n\n')
    if(decision?.tool){chunk({role:'assistant',tool_calls:[{index:0,id:'call-'+requests.length,type:'function',function:{name:decision.tool,arguments:JSON.stringify(decision.args)}}]});chunk({},'tool_calls')}
    else{chunk({role:'assistant',content:decision?.text??'verified'});chunk({},'stop')}
    res.end('data: [DONE]\n\n')
  })
  await new Promise(r=>server.listen(0,'127.0.0.1',r))
  const config={installRoot:root,dataDir:'data',model:{provider:'fixture',model:'m'},providers:{fixture:{api:'openai-completions',baseURL:`http://127.0.0.1:${server.address().port}/v1`,apiKeyEnv:'MEMORY_FIXTURE_KEY',models:[{id:'m',input:['text'],contextWindow:32000,maxTokens:1024}]}},memory:{background},skillWatch:false,credentialsWatch:false}
  const boot=async()=>{host=await createHost(config,{environmentOptions:{inherited:{MEMORY_FIXTURE_KEY:'local-fixture'}}});host.ctx.on('agent/error',e=>errors.push(e.error));return host}
  const close=async()=>{await host?.close();host=undefined}
  await boot()
  t.after(async()=>{try{await close()}finally{await new Promise(r=>server.close(r));await rm(root,{recursive:true,force:true})}})
  return {root,config,requests,errors,get host(){return host},boot,close,
    async agent(id,binding){const handle=await host.ctx.agents.create({sessionId:id,meta:{cwd:join(root,'data','workspaces'),agentPreset:'night-bot'},agentOptions:config.model,setup:async ctx=>{await host.ctx.agentPresets.mount(ctx,'night-bot')}});if(binding)await host.ctx.memory.bindSession(id,binding);return handle},
    async say(agent,text){const message=createUserMessage({source:{kind:'user'},content:[{type:'text',text}]});agent.followup(message);await agent.whenIdle();await host.ctx.memory.whenIdle();return message},
  }
}
