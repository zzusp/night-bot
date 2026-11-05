import test from 'node:test'
import assert from 'node:assert/strict'
import {runInNewContext} from 'node:vm'
import {validateJsonSchemaValue as validate, defineTool} from '../src/native-tool-protocol.js'

const object = {type:'object',properties:{name:{type:'string'}},required:['name'],additionalProperties:false}
test('tool contract diagnostics preserve required, child, and undeclared-property order',()=>{
 assert.deepEqual(validate(object,{name:12,other:true},''),['"name" must be a string','"other" is not a declared property (additionalProperties: false)'])
 assert.deepEqual(validate(object,{},''),['missing required property "name"'])
 const union={oneOf:[{type:'integer'},{type:'number'}]}
 assert.match(validate(union,1)[0],/matched 2/)
 assert.deepEqual(validate(union,1.5),[])
})
test('schema evaluation captures accessors once before checking mutually exclusive branches',()=>{
 let reads=0
 const input={get name(){reads++;return reads===1?'first':7}}
 const schema={oneOf:[object,{type:'object',properties:{name:{type:'integer'}},required:['name'],additionalProperties:false}]}
 assert.deepEqual(validate(schema,input),[])
 assert.equal(reads,1)
})
test('tool values reject hidden, sparse, cyclic and hostile data even in open properties',()=>{
 const cycle={};cycle.self=cycle
 const hostile={get name(){throw new Error('private value must not escape')}}
 for(const value of [undefined,NaN,Infinity,-0,1n,new Date(),new Array(2),cycle,hostile,{extra:undefined},{[Symbol()]:true},Object.create({name:'inherited'})]) {
  const errors=validate({},value)
  assert.equal(errors.length,1)
  assert.match(errors[0],/lossless JSON/)
  assert.doesNotMatch(errors[0],/private value/)
 }
 assert.deepEqual(validate(object,runInNewContext('({name:"realm"})')),[])
 assert.deepEqual(validate(object,Object.assign(Object.create(null),{name:'null prototype'})),[])
})
test('deep tool contracts use bounded call stack and capture each property once',()=>{
 let schema={type:'string'},value='leaf',reads=0
 for(let i=0;i<12000;i++) {
  schema={type:'object',properties:{next:schema},required:['next'],additionalProperties:false}
  const next=value;value={get next(){reads++;return next}}
 }
 assert.deepEqual(validate(schema,value),[])
 assert.equal(reads,12000)
})
test('application definitions publish immutable schemas and fail invalid calls before callbacks',async()=>{
 let effects=0
 const definition=defineTool({name:'owned',description:'owned',parameters:{name:{type:'string',required:true}},output:{schema:{type:'object',properties:{ok:{type:'boolean',required:true}},additionalProperties:false},render:()=>[]},execute:async()=>{effects++;return{ok:true}},isConcurrencySafe:()=>true,presentCall:()=> 'visible'})
 assert.ok(Object.isFrozen(definition.parameters.properties.name))
 assert.ok(Object.isFrozen(definition.output.schema.properties.ok))
 assert.throws(()=>{definition.parameters.properties.name.type='number'},TypeError)
 await assert.rejects(definition.execute({name:5},{}),error=>error.code==='INVALID_ARGS')
 assert.equal(definition.isConcurrencySafe({name:5}),false)
 assert.equal(definition.presentCall({name:5}),undefined)
 assert.deepEqual(await definition.execute({name:'safe'},{}),{ok:true})
 assert.equal(effects,1)
})
test('core numeric, string, array and uniqueness contracts are enforced at inclusive boundaries',async()=>{
 const {assertSupportedJsonSchema}=await import('../src/native-tool-protocol.js')
 const schema={type:'object',additionalProperties:false,properties:{offset:{type:'integer',minimum:0},limit:{type:'integer',minimum:1,maximum:16000},caption:{type:'string',minLength:1,maxLength:2,pattern:'^.+$'},ids:{type:'array',minItems:1,maxItems:2,uniqueItems:true,items:{type:'string',minLength:1}}},required:['offset','limit','caption','ids']}
 assert.doesNotThrow(()=>assertSupportedJsonSchema(schema))
 const valid={offset:0,limit:16000,caption:'😀a',ids:['one','two']}
 assert.deepEqual(validate(schema,valid),[])
 for(const change of [{offset:-1},{limit:0},{limit:16001},{caption:''},{caption:'abc'},{caption:'\n'},{ids:[]},{ids:['one','two','three']},{ids:['one','one']}])assert.ok(validate(schema,{...valid,...change}).length,JSON.stringify(change))
 assert.deepEqual(validate({type:'number',minimum:-1.5,maximum:2.25},2.25),[])
 assert.ok(validate({type:'number',minimum:-1.5},-1.5001).length)
 const unique={type:'array',uniqueItems:true}
 assert.ok(validate(unique,[{a:1,b:[2]},{b:[2],a:1}]).length,'object member order does not establish uniqueness')
 assert.deepEqual(validate(unique,[{a:1,b:2},{a:2,b:1},['a,b'],['a','b']]),[])
 assert.deepEqual(validate({type:'array',uniqueItems:false},[1,1]),[])
 const definition=defineTool({name:'bounded',parameters:{limit:{type:'integer',minimum:1,maximum:100,required:true},rows:{type:'array',maxItems:1,items:{type:'string',minLength:1}}},output:{schema:{type:'json'},render:()=>[]},execute:async args=>args})
 assert.equal(definition.parameters.properties.limit.maximum,100)
 await assert.rejects(definition.execute({limit:101}),error=>error.code==='INVALID_ARGS')
 await assert.rejects(definition.execute({limit:1,rows:['']}),error=>error.code==='INVALID_ARGS')
})
test('schema admission rejects malformed, misplaced, contradictory and unknown constraints',async()=>{
 const {assertSupportedJsonSchema}=await import('../src/native-tool-protocol.js')
 for(const schema of [
  {type:'integer',minimum:'0'}, {type:'number',maximum:Infinity}, {type:'number',minimum:2,maximum:1},
  {type:'string',minimum:0},{type:'array',minItems:-1},{type:'array',maxItems:1.5},{type:'array',uniqueItems:'true'},
  {type:'string',minLength:2,maxLength:1},{type:'string',pattern:'['},{type:'string',pattern:12},
  {type:'array',minItems:2,maxItems:1},{type:'object',maxLength:1},{minimum:0},
  {oneOf:[{type:'number'},{type:'null'}],minimum:0},{type:'integer',madeUp:1}
 ])assert.throws(()=>assertSupportedJsonSchema(schema),error=>error.code==='UNSUPPORTED_SCHEMA',JSON.stringify(schema))
})
test('type-free core task state enums and JSON const values stay constrained',async()=>{
 const {assertSupportedJsonSchema}=await import('../src/native-tool-protocol.js')
 const state={enum:['running','completed','all']}
 assert.doesNotThrow(()=>assertSupportedJsonSchema(state))
 assert.deepEqual(validate(state,'completed'),[])
 for(const invalid of ['invented',null,12,{}])assert.ok(validate(state,invalid).length)
 const json={enum:[{kind:'task',ids:[1,2]},null,1]}
 assert.doesNotThrow(()=>assertSupportedJsonSchema(json))
 assert.deepEqual(validate(json,{ids:[1,2],kind:'task'}),[])
 assert.ok(validate(json,{kind:'task',ids:[2,1]}).length)
 assert.deepEqual(validate({const:{a:1,b:2}},{b:2,a:1}),[])
 assert.ok(validate({const:{a:1,b:2}},{b:2,a:2}).length)
 for(const invalid of [{enum:[]},{enum:[undefined]},{const:undefined},{enum:['allowed'],const:'other'}])assert.throws(()=>assertSupportedJsonSchema(invalid),error=>error.code==='UNSUPPORTED_SCHEMA')
})
test('observedAt date-time format enforces calendar dates, times and explicit timezone semantics',async()=>{
 const {assertSupportedJsonSchema}=await import('../src/native-tool-protocol.js')
 const {observedHostExitSchema}=await import('../packages/dingtalk-core/native-restart-scope-probe.js')
 assert.doesNotThrow(()=>assertSupportedJsonSchema(observedHostExitSchema))
 const schema={type:'string',format:'date-time'}
 for(const value of ['2026-11-05T15:21:56.682Z','2024-02-29T23:59:59Z','2000-02-29T00:00:00+08:00','2026-11-05t15:21:56z','2026-11-05T15:21:56.123456-04:30','2026-11-05T00:00:00-00:00'])assert.deepEqual(validate(schema,value),[],value)
 for(const value of ['2026-02-29T00:00:00Z','1900-02-29T00:00:00Z','2026-02-30T12:00:00Z','2026-04-31T00:00:00Z','2026-00-01T00:00:00Z','2026-13-01T00:00:00Z','2026-11-00T00:00:00Z','2026-11-05T24:00:00Z','2026-11-05T23:60:00Z','2026-11-05T23:59:60Z','2026-11-05T15:21:56','2026-11-05 15:21:56Z','2026-11-05T15:21:56+24:00','2026-11-05T15:21:56+08:60','2026-11-05T15:21:56+0800','2026-11-05T15:21Z',' 2026-11-05T15:21:56Z','2026-11-05T15:21:56Z\n'])assert.ok(validate(schema,value).length,value)
 for(const format of ['email','uri','unknown',null,42])assert.throws(()=>assertSupportedJsonSchema({type:'string',format}),error=>error.code==='UNSUPPORTED_SCHEMA')
 assert.throws(()=>assertSupportedJsonSchema({type:'number',format:'date-time'}),error=>error.code==='UNSUPPORTED_SCHEMA')
 const tool=defineTool({name:'observed',parameters:{observedAt:{type:'string',format:'date-time',required:true}},output:{schema:{type:'json'},render:()=>[]},execute:async args=>args})
 assert.equal(tool.parameters.properties.observedAt.format,'date-time')
 await assert.rejects(tool.execute({observedAt:'2026-02-30T12:00:00Z'}),error=>error.code==='INVALID_ARGS')
 assert.deepEqual(validate(observedHostExitSchema,{observedAt:'2026-11-05T15:21:56.682Z',evidenceRef:'operator evidence'}),[])
})
