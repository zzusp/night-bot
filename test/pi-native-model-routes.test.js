import test from 'node:test'
import assert from 'node:assert/strict'
import {createServer} from 'node:http'
import {NativeModelRoutes} from '../src/native-model-routes.js'
import {OfficialPiModelRuntime} from '../src/pi-official-model-runtime.js'
import {resolvePiProfiles} from '../src/pi-provider-catalog.js'
import {piAuthentication} from '../src/pi-provider-auth.js'

function fixture(raw){
 let profiles=resolvePiProfiles(raw,{deferred:true})
 const authentication=piAuthentication({getEnvironment:()=> 'private-metadata-fixture'})
 const official=new OfficialPiModelRuntime({get:()=>undefined},()=>profiles,authentication)
 const routes=new NativeModelRoutes({profiles:()=>profiles,official,authentication,settingsNs:'fixture-settings'})
 return {routes,official,update:raw=>{profiles=resolvePiProfiles(raw,{deferred:true})}}
}
const configured=()=>({fixture:{api:'openai-completions',apiKeyEnv:'LOCAL_KEY',baseURL:'http://127.0.0.1:1/v1',displayName:'Local fixture',models:[{id:'high-only',input:['text','image'],maxTokens:80,contextWindow:8192,reasoningEfforts:{high:'high'}}]}})
test('model UI is a current official descriptor view and exposes no stream adapter',async()=>{
 const f=fixture(configured()),routes=f.routes
 assert.deepEqual(routes.listProviders(),[{id:'fixture',name:'Local fixture'}])
 assert.deepEqual((await routes.listModels('fixture')).map(model=>model.id),['high-only'])
 const info=await routes.describeModel('fixture','high-only')
 assert.deepEqual(info.reasoning.efforts.map(effort=>effort.id),['high']);assert.equal(info.reasoning.defaultEffort,undefined);assert.equal(info.defaultMaxTokens,80)
 assert.equal(routes.stream,undefined);assert.equal(routes.prepareCall,undefined)
 assert.ok(!JSON.stringify(info).includes('private-metadata-fixture'))
 assert.deepEqual(await routes.validateSelection({provider:'fixture',model:'high-only'}),{provider:'fixture',model:'high-only'})
 await assert.rejects(routes.validateSelection({provider:'fixture',model:'high-only',reasoningEffort:'medium'}),{code:'UNSUPPORTED_REASONING_EFFORT'})
 await assert.rejects(routes.validateSelection({provider:'fixture',model:'high-only',maxTokens:81}),{code:'INVALID_MODEL_MAX_TOKENS'})
 f.update({});assert.deepEqual(routes.listProviders(),[]);await assert.rejects(routes.describeModel('fixture','high-only'),{code:'MODEL_PROVIDER_UNAVAILABLE'})
 await f.official.close()
})
test('discovery uses exact provider-scoped credentials and refuses endpoint credential forwarding',async t=>{
 let received
 const server=createServer(async(req,res)=>{received={headers:req.headers,url:req.url};res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({data:[{id:'discovered-model'}]}))})
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)))
 const raw=configured();raw.fixture.baseURL=`http://127.0.0.1:${server.address().port}/v1`
 const f=fixture(raw);t.after(()=>f.official.close())
 assert.deepEqual(await f.routes.discover({provider:'fixture'}),[{id:'discovered-model',name:'discovered-model'}])
 assert.equal(received.headers.authorization,'Bearer private-metadata-fixture');assert.equal(received.url,'/v1/models')
 assert.throws(()=>f.routes.discover({provider:'fixture',baseURL:raw.fixture.baseURL+'/other'}),{code:'DISCOVERY_AUTH_SCOPE_MISMATCH'})
 assert.throws(()=>f.routes.discover({provider:' fixture'}),{code:'DISCOVERY_PROVIDER_REQUIRED'})
 const available=f.routes.configurableProviders().find(provider=>provider.provider==='fixture');assert.equal(available.settingsNs,'fixture-settings');assert.deepEqual(available.settingsPath,['providers','fixture'])
})
