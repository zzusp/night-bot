import {createServer} from 'node:http'
import {mkdir,readFile,writeFile} from 'node:fs/promises'
import {join} from 'node:path'
import {createHash} from 'node:crypto'
import {memoryHost} from './memory-host.js'
import {openResidentStore} from '../../packages/dingtalk-core/store.js'
import {openTaskSessionService} from '../../packages/dingtalk-core/task-session-service.js'
import {openDynamicTaskStore} from '../../packages/dingtalk-core/dynamic-task-store.js'
import {handleRequest} from '../../packages/dingtalk-core/http.js'
import {createEffectOperatorAuth,readEffectOperatorToken} from '../../src/tasks/effect-operator-auth.js'
export const hash=bytes=>createHash('sha256').update(bytes).digest('hex')
export async function until(fn){for(let n=0;n<800;n++){const value=await fn();if(value)return value;await new Promise(r=>setTimeout(r,10))}throw Error('official restart evidence timeout')}
const quote=value=>"'"+value.replaceAll("'","'\\''")+"'"
export async function restartDrainHost(t,{processGate=false}={}){
 let effects=0,commands=0,service,store,resident,server,port,token,terminal
 const entered=Promise.withResolvers(),release=Promise.withResolvers()
 t.after(close)
 const f=await memoryHost(t,body=>body.tools?.some(tool=>tool.function.name==='uncertain_restart_effect')?{tool:'uncertain_restart_effect',args:{}}:undefined)
 function register(){const ctx=f.host.ctx;ctx.get('tools').register({name:'uncertain_restart_effect',description:'Fixture isolated local effect with lost acknowledgement',parameters:{type:'object',properties:{},additionalProperties:false},output:{schema:{type:'object'},render:()=>[]},async execute(_args,exec){
  effects++;const file=join(exec.agent.metadata.cwd,'work/uncertain.txt')
  if(processGate){
   const script='require("node:fs").writeFileSync('+JSON.stringify(file)+',"one partial effect");process.on("SIGTERM",()=>{});process.stdout.write("OWNED_RANGE_READY");setInterval(()=>{},1000)'
   const policy=ctx.get('sandboxPolicy').resolve({actor:exec.agent}),shell=ctx.get('shell')
   terminal=await shell.execute(shell.resolve({command:quote(process.execPath)+' -e '+quote(script),workdir:exec.agent.metadata.cwd,sandboxPolicy:policy,signal:exec.signal,onExpiry:'none'}))
   await until(()=>terminal.observed.stdout.readFrom(0).text.includes('OWNED_RANGE_READY'))
   entered.resolve();await release.promise;terminal.kill();await terminal.done
  }else{await writeFile(file,'one partial effect');entered.resolve()}
  throw Error('fixture response lost after the local effect')
 }})}
 async function open(initialize){
  register();const ctx=f.host.ctx,config={...f.config.model,workspaceDir:ctx.runtimePaths.workspaces,dbPath:join(ctx.runtimePaths.state,'restart-drain.sqlite'),instanceId:'official-restart-drain',ownerActorId:'owner',webActorId:'operator',reasoningMode:'inherit'}
  resident=await openResidentStore(ctx.storageDomain);store=await openDynamicTaskStore({...config,initialize})
  service=await openTaskSessionService({ctx,config,store:{...store,command:value=>{commands++;return store.command(value)}},residentStore:resident,legacy:{getAgentConfig:()=>({...config,agentNames:[]}),getGroup:id=>resident.getGroup(id)},notifications:{async send(){throw Error('no external delivery')},async readback(){throw Error('no external readback')}}})
  const auth=await createEffectOperatorAuth(ctx.runtimePaths);token=await readEffectOperatorToken(ctx.runtimePaths)
  server=createServer((req,res)=>handleRequest(req,res,{inspectTaskEffect:service.inspectTaskEffect,reconcileTaskEffect:service.reconcileTaskEffect},{effectOperatorAuth:auth}).catch(error=>{res.writeHead(500,{'content-type':'application/json'});res.end(JSON.stringify({error:error.code??error.message}))}));await new Promise(r=>server.listen(0,'127.0.0.1',r));port=server.address().port
 }
 async function close(){release.resolve();await service?.close();await store?.close();await resident?.close();if(server){await new Promise(r=>server.close(r));server=undefined}}
 await open(true)
 return {f,entered,release,get ctx(){return f.host.ctx},get service(){return service},get effects(){return effects},get commands(){return commands},get terminal(){return terminal},get token(){return token},query:(kind,args={})=>store.query({kind,...args}),async create(){return service.createTask({requestId:'restart-unknown',objective:'Perform one authorized local effect and preserve unknown outcomes'})},async uncertain(task){await until(async()=>!!(await service.taskDialogue(task.taskId)).error);await service.whenIdle();return store.query({kind:'task.get',taskId:task.taskId})},async native(task){return f.host.ctx.sessionPersistence.readNative(task.sessionId??task.session.sessionId,{requireComplete:true})},async intent(task){const native=await this.native(task);return native.auditEntries.find(entry=>entry.data.domain==='task'&&entry.data.kind==='effect-intent')},async post(task,intent,action,body={},headers={authorization:'Bearer '+token}){const response=await fetch(`http://127.0.0.1:${port}/tasks/${task.taskId}/effects/${intent.entryId}/${action}`,{method:'POST',headers:{'content-type':'application/json',...headers},body:JSON.stringify(body)});return {status:response.status,body:await response.json()}},async evidence(inspection){
  const doc={version:1,kind:'task-effect-readback',...Object.fromEntries(['taskId','sessionId','intentEntryId','intentDigest','callEntryId','argumentsDigest','originBinding','currentBinding','scopeDigest'].map(key=>[key,inspection[key]])),observedAt:new Date().toISOString(),summary:'Operator read back local bytes; partial effects remain unknown.',outcome:'partial-or-unknown',noReplay:true},bytes=Buffer.from(JSON.stringify(doc)),sha256=hash(bytes),path='materials/runtime-evidence/effects/'+sha256+'.json'
  await mkdir(join(inspection.scope.taskRoot,'materials/runtime-evidence/effects'),{recursive:true});await writeFile(join(inspection.scope.taskRoot,path),bytes)
  return {bytes,path,absolute:join(inspection.scope.taskRoot,path),proposal:{...Object.fromEntries(['taskId','intentEntryId','intentDigest','currentBinding','journalRevision','scopeDigest'].map(key=>[key,inspection[key]])),requestId:'operator-restart-close',evidenceRefs:[{path,sha256}],outcome:'closed-with-possible-partial-effects',noReplay:true,operatorText:'Read back the local effect and close it without authorizing replay.'}}
 },async cold(){await close();await f.close();await f.boot();await open(false)}}
}
