import {createHash} from 'node:crypto'
import {resolve,basename} from 'node:path'
import {realpathSync,existsSync} from 'node:fs'
import {officialWorkingDirectoryOrigin} from './native-working-directory.js'
import {inside} from './runtime/paths.js'
import {isNativeSearchObservationalTool} from './native-tool-fs-search.js'

const fail=code=>Object.assign(new Error(code),{code,status:409})
const stable=value=>Array.isArray(value)?value.map(stable):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,stable(value[key])])):value
const digest=value=>createHash('sha256').update(JSON.stringify(stable(value))).digest('hex')
const canonical=path=>{let root=resolve(path),tail=[];while(!existsSync(root)){const parent=resolve(root,'..');if(parent===root)break;tail.unshift(basename(root));root=parent}return resolve(realpathSync(root),...tail)}
const fileTools=['read','read_window','read_image','write','edit','ls','find','grep','working_directory']
const treeTools=['ls','find','grep']

// Full access uses OS-account permissions. Bind native access to the exact live call,
 // without creating persistent approval requests or waiting for human/model decisions.
export function openToolPermissions({ctx}){
 const records=new WeakMap(),lifetime=new AbortController()
 let closed=false
 const active=exec=>{
  const identity=ctx.tools.admissionIdentity(exec)??ctx.tools.executionIdentity(exec)
  if(closed||exec.signal.aborted||!identity||ctx.agents.get(exec.agent?.id)!==exec.agent||identity.owner!==exec.agent?.id||exec.agent.lifecycle?.signal?.aborted)throw fail('PERMISSION_CALL_INACTIVE')
  return identity
 }
 const current=actor=>{const exec=ctx.tools.currentPermissionExecution();if(!exec||exec.agent!==actor||ctx.agents.currentInitiator()!==actor)return;active(exec);return exec}
 const identity=exec=>({actorId:exec.agent.id,taskId:exec.agent.metadata?.taskId??null,conversationId:exec.agent.metadata?.conversationId??exec.agent.metadata?.groupId??null,callId:exec.callId,toolName:exec.name,parametersDigest:digest(exec.arguments)})
 const valid=(exec,record)=>{active(exec);if(record.identity!==JSON.stringify(identity(exec)))throw fail('PERMISSION_SCOPE_CHANGED');return record}
 const bind=(exec,scope)=>{
  active(exec);const value={...scope,cwd:canonical(scope.cwd)},old=records.get(exec)
  if(old){valid(exec,old);if(JSON.stringify(stable(old.scope))!==JSON.stringify(stable(value)))throw fail('PERMISSION_SCOPE_CHANGED');return old}
  const record={identity:JSON.stringify(identity(exec)),scope:value,used:false};records.set(exec,record);return record
 }
 const fileScope=(exec,path,writing,lookup=false)=>{
  const actor=exec.agent,cwd=canonical(actor.ctx.get('workingDirectory').get(actor)),target=canonical(path),tree=treeTools.includes(exec.name)
  const directory=exec.name==='working_directory'
  if(directory&&writing){if(lookup)return;throw fail('PERMISSION_FILE_TOOL_REQUIRED')}
  const root=canonical(resolve(cwd,directory?exec.arguments.cd??'.':exec.arguments.path??'.'))
  if(tree?!inside(root,target):root!==target){if(lookup)return;throw fail('PERMISSION_FILE_ARGUMENT_CHANGED')}
  const old=records.get(exec),operation=!writing&&old?.scope.kind==='file'&&old.scope.operation==='write'?'write':writing?'write':'read'
  return{kind:'file',operation,cwd,path:root,tree}
 }
 // 从冻结参数重建范围；检查和实际 spawn 消费复用同一 record，不发行第二种 token。
 const processScope=exec=>{
  const actor=exec.agent,base=canonical(actor.ctx.get('workingDirectory').get(actor)),cwd=canonical(resolve(base,exec.arguments.workdir??'.'))
  return{kind:'process',operation:'execute',cwd}
 }
 const processRecord=actor=>{
  const exec=current(actor);if(!exec)return
  // full搜索复用已绑定的只读文件授权；同一调用可按文件表分批启动受控rg。
  if(exec.name==='grep'&&isNativeSearchObservationalTool(ctx.tools.get(exec.name,actor),actor)){
   const record=records.get(exec)
   if(!record||record.scope.kind!=='file'||record.scope.operation!=='read')return
   valid(exec,record)
   if(JSON.stringify(stable(record.scope))!==JSON.stringify(stable(fileScope(exec,record.scope.path,false))))throw fail('PERMISSION_SCOPE_CHANGED')
   return{record,projection:{kind:'direct',cwd:record.scope.cwd}}
  }
  if(!['bash','pwsh'].includes(exec.name))return
  let record=records.get(exec)
  if(!record)record=bind(exec,processScope(exec))
  if(!record||record.scope.kind!=='process')return
  valid(exec,record)
  if(JSON.stringify(stable(record.scope))!==JSON.stringify(stable(processScope(exec))))throw fail('PERMISSION_PROCESS_SCOPE_CHANGED')
  if(record.used)throw fail('PERMISSION_PROCESS_ALREADY_CONSUMED')
  return{record,projection:{kind:'direct',cwd:record.scope.cwd}}
 }
 const api={
  mode:'full',
  async authorizeFile({actor,path,writing=false}){
   const exec=current(actor);if(!exec)throw fail('PERMISSION_CALL_UNBOUND')
   if(!fileTools.includes(exec.name))throw fail('PERMISSION_FILE_TOOL_REQUIRED')
   return bind(exec,fileScope(exec,path,writing))
  },
  resolveFileAuthorization({actor,path,writing=false}){
   const exec=current(actor);if(!exec||!fileTools.includes(exec.name))return
   let record=records.get(exec)
   if(record)valid(exec,record)
   // 工作目录等辅助检查不获得文件授权，继续接受原文件系统边界检查。
   const scope=fileScope(exec,path,writing,true);if(!scope)return
   if(!record)record=bind(exec,scope)
   if(!record)return
   const target=canonical(path)
   if(record.scope.kind!=='file'||record.scope.path!==scope.path||record.scope.cwd!==scope.cwd||writing&&record.scope.operation!=='write')throw fail('PERMISSION_SCOPE_CHANGED')
   return {kind:'direct',path:target,full:true}
  },
  canStatWorkingDirectory({actor,path}){
   const initiator=ctx.agents.currentInitiator()
   if(closed||ctx.agents.get(actor?.id)!==actor||actor.lifecycle?.signal?.aborted||initiator!==undefined&&initiator!==actor)throw fail('PERMISSION_CALL_INACTIVE')
   officialWorkingDirectoryOrigin(actor)
   if(path!==actor.ctx.get('workingDirectory').get(actor))throw fail('PERMISSION_SCOPE_CHANGED')
   const exec=ctx.tools.currentPermissionExecution()
   if(exec){
    if(exec.agent!==actor||initiator!==actor)throw fail('PERMISSION_CALL_UNBOUND')
    active(exec)
    const record=records.get(exec)
    if(record){
     valid(exec,record)
     const scope=record.scope.kind==='process'?processScope(exec):fileScope(exec,record.scope.path,record.scope.operation==='write')
     if(JSON.stringify(stable(scope))!==JSON.stringify(stable(record.scope)))throw fail('PERMISSION_SCOPE_CHANGED')
    }
   }
   return true
  },
  async authorizeProcess(exec){
   active(exec);if(!['bash','pwsh'].includes(exec.name))throw fail('PERMISSION_PROCESS_TOOL_REQUIRED')
   return bind(exec,processScope(exec))
  },
  inspectProcessAuthorization({actor}){return processRecord(actor)?.projection},
  resolveProcessAuthorization({actor,cwd,argv}){
   const bound=processRecord(actor);if(!bound)return
   const {record,projection}=bound
   if(record.scope.cwd!==canonical(cwd)||!Array.isArray(argv)||argv.length===0||argv.some(value=>typeof value!=='string'))throw fail('PERMISSION_PROCESS_SCOPE_CHANGED')
   if(record.scope.kind==='process')record.used=true
   record.argv=Object.freeze([...argv]);return projection
  },
  consumeFileAuthorization({actor,path}){
   const grant=api.resolveFileAuthorization({actor,path,writing:true}),record=records.get(current(actor))
   // 辅助查询可以无授权；已有文件授权的最终写入必须精确匹配，不能回退旧策略。
   if(!grant){if(record?.scope.kind==='file')throw fail('PERMISSION_SCOPE_CHANGED');return}
   if(record.used)throw fail('PERMISSION_FILE_ALREADY_CONSUMED')
   record.used=true
  },
  executionSignal(signal){return AbortSignal.any([signal,lifetime.signal])},
  finish(exec){records.delete(exec)},
  async prepare(exec){
   if(!exec.agent)return
   active(exec)
   if(['read','write','edit'].includes(exec.name)&&typeof exec.arguments.path==='string'){
    const cwd=canonical(exec.agent.ctx.get('workingDirectory').get(exec.agent)),path=canonical(resolve(cwd,exec.arguments.path)),writing=['write','edit'].includes(exec.name)
    await api.authorizeFile({actor:exec.agent,path,writing})
   }
   if(exec.name==='working_directory'){
    const cwd=canonical(exec.agent.ctx.get('workingDirectory').get(exec.agent))
    await api.authorizeFile({actor:exec.agent,path:canonical(resolve(cwd,exec.arguments.cd??'.'))})
   }
   if(['bash','pwsh'].includes(exec.name))await api.authorizeProcess(exec)
  },
  close(){closed=true;lifetime.abort()},
 }
 return api
}
