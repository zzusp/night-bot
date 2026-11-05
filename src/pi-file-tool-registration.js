import {createPiFileTools} from './pi-file-tools.js'
import {scopeOf} from './native-scope.js'
import {createHash} from 'node:crypto'
import {symbols} from '@deepseek-ai/cordis'

const registrations=new WeakMap()
const fail=code=>Object.assign(new Error(code),{code})
const imageMetadata=block=>{const bytes=Buffer.from(block.data,'base64');return {mimeType:block.mimeType,bytes:bytes.byteLength,sha256:createHash('sha256').update(bytes).digest('hex')}}
function metadata(value){
 if(Array.isArray(value))return value.map(metadata)
 if(!value||typeof value!=='object')return value
 if(typeof value.data==='string'&&typeof value.mimeType==='string'&&value.mimeType.startsWith('image/')){
  const {data,...rest}=value;return {...metadata(rest),...imageMetadata(value)}
 }
 return Object.fromEntries(Object.entries(value).map(([key,item])=>[key,metadata(item)]))
}
export function isPiFileObservationalTool(definition,actor){
 const port=definition&&registrations.get(definition)
 return !!port&&port.actor===actor&&['read','read_image','read_window'].includes(definition.name)&&port.registry.get(definition.name,actor)===definition
}
/** Exact-definition pre-effect capability, never inferred from a tool name. */
export async function preflightPiFileMutation(exec,definition){
 const port=definition&&registrations.get(definition)
 if(!port)return
 if(exec.agent!==port.actor||exec.name!==definition.name||port.registry.get(exec.name,exec.agent)!==definition)throw fail('PI_FILE_DEFINITION_REQUIRED')
 if(!['write','edit'].includes(exec.name))return
 await port.bundle.preflightMutation(port.native,exec.arguments,exec.signal)
}

/** Register Pi implementations inside the existing business tool pipeline.
 * Factory-owned budgets and awaited scope close are mandatory integration
 * capabilities. Registration alone does not claim a complete Host migration.
 */
export function registerPiFileTools({ctx,actor,sourceConfig,services,imageBudget,transportBudget,timeoutMs,onlyMissing=false}={}){
 const original=value=>value?.[symbols.original]??value
 if(!ctx||scopeOf(ctx)!==actor||original(ctx.get('agents'))!==original(actor.ctx?.get('agents')))throw fail('PI_FILE_ACTOR_SCOPE_REQUIRED')
 if(typeof imageBudget?.accept!=='function'||typeof transportBudget?.accept!=='function')throw fail('PI_FILE_FACTORY_BUDGETS_REQUIRED')
 if(timeoutMs!==undefined&&(!Number.isFinite(timeoutMs)||timeoutMs<=0))throw new TypeError('File tool timeout must be positive')
 if(typeof onlyMissing!=='boolean')throw new TypeError('onlyMissing must be boolean')
 const registry=ctx.get('tools')
 if(typeof registry?.register!=='function'||typeof registry.executionIdentity!=='function')throw fail('PI_FILE_NATIVE_REGISTRY_REQUIRED')
 const bundle=createPiFileTools({ctx,actor,sourceConfig,services,imageBudget,transportBudget}),definitions=[],contents=new WeakMap()
 for(const native of bundle.tools){
  if(onlyMissing&&registry.get(native.name,actor)!==undefined)continue
  // Pi Schema includes non-enumerable ~kind construction metadata. Its public
  // JSON schema representation is the enumerable JSON value; capture that
  // official schema once before the strict business registry admission.
  const parameters=JSON.parse(JSON.stringify(native.parameters))
  const definition={name:native.name,description:native.description,parameters,
   ...timeoutMs===undefined?{}:{timeoutMs},
   isConcurrencySafe:()=>!['write','edit'].includes(native.name),
   output:{schema:{type:'object',required:['text','images'],properties:{text:{type:'string'},images:{type:'array',items:{type:'object'}}},additionalProperties:true},render:(_args,value)=>value.text?[{type:'text',text:value.text}]:[]},
   projectContent(exec,result){const content=contents.get(exec);contents.delete(exec);return result.isError?undefined:content},
   async execute(args,exec){
    const identity=registry.executionIdentity(exec)
    if(exec.agent!==actor||identity?.owner!==actor.id||identity.name!==native.name||identity.callId!==exec.callId||args!==exec.arguments||registry.get(native.name,actor)!==definition)throw fail('PI_FILE_NATIVE_EXECUTION_REQUIRED')
    await preflightPiFileMutation(exec,definition)
    const result=await bundle.executeRegistered(native,args,exec)
    contents.set(exec,result.content)
    return {text:result.content.filter(block=>block.type==='text').map(block=>block.text).join('\n'),images:result.content.filter(block=>block.type==='image').map(imageMetadata),...result.details===undefined?{}:{details:metadata(result.details)},...result.structuredContent===undefined?{}:{structuredContent:metadata(result.structuredContent)}}
   },
  }
  registrations.set(definition,{actor,registry,bundle,native})
  registry.register(definition);definitions.push(definition)
 }
 const owned=new Set(definitions)
 if(owned.size)ctx.on('tools/pre-execute',async(exec,next)=>{const definition=registry.get(exec.name,exec.agent);if(owned.has(definition)&&registrations.get(definition)?.actor===actor)await preflightPiFileMutation(exec,definition);return next()})
 return Object.freeze({definitions:Object.freeze(definitions),tools:bundle.tools,sourceConfig:bundle.sourceConfig,sourceConfigComparison:bundle.sourceConfigComparison,capabilities:Object.freeze({...bundle.capabilities,registered:true,ready:false,actorScopedRegistration:true,requiresFactoryBudgetOwnership:true,readyForHost:false}),close:()=>bundle.close()})
}
