import test from 'node:test'
import assert from 'node:assert/strict'
import {appendFile,readFile} from 'node:fs/promises'
import {join} from 'node:path'
import {memoryHost} from './fixtures/memory-host.js'
import {piJournalFilename} from '../src/runtime/pi-journal.js'
import {projectInterruptedRouterCalls,unresolvedRouterCalls} from '../src/runtime/pi-router-recovery-view.js'

test('interrupted Router projection preserves raw evidence and does not synthesize successful results',()=>{
 const messages=[{role:'assistant',stopReason:'toolUse',content:[{type:'toolCall',id:'unknown',name:'resident_router_reply',arguments:{operationId:'old',sourceId:'source',text:'Original'}}]},{role:'assistant',stopReason:'toolUse',content:[{type:'toolCall',id:'paired',name:'resident_task_query',arguments:{}}]},{role:'toolResult',toolCallId:'paired',toolName:'resident_task_query',isError:false,content:[{type:'text',text:'[]'}]}]
 const before=structuredClone(messages),view=projectInterruptedRouterCalls(messages)
 assert.deepEqual(messages,before);assert.deepEqual(unresolvedRouterCalls(messages),[before[0].content[0]])
 assert.deepEqual(view[1],before[1]);assert.deepEqual(view[2],before[2]);assert.equal(view.length,messages.length)
 const fact=JSON.parse(view[0].content[0].text);assert.equal(fact.status,'unknown');assert.equal(fact.callId,'unknown');assert.deepEqual(fact.arguments,before[0].content[0].arguments)
 assert.equal(view.filter(message=>message.role==='toolResult').length,1)
})

test('catalog isolates only checksum-identifiable Router corruption; strict reads and other session corruption fail closed',async t=>{
 const f=await memoryHost(t),ctx=f.host.ctx,id='damaged-router'
 const handle=await ctx.agents.create({sessionId:id,meta:{cwd:ctx.runtimePaths.workspaces,runtimeOwner:'conversation-router',conversationId:'isolated-fixture',generation:1},agentOptions:f.config.model,authorizeInput:()=>false})
 await handle.dispose()
 const path=join(ctx.runtimePaths.state,'sessions',piJournalFilename(id));await appendFile(path,'damaged-tail\n')
 const original=await readFile(path)
 await assert.rejects(ctx.sessionPersistence.list(),{code:'PI_SESSION_JOURNAL_CORRUPT'})
 assert.ok(!(await ctx.sessionCatalog.listHeaders()).some(header=>header.id===id))
 await assert.rejects(ctx.sessionCatalog.header(id),{code:'PI_SESSION_JOURNAL_CORRUPT'})
 assert.deepEqual(await readFile(path),original)
 const ordinary=await f.agent('damaged-ordinary');await ordinary.dispose()
 await appendFile(join(ctx.runtimePaths.state,'sessions',piJournalFilename('damaged-ordinary')),'damaged-tail\n')
 await assert.rejects(ctx.sessionCatalog.listHeaders(),{code:'PI_SESSION_JOURNAL_CORRUPT'})
})
