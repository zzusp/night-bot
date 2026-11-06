import {tmpdir} from 'node:os'
import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,rm,mkdir,symlink,readFile,access} from 'node:fs/promises'
import {join} from 'node:path'
import {nativeRuntimeHost,latestInput} from './fixtures/runtime-official-host.js'
import {backupTask,restoreTask} from '../src/tasks/archive.js'
const linux={skip:process.platform!=='linux',timeout:30000}
const call=(name,args)=>({name,args})
const result=(action='wait')=>call('task_result',{decision:{action,summary:'Verified task evidence and actual process boundaries',evidence:['official file result and real child output'],limitations:[]}})
const quote=value=>"'"+value.replaceAll("'","'\\''")+"'"
async function fixture(t){
 const roots=[],hosts=[]
 t.after(async()=>{try{for(const host of hosts.toReversed())await host.close()}finally{for(const root of roots)await rm(root,{recursive:true,force:true})}})
 const newRoot=async()=>{const root=await mkdtemp(join(tmpdir(),'night-single-kernel-'));roots.push(root);return root},root=await newRoot()
 return {root,newRoot,async host(decide,{at=root,initialize=true}={}){const h=await nativeRuntimeHost(at,decide,{initialize,config:{dbPath:join(at,'data/state/tasks.sqlite')}});hosts.push(h);return h},config(at=root){return{installRoot:at,dataDir:'data',resident:{taskSessions:{initialize:true,instanceId:'native-test',ownerActorId:'native-user',webActorId:'native-user'}}}}}
}
const taskRoot=(h,id)=>join(h.ctx.runtimePaths.workspaces,'tasks',id)
const targets=root=>[['metadata',join(root,'task.json')],...['materials','outputs','sessions','reviews'].map(name=>[name,join(root,name,'kernel-forbidden.txt')]),['escape',join(root,'work/escape/kernel-forbidden.txt')]]
async function escape(root){const other=join(root,'../foreign-kernel-task/work');await mkdir(other,{recursive:true});await symlink(other,join(root,'work/escape'));return other}
function command(root,{readOnly=false,marker='cold'}={}){
 const denied=[...targets(root),...readOnly?[['work',join(root,'work/readonly-forbidden.txt')],['tmp',join(root,'tmp/readonly-forbidden.txt')]]:[]]
 const allowed=readOnly?'':`fs.writeFileSync(p.join(${JSON.stringify(root)},'work/${marker}-child.txt'),'CHILD_ALLOWED_WORK');fs.writeFileSync(p.join(process.env.TMPDIR,'${marker}-child.txt'),'CHILD_ALLOWED_TMP');console.log('ALLOWED_MARKERS_WRITTEN');`
 const script=`const fs=require('node:fs'),p=require('node:path');console.log('KERNEL_CHILD_STARTED');console.log('ORIGINAL:'+fs.readFileSync(p.join(${JSON.stringify(root)},'work/original.txt'),'utf8'));${allowed}for(const [label,path]of ${JSON.stringify(denied)}){try{fs.writeFileSync(path,'forbidden');console.log('WROTE:'+label)}catch{console.log('DENIED:'+label)}}`
 return[process.execPath,'-e',script].map(quote).join(' ')
}
function assertProcess(h,root,{readOnly=false}={}){
 const shell=h.toolResults.findLast(row=>row.name==='bash');assert.ok(shell);assert.equal(shell.result.isError,false,JSON.stringify(shell.result));const output=JSON.stringify(shell.result.content)
 assert.match(output,/KERNEL_CHILD_STARTED/);assert.match(output,/ORIGINAL:ORIGINAL_EFFECT_ONCE/);if(!readOnly)assert.match(output,/ALLOWED_MARKERS_WRITTEN/)
 for(const [label]of[...targets(root),...readOnly?[['work'],['tmp']]:[]]){assert.ok(output.includes('DENIED:'+label),output);assert.ok(!output.includes('WROTE:'+label),output)}
}
async function assertOriginal(h,task){const saved=await h.ctx.sessionPersistence.readNative(task.sessionId,{requireComplete:true}),writes=saved.entries.filter(e=>e.type==='message'&&e.message.role==='assistant').flatMap(e=>e.message.content).filter(part=>part.type==='toolCall'&&part.name==='write'&&part.arguments.path==='work/original.txt');assert.equal(writes.length,1);assert.equal(await readFile(join(saved.header.cwd,'work/original.txt'),'utf8'),'ORIGINAL_EFFECT_ONCE');assert.deepEqual(await h.query('execution.list'),[]);return saved}

