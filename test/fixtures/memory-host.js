import {tmpdir} from 'node:os'
import {createServer} from 'node:http'
import {mkdtemp,rm} from 'node:fs/promises'
import {join} from 'node:path'
import {createHost} from '../../src/host.js'
import {randomUUID} from 'node:crypto'
export async function memoryHost(t,decide=()=>undefined,{background=false,portable=true,dingtalkProfileRunner,hostConfig={},inheritedEnvironment={}}={}){
  const root=await mkdtemp(join(tmpdir(),'night-memory-wire-')),requests=[],errors=[];let host
  const server=createServer(async(req,res)=>{
    req.setEncoding('utf8')
    let raw='';for await(const chunk of req)raw+=chunk
    const body=JSON.parse(raw);requests.push(body);const decision=await decide(body)
    if(decision?.error){res.writeHead(400,{'content-type':'application/json'});res.end(JSON.stringify({error:{message:decision.error,type:'invalid_request_error'}}));return}
    res.writeHead(200,{'content-type':'text/event-stream'})
    const chunk=(delta,finish_reason=null)=>res.write('data: '+JSON.stringify({id:'memory-fixture',object:'chat.completion.chunk',created:1,model:body.model,choices:[{index:0,delta,finish_reason}]})+'\n\n')
    if(decision?.tool){chunk({role:'assistant',tool_calls:[{index:0,id:'call-'+requests.length,type:'function',function:{name:decision.tool,arguments:JSON.stringify(decision.args)}}]});if(decision.beforeFinish)await decision.beforeFinish();chunk({},'tool_calls')}
    else{chunk({role:'assistant',content:decision?.text??'verified'});chunk({},'stop')}
    res.end('data: [DONE]\n\n')
  })
  await new Promise(r=>server.listen(0,'127.0.0.1',r))
  // Containment/memory fixtures intentionally select ask, independently of the
  // product's full-access default. Tests may explicitly override this selection.
  const config={...(portable?{installRoot:root,dataDir:'data'}:{stateDir:join(root,'nonportable-state'),workspaceDir:join(root,'data','workspaces')}),permissionMode:'ask',model:{provider:'fixture',model:'m'},providers:{fixture:{api:'openai-completions',baseURL:`http://127.0.0.1:${server.address().port}/v1`,apiKeyEnv:'MEMORY_FIXTURE_KEY',models:[{id:'m',input:['text'],contextWindow:32000,maxTokens:1024}]}},memory:{background},skillWatch:false,credentialsWatch:false}
  Object.assign(config,typeof hostConfig==='function'?hostConfig(config):hostConfig)
  const boot=async()=>{host=await createHost(config,{dingtalkProfileRunner,environmentOptions:{...portable?{}:{cwd:root,home:root},inherited:{...inheritedEnvironment,MEMORY_FIXTURE_KEY:'local-fixture'}}});host.ctx.on('agent/error',e=>errors.push(e.error));return host}
  const close=async()=>{await host?.close();host=undefined}
  t.after(async()=>{try{await close()}finally{await new Promise(r=>server.close(r));await rm(root,{recursive:true,force:true})}})
  await boot()
  return {root,config,requests,errors,get host(){return host},boot,close,
    async agent(id,binding){const handle=await host.ctx.agents.create({sessionId:id,meta:{cwd:join(root,'data','workspaces'),agentPreset:'night-bot'},agentOptions:config.model,authorizeInput:packet=>packet.source.kind==='user',setup:async ctx=>{await host.ctx.agentPresets.mount(ctx,'night-bot')}});if(binding)await host.ctx.memory.bindSession(id,binding);return handle},
    async say(agent,text){const message={id:randomUUID(),source:{kind:'user'},content:[{type:'text',text}]};await agent.input.enqueue(message);await agent.input.deliver(message.id,{deliverAs:'followUp'});await agent.whenIdle();await host.ctx.memory.whenIdle();return message},
  }
}

// 低层复盘夹具也须兑现 Host 的工作区创建事务，不能直接 claim pending 任务。
export async function initializeMemoryTaskWorkspace(store,workspaceRoot,taskId){
  const task=await store.query({kind:'task.get',taskId});if(!task.workspaceInitialization)return
  const {initializeTaskDirectories}=await import('../../packages/dingtalk-core/session-workspaces.js')
  const {creationCommandId,sessionId}=task.workspaceInitialization,binding={taskId,creationCommandId,sessionId}
  const begin=await store.command({id:creationCommandId+':workspace-begin',kind:'task.workspace.begin',args:binding})
  const observation=await initializeTaskDirectories(workspaceRoot,begin.result.task)
  await store.command({id:creationCommandId+':workspace-finish',kind:'task.workspace.finish',args:{...binding,state:'ready',observation:observation.native}})
}
