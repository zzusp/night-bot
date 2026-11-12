import test from 'node:test'
import assert from 'node:assert/strict'
import {createServer,request} from 'node:http'
import {spawn} from 'node:child_process'
import {handleRequest} from '../packages/dingtalk-core/http.js'

test('retired task execution authorization route cannot invoke the old capability',async t=>{
 let calls=0
 const server=createServer((req,res)=>handleRequest(req,res,{authorizeTaskEffectAction(){calls++;throw Error('retired')}},{}))
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)))
 for(const authorization of [undefined,'Bearer obsolete']){
  const result=await new Promise((resolve,reject)=>{
   const req=request({hostname:'127.0.0.1',port:server.address().port,path:'/tasks/task/effects/new-action',method:'POST',headers:authorization?{authorization}:{}},res=>{const chunks=[];res.on('data',chunk=>chunks.push(chunk));res.on('end',()=>resolve({status:res.statusCode,body:JSON.parse(Buffer.concat(chunks))}))});req.on('error',reject);req.end('{}')
  })
  assert.equal(result.status,410);assert.equal(result.body.error,'TASK_EFFECT_NEW_ACTION_RETIRED')
 }
 assert.equal(calls,0)
})
test('retired new-action CLI rejects before loading configuration or credentials',async()=>{
 const result=await new Promise((resolve,reject)=>{
  const child=spawn(process.execPath,['bin/night-bot-effects.js','missing-config.json','new-action','missing-proposal.json','--operator-text-file','missing-note.txt'],{cwd:new URL('..',import.meta.url)}),chunks=[]
  child.stdout.on('data',chunk=>chunks.push(chunk));child.stderr.on('data',chunk=>chunks.push(chunk));child.on('error',reject);child.on('close',code=>resolve({code,text:Buffer.concat(chunks).toString()}))
 })
 assert.notEqual(result.code,0);assert.match(result.text,/TASK_EFFECT_NEW_ACTION_RETIRED/)
})
