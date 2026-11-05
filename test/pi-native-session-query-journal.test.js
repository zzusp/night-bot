import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,rm,readFile,writeFile,mkdir,cp} from 'node:fs/promises'
import {join} from 'node:path'
import {Context} from '@deepseek-ai/cordis'
import {buildSessionContext,buildSessionProjection} from '@earendil-works/pi-coding-agent'
import {runtimePaths} from '../src/runtime/paths.js'
import {portablePaths} from '../src/runtime/portable.js'
import NativeSessions from '../src/native-sessions.js'
import NativeQuery from '../src/native-session-query.js'
import PiPersistence from '../src/pi-session-persistence.js'
import {apply as authority} from '../src/pi-authority.js'
import {createUserMessage} from '../src/native-message-protocol.js'
import {decodePiJournal,piJournalFilename} from '../src/runtime/pi-journal.js'

test('cold query context comes from the committed Pi journal without publishing a Session or touching writer ownership',async t=>{
 const root=await mkdtemp('/tmp/night-query-context-'),ctx=new Context()
 t.after(async()=>{try{await ctx.fiber.dispose()}finally{await rm(root,{recursive:true,force:true})}})
 new NativeSessions(ctx);authority(ctx);const backend=new PiPersistence(ctx,{root});new NativeQuery(ctx);await ctx.fiber.await()
 const session=ctx.sessions.prepare('committed-context')
 session.append('user/message',createUserMessage({source:{kind:'user'},content:[{type:'text',text:'COMMITTED_PI_CONTEXT'}]}),{surfaceOp:'append'})
 const writer=await backend.create(session.header);await writer.append(session.snapshotEvents());await writer.close()
 const path=join(root,piJournalFilename(session.id)),before=await readFile(path)
 const decoded=decodePiJournal(before,session.id,{requireComplete:true})
 const observation=await ctx.sessionQuery.observeSession(session.id)
 assert.deepEqual(observation.context.piMessages,buildSessionContext(decoded.entries,decoded.entries.at(-1).id).messages)
 assert.equal(observation.context.engine,'pi-session-manager')
 assert.equal(observation.context.eventCount,session.seq)
 assert.ok(JSON.stringify(observation.context.piMessages).includes('COMMITTED_PI_CONTEXT'))
 assert.deepEqual(observation.context.projection,buildSessionProjection(decoded.entries,decoded.entries.at(-1).id))
 assert.equal(Object.hasOwn(observation.context,'hostMessages'),false)
 assert.equal(ctx.sessions.get(session.id),undefined);assert.equal(backend.writers.size,0)
 assert.equal(Object.isFrozen(observation.context.projection.entries),true)
 assert.deepEqual(await readFile(path),before)
 // A read lease does not own the writer: a legitimate writer can open while
 // the retained observation keeps its exact committed context cut.
 const next=await backend.open(session.id,'write')
 assert.equal(backend.writers.size,1)
 assert.equal(observation.context.eventCount,session.seq)
 await next.close();observation[Symbol.dispose]()
 assert.deepEqual(await readFile(path),before)
 // Runtime inspection accepts only the committed prefix of a torn physical
 // tail. It never truncates the evidence or publishes that tail as context.
 await writeFile(path,Buffer.concat([before,Buffer.from('{"uncommitted":')]))
 const torn=await ctx.sessionQuery.observeSession(session.id)
 assert.equal(torn.context.eventCount,session.seq)
 assert.equal(JSON.stringify(torn.context).includes('uncommitted'),false)
 torn[Symbol.dispose]()
 assert.deepEqual(await readFile(path),Buffer.concat([before,Buffer.from('{"uncommitted":')]))
})

test('copied Night portable journal restores cold context and controlled paths through the explicit codec',async t=>{
 const parent=await mkdtemp('/tmp/night-query-portable-'),source=join(parent,'source'),target=join(parent,'restored'),sourcePaths=runtimePaths({installRoot:source}),contexts=[]
 t.after(async()=>{try{for(const ctx of contexts)await ctx.fiber.dispose()}finally{await rm(parent,{recursive:true,force:true})}})
 const setup=async paths=>{await mkdir(paths.workspaces,{recursive:true});const ctx=new Context();contexts.push(ctx);ctx.provide('portablePaths',portablePaths(paths));new NativeSessions(ctx);authority(ctx);const backend=new PiPersistence(ctx,{root:join(paths.state,'sessions')});new NativeQuery(ctx);await ctx.fiber.await();return{ctx,backend}}
 const first=await setup(sourcePaths),session=first.ctx.sessions.prepare('portable-context',{meta:{cwd:sourcePaths.workspaces}})
 session.append('working-directory/change',{cwd:sourcePaths.workspaces})
 session.append('user/message',createUserMessage({source:{kind:'user'},content:[{type:'text',text:'NIGHT_BACKUP_CONTEXT'}]}),{surfaceOp:'append'})
 const writer=await first.backend.create(session.header);await writer.append(session.snapshotEvents());await writer.close()
 await first.ctx.fiber.dispose();await cp(source,target,{recursive:true})
 const paths=runtimePaths({installRoot:target}),restored=await setup(paths),path=join(paths.state,'sessions',piJournalFilename(session.id)),before=await readFile(path),codec=portablePaths(paths)
 const observation=await restored.ctx.sessionQuery.observeSession(session.id),decoded=decodePiJournal(before,session.id,{codec,requireComplete:true})
 assert.equal(observation.header.cwd,paths.workspaces)
 assert.equal(observation.events.find(event=>event.type==='working-directory/change').data.cwd,paths.workspaces)
 assert.deepEqual(observation.context.piMessages,buildSessionContext(decoded.entries,decoded.entries.at(-1).id).messages)
 assert.deepEqual(observation.context.projection,buildSessionProjection(decoded.entries,decoded.entries.at(-1).id))
 assert.equal(Object.hasOwn(observation.context,'hostMessages'),false)
 assert.equal(observation.context.eventCount,session.seq)
 const nativeSurface=await restored.ctx.sessionQuery.readSurface(session.id),documents=await restored.ctx.sessionQuery.readContextProjection(session.id)
 assert.equal(nativeSurface.session.cwd,paths.workspaces)
 assert.equal(nativeSurface.authority,'pi-session-manager')
 assert.deepEqual(documents.messages,observation.context.projection.messages)
 assert.ok(JSON.stringify(documents.messages).includes('NIGHT_BACKUP_CONTEXT'))
 assert.equal(restored.ctx.sessions.get(session.id),undefined);assert.equal(restored.backend.writers.size,0)
 observation[Symbol.dispose]();assert.deepEqual(await readFile(path),before)
})
