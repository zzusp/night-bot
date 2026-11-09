import test from 'node:test'
import assert from 'node:assert/strict'
import {compile,Validator} from '@earendil-works/pi-schema'
import {formats} from '@earendil-works/pi-schema/formats'
import {schemaToType} from '@earendil-works/pi-codemode/declarations'
import {officialToolValidator} from '../src/runtime/tool-schema-value.js'
import {assertSupportedJsonSchema,validateJsonSchemaValue as validate,jsonSchemaToTs,renderToolsSdk} from '../src/native-tool-protocol.js'

test('Night uses the official strict Validator without coercion or default insertion',()=>{
 const schema={type:'object',properties:{n:{type:'number',default:7}},additionalProperties:false}
 const official=officialToolValidator(schema)
 assert.ok(official instanceof Validator);assert.equal(officialToolValidator(schema),official)
 const input={};assert.equal(official.check(input),true);assert.deepEqual(input,{})
 for(const value of [{n:'42'},{n:null},{extra:true}])assert.ok(validate(schema,value).length)
 assert.deepEqual(validate(schema,{n:42}),[])
 assert.match(validate(schema,{n:'42'})[0],/expected number/)
})
test('official permissive annotations are narrowed by the explicit Night vocabulary policy',()=>{
 for(const schema of [{type:'object',unreviewedKeyword:true},{type:'string',format:'unreviewed-format'},{type:'integer',minimum:'0'},{type:'array',maxItems:1.5}]){
  assert.doesNotThrow(()=>compile(schema,{coerce:false,formats}))
  assert.throws(()=>assertSupportedJsonSchema(schema),error=>error.code==='UNSUPPORTED_SCHEMA')
 }
 const keywordAsData={type:'object',properties:{unreviewedKeyword:{type:'string'},format:{type:'string'}}}
 assert.doesNotThrow(()=>assertSupportedJsonSchema(keywordAsData))
 assert.deepEqual(validate(keywordAsData,{unreviewedKeyword:'data',format:'data'}),[])
})
test('official date-time owns format semantics; business finite-instant checks remain stronger',()=>{
 const schema={type:'string',format:'date-time'},official=compile(schema,{coerce:false,formats})
 for(const value of ['2026-11-05T12:00:00Z','2026-11-05T12:00:00+08:00','2026-02-30T12:00:00Z','2026-11-05T12:00:00','2016-12-31T23:59:60Z'])assert.equal(validate(schema,value).length===0,official.check(value),value)
 assert.equal(official.check('2016-12-31T23:59:60Z'),true)
 assert.equal(Number.isFinite(Date.parse('2016-12-31T23:59:60Z')),false,'the existing observed-exit evidence gate separately requires a finite instant')
})
test('official TypeScript generation preserves raw RPC names rather than official codemode aliases',()=>{
 const parameters={type:'object',properties:{count:{type:'number',minimum:1}},required:['count']}
 assert.equal(jsonSchemaToTs(parameters),schemaToType(parameters))
 const sdk=renderToolsSdk(['odd-name','a.b','a_b','class'].map(name=>({name,description:'RPC '+name,parameters,output:{type:'boolean'}})))
 const declarations=sdk.split('```ts\n')[1].split('\n```')[0]
 assert.match(declarations,/"odd-name"\(/);assert.match(declarations,/"a\.b"\(/);assert.match(declarations,/a_b\(/);assert.match(declarations,/class\(/)
 assert.doesNotMatch(declarations,/nightRpc\d+\(/)
 assert.match(declarations,/@minimum 1/)
})
test('mutable schema versions invalidate official validators and accessors are captured only once',()=>{
 const schema={type:'number'}
 const first=officialToolValidator(schema);assert.equal(first.check(2),true)
 schema.minimum=3
 const next=officialToolValidator(schema);assert.notEqual(next,first);assert.equal(next.check(2),false)
 assert.ok(validate(schema,2).length)
 schema.minimum=1;assert.deepEqual(validate(schema,2),[])
 let reads=0
 const accessor=Object.freeze({type:'number',get minimum(){reads++;return reads===1?5:0}})
 const validator=officialToolValidator(accessor)
 assert.equal(reads,1);assert.equal(validator.check(2),false)
 assert.doesNotThrow(()=>assertSupportedJsonSchema(accessor));assert.equal(reads,2,'admission captures once, not once for policy and again for compilation')
})
test('object-root admission checks the captured root type without rereading its accessor',async()=>{
 const {assertObjectJsonSchema}=await import('../src/native-tool-protocol.js')
 let reads=0
 assert.doesNotThrow(()=>assertObjectJsonSchema({get type(){reads++;return reads===1?'object':'string'},properties:{n:{type:'number'}}}))
 assert.equal(reads,1)
 let typeReads=0
 assert.match(jsonSchemaToTs({get type(){typeReads++;return typeReads===1?'number':'string'}}),/number/)
 assert.equal(typeReads,1)
})
