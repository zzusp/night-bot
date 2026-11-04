import test from 'node:test'
import assert from 'node:assert/strict'
import {createServer} from 'node:http'
import {mkdtemp,writeFile,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {spawn} from 'node:child_process'
import {createHost} from '../src/host.js'
import {createUserMessage} from '@deepseek-ai/dsh-llm'
const sleep=ms=>new Promise(r=>setTimeout(r,ms))
async function cli(path,args,input=''){return new Promise((resolve,reject)=>{const child=spawn(process.execPath,['bin/night-bot-auth.js',path,...args],{cwd:new URL('..',import.meta.url),stdio:['pipe','pipe','pipe']}),timer=setTimeout(()=>{child.kill('SIGKILL');reject(new Error('auth subprocess timeout'))},10000);let output='';child.stdout.on('data',c=>output+=c);child.stderr.on('data',c=>output+=c);child.on('error',reject);child.on('exit',code=>{clearTimeout(timer);code===0?resolve(output):reject(new Error('auth subprocess failed'))});child.stdin.end(input)})}
test('standalone operator writes and deletes refresh the running Host before its next real Pi request',{timeout:20000},async t=>{
 const root=await mkdtemp(join(tmpdir(),'night-operator-wire-')),keys=[],handles=[];let host
 const server=createServer(async(req,res)=>{for await(const _ of req){}keys.push(req.headers.authorization);res.writeHead(200,{'content-type':'text/event-stream'});for(const [delta,finish_reason]of [[{role:'assistant',content:'verified'},null],[{},'stop']])res.write('data: '+JSON.stringify({id:'operator-wire',object:'chat.completion.chunk',model:'m',choices:[{index:0,delta,finish_reason}]})+'\n\n');res.end('data: [DONE]\n\n')})
 t.after(async()=>{try{for(const h of handles)await h.dispose()}finally{try{await host?.close()}finally{await new Promise(r=>server.close(r));await rm(root,{recursive:true,force:true})}}})
 await new Promise(r=>server.listen(0,'127.0.0.1',r))
 const config={stateDir:join(root,'state'),workspaceDir:join(root,'work'),model:{provider:'fixture',model:'m'},providers:{fixture:{api:'openai-completions',apiKeyEnv:'NIGHT_OPERATOR_WIRE_KEY',baseURL:`http://127.0.0.1:${server.address().port}/v1`,models:[{id:'m',contextWindow:4096,maxTokens:128}]}}},path=join(root,'config.json');await writeFile(path,JSON.stringify(config))
 host=await createHost(config,{environmentOptions:{cwd:root,home:root,inherited:{}}})
 const changed=async configured=>{for(let i=0;i<100;i++){if((await host.ctx.credentials.describe('NIGHT_OPERATOR_WIRE_KEY')).configured===configured)return;await sleep(25)}assert.fail('credential watcher did not publish the external replacement')}
 for(const [id,key]of [['first','fixture-external-one'],['second','fixture-external-two']]){
  await cli(path,['set-ref','NIGHT_OPERATOR_WIRE_KEY'],key+'\n')
  for(let i=0;i<100&&(await host.ctx.credentials.resolve('NIGHT_OPERATOR_WIRE_KEY'))?.value!==key;i++)await sleep(25)
  assert.equal((await host.ctx.credentials.resolve('NIGHT_OPERATOR_WIRE_KEY')).value,key)
  const h=await host.ctx.agents.create({sessionId:id,agentOptions:{provider:'fixture',model:'m'},meta:{cwd:config.workspaceDir}});handles.push(h);h.agent.steer(createUserMessage({source:{kind:'user'},content:[{type:'text',text:'verify'}]}));await h.agent.whenIdle();assert.equal(h.agent.providerStreamProtocol,'pi-native')
 }
 assert.deepEqual(keys,['Bearer fixture-external-one','Bearer fixture-external-two']);await cli(path,['unset-ref','NIGHT_OPERATOR_WIRE_KEY']);await changed(false);assert.equal(process.env.NIGHT_OPERATOR_WIRE_KEY,undefined)
})
