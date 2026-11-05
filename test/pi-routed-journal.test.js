import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,mkdir,rm,readFile,readdir,appendFile,writeFile} from 'node:fs/promises'
import {join} from 'node:path'
import {Context} from '@deepseek-ai/cordis'
import NativeSessions from '../src/native-sessions.js'
import {createUserMessage} from '../src/native-message-protocol.js'
import PiPersistence,{validatePiArchiveSession} from '../src/pi-session-persistence.js'
import {apply as authority} from '../src/pi-authority.js'
import {piJournalFilename} from '../src/runtime/pi-journal.js'
import {readNativeHistory} from '../packages/dingtalk-core/native-maintenance-drain.js'

async function fixture(t){
 const root=await mkdtemp('/tmp/night-routed-journal-'),directory=join(root,'tasks','task','sessions'),path=join(directory,piJournalFilename('owned'))
 await mkdir(directory,{recursive:true});const routes=new Map([['owned',path]]),ctx=new Context();ctx.provide('taskSessionRoutes',routes);new NativeSessions(ctx);authority(ctx)
 const backend=new PiPersistence(ctx,{root:join(root,'global-unused')}),session=ctx.sessions.prepare('owned',{meta:{cwd:root}})
 session.append('user/message',createUserMessage({source:{kind:'user'},content:[{type:'text',text:'ROUTED_EVIDENCE'}]}),{surfaceOp:'append'})
 t.after(async()=>{try{await ctx.fiber.dispose()}finally{await rm(root,{recursive:true,force:true})}})
 return{root,directory,path,routes,ctx,backend,session}
}
test('routed Pi creation publishes and syncs in its own directory without using a global temp directory',async t=>{
 const f=await fixture(t),writer=await f.backend.create(f.session.header);await writer.append(f.session.snapshotEvents());await writer.close()
 assert.equal((await validatePiArchiveSession(f.path,'owned')).events.length,1)
 await assert.rejects(readdir(join(f.root,'global-unused')),{code:'ENOENT'})
 assert.deepEqual(await readdir(f.directory),[piJournalFilename('owned')])
})
test('a changed task route cannot redirect an already admitted writer',async t=>{
 const f=await fixture(t),writer=await f.backend.create(f.session.header),outside=join(f.root,'other-route','target.pi.jsonl')
 f.routes.set('owned',outside)
 await assert.rejects(writer.append(f.session.snapshotEvents()),{code:'PI_SESSION_ROUTE_CHANGED'});await writer.close()
 assert.deepEqual(await readdir(f.directory),[]);await assert.rejects(readFile(outside),{code:'ENOENT'})
})
test('archive validation refuses a torn Pi tail while read-only live inspection preserves the evidence',async t=>{
 const f=await fixture(t),writer=await f.backend.create(f.session.header);await writer.append(f.session.snapshotEvents());await writer.close()
 const before=await readFile(f.path);await appendFile(f.path,'{"uncommitted":')
 await assert.rejects(validatePiArchiveSession(f.path,'owned'),{code:'PI_SESSION_UNCOMMITTED_TAIL'})
 const reader=await f.backend.open('owned','read');try{assert.equal((await reader.read()).events.length,1)}finally{await reader.close()}
 assert.equal((await readFile(f.path)).toString(),before.toString()+'{"uncommitted":')
})
test('maintenance resolves a task archive only through its matching Host-owned identity marker',async t=>{
 const f=await fixture(t),writer=await f.backend.create(f.session.header);await writer.append(f.session.snapshotEvents());await writer.close()
 const marker=join(f.root,'tasks','task','.task-session.json')
 await writeFile(marker,JSON.stringify({version:1,taskId:'task',sessionId:'owned'}))
 const stored=readNativeHistory(f.root,{taskId:'task',sessionId:'owned'});assert.equal(stored.path,f.path);assert.deepEqual(stored.events,f.session.snapshotEvents())
 await writeFile(marker,JSON.stringify({version:1,taskId:'task',sessionId:'foreign'}))
 assert.throws(()=>readNativeHistory(f.root,{taskId:'task',sessionId:'owned'}),/DEPLOY_NATIVE_LOG_IDENTITY/)
})
