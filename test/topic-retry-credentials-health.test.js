import {join} from 'node:path'
import {tmpdir} from 'node:os'
import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,rm} from 'node:fs/promises'
import {createHost} from '../src/host.js'

test('actual official Host missing credentials retain the original provider error without a TypeError',async t=>{
 const root=await mkdtemp(join(tmpdir(),'topic-real-missing-credentials-'))
 let host,handle
 t.after(async()=>{try{await handle?.dispose();await host?.close()}finally{await rm(root,{recursive:true,force:true})}})
 host=await createHost({installRoot:root,dataDir:'data',model:{provider:'fixture',model:'m'},providers:{fixture:{api:'openai-completions',baseURL:'http://127.0.0.1:1/no-network',apiKeyEnv:'MISSING_TOPIC_REGRESSION_KEY',retry:{enabled:false,maxRetries:0,provider:{maxRetries:0}},models:[{id:'m',maxTokens:64,contextWindow:8192}]}},memory:{background:false},reflection:{enabled:false},skillWatch:false,credentialsWatch:false},{environmentOptions:{inherited:{}}})

 handle=await host.ctx.agents.create({sessionId:'missing-topic-credentials',meta:{cwd:host.ctx.runtimePaths.workspaces,agentPreset:'night-bot'},authorizeInput:packet=>packet.source.kind==='user'})
 const packet={id:'missing-key-input',source:{kind:'user'},content:[{type:'text',text:'Verify this isolated missing-key error'}]}
 await handle.enqueue(packet);await handle.deliver(packet.id);await handle.whenIdle()
 const messages=handle.actor.piSession.sessionManager.buildSessionProjection().messages
 const failure=messages.findLast(message=>message.role==='assistant'&&message.stopReason==='error')
 assert.ok(failure);assert.match(failure.errorMessage,/No credential is available for provider fixture/)
 assert.doesNotMatch(failure.errorMessage,/\.some|TypeError/)
})
