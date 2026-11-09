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

test('双提供方同名模型保持联合身份，目录观察不解析选择、不推理也不泄露秘密',async t=>{
 let requests=0
 const server=createServer((_req,res)=>{requests++;res.writeHead(500);res.end()})
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
 t.after(()=>new Promise(resolve=>server.close(resolve)))
 const url=`http://127.0.0.1:${server.address().port}`
 const raw={
  alpha:{api:'openai-completions',apiKeyEnv:'ALPHA_KEY',baseURL:url+'/alpha/v1',displayName:'Alpha',headers:{'X-Private':'private-route-secret'},models:[{id:'shared',name:'Alpha shared',input:['text'],maxTokens:80,contextWindow:8192}]},
  beta:{api:'openai-completions',apiKeyEnv:'BETA_KEY',baseURL:url+'/beta/v1',displayName:'Beta',models:[{id:'shared',name:'Beta shared',input:['text','image'],maxTokens:160,contextWindow:16384}]},
 }
 const f=fixture(raw);t.after(()=>f.official.close())
 const selected={provider:'beta',model:'shared'}
 assert.deepEqual(await f.routes.validateSelection(selected),selected)
 const alpha=await f.official.resolve({provider:'alpha',model:'shared'}),beta=await f.official.resolve(selected)
 assert.equal(alpha.model.provider,'alpha');assert.equal(beta.model.provider,'beta')
 assert.equal(alpha.model.id,beta.model.id);assert.notEqual(alpha.model.baseUrl,beta.model.baseUrl)
 const before={...selected},modelBefore=beta.model
 const resolve=t.mock.method(f.official,'resolve',f.official.resolve.bind(f.official))
 const view={providers:f.routes.listProviders(),configurable:f.routes.configurableProviders(),alpha:await f.routes.listModels('alpha'),beta:await f.routes.listModels('beta'),descriptors:[await f.routes.describeModel('alpha','shared'),await f.routes.describeModel('beta','shared')]}
 assert.deepEqual(view.alpha,[{provider:'alpha',id:'shared',name:'Alpha shared',inputModalities:['text']}])
 assert.deepEqual(view.beta,[{provider:'beta',id:'shared',name:'Beta shared',inputModalities:['text','image']}])
 assert.deepEqual(view.descriptors.map(row=>[row.provider,row.id,row.defaultMaxTokens,row.context.contextWindow]),[['alpha','shared',80,8192],['beta','shared',160,16384]])
 await assert.rejects(f.routes.describeModel('missing','shared'),{code:'MODEL_PROVIDER_UNAVAILABLE'})
 assert.equal(resolve.mock.callCount(),0)
 assert.deepEqual(selected,before);assert.equal(beta.model,modelBefore)
 assert.equal(requests,0)
 for(const secret of ['private-route-secret','private-metadata-fixture',url])assert.ok(!JSON.stringify(view).includes(secret))
})