test('Single cold continuation keeps official FS and an actually started kernel process within work and tmp',linux,async t=>{
 const f=await fixture(t);let step=0
 const first=await f.host(()=>step++===0?[call('write',{path:'work/original.txt',content:'ORIGINAL_EFFECT_ONCE'})]:[result()])
 const created=await first.service.createTask({requestId:'cold-kernel',objective:'Write original evidence once; later run bounded FS/process isolation probes without repeating it'});await first.service.whenIdle();const before=await first.query('task.get',{taskId:created.taskId}),root=taskRoot(first,before.taskId),other=await escape(root);await first.close()
 step=0;const cold=await f.host(request=>{assert.equal(latestInput(request).task.sessionId,before.sessionId);if(step++===0)return[call('write',{path:'work/fs-proof.txt',content:'FS_ALLOWED_WORK'}),call('write',{path:'tmp/fs-proof.txt',content:'FS_ALLOWED_TMP'}),...targets(root).map(([label,path])=>call('write',{path,content:'forbidden '+label}))];if(step===2)return[call('bash',{command:command(root),description:'Real child writes allowed markers then probes denied roots'})];assertProcess(cold,root);return[result()]},{initialize:false})
 await cold.service.recover();await cold.service.whenIdle();assert.equal(cold.requests.length,0);await cold.service.store.command({id:'inspect-cold',kind:'task.wake',args:{taskId:before.taskId,kind:'host.explicit-inspection',payload:{reason:'Inspect retained evidence and its preauthorized file/process boundaries; do not repeat original write.'}}});await cold.service.recover();await cold.service.whenIdle()
 const after=await cold.query('task.get',{taskId:before.taskId});assert.equal(after.sessionId,before.sessionId);assert.equal(after.requirementRevision,before.requirementRevision);assert.equal(after.drained,true);assertProcess(cold,root)
 for(const[file,expected]of[['work/fs-proof.txt','FS_ALLOWED_WORK'],['tmp/fs-proof.txt','FS_ALLOWED_TMP'],['work/cold-child.txt','CHILD_ALLOWED_WORK'],['tmp/cold-child.txt','CHILD_ALLOWED_TMP']])assert.equal(await readFile(join(root,file),'utf8'),expected)
 assert.equal(cold.toolResults.filter(row=>row.name==='write'&&row.result.isError).length,targets(root).length);await assert.rejects(access(join(other,'kernel-forbidden.txt')),{code:'ENOENT'});await assertOriginal(cold,after)
})

