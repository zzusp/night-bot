import {join} from 'node:path'
import {readdir,lstat} from 'node:fs/promises'
import {createHash} from 'node:crypto'
import {readRegular,atomicWrite,privateDirectory,failure} from '../runtime/files.js'
import {checkedTaskDirectory,assertTaskWorkspaceReady} from '../../packages/dingtalk-core/session-workspaces.js'
const hash=id=>createHash('sha256').update(id).digest('hex')
export async function taskSessionRoutes(paths){
  const routes=new Map();if(paths.mode!=='portable')return routes
  const root=join(paths.workspaces,'tasks')
  for(const entry of await readdir(root,{withFileTypes:true}).catch(error=>{if(error.code==='ENOENT')return [];throw error})){
    if(entry.isSymbolicLink())throw failure('TASK_ARCHIVE_PATH_UNSAFE');if(!entry.isDirectory())continue
    await checkedTaskDirectory(join(root,entry.name));const owner=JSON.parse(await readRegular(join(root,entry.name,'.task-session.json'))??'null');if(!owner)continue
    if(owner.taskId!==entry.name||typeof owner.sessionId!=='string'||routes.has(owner.sessionId))throw failure('TASK_ARCHIVE_SESSION_CONFLICT')
    const directory=join(root,entry.name,'sessions');await checkedTaskDirectory(directory)
    routes.set(owner.sessionId,join(directory,hash(owner.sessionId)+'.pi.jsonl'))
  }
  return routes
}
export async function registerTaskSession(paths,routes,task,{relocate=false}={}){
  assertTaskWorkspaceReady(task)
  const central=join(paths.state,'sessions',hash(task.sessionId)+'.pi.jsonl');if(!relocate&&!routes.has(task.sessionId)&&await lstat(central).catch(error=>{if(error.code!=='ENOENT')throw error}))throw failure('TASK_ARCHIVE_EXISTING_SESSION_REQUIRES_OFFLINE_RELOCATION');
  const root=join(paths.workspaces,'tasks',task.taskId);await checkedTaskDirectory(root,true);const directory=join(root,'sessions');await privateDirectory(directory)
  const file=join(root,'.task-session.json'),prior=JSON.parse(await readRegular(file)??'null')
  if(prior&&(prior.taskId!==task.taskId||prior.sessionId!==task.sessionId))throw failure('TASK_ARCHIVE_SESSION_CONFLICT')
  const path=join(directory,hash(task.sessionId)+'.pi.jsonl');if(routes.has(task.sessionId)&&routes.get(task.sessionId)!==path)throw failure('TASK_ARCHIVE_SESSION_CONFLICT')
  if(!prior)await atomicWrite(file,JSON.stringify({version:1,taskId:task.taskId,sessionId:task.sessionId})+'\n');routes.set(task.sessionId,path)
  return {root,path}
}
