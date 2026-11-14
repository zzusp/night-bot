import {Context} from '@deepseek-ai/cordis'
import {SessionManager} from '@earendil-works/pi-coding-agent'
import {DatabaseSync} from 'node:sqlite'
import {createHash} from 'node:crypto'
import {readFile,lstat} from 'node:fs/promises'
import {join,resolve,dirname} from 'node:path'
import {z} from 'zod'
import PiPersistence from '../pi-session-persistence.js'
import {apply as authority} from '../pi-authority.js'
import {runtimePaths,inside} from '../runtime/paths.js'
import {portablePaths} from '../runtime/portable.js'
import {acquireLock,atomicWrite,readRegular,failure} from '../runtime/files.js'
import {unresolvedNativeJobReceipts,jobReceiptKinds,jobRegistrationDigest} from '../runtime/job-ledger.js'
import {taskSessionRoutes} from './session-routes.js'
import {validateTaskIdentity} from './session-audit.js'
import {taskEffectBinding,taskEffectDigest} from './effect-reconciliation.js'
import {checkedTaskDirectory} from '../../packages/dingtalk-core/session-workspaces.js'
const hex=z.string().regex(/^[a-f0-9]{64}$/),text=z.string().min(1).max(2000)
const proposalSchema=z.strictObject({version:z.literal(1),taskId:text,sessionId:text,jobId:text,registeredEntryId:text,registrationDigest:hex,journalRevision:hex,taskRevision:hex})
const noteSchema=z.strictObject({operatorText:z.string().trim().min(1).max(16000),producerAbsent:z.literal(true),partialEffectsPossible:z.literal(true),noReplay:z.literal(true),evidenceFiles:z.array(z.strictObject({path:z.string().startsWith('work/').refine(path=>!/[\:\x00-\x1f]/.test(path)&&path.split('/').every(part=>part&&part!=='.'&&part!=='..')),sha256:hex})).min(1).max(16)})
const hash=bytes=>createHash('sha256').update(bytes).digest('hex')
const assert=(condition,code)=>{if(!condition)throw failure(code)}
async function regular(path){
 await checkedTaskDirectory(dirname(path));const before=await lstat(path)
 assert(before.isFile()&&!before.isSymbolicLink()&&before.nlink===1,'NIGHT_JOB_EVIDENCE_PATH_UNSAFE')
 const bytes=await readFile(path),after=await lstat(path)
 assert(before.ino===after.ino&&before.dev===after.dev&&before.size===after.size&&before.mtimeMs===after.mtimeMs&&before.ctimeMs===after.ctimeMs,'NIGHT_JOB_EVIDENCE_CHANGED')
 return bytes
}
function taskRevision(task){return taskEffectDigest({binding:taskEffectBinding(task),ownerActorId:task.ownerActorId,groupId:task.groupId??null,control:task.control,status:task.status,archiveRestore:task.archiveRestore??null,archivedAt:task.archivedAt??null})}
async function readTask(paths,config,taskId){
 const file=join(paths.state,'tasks.sqlite');await checkedTaskDirectory(dirname(file));const info=await lstat(file)
 assert(info.isFile()&&!info.isSymbolicLink()&&info.nlink===1,'NIGHT_JOB_EVIDENCE_PATH_UNSAFE')
 const marker=JSON.parse(await readRegular(file+'.initialized')??'null'),db=new DatabaseSync(file,{readOnly:true})
 try{
  assert(marker?.phase==='initialized'&&marker.instanceId===config.resident?.taskSessions?.instanceId&&db.prepare("SELECT value FROM dynamic_meta WHERE key='instanceId'").get()?.value===marker.instanceId&&db.prepare("SELECT value FROM dynamic_meta WHERE key='initToken'").get()?.value===marker.initToken,'NIGHT_JOB_INSTALLATION_MISMATCH')
  const row=db.prepare('SELECT body FROM dynamic_tasks WHERE id=?').get(taskId);assert(row,'NIGHT_JOB_TASK_MISSING');return JSON.parse(row.body)
 }finally{db.close()}
}
async function persistence(config,work){
 const paths=runtimePaths(config);assert(paths.mode==='portable','NIGHT_JOB_PORTABLE_REQUIRED')
 await checkedTaskDirectory(paths.runtime);await checkedTaskDirectory(paths.state)
 const ctx=new Context();authority(ctx);ctx.provide('portablePaths',portablePaths(paths));ctx.provide('taskSessionRoutes',await taskSessionRoutes(paths))
 const backend=new PiPersistence(ctx,{root:join(paths.state,'sessions')})
 try{return await work({paths,backend})}finally{await ctx.fiber.dispose()}
}
async function snapshot(config,paths,backend,taskId){
 const task=await readTask(paths,config,taskId);assert(task.sessionBound&&!task.archivedAt&&!task.archiveRestore?.reviewRequired,'NIGHT_JOB_TASK_SCOPE_INVALID')
 const stored=await backend.readNative(task.sessionId,{requireComplete:true}),identity=stored.audit.filter(row=>row.domain==='task'&&row.kind==='identity')
 assert(identity.length===1&&validateTaskIdentity(identity[0].payload)&&identity[0].payload.taskId===taskId&&identity[0].payload.sessionId===task.sessionId,'NIGHT_JOB_TASK_IDENTITY_MISMATCH')
 const root=join(paths.workspaces,'tasks',taskId);await checkedTaskDirectory(root)
 assert(resolve(stored.header.cwd)===resolve(root)&&backend.path(task.sessionId)===join(root,'sessions',hash(task.sessionId)+'.pi.jsonl'),'NIGHT_JOB_TASK_IDENTITY_MISMATCH')
 return {task,stored,root,journalRevision:stored.journalDigest.split(':').at(-1)}
}
function inspect(snap,jobId){
 const {task,stored}=snap,job=unresolvedNativeJobReceipts(stored.audit,task.sessionId).find(row=>row.jobId===jobId)
 assert(job&&!job.uncertain&&!job.resourceOwnership&&['pwsh','bash'].includes(job.kind),'NIGHT_JOB_RECONCILIATION_UNSUPPORTED')
 const rows=stored.auditEntries.filter(row=>row.data.domain==='job'&&row.data.kind==='registered'&&row.data.payload.jobId===jobId)
 assert(rows.length===1,'NIGHT_JOB_RECEIPT_INVALID')
 const manager=SessionManager.inMemory(stored.header.cwd,{id:stored.header.id},structuredClone(stored.entries))
 assert(manager.getBranch().some(row=>row.id===rows[0].entryId),'NIGHT_JOB_RECONCILIATION_BRANCH_INVALID')
 return {proposal:proposalSchema.parse({version:1,taskId:task.taskId,sessionId:task.sessionId,jobId,registeredEntryId:rows[0].entryId,registrationDigest:jobRegistrationDigest(job),journalRevision:snap.journalRevision,taskRevision:taskRevision(task)}),job}
}
export async function inspectNativeJob(config,taskId,jobId){return persistence(config,async({paths,backend})=>inspect(await snapshot(config,paths,backend,taskId),jobId))}
async function assertOffline(paths){
 const lock=join(paths.runtime,'.host.lock'),info=await lstat(lock).catch(error=>{if(error.code!=='ENOENT')throw error})
 if(!info)return
 await checkedTaskDirectory(lock)
 const owner=JSON.parse(await readRegular(join(lock,'owner.json'))??'null')
 assert(owner,'NIGHT_JOB_HOST_LOCK_UNCERTAIN')
 assert(Number.isSafeInteger(owner.pid)&&owner.pid>0,'NIGHT_JOB_HOST_LOCK_UNCERTAIN')
 try{process.kill(owner.pid,0)}catch(error){if(error.code==='ESRCH')return;throw failure('NIGHT_JOB_HOST_LOCK_UNCERTAIN')}
 throw failure('NIGHT_JOB_RECONCILIATION_HOST_LIVE')
}
export async function reconcileNativeJob(config,proposal,note,{check=false}={}){
 proposal=proposalSchema.parse(proposal);note=noteSchema.parse(note)
 const requestDigest=taskEffectDigest({proposal,note})
 return persistence(config,async({paths,backend})=>{
  let release,writer
  try{
   if(check)await assertOffline(paths)
   else release=await acquireLock(join(paths.runtime,'.host.lock'),{timeoutMs:0})
   for(const name of ['restore.pending.json','task-restore.pending.json'])assert(await readRegular(join(paths.runtime,name))===undefined,'NIGHT_JOB_RESTORE_PENDING')
   let snap=await snapshot(config,paths,backend,proposal.taskId)
   const existing=snap.stored.auditEntries.find(row=>row.data.domain==='job'&&row.data.kind==='reconciled'&&row.data.payload.requestDigest===requestDigest)
   if(existing){
    const prior=existing.data.payload
    assert(jobReceiptKinds['job/reconciled'](prior)&&prior.owner===proposal.sessionId&&prior.jobId===proposal.jobId&&prior.registrationDigest===proposal.registrationDigest&&prior.journalRevision===proposal.journalRevision&&prior.registeredEntryId===proposal.registeredEntryId,'NIGHT_JOB_RECONCILIATION_STALE')
    assert(hash(await regular(join(snap.root,prior.evidence.path)))===prior.evidence.sha256,'NIGHT_JOB_EVIDENCE_CHANGED')
    return {state:'committed',entryId:existing.entryId,noReplay:true,exitStatus:'unknown'}
   }
   if(!check){writer=await backend.openNative(proposal.sessionId,{auditKinds:jobReceiptKinds});snap=await snapshot(config,paths,backend,proposal.taskId)}
   const current=inspect(snap,proposal.jobId)
   assert(taskEffectDigest(current.proposal)===taskEffectDigest(proposal),'NIGHT_JOB_RECONCILIATION_STALE')
   if(writer)assert(writer.manager.getBranch().some(row=>row.id===proposal.registeredEntryId),'NIGHT_JOB_RECONCILIATION_BRANCH_INVALID')
   for(const file of note.evidenceFiles){const filePath=resolve(snap.root,file.path);assert(inside(join(snap.root,'work'),filePath)&&filePath!==join(snap.root,'work'),'NIGHT_JOB_EVIDENCE_PATH_UNSAFE');assert(hash(await regular(filePath))===file.sha256,'NIGHT_JOB_EVIDENCE_CHANGED')}
   if(check)return {state:'checked',noWrites:true,noReplay:true,exitStatus:'unknown',proposal}
   const operatorActorId=config.resident?.taskSessions?.webActorId;assert(typeof operatorActorId==='string'&&operatorActorId,'NIGHT_JOB_OPERATOR_REQUIRED')
   const observedAt=new Date().toISOString(),report=Buffer.from(JSON.stringify({version:1,kind:'native-job-operator-readback',proposal,operatorActorId,...note,observedAt,exitStatus:'unknown'})+'\n'),sha256=hash(report),evidence={path:'materials/runtime-evidence/jobs/'+sha256+'.json',sha256}
   await checkedTaskDirectory(join(snap.root,'materials/runtime-evidence/jobs'),true);await atomicWrite(join(snap.root,evidence.path),report)
   const {state,uncertain,resourceSequence,resourceOwnership,privateProof,...bound}=current.job
   const receipt={version:1,domain:'job',kind:'reconciled',payload:{...bound,taskId:proposal.taskId,registeredEntryId:proposal.registeredEntryId,registrationDigest:proposal.registrationDigest,journalRevision:proposal.journalRevision,requestDigest,operatorActorId,evidence,observedAt,outcome:'closed-with-possible-partial-effects',exitStatus:'unknown',producerObservation:'operator-attested-absent',partialEffectsPossible:true,noReplay:true}}
   assert(jobReceiptKinds['job/reconciled'](receipt.payload),'NIGHT_JOB_RECEIPT_INVALID')
   const entryId=writer.appendAudit(receipt);await writer.commit()
   return {state:'committed',entryId,noReplay:true,exitStatus:'unknown',evidence}
  }finally{try{await writer?.close()}finally{await release?.()}}
 })
}
