import {runtimePaths} from '../src/runtime/paths.js'
import {portablePaths} from '../src/runtime/portable.js'
import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,rm,mkdir,readFile,writeFile,rename,symlink,link} from 'node:fs/promises'
import {join} from 'node:path'
import {Context} from '@deepseek-ai/cordis'
import NativeSessions from '../src/native-sessions.js'
import PiPersistence from '../src/pi-session-persistence.js'
import {apply as authority} from '../src/pi-authority.js'
import {createUserMessage} from '../src/native-message-protocol.js'
import {readNativeHistory} from '../packages/dingtalk-core/native-maintenance-drain.js'
import {piJournalFilename} from '../src/runtime/pi-journal.js'

async function fixture(t,{portable=false}={}){
 const root=await mkdtemp('/tmp/night-maintenance-pi-'),paths=runtimePaths({installRoot:root}),workspace=portable?paths.workspaces:root,row={taskId:'task',sessionId:'session'},directory=join(workspace,'tasks','task','.dsh','sessions')
 await mkdir(workspace,{recursive:true})
 const ctx=new Context();const pathCodec=portable?portablePaths(paths):undefined;if(pathCodec)ctx.provide('portablePaths',pathCodec);new NativeSessions(ctx);authority(ctx);const backend=new PiPersistence(ctx,{root:directory})
 t.after(async()=>{try{await ctx.fiber.dispose()}finally{await rm(root,{recursive:true,force:true})}})
 const session=ctx.sessions.prepare(row.sessionId,{meta:{cwd:workspace}})
 session.append('user/message',createUserMessage({source:{kind:'user'},content:[{type:'text',text:'ORIGINAL_EVIDENCE'}]}),{surfaceOp:'append'})
 if(portable)session.append('working-directory/change',{cwd:workspace})
 const writer=await backend.create(session.header);await writer.append(session.snapshotEvents());await writer.close()
 const path=join(directory,piJournalFilename(row.sessionId)),bytes=await readFile(path)
 return{root,workspace,pathCodec,row,directory,path,bytes,backend,events:session.snapshotEvents()}
}
test('offline maintenance reads exact committed Pi history without taking a writer lease',async t=>{
 const f=await fixture(t),first=readNativeHistory(f.root,f.row),second=readNativeHistory(f.root,f.row)
 assert.deepEqual(first.events,f.events);assert.equal(first.header.id,f.row.sessionId);assert.equal(first.format,'pi-jsonl-v3');assert.equal(first.digest,second.digest)
 assert.deepEqual(await readFile(f.path),f.bytes)
 assert.throws(()=>readNativeHistory(f.root,{...f.row,taskId:'../escape'}),/TASK_DIRECTORY_INVALID/)
})
test('offline proof rejects uncommitted Pi tails while ordinary read-only inspection leaves them untouched',async t=>{
 const f=await fixture(t),last=JSON.parse(f.bytes.toString().trim().split('\n').at(-1))
 for(const tail of ['{"torn":',JSON.stringify({type:'custom',customType:'pending',id:'pending-entry',parentId:last.id,data:{}})+'\n']){
  await writeFile(f.path,Buffer.concat([f.bytes,Buffer.from(tail)]))
  assert.throws(()=>readNativeHistory(f.root,f.row),{code:'PI_SESSION_UNCOMMITTED_TAIL'})
  const reader=await f.backend.open(f.row.sessionId,'read');assert.deepEqual((await reader.read()).events,f.events);await reader.close()
  assert.equal((await readFile(f.path)).toString(),f.bytes.toString()+tail)
 }
})
test('offline Pi evidence rejects changed records and unsupported headers without rewriting bytes',async t=>{
 const f=await fixture(t)
 for(const [text,code] of [[f.bytes.toString().replace('ORIGINAL_EVIDENCE','FORGED_EVIDENCE'),'PI_SESSION_CHECKSUM_MISMATCH'],[f.bytes.toString().replace('"version":3','"version":99'),'PI_SESSION_FORMAT_UNSUPPORTED']]){
  await writeFile(f.path,text);assert.throws(()=>readNativeHistory(f.root,f.row),{code});assert.equal(await readFile(f.path,'utf8'),text)
 }
})
test('offline Pi evidence rejects symbolic/hard-linked files and a linked ancestor',async t=>{
 const f=await fixture(t),saved=f.path+'.saved';await rename(f.path,saved)
 await symlink(saved,f.path);assert.throws(()=>readNativeHistory(f.root,f.row),/DEPLOY_LOG_REPARSE_POINT/);await rm(f.path)
 await link(saved,f.path);assert.throws(()=>readNativeHistory(f.root,f.row),/DEPLOY_LOG_REPARSE_POINT/);await rm(f.path)
 await rename(saved,f.path);const moved=f.directory+'.saved';await rename(f.directory,moved);await symlink(moved,f.directory,'dir')
 assert.throws(()=>readNativeHistory(f.root,f.row),/DEPLOY_LOG_REPARSE_POINT/)
 assert.deepEqual(await readFile(join(moved,piJournalFilename(f.row.sessionId))),f.bytes)
})
test('old v4 physical logs cannot substitute for missing Pi evidence',async t=>{
 const f=await fixture(t);await rm(f.path)
 await writeFile(join(f.directory,'session.v4.jsonl'),'{}\n')
 assert.throws(()=>readNativeHistory(f.root,f.row),{code:'ENOENT'})
})

test('portable maintenance uses the same explicit controlled-path codec as live Pi inspection',async t=>{
 const f=await fixture(t,{portable:true})
 assert.throws(()=>readNativeHistory(f.workspace,f.row),/PI_SESSION_PATH_CODEC_REQUIRED/)
 const stored=readNativeHistory(f.workspace,f.row,{pathCodec:f.pathCodec})
 assert.deepEqual(stored.events,f.events);assert.equal(stored.header.cwd,f.workspace)
 const reader=await f.backend.open(f.row.sessionId,'read');try{assert.deepEqual(stored.events,(await reader.read()).events)}finally{await reader.close()}
 assert.deepEqual(await readFile(f.path),f.bytes)
})
