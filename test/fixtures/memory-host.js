import {tmpdir} from 'node:os'
import {createServer} from 'node:http'
import {mkdtemp,rm} from 'node:fs/promises'
import {join} from 'node:path'
import {createHost} from '../../src/host.js'
import {randomUUID} from 'node:crypto'
export async function memoryHost(t,decide=()=>undefined,{callIdPrefix='',background=false,portable=true,dingtalkProfileRunner,hostConfig={},inheritedEnvironment={},replyQuality=acceptScriptedReplyQuality,strictModelDecisions=false}={}){
  const root=await mkdtemp(join(tmpdir(),'night-memory-wire-')),requests=[],errors=[];let host
  const server=createServer(async(req,res)=>{
    req.setEncoding('utf8')
    let raw='';for await(const chunk of req)raw+=chunk
    const body=JSON.parse(raw);requests.push(body);const review=replyQualityRequest(body)
    let decision
    if(review)decision=await replyQuality(review,body)
    else{
      const selection=JSON.stringify(body.messages).includes('NIGHT_BOT_REFLECTION_SELECT')
      decision=scriptedAdmissionDecisions(body,selection?scriptedAdmissionSelection(body):await decide(body)??scriptedSkillGeneration(body))
    }
    // Normal legacy scripted models used bare settle for no further action.
    // Supply only the explicit new direct-source disposition; negative Host
    // contract cases opt out. No production result or scope is rewritten.
    if(!strictModelDecisions&&decision?.tool==='resident_router_settle'){
      const texts=body.messages.flatMap(message=>typeof message.content==='string'?[message.content]:(message.content??[]).filter(part=>part.type==='text').map(part=>part.text))
      const lines=texts.flatMap(text=>text.split('\n')).filter(text=>text.startsWith('Router 请求：'))
      const events=[...new Map(lines.flatMap(line=>JSON.parse(line.slice('Router 请求：'.length)).events).map(event=>[event.id,event])).values()]
      const provided=decision.args.noTaskDispositions??[]
      const direct=events.filter(event=>event.directRouter&&event.source&&decision.args.eventIds?.includes(event.id)&&!provided.some(item=>item.eventId===event.id))
      if(direct.length)decision={...decision,args:{...decision.args,noTaskDispositions:[...provided,...direct.map(event=>({eventId:event.id,outcome:'context-only',sourceQuote:event.source.text,reason:'Synthetic model explicitly finishes this background source without further action'}))]}}
    }
    if(decision?.error){res.writeHead(400,{'content-type':'application/json'});res.end(JSON.stringify({error:{message:decision.error,type:'invalid_request_error'}}));return}
    res.writeHead(200,{'content-type':'text/event-stream'})
    const chunk=(delta,finish_reason=null)=>res.write('data: '+JSON.stringify({id:'memory-fixture',object:'chat.completion.chunk',created:1,model:body.model,choices:[{index:0,delta,finish_reason}]})+'\n\n')
    if(decision?.tool){chunk({role:'assistant',tool_calls:[{index:0,id:callIdPrefix+'call-'+requests.length,type:'function',function:{name:decision.tool,arguments:JSON.stringify(decision.args)}}]});if(decision.beforeFinish)await decision.beforeFinish();chunk({},'tool_calls')}
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

export function replyQualityRequest(body){
  if(!body.messages.some(row=>row.role==='system'&&row.content.startsWith('NIGHT_BOT_REPLY_QUALITY_REVIEW')))return
  return JSON.parse(body.messages.find(row=>row.role==='user').content)
}
function acceptScriptedReplyQuality({candidates}){
  return {text:JSON.stringify({decisions:candidates.map(({index})=>({index,issues:[]}))})}
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

// 本地脚本模型仍须真正走 Pi 工具循环，不直接写受管技能状态。
export function scriptedSkillGeneration(body){
 if(!JSON.stringify(body.messages).includes('NIGHT_BOT_SKILL_GENERATION'))return
 if(!body.messages.some(message=>message.role==='tool'))return {tool:'skill',args:{name:'skill-creator'}}
 const content=body.messages.find(message=>message.role==='user').content
 const input=JSON.parse(typeof content==='string'?content:content.map(part=>part.text??'').join(''))
 return {text:JSON.stringify({description:input.candidate.applicability,body:input.candidate.guidance??input.candidate.steps.join(String.fromCharCode(10))})}
}


// Explicit scripted-model support for legacy test lesson fixtures. Production
// never supplies admission decisions or treats these fixture judgments as proof.
function scriptedAdmissionSelection(body){
 const input=JSON.parse(body.messages.findLast(m=>m.role==='user').content),catalog=input.catalog;
 const memoryIds=[...new Set(catalog.memories.map(e=>e.id))],skillKeys=[...new Set(catalog.skills.map(e=>e.key))];
 return {text:JSON.stringify({memoryIds,skillKeys,installedIds:[]})};
}
function scriptedAdmissionDecisions(body,decision){
 if(!decision?.text||!JSON.stringify(body.messages).includes('NIGHT_BOT_TASK_REFLECTION'))return decision;
 let value,input;try{value=JSON.parse(decision.text);input=JSON.parse(body.messages.findLast(m=>m.role==='user').content)}catch{return decision}
 if(!input.details||!Array.isArray(value.lessons))return decision;
 for(const lesson of value.lessons){
  const old=input.details.memories.find(e=>e.topic==='experience'&&e.key===lesson.key),prior=input.details.skills.find(e=>e.key===lesson.key);
  const judgment={category:'Evidence-first local changes',boundaries:'Only within the current objective and authorization; verify the original evidence',when:'When the evidenced local scenario recurs',changes:'Choose an evidence-backed action before writing',reason:'Fixture judgment based on supplied completion evidence'};
  lesson.memory??={action:old?(old.writable?'update':'skip'):'new',key:lesson.key,expectedRevision:old?.revision??0,...judgment};
  lesson.skillDecision??=lesson.skill?.evidenceBacked&&lesson.skill.applicability!=='Not established'?{action:prior?'update':'new',key:lesson.key,expectedRevision:prior?.revision??0,...judgment}:{action:'skip',reason:'No qualifying skill'};
 }
 return {...decision,text:JSON.stringify(value)};
}
