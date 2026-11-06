import {tmpdir} from 'node:os'
import assert from 'node:assert/strict'
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises'
import {join} from 'node:path'
import {nativeRuntimeHost,latestInput,topicTaskCalls,waitUntil} from './runtime-official-host.js'
export {latestInput,waitUntil}
export const call=(name,args)=>({name,args})
export const decision=(action,summary,extra={})=>call('task_result',{decision:{action,summary,evidence:[],limitations:[],...extra}})
export const names=['alpha','bravo','charlie','delta','echo','foxtrot','golf'].map(name=>'personal-'+name)
export const skillDoc=(name,body)=>`---\nname: ${name}\ndescription: Routing summary for ${name}.\n---\n${body}\nRead references/procedure.md only when needed.\n`
export async function taskEvidenceFixture(t,decide,{skills=true}={}){
 const root=await mkdtemp(join(tmpdir(),'runtime-task-evidence-')),skillRoot=join(root,'personal-assets');let h
 if(skills)for(const name of names){await mkdir(join(skillRoot,name,'references'),{recursive:true});await writeFile(join(skillRoot,name,'SKILL.md'),skillDoc(name,'BODY_ONLY_'+name));await writeFile(join(skillRoot,name,'references/procedure.md'),'REFERENCE_ONLY_'+name)}
 const boot=async(initialize=true)=>{
  h=await nativeRuntimeHost(root,async(request,host)=>{const route=topicTaskCalls(request);if(route)return route;return decide(request,host)},{initialize,skillDirs:skills?[skillRoot]:[]})
  return h
 }
 await boot();t.after(async()=>{try{await h.close()}finally{await rm(root,{recursive:true,force:true})}})
 return {root,skillRoot,get h(){return h},async cold(){await h.close();return boot(false)},async create(requestId,objective){const created=await h.service.createTask({requestId,objective});await h.service.whenIdle();const task=await h.query('task.get',{taskId:created.taskId});return task},async snapshot(task){return h.ctx.sessionPersistence.readNative(task.sessionId,{requireComplete:true})},async sole(task){assert.equal((await h.query('execution.list',{taskId:task.taskId})).length,0);const stored=await h.ctx.sessionPersistence.readNative(task.sessionId,{requireComplete:true});assert.equal(stored.audit.filter(receipt=>receipt.domain==='task'&&receipt.kind==='identity').length,1);return stored},async dialogue(task,id,text){await h.service.sendTaskDialogue({taskId:task.taskId,requestId:id,text});await h.service.whenIdle();return h.query('task.get',{taskId:task.taskId})}}
}
