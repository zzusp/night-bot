import test from 'node:test'
import assert from 'node:assert/strict'
import {createServer} from 'node:http'
import {discoverPiModels} from '../src/pi-provider-discovery.js'
test('native discovery reads installed catalog without resolving credentials or network',async()=>{
 const models=await discoverPiModels({provider:'openai'},()=>{throw new Error('must not resolve secrets')});assert.ok(models.length>1);assert.ok(models[0].contextWindow)
})
test('native discovery preserves gateway path, draft credential precedence, Anthropic headers and listing metadata',async t=>{
 const requests=[],server=createServer((req,res)=>{requests.push({url:req.url,headers:req.headers});res.setHeader('content-type','application/json');res.end(JSON.stringify(req.url.includes('anthropic')?{models:{'model-id':{display_name:'Model',limit:{context:99,output:11}}}}:{data:[{id:'model-id',name:'Model',context_length:99,max_output_tokens:11}]}))});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)))
 const root=`http://127.0.0.1:${server.address().port}`,stored=()=>({headers:{'x-config':'stored'},resolveApiKey:()=>{throw new Error('draft key wins')}})
 assert.deepEqual(await discoverPiModels({baseURL:root+'/gateway/v1/',apiKey:' draft-fixture '},stored),[{id:'model-id',name:'Model',contextWindow:99,maxTokens:11}]);assert.equal(requests[0].url,'/gateway/v1/models');assert.equal(requests[0].headers.authorization,'Bearer draft-fixture');assert.equal(requests[0].headers['x-config'],'stored')
 await discoverPiModels({baseURL:root+'/anthropic/v1',api:'anthropic-messages',apiKey:'anthropic-fixture'});assert.equal(requests[1].url,'/anthropic/v1/models?limit=1000');assert.equal(requests[1].headers['x-api-key'],'anthropic-fixture');assert.equal(requests[1].headers['anthropic-version'],'2023-06-01')
})
test('native discovery refuses oversized reply, malformed key, unsupported protocol and preserves caller abort',async t=>{
 const server=createServer((req,res)=>{if(req.url.startsWith('/oversized')){res.setHeader('content-length','5000000');res.end()}else{res.writeHead(200);res.write(' ')} });await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>{server.closeAllConnections();return new Promise(resolve=>server.close(resolve))});const root=`http://127.0.0.1:${server.address().port}`
 await assert.rejects(discoverPiModels({baseURL:root+'/oversized'}),e=>e.code==='DISCOVERY_FAILED');await assert.rejects(discoverPiModels({baseURL:root,apiKey:'bad\nkey'}),e=>e.code==='INVALID_CREDENTIAL');await assert.rejects(discoverPiModels({baseURL:root,api:'azure-openai-responses'}),e=>e.code==='DISCOVERY_UNSUPPORTED')
 const controller=new AbortController(),pending=discoverPiModels({baseURL:root,signal:controller.signal});controller.abort();await assert.rejects(pending,e=>e.code==='ABORTED')
})
