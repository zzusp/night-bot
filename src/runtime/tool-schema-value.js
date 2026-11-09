import {compile} from '@earendil-works/pi-schema'
import {formats} from '@earendil-works/pi-schema/formats'
import {snapshotJsonValue,deepFreeze} from '../native-values.js'

const capturedSchemas=new WeakSet()
const validators=new Map()
const validatorCacheLimit=128
const options={coerce:false,formats,unresolvedRefs:'throw'}
const label=path=>path===''?'arguments':path
const pointerPath=(base,pointer)=>pointer.split('/').slice(1).reduce((path,part)=>{const key=part.replaceAll('~1','/').replaceAll('~0','~');return path===''?key:`${path}.${key}`},base)

/** Official strict validation plus Night's lossless capture and error framing.
 * Defaults remain annotations. No coercion, mutation, or application effects.
 */
export function captureToolSchema(schema){
 if(typeof schema==='object'&&schema!==null&&capturedSchemas.has(schema))return schema
 const captured=snapshotJsonValue(schema)
 if(captured===undefined)throw new TypeError('Tool schema must be lossless JSON')
 deepFreeze(captured)
 if(typeof captured==='object'&&captured!==null)capturedSchemas.add(captured)
 return captured
}
export function officialToolValidator(schema){
 const captured=captureToolSchema(schema)
 // Object.freeze from a caller is not provenance: nested accessors may still
 // change. Cache only the version of our single captured, immutable JSON value.
 const version=JSON.stringify(captured)
 let validator=validators.get(version)
 if(validator){validators.delete(version);validators.set(version,validator);return validator}
 validator=compile(captured,options)
 validators.set(version,validator)
 if(validators.size>validatorCacheLimit)validators.delete(validators.keys().next().value)
 return validator
}
export function validateToolSchemaValue(schema,input,path='value'){
 let captured
 try{captured=snapshotJsonValue(input)}catch{}
 if(captured===undefined)return[`"${label(path)}" must be a lossless JSON value`]
 try{
  const validator=officialToolValidator(schema)
  if(validator.check(captured))return[]
  return validator.errors(captured).map(error=>`"${label(pointerPath(path,error.path))}": ${error.message}`)
 }catch{return[`"${label(path)}": official schema validation could not evaluate this contract`]}
}
export const toolSchemaContractJson=value=>JSON.stringify(value)
