import test from 'node:test'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import {pathToFileURL} from 'node:url'
import * as llm from '../src/native-llm-protocol.js'
import * as tools from '../src/native-tool-protocol.js'
import NativeTools from '../src/native-tools.js'
import NativeLlm from '../src/native-llm.js'
import NativeSubagents from '../src/native-subagents.js'
test('native execution namespaces preserve every original public name and map defaults to native owners',async()=>{
 for(const [name,Owner] of [['llm',NativeLlm],['tools',NativeTools],['subagent',NativeSubagents]]){
  const alias=await import('../packages/capability-compat/'+name+'/index.js'),original=await import('./fixtures/legacy-'+name+'-interface.mjs')
  assert.equal(alias.default,Owner)
  for(const key of Object.keys(original))assert.ok(key in alias,name+': '+key)
 }
 const alias=await import('../packages/capability-compat/tools/index.js'),original=await import('./fixtures/legacy-tools-interface.mjs')
 assert.equal(alias.TOOL_RUNTIME_SCHEDULER,tools.TOOL_RUNTIME_SCHEDULER)
 assert.notEqual(alias.TOOL_RUNTIME_SCHEDULER,original.TOOL_RUNTIME_SCHEDULER)
})
test('canonical model errors retain strict trusted identity and validated detached failure facts',async()=>{
 const original=await import('./fixtures/legacy-llm-interface.mjs'),cause=new Error('cause')
 const options={cause,status:429,providerRetryAfterMs:100,requestId:'fixture',offloadImages:2}
 const current=new llm.LlmError('fixture','RATE_LIMIT',options),old=new original.LlmError('fixture','RATE_LIMIT',options)
 assert.equal(current.name,old.name);assert.equal(current.message,old.message);assert.deepEqual(current.failure,old.failure)
 assert.equal(current.cause,cause);assert.equal(Object.isFrozen(current.failure),true)
 assert.equal(llm.isHarnessError(current),true);assert.equal(llm.isHarnessError({message:'fake',code:'RATE_LIMIT'}),false)
 for(const invalid of [{status:99},{status:600},{providerRetryAfterMs:0},{requestId:''}])assert.throws(()=>new llm.LlmError('fixture','CODE',invalid))
})
test('actual retained Session SDK peer shares native model errors and request-marker protocol',async()=>{
 const root=createRequire(import.meta.url),peer=createRequire(root.resolve('@deepseek-ai/dsh-session'))
 const api=await import(pathToFileURL(peer.resolve('@deepseek-ai/dsh-llm')))
 assert.equal(api.HarnessError,llm.HarnessError);assert.equal(api.LlmError,llm.LlmError)
 const request={};api.markAgentLoopRequest(request);assert.equal(llm.isAgentLoopRequest(request),true)
})
test('tool schema validation and both code SDK renderers agree with independent original helpers',async()=>{
 const original=await import('./fixtures/legacy-tools-interface.mjs')
 const schema={type:'object',properties:{name:{type:'string',enum:['a','b']},rows:{type:'array',items:{type:'integer'}}},required:['name'],additionalProperties:false}
 for(const api of [tools,original]){
  api.assertSupportedJsonSchema(schema)
  assert.equal(api.validateJsonSchemaValue(schema,{name:'a',rows:[1,2]}).length,0)
  assert.ok(api.validateJsonSchemaValue(schema,{name:'c',rows:['bad']}).length)
 }
 assert.equal(tools.jsonSchemaToTs(schema),original.jsonSchemaToTs(schema))
 assert.equal(tools.jsonSchemaToPy(schema),original.jsonSchemaToPy(schema))
 const declarations=[{name:'fixture',description:'fixture',parameters:schema}]
 assert.equal(tools.renderToolsSdk(declarations),original.renderToolsSdk(declarations))
 assert.equal(tools.renderToolsSdkPy(declarations),original.renderToolsSdkPy(declarations))
})
test('native product attribution and invalid credential guidance preserve secrecy without visual setup references',()=>{
 assert.equal(llm.APP_IDENTITY.product,'night-bot')
 assert.match(llm.attributionHeaders()['user-agent'],/^night-bot\/.*github.com\/zzusp\/night-bot/)
 assert.equal(llm.userAgent({product:'fixture',version:'1',url:'https://fixture.invalid'}),'fixture/1 (+https://fixture.invalid)')
 assert.equal(llm.assertUsableApiKey(' fixture-key ','fixture','ENV_REF'),'fixture-key')
 for(const key of [' ','sensitive-非ASCII'])assert.throws(()=>llm.assertUsableApiKey(key,'fixture','ENV_REF'),error=>{
  assert.equal(error instanceof llm.LlmError,true);assert.equal(error.code,'INVALID_CREDENTIAL')
  assert.doesNotMatch(error.message,/sensitive|非ASCII|web Models/);return true
 })
})
