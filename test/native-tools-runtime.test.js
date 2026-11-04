import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,rm,readFile,access,writeFile} from 'node:fs/promises'
import {join,dirname,basename} from 'node:path'
import NodePtcRuntime from '@deepseek-ai/dsh-ptc-runtime-node'
import {createHost} from '../src/host.js'
test('native code transport uses a real isolated Node RPC worker and enforces workspace writes', {timeout:20000}, async t=>{
 const root=await mkdtemp('/tmp/night-native-code-worker-'),work=join(root,'work'),outside=join(dirname(process.cwd()),'.night-code-denied-'+basename(root)+'.txt');let host,handle
 t.after(async()=>{try{await handle?.dispose();await host?.close()}finally{await rm(root,{recursive:true,force:true});await rm(outside,{force:true})}})
 host=await createHost({stateDir:join(root,'state'),workspaceDir:work,model:{provider:'fixture',model:'m'},providers:{fixture:{api:'openai-completions',baseURL:'http://127.0.0.1:1/v1',models:[{id:'m'}]}}})
 await host.ctx.plugin(NodePtcRuntime,{timeoutMs:5000,maxTimeoutMs:10000})
 assert.ok(host.ctx.get('ptcRuntime'))
 handle=await host.ctx.agents.create({sessionId:'native-code-rpc',meta:{cwd:work},setup:async ctx=>{
  await host.ctx.agentPresets.mount(ctx,'night-bot')
  ctx.tools.presentAs('ptc');ctx.tools.register({name:'echo',description:'Echo a structured RPC value',parameters:{type:'object',required:['text'],properties:{text:{type:'string'}},additionalProperties:false},output:{schema:{type:'object',required:['text'],properties:{text:{type:'string'}},additionalProperties:false},render:(_args,value)=>[{type:'text',text:value.text}]},execute:async args=>args})
 }})
 // The application sandbox deliberately permits the host temporary directory.
 // Prove a parent-directory path is ordinarily writable before testing denial.
 await writeFile(outside,'baseline host permission');await rm(outside)
 const code=`const fs = await import('node:fs/promises'); await fs.writeFile('inside.txt', 'within workspace'); await tools.write({ file_path: 'rpc-inside.txt', content: 'nested filesystem tool' }); let denied = false; try { await fs.writeFile(${JSON.stringify(outside)}, 'must fail'); } catch { denied = true; } return { rpc: await tools.echo({ text: 'REAL_NODE_RPC' }), denied, emptyEnvironment: Object.keys(process.env).length === 0 };`
 const result=await handle.agent.ctx.tools.execute({callId:'actual-code-rpc',name:'run_code',arguments:{description:'Verify isolated RPC and workspace policy',code},agent:handle.agent,signal:new AbortController().signal})
 assert.equal(result.isError,false,JSON.stringify(result));assert.equal(result.value.result.rpc.text,'REAL_NODE_RPC');assert.equal(result.value.result.denied,true,'outside write denied: '+JSON.stringify(result));assert.equal(result.value.result.emptyEnvironment,true,'empty worker environment: '+JSON.stringify(result));assert.equal(await readFile(join(work,'inside.txt'),'utf8'),'within workspace');assert.equal(await readFile(join(work,'rpc-inside.txt'),'utf8'),'nested filesystem tool');await assert.rejects(access(outside),e=>e.code==='ENOENT');const events=handle.agent.session.snapshotEvents();assert.equal(events.filter(e=>e.type==='tool/ptc-dispatch-start').length,2);assert.equal(events.filter(e=>e.type==='tool/ptc-dispatch').length,2)
})
