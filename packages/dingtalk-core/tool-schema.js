import {z} from 'zod'
import {assertSupportedJsonSchema} from '../../src/native-tool-protocol.js'

/** Preserve Zod's input contract. Transformations and superRefine remain the
 * Host's final semantic gate; representable constraints stay executable schema.
 */
export function toToolJsonSchema(schema) {
 const generated=z.toJSONSchema(schema,{io:'input',override:({zodSchema,jsonSchema})=>{
  if(zodSchema.def?.type==='tuple'&&!zodSchema.def.rest)jsonSchema.maxItems=zodSchema.def.items.length
 }})
 const result=JSON.parse(JSON.stringify(generated))
 delete result.$schema
 assertSupportedJsonSchema(result)
 return result
}

/** Pi providers need a visible object root. Retain the exact union beside a
 * field catalogue for providers that only transmit root properties/required.
 * The catalogue widens presentation only; anyOf/oneOf still validates branches.
 */
export function toToolObjectJsonSchema(schema) {
 const result=toToolJsonSchema(schema)
 if(result.type==='object')return result
 const branches=result.anyOf??result.oneOf
 if(!branches?.length||!branches.every(branch=>branch.type==='object'))throw new Error('tool_object_schema_required')
 const keys=[...new Set(branches.flatMap(branch=>Object.keys(branch.properties??{})))]
 const properties=Object.fromEntries(keys.map(key=>{
  const alternatives=branches.flatMap(branch=>Object.hasOwn(branch.properties??{},key)?[branch.properties[key]]:[])
  const unique=[...new Map(alternatives.map(node=>[JSON.stringify(node),node])).values()]
  return[key,unique.length===1?unique[0]:{anyOf:unique}]
 }))
 const required=(branches[0].required??[]).filter(key=>branches.every(branch=>branch.required?.includes(key)))
 const output={...result,type:'object',properties,required}
 assertSupportedJsonSchema(output)
 return output
}
