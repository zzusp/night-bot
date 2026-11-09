import {toolSchemaPolicy} from './tool-schema-policy.js'
import {captureToolSchema,officialToolValidator} from './tool-schema-value.js'

/** Policy admission is itself validated by Pi's official schema engine. */
export function toolSchemaViolations(input){
 let schema
 try{schema=captureToolSchema(input)}catch{}
 if(schema===undefined)return['schema must be lossless JSON schema data']
 try{
  if(!toolSchemaPolicy.check(schema))return toolSchemaPolicy.errors(schema).map(error=>`schema${error.path}: unsupported schema policy (${error.keyword}: ${error.message})`)
  officialToolValidator(schema)
  return[]
 }catch{return['schema cannot be compiled by the official Pi schema validator']}
}
