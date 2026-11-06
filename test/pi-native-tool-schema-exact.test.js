import test from 'node:test'
import assert from 'node:assert/strict'
import {z} from 'zod'
import {toToolJsonSchema,toToolObjectJsonSchema} from '../packages/dingtalk-core/tool-schema.js'
import {assertSupportedJsonSchema,assertObjectJsonSchema,validateJsonSchemaValue as violations} from '../src/native-tool-protocol.js'

const compare=(source,values,objectRoot=false)=>{
 const schema=(objectRoot?toToolObjectJsonSchema:toToolJsonSchema)(source)
 assertSupportedJsonSchema(schema)
 if(objectRoot)assertObjectJsonSchema(schema)
 for(const value of values)assert.equal(violations(schema,value).length===0,source.safeParse(value).success,JSON.stringify(value))
 return schema
}
test('Zod overlapping alternatives remain anyOf with exact bounds and sibling constraints',()=>{
 const source=z.union([z.strictObject({n:z.number().min(0).max(2)}),z.strictObject({n:z.number().min(1).max(3),label:z.string().min(1).optional()})])
 const schema=compare(source,[{}, {n:0},{n:1},{n:3},{n:4},{n:1,label:''},{n:1,extra:true}],true)
 assert.ok(schema.anyOf);assert.equal(schema.type,'object');assert.ok(schema.properties.n.anyOf)
 assert.equal(schema.anyOf[0].properties.n.minimum,0)
 assert.equal(schema.anyOf[1].properties.n.maximum,3)
 assert.deepEqual(violations({...schema,properties:{...schema.properties,n:{type:'number',maximum:1}}},{n:2}).length>0,true)
 assert.ok(violations({type:'number',minimum:2,anyOf:[{type:'number',maximum:3},{type:'number',maximum:4}]},1).length)
 assert.ok(violations({oneOf:[{type:'number'},{type:'integer'}],maximum:0,type:'number'},1).length)
})
test('nullable type arrays, mixed unions and discriminators do not collapse to unconstrained JSON',()=>{
 compare(z.string().min(2).nullable(),[null,'ab','',1,false,{}])
 compare(z.union([z.literal('go'),z.number().positive(),z.null()]),['go','other',0,1,null,{}])
 compare(z.discriminatedUnion('kind',[z.strictObject({kind:z.literal('a'),a:z.string().min(1)}),z.strictObject({kind:z.literal('b'),b:z.array(z.number()).min(1).max(2)})]),[{kind:'a',a:'x'},{kind:'a',b:[1]},{kind:'b',b:[]},{kind:'b',b:[1]},{kind:'b',b:[1,2,3]}],true)
})
test('tuple prefixes, false tails, rest items and typed record properties retain input semantics',()=>{
 const empty=compare(z.tuple([]),[[],[1],{},null])
 assert.deepEqual(empty.prefixItems,[]);assert.equal(empty.items,false);assert.equal(empty.maxItems,0)
 compare(z.tuple([z.string().min(1),z.number().int().positive()]),[[],['x'],['x',1],['',1],['x',0],['x',1,2]])
 compare(z.tuple([z.string()],z.number()),[[],['x'],['x',1,2],['x','bad']])
 const record=compare(z.record(z.string().regex(/^[a-z]+$/),z.number().int().positive()),[{}, {a:1},{A:1},{a:0},{a:'one'},{a:1,b:2}])
 assert.ok(record.propertyNames);assert.equal(record.additionalProperties.type,'integer')
 compare(z.strictObject({known:z.string()}).catchall(z.number()),[{known:'x',other:1},{known:'x',other:'bad'},{other:1}])
})
test('schema admission validates every new applicator and continues rejecting unknown vocabulary',()=>{
 for(const schema of [
  {anyOf:[]},{anyOf:{}},{anyOf:[null]},{oneOf:[]},{type:['string','string']},{type:['string','imaginary']},
  {type:'array',prefixItems:{}},{type:'array',items:null},{type:'object',propertyNames:2},{type:'object',additionalProperties:'yes'},
  {type:'number',exclusiveMinimum:true},{type:'string',exclusiveMaximum:3},{allOf:[{type:'string'}]},{$ref:'#/$defs/a'},
  {type:'object',unevaluatedProperties:false},{type:'string',minLength:1,unexpected:true}
 ])assert.throws(()=>assertSupportedJsonSchema(schema),error=>error.code==='UNSUPPORTED_SCHEMA',JSON.stringify(schema))
 assert.doesNotThrow(()=>assertSupportedJsonSchema({type:'number',oneOf:[{minimum:0,type:'number'},{maximum:0,type:'number'}]}))
 assert.ok(violations(false,{anything:true}).length);assert.deepEqual(violations(true,{anything:true}),[])
 assert.ok(violations({type:['string','null'],minLength:2},'a').length)
 assert.deepEqual(violations({type:['string','null'],minLength:2},null),[])
})
test('all exported product Zod input schemas retain their JSON vocabulary without description downgrade',async()=>{
 let count=0
 for(const module of ['decision','task-result','task-plan','message-coordinator','independent-coordination-planner','task-checks','topic-facts','platform-notification']){
  for(const value of Object.values(await import('../packages/dingtalk-core/'+module+'.js'))){
   if(!value?._zod)continue
   const expected=JSON.parse(JSON.stringify(z.toJSONSchema(value,{io:'input',override:({zodSchema,jsonSchema})=>{if(zodSchema.def?.type==='tuple'&&!zodSchema.def.rest)jsonSchema.maxItems=zodSchema.def.items.length}})))
   delete expected.$schema
   assert.deepEqual(toToolJsonSchema(value),expected,module)
   count++
  }
 }
 assert.equal(count,24)
})
test('TypeScript and Python SDKs retain union fields, nullable types, tuple shapes and record values',async()=>{
 const {jsonSchemaToTs,jsonSchemaToPy,renderToolsSdk,renderToolsSdkPy}=await import('../src/native-tool-protocol.js')
 const {groupDecisionSubmissionJsonSchema}=await import('../packages/dingtalk-core/decision.js')
 const {schemaToType}=await import('@earendil-works/pi-codemode/declarations')
 const typedRecord={type:'object',additionalProperties:{type:'number'}}
 assert.equal(jsonSchemaToTs({type:['string','null']}),schemaToType({type:['string','null']}))
 assert.equal(jsonSchemaToPy({type:['string','null']}),'str | None')
 assert.equal(jsonSchemaToTs(typedRecord),schemaToType(typedRecord))
 assert.equal(jsonSchemaToPy(typedRecord),'dict[str, float]')
 assert.equal(jsonSchemaToTs(false),'never');assert.equal(jsonSchemaToPy(false),'Never')
 const tuple={type:'array',prefixItems:[{type:'string'},{type:'number'}],items:false,minItems:2};assert.equal(jsonSchemaToTs(tuple),schemaToType(tuple))
 const emptyTuple={type:'array',prefixItems:[],items:false};assert.equal(jsonSchemaToTs(emptyTuple),schemaToType(emptyTuple))
 assert.equal(jsonSchemaToPy({type:'array',prefixItems:[{type:'string'},{type:'number'}],items:false}),'list[str | float]')
 const declarations=[{name:'group_decision',description:'Decision',parameters:groupDecisionSubmissionJsonSchema,output:{type:'object'}},{name:'odd-name',description:'Quoted',parameters:{type:'object',properties:{'x-y':{type:['string','null']}},required:['x-y'],additionalProperties:false},output:typedRecord}]
 for(const sdk of [renderToolsSdk(declarations),renderToolsSdkPy(declarations)]){
  assert.match(sdk,/basisMessageIds/);assert.match(sdk,/reason/);assert.match(sdk,/reply/)
  assert.match(sdk,/odd-name/);assert.match(sdk,/x-y/);assert.match(sdk,/Static declarations are advisory/)
  const contract=JSON.parse(sdk.split('```json\n')[1].split('\n```')[0])
  assert.deepEqual(contract.find(tool=>tool.name==='group_decision').parameters,groupDecisionSubmissionJsonSchema)
 }
 const {spawnSync}=await import('node:child_process')
 const py=renderToolsSdkPy(declarations).split('```python\n')[1].split('\n```')[0]
 const parsed=spawnSync(process.platform==='win32'?'python':'python3',['-I','-X','utf8','-c','import ast,sys;ast.parse(sys.stdin.read())'],{input:py,encoding:'utf8'})
 assert.equal(parsed.status,0,parsed.stderr)
})
