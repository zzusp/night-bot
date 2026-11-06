import test from 'node:test'
import assert from 'node:assert/strict'
import {createServer} from 'node:http'
import {handleRequest} from '../packages/dingtalk-core/http.js'

test('retired Topic hold and scope writes return 410 before calling any runtime mutation',async t=>{
 let calls=0
 const runtime=new Proxy({},{get(){calls++;throw Error('Retired write must not reach runtime')}})
 const server=createServer((req,res)=>handleRequest(req,res,runtime));await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
 t.after(()=>new Promise(resolve=>server.close(resolve)))
 for(const path of ['/config/groups/g/messages/m/routing-hold','/config/groups/g/topics/t','/runtime/task-topics/retry']){
  const response=await fetch(`http://127.0.0.1:${server.address().port}${path}`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({messageVersion:1,epoch:1,resume:true})})
  assert.equal(response.status,410);assert.equal((await response.json()).error,'TOPIC_ROUTING_RETIRED')
 }
 assert.equal(calls,0)
})
