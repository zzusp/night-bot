import test from 'node:test'
import assert from 'node:assert/strict'
import * as llm from '../src/native-llm-protocol.js'
import * as tools from '../src/native-tool-protocol.js'
import NativeTools from '../src/native-tools.js'
test('internal execution entrypoints resolve owned services and the application scheduler capability',async()=>{
 const toolNamespace=await import('../packages/capability-compat/tools/index.js')
 assert.equal(toolNamespace.default,NativeTools)
 const modelNamespace=await import('../packages/capability-compat/llm/index.js')
 assert.equal(Object.hasOwn(modelNamespace,'default'),false)
 assert.equal(Object.hasOwn(modelNamespace,'LlmRuntime'),false)
 const alias=await import('../packages/capability-compat/tools/index.js')
 assert.equal(alias.TOOL_RUNTIME_SCHEDULER,tools.TOOL_RUNTIME_SCHEDULER)
 assert.equal(typeof alias.TOOL_RUNTIME_SCHEDULER,'symbol')
 assert.notEqual(alias.TOOL_RUNTIME_SCHEDULER,Symbol('night-bot.tool-scheduler'))
})
test('canonical model errors retain strict trusted identity and validated detached failure facts',async()=>{
 const cause=new Error('cause')
 const options={cause,status:429,providerRetryAfterMs:100,requestId:'fixture',offloadImages:2}
 const current=new llm.LlmError('fixture','RATE_LIMIT',options)
 assert.equal(current.name,'LlmError');assert.equal(current.message,'fixture');assert.deepEqual(current.failure,{message:'fixture',code:'RATE_LIMIT',status:429,providerRetryAfterMs:100,requestId:'fixture',offloadImages:2})
 assert.equal(current.cause,cause);assert.equal(Object.isFrozen(current.failure),true)
 assert.equal(llm.isHarnessError(current),true);assert.equal(llm.isHarnessError({message:'fake',code:'RATE_LIMIT'}),false)
 for(const invalid of [{status:99},{status:600},{providerRetryAfterMs:0},{requestId:''}])assert.throws(()=>new llm.LlmError('fixture','CODE',invalid))
})
test('historical Session and model namespaces expose canonical native implementations',async()=>{
 const session=await import('../packages/capability-compat/session/index.js')
 const protocol=await import('../src/native-session-protocol.js')
 const api=await import('../packages/capability-compat/llm/index.js')
 assert.equal(session.Session,protocol.Session)
 assert.equal(session.snapshotSessionEvent,protocol.snapshotSessionEvent)
 assert.equal(api.HarnessError,llm.HarnessError);assert.equal(api.LlmError,llm.LlmError)
 const request={};api.markAgentLoopRequest(request);assert.equal(llm.isAgentLoopRequest(request),true)
})

test('tool schemas reject invalid nested values and SDK declarations expose constrained arguments',()=>{
 const schema={type:'object',properties:{name:{type:'string',enum:['a','b']},rows:{type:'array',items:{type:'integer'}}},required:['name'],additionalProperties:false}
 tools.assertSupportedJsonSchema(schema)
 for(const valid of [{name:'a'},{name:'b',rows:[1,2]}])assert.deepEqual(tools.validateJsonSchemaValue(schema,valid),[])
 for(const invalid of [{},{name:'c'},{name:'a',rows:['bad']},{name:'a',rows:[1.5]},{name:'a',extra:true}])assert.ok(tools.validateJsonSchemaValue(schema,invalid).length)
 assert.equal(tools.jsonSchemaToTs(schema),'{ name: "a" | "b"; rows?: Array<number>; }')
 const declarations=[{name:'fixture',description:'fixture',parameters:schema}]
 const ts=tools.renderToolsSdk(declarations),py=tools.renderToolsSdkPy(declarations)
 assert.match(ts,/fixture/);assert.match(ts,/name: "a" \| "b"/)
 assert.match(py,/async def fixture/);assert.match(py,/Literal\["a", "b"\]/)
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
