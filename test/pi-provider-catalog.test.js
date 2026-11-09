import test from 'node:test'
import assert from 'node:assert/strict'
import { builtinProviders,getBuiltinModels } from '@earendil-works/pi-ai/providers/all'
import { resolvePiProfiles,configuredPiModels } from '../src/pi-provider-catalog.js'
test('native catalog preserves every installed chat provider and every shipped model descriptor',()=>{
  const declarations=Object.fromEntries(builtinProviders().filter(p=>getBuiltinModels(p.id).length).map(p=>[p.id,{}]))
  const profiles=resolvePiProfiles(declarations),models=configuredPiModels(profiles)
  assert.ok(profiles.size>40)
  for(const [provider,profile]of profiles){
    const baseline=getBuiltinModels(provider)
    assert.deepEqual(models.getModels(provider).map(m=>m.id),baseline.map(m=>m.id),provider)
    for(const expected of baseline){const actual=profile.models.find(m=>m.id===expected.id);for(const key of Object.keys(expected))assert.deepEqual(actual[key],expected[key],provider+'/'+expected.id+':'+key)}
    assert.equal(models.getProvider(provider).auth.apiKey,profile.baseProvider.auth.apiKey)
  }
})
test('declared endpoint config retains actual parameters, reasoning spellings, cap and compat precedence',()=>{
  const p=resolvePiProfiles({gateway:{api:'openai-completions',baseURL:'http://127.0.0.1:1/v1',apiKeyEnv:'LOCAL_KEY',headers:{'x-route':'configured'},compat:{supportsStore:false,supportsDeveloperRole:false},models:[{id:'new-model',maxTokens:1200,input:['text','image'],reasoningEfforts:{off:null,high:'enabled'},compat:{supportsDeveloperRole:true}}]}}).get('gateway')
  const m=p.models[0];assert.equal(m.maxTokens,1200);assert.equal(p.configuredMaxTokens.get(m.id),1200);assert.deepEqual(m.input,['text','image']);assert.equal(m.thinkingLevelMap.high,'enabled');assert.equal(m.thinkingLevelMap.low,null);assert.equal('off'in m.thinkingLevelMap,false);assert.equal(m.compat.supportsDeveloperRole,true);assert.equal(m.compat.supportsStore,false);assert.equal(p.headers['x-route'],'configured')
})
test('catalog model overrides replace only declared metadata and reject conflicting catalog replacement',()=>{
  const base=getBuiltinModels('openai')[0]
  const p=resolvePiProfiles({openai:{modelOverrides:{[base.id]:{maxTokens:111}}}}).get('openai')
  assert.equal(p.models.find(m=>m.id===base.id).maxTokens,111)
  assert.equal(p.models.length,getBuiltinModels('openai').length)
  assert.throws(()=>resolvePiProfiles({openai:{models:[{id:base.id}],modelOverrides:{[base.id]:{maxTokens:111}}}}),/modelOverrides/)
})
test('stored unavailable models remain diagnosable without deleting healthy routes',()=>{
  const profiles=resolvePiProfiles({broken:{api:'openai-completions',baseURL:'https://invalid.example',models:[{id:'bad',maxTokens:-1}]},openai:{}},{deferred:true})
  assert.ok(profiles.get('broken').modelErrors.get('bad'));assert.ok(profiles.get('openai').models.length)
  assert.throws(()=>resolvePiProfiles({broken:{api:'openai-completions',baseURL:'https://invalid.example',models:[{id:'bad',maxTokens:-1}]}}),/maxTokens/)
})
for(const [label,patch]of Object.entries({duplicate:{models:[{id:'m'},{id:'m'}]},reasoning:{models:[{id:'m',reasoningEfforts:{high:null}}]},compat:{compat:{sendSessionAffinityHeaders:true}},wrongProtocol:{api:'azure-openai-responses'},unusedCompat:{api:'anthropic-messages',compat:{supportsDeveloperRole:true}},emptyInput:{defaultInput:[]},header:{headers:{'x-invalid':'line\nbreak'}},timeout:{streamIdleTimeoutMs:2147483648},oldRetry:{maxRetries:3}}))test('native provider refuses unsupported config: '+label,()=>{
 assert.throws(()=>resolvePiProfiles({gateway:{api:'openai-completions',baseURL:'https://invalid.example',models:[{id:'m'}],...patch}}),e=>e.code==='INVALID_CONFIG')
})
test('a duplicated stored model remains diagnostic and is excluded from the served catalog',()=>{
 const profile=resolvePiProfiles({fixture:{api:'openai-completions',baseURL:'https://invalid.example',models:[{id:'duplicate'},{id:'duplicate'},{id:'healthy'}]}},{deferred:true}).get('fixture')
 assert.ok(profile.modelErrors.has('duplicate'));assert.deepEqual(profile.models.map(m=>m.id),['healthy'])
})

test('provider retry configuration uses Pi-native settings and rejects legacy policy without silent conversion',()=>{
 const declaration={api:'openai-completions',baseURL:'http://127.0.0.1:1',models:[{id:'m'}]}
 const profile=resolvePiProfiles({fixture:{...declaration,retry:{enabled:true,maxRetries:2,baseDelayMs:7,maxAgentDelayMs:11,provider:{maxRetries:0}}}}).get('fixture')
 assert.equal(profile.retrySettings.maxRetries,2);assert.equal(profile.retrySettings.baseDelayMs,7);assert.equal(profile.retrySettings.maxAgentDelayMs,11);assert.equal(profile.retrySettings.provider.maxRetries,0)
 assert.equal(profile.retryPolicy,undefined)
 for(const retryPolicy of [undefined,{mode:'normal',maxRetries:0},{mode:'always'}])assert.throws(()=>resolvePiProfiles({fixture:{...declaration,retryPolicy}}),{code:'PI_RETRY_SETTINGS_MIGRATION_REQUIRED'})
})
