import {getSupportedThinkingLevels,clampThinkingLevel} from '@earendil-works/pi-ai'
import {resolvePiProfiles,thinkingLevels} from './pi-provider-catalog.js'
import {failure} from './runtime/files.js'

export const MODEL_ROLES=Object.freeze(['triage','router','task'])
export const ROLE_MODEL_ENV_NAMES=Object.freeze(Object.fromEntries(MODEL_ROLES.map(role=>[role,Object.freeze({
  provider:`NIGHT_BOT_${role.toUpperCase()}_PROVIDER`,model:`NIGHT_BOT_${role.toUpperCase()}_MODEL`,reasoningEffort:`NIGHT_BOT_${role.toUpperCase()}_REASONING_EFFORT`,
})])))
const fields=['provider','model','reasoningEffort']
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value)
const text=value=>typeof value==='string'&&value.trim()===value&&value.length>0&&value.length<=256&&!/[\x00-\x1f\x7f]/.test(value)
const selection=value=>Object.fromEntries(fields.filter(key=>value?.[key]!==undefined).map(key=>[key,value[key]]))
export const roleReasoningLevels=model=>[...getSupportedThinkingLevels(model)]

/** A secret-free view of the same configured Pi models used for validation. */
export function roleModelCatalog(config){
  return [...resolvePiProfiles(config.providers,{deferred:true}).values()].map(profile=>({provider:profile.provider,name:profile.displayName,
    models:profile.models.map(model=>({id:model.id,name:model.name,reasoningEfforts:roleReasoningLevels(model)}))}))
}

/** Use the same Pi model default as a new official session. Callers validate
 * explicit role selections first; this does not rewrite persisted configuration. */
export function materializeRoleModelSelection(config,value){
  const profile=resolvePiProfiles({[value.provider]:config.providers[value.provider]}).get(value.provider)
  const model=profile.models.find(model=>model.id===value.model)
  if(!model)throw failure('NIGHT_BOT_MODEL_NOT_CONFIGURED')
  return {...selection(value),reasoningEffort:value.reasoningEffort??profile.reasoning??clampThinkingLevel(model,'medium')}
}

/** Only explicit role entries are checked here. Omitted roles retain the legacy
 * runtime's selection/restoration behavior, including persisted default choices. */
export function validateRoleModels(config){
  const roles=config.roleModels
  if(roles===undefined)return config
  if(!object(roles))throw failure('NIGHT_BOT_ROLE_MODELS_INVALID')
  for(const [role,value]of Object.entries(roles)){
    if(!MODEL_ROLES.includes(role))throw failure('NIGHT_BOT_MODEL_ROLE_INVALID')
    if(!object(value)||Object.keys(value).some(key=>!fields.includes(key))||!text(value.provider)||!text(value.model))throw failure('NIGHT_BOT_ROLE_MODEL_INVALID:'+role)
    if(value.reasoningEffort!==undefined&&!thinkingLevels.includes(value.reasoningEffort))throw failure('UNSUPPORTED_REASONING_EFFORT')
    if(!Object.hasOwn(config.providers??{},value.provider))throw failure('NIGHT_BOT_PROVIDER_PROFILE_REQUIRED')
    const profile=resolvePiProfiles({[value.provider]:config.providers[value.provider]}).get(value.provider),model=profile.models.find(model=>model.id===value.model)
    if(!model)throw failure('NIGHT_BOT_MODEL_NOT_CONFIGURED')
    const effort=value.reasoningEffort??profile.reasoning
    if(effort!==undefined&&!roleReasoningLevels(model).includes(effort))throw failure('UNSUPPORTED_REASONING_EFFORT')
  }
  return config
}

/** Saved legacy fallback, not a new default and not the runtime's persisted
 * interactive selection. This is used only when creating an explicit override. */
export function legacyRoleModelSelection(config,role){
  if(!MODEL_ROLES.includes(role))throw failure('NIGHT_BOT_MODEL_ROLE_INVALID')
  const base=selection(config.model)
  if(role!=='task')return base
  const task={...config.model,...config.resident?.taskSessions}
  let effort=task.reasoningEffort===undefined&&task.reasoningMode===undefined?'low':task.reasoningEffort
  const mode=task.reasoningMode??(effort===undefined?'inherit':effort===null||effort===''?'model-default':'explicit')
  effort=mode==='inherit'?base.reasoningEffort:mode==='explicit'?effort:undefined
  return {provider:task.provider,model:task.model,...effort===undefined?{}:{reasoningEffort:effort}}
}

/** ENV/CLI patches are per-field. Changing the route must never carry an
 * inherited effort to a model with different capabilities. */
export function mergeRoleModelSelection(base,patch){
  const result=selection(base)
  if(['provider','model'].some(key=>patch[key]!==undefined&&patch[key]!==base?.[key]))delete result.reasoningEffort
  for(const key of fields)if(patch[key]!==undefined){
    if(key==='reasoningEffort'&&patch[key]==='model-default')delete result.reasoningEffort
    else result[key]=patch[key]
  }
  return result
}

export function resolveRoleModels(config,environment=process.env){
  validateRoleModels(config)
  const roles=structuredClone(config.roleModels??{})
  for(const role of MODEL_ROLES){
    const patch={}
    for(const [field,name]of Object.entries(ROLE_MODEL_ENV_NAMES[role])){
      const found=typeof environment?.get==='function'?environment.get(name):environment?.[name]
      const value=object(found)&&Object.hasOwn(found,'value')?found.value:found
      if(value!==undefined)patch[field]=value
    }
    if(Object.keys(patch).length)roles[role]=mergeRoleModelSelection(roles[role]??legacyRoleModelSelection(config,role),patch)
  }
  validateRoleModels({...config,roleModels:roles})
  return roles
}

export function roleModelSelection(ctx,role,fallback){
  return structuredClone(ctx.get('roleModels')?.[role]??fallback)
}