test('Single readonly permission survives cold restore and a real child reads evidence but cannot write work tmp or Host roots',linux,async t=>{
 const f=await fixture(t);let step=0
 const first=await f.host(async(request,h)=>{if(step++===0)return[call('write',{path:'work/original.txt',content:'ORIGINAL_EFFECT_ONCE'})];const actor=h.ctx.agents.get(latestInput(request).task.sessionId);await actor.ctx.get('permissionPresets').set(actor,'read-only');return[result()]})
 const created=await first.service.createTask({requestId:'readonly-cold',objective:'Create retained evidence then restrict later work to readonly inspection'});await first.service.whenIdle();const before=await first.query('task.get',{taskId:created.taskId}),root=taskRoot(first,before.taskId);await escape(root);await first.close()
 step=0;const cold=await f.host((request,h)=>{const actor=h.ctx.agents.get(before.sessionId);assert.equal(actor.ctx.get('permissionPresets').current(actor),'read-only');if(step++===0)return[call('bash',{command:command(root,{readOnly:true}),description:'Readonly child reads evidence and rejects writes'})];assertProcess(cold,root,{readOnly:true});if(step===2)return[call('write',{path:'work/readonly-fs.txt',content:'forbidden'})];assert.ok(cold.toolResults.some(row=>row.name==='write'&&row.result.isError),'The known readonly write must be refused before normal wait');return[result()]},{initialize:false})
 await cold.service.recover();await cold.service.whenIdle();assert.equal(cold.requests.length,0);await cold.service.store.command({id:'readonly-inspect',kind:'task.wake',args:{taskId:before.taskId,kind:'host.explicit-inspection',payload:{reason:'Only inspect original evidence; readonly permission remains effective.'}}});await cold.service.recover();await cold.service.whenIdle()
 const after=await cold.query('task.get',{taskId:before.taskId});assert.equal(after.sessionId,before.sessionId);assertProcess(cold,root,{readOnly:true});await assert.rejects(access(join(root,'work/readonly-fs.txt')),{code:'ENOENT'});await assert.rejects(access(join(root,'work/readonly-forbidden.txt')),{code:'ENOENT'});const saved=await assertOriginal(cold,after);assert.ok(cold.toolResults.some(row=>row.name==='write'&&row.result.isError));assert.equal((await cold.service.taskDialogue(after.taskId)).error,null);assert.equal(after.lastDecision.action,'wait');assert.deepEqual(after.lastDecision.limitations,[]);assert.equal(saved.audit.filter(row=>row.domain==='task'&&row.kind==='effect-intent'&&row.payload.name==='write').length,1,'Known readonly rejection cannot create another write intent');assert.equal(saved.audit.filter(row=>row.domain==='task'&&row.kind==='effect-intent'&&row.payload.name==='bash').length,1,'The real readonly child retains its successful invocation receipt');assert.equal(saved.audit.filter(row=>row.domain==='task'&&row.kind==='effect-result').length,2);const count=cold.requests.length;for(let i=0;i<3;i++){await cold.service.recover();await cold.service.whenIdle()}assert.equal(cold.requests.length,count,'Known policy rejection and normal wait cannot manufacture another wake')
})

test('Single explicit reopen retains evidence and kernel boundary; own portable archive restores held without replay',linux,async t=>{
 const f=await fixture(t);let step=0,reopened=false,root
 const host=await f.host(request=>{if(!reopened)return step++===0?[call('write',{path:'work/original.txt',content:'ORIGINAL_EFFECT_ONCE'})]:[result('complete')];if(step++===0)return[call('read',{path:'work/original.txt'})];if(step===2){assert.match(JSON.stringify(request.messages.filter(m=>m.role==='toolResult')),/ORIGINAL_EFFECT_ONCE/);return[call('bash',{command:command(root,{marker:'reopen'}),description:'Verify reopened task boundary with a real child'})]}assertProcess(host,root);return[result()]})
 const created=await host.service.createTask({requestId:'reopen-archive',objective:'Create original task evidence once'});await host.service.whenIdle();const before=await host.query('task.get',{taskId:created.taskId});assert.equal(before.status,'completed');root=taskRoot(host,before.taskId);await escape(root)
 reopened=true;step=0;await host.service.store.command({id:'explicit-kernel-reopen',kind:'task.reopen',args:{taskId:before.taskId,expectedRequirementRevision:before.requirementRevision,expectedControlRevision:before.controlRevision,objective:'Inspect original evidence and isolation without replaying its effect'}});await host.service.recover();await host.service.whenIdle();const after=await host.query('task.get',{taskId:before.taskId});assert.equal(after.sessionId,before.sessionId);assert.equal(after.requirementRevision,before.requirementRevision+1);await assertOriginal(host,after);assertProcess(host,root)
 // Archive sealing rejects symlinks. Remove this probe only after the actual
 // kernel denial is observed, without replacing or weakening the archive seal.
 await rm(join(root,'work/escape'));await host.close();const backup=join(f.root,'backups/task');await backupTask(f.config(),before.taskId,backup);const restoredRoot=await f.newRoot();assert.equal((await restoreTask(f.config(restoredRoot),backup)).paused,true)
 const restored=await f.host(()=>assert.fail('Restored task stays held without operator review'),{at:restoredRoot,initialize:false});await restored.service.recover();await restored.service.whenIdle();const held=await restored.query('task.get',{taskId:before.taskId});assert.equal(held.control,'paused');assert.equal(held.archiveRestore.reviewRequired,true);assert.equal(held.sessionId,before.sessionId);assert.equal(restored.requests.length,0);await assertOriginal(restored,held);await assert.rejects(restored.service.store.command({id:'unreviewed-kernel-claim',kind:'task.claim',args:{taskId:held.taskId}}),/RESTORE_REVIEW_REQUIRED/)
})
