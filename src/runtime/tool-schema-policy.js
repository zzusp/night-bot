import {compile} from '@earendil-works/pi-schema'
import {formats} from '@earendil-works/pi-schema/formats'

// Night's definition policy, not a second JSON Schema engine. The official
// compiler intentionally permits unknown annotations; tools admit only this
// reviewed vocabulary, and the official validator checks these policy shapes.
const node={$ref:'#/$defs/node'}
const length={type:'integer',minimum:0,maximum:Number.MAX_SAFE_INTEGER}
const types=['object','array','string','number','integer','boolean','null']
const applies={minimum:['number','integer'],maximum:['number','integer'],exclusiveMinimum:['number','integer'],exclusiveMaximum:['number','integer'],minLength:['string'],maxLength:['string'],pattern:['string'],format:['string'],minItems:['array'],maxItems:['array'],uniqueItems:['array'],properties:['object'],required:['object'],additionalProperties:['object'],propertyNames:['object'],items:['array'],prefixItems:['array']}
const list={type:'array',minItems:1,items:node}
const policy={...node,$defs:{node:{anyOf:[{type:'boolean'},{type:'object',additionalProperties:false,properties:{
 type:{anyOf:[{enum:types},{type:'array',minItems:1,uniqueItems:true,items:{enum:types}}]},
 description:{type:'string'},title:{type:'string'},default:true,examples:true,
 enum:{type:'array',minItems:1},const:true,
 oneOf:list,anyOf:list,
 minimum:{type:'number'},maximum:{type:'number'},exclusiveMinimum:{type:'number'},exclusiveMaximum:{type:'number'},
 minLength:length,maxLength:length,minItems:length,maxItems:length,uniqueItems:{type:'boolean'},
 pattern:{type:'string',format:'regex'},format:{enum:['date-time']},
 properties:{type:'object',additionalProperties:node},required:{type:'array',uniqueItems:true,items:{type:'string'}},
 additionalProperties:node,propertyNames:node,items:node,prefixItems:{type:'array',items:node},
 },allOf:Object.entries(applies).map(([key,allowed])=>({if:{required:[key]},then:{required:['type'],properties:{type:{anyOf:[{enum:allowed},{type:'array',contains:{enum:allowed}}]}}}}))}]}}}
export const toolSchemaPolicy=compile(policy,{coerce:false,formats,unresolvedRefs:'throw'})
