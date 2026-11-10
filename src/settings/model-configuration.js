import {createHash} from 'node:crypto'
import {updateConfig} from '../config.js'
import {resolvePiProfiles} from '../pi-provider-catalog.js'
import {MODEL_ROLES,ROLE_MODEL_ENV_NAMES,resolveRoleModels,roleReasoningLevels,legacyRoleModelSelection,mergeRoleModelSelection,validateRoleModels} from '../role-models.js'
import {failure} from '../runtime/files.js'

export const configVersion=config=>createHash('sha256').update(JSON.stringify(config)).digest('hex')
const checkVersion=(config,expected)=>{if(expected!==undefined&&expected!==configVersion(config))throw failure('SETTINGS_VERSION_CONFLICT')}
const nonempty=value=>typeof value==='string'&&value.trim()===value&&value.length>0&&value.length<=256&&!/[\x00-\x1f\x7f]/.test(value)
const resultWithVersion=result=>({...result,version:configVersion(result.config)})

// Validate the entire saved catalog before edits: a partial/deferred catalog must
// never become an accidental replacement for entries that failed to resolve.
function catalogState(config,environment,fallbacks){
  const profiles=resolvePiProfiles(config.providers)
  if(!profiles.size)throw failure('SETTINGS_MODEL_CATALOG_INVALID')
  const references=new Map(),add=(selection,label)=>{
    if(!selection||!profiles.get(selection.provider)?.models.some(row=>row.id===selection.model))throw failure('SETTINGS_MODEL_CATALOG_INVALID')
    const key=JSON.stringify([selection.provider,selection.model])
    references.set(key,[...(references.get(key)??[]),label])
  }
  add(config.model,'default')
  validateRoleModels(config)
  for(const role of MODEL_ROLES)if(config.roleModels?.[role])add(config.roleModels[role],'role:'+role)
  if(config.resident?.taskSessions)add(legacyRoleModelSelection(config,'task'),'legacy:task')
  const effective=resolveRoleModels(config,environment)
  if(!effective.task&&fallbacks?.task)add(fallbacks.task,'runtime:task')
  for(const role of MODEL_ROLES)if(Object.values(ROLE_MODEL_ENV_NAMES[role]).some(name=>{
    const entry=typeof environment?.get==='function'?environment.get(name):environment?.[name]
    return entry!==undefined
  }))add(effective[role],'environment:'+role)
  return {profiles,references,taskRoleRequired:!!config.resident&&!effective.task}
}

export function modelCatalogView(config,environment={},fallbacks){
  const {profiles,references}=catalogState(config,environment,fallbacks)
  return {version:configVersion(config),providers:[...profiles.values()].map(profile=>({provider:profile.provider,name:profile.displayName,
    models:profile.models.map(model=>{
      const source=config.providers[profile.provider],entry=source.models?.length?source.models.find(row=>row.id===model.id):source.modelOverrides?.[model.id]
      return {id:model.id,name:model.name,configuredName:entry?.name??null,reasoningEfforts:roleReasoningLevels(model),references:references.get(JSON.stringify([profile.provider,model.id]))??[]}
    })}))}
}

/** Mutate one entry on an existing API route, without changing credentials or
 * session state. Materialize builtin IDs (not resolved secrets/transport data)
 * when switching to an explicit whitelist, retaining per-model overrides. */
export async function saveModelCatalogEntry(file,{action,provider,id,model,name,expectedVersion,confirm,checkOnly=false}={},environment={},getFallbackRoleModels=()=>undefined){
  if(!['add','edit','remove'].includes(action)||!nonempty(provider)||typeof expectedVersion!=='string'||!/^[a-f0-9]{64}$/.test(expectedVersion))throw failure('SETTINGS_INPUT_INVALID')
  if(action!=='add'&&!nonempty(id)||action!=='remove'&&!nonempty(model)||name!==undefined&&name!==''&&!nonempty(name))throw failure('SETTINGS_INPUT_INVALID')
  if(action==='remove'&&confirm!==true)throw failure('SETTINGS_MODEL_DELETE_CONFIRMATION_REQUIRED')
  return resultWithVersion(await updateConfig(file,config=>{
    checkVersion(config,expectedVersion)
    const fallbacks=getFallbackRoleModels(config),{profiles,references,taskRoleRequired}=catalogState(config,environment,fallbacks),resolved=profiles.get(provider)
    if(!resolved)throw failure('NIGHT_BOT_PROVIDER_PROFILE_REQUIRED')
    const profile=config.providers[provider]
    const entries=profile.models?.length?structuredClone(profile.models):resolved.models.map(row=>({id:row.id,...structuredClone(profile.modelOverrides?.[row.id]??{})}))
    const index=entries.findIndex(row=>row.id===id)
    if(action!=='add'&&index<0)throw failure('NIGHT_BOT_MODEL_NOT_CONFIGURED')
    if(action!=='remove'&&entries.some((row,i)=>row.id===model&&(action==='add'||i!==index)))throw failure('SETTINGS_MODEL_EXISTS')
    if((action==='remove'||action==='edit'&&id!==model)&&references.has(JSON.stringify([provider,id])))throw failure('SETTINGS_MODEL_IN_USE')
    // The legacy resident settings endpoint writes its task fallback separately
    // and validates against the running catalog, which changes only on restart.
    // Require an authoritative role selection before destructive edits, so a
    // later legacy write cannot make the next startup select a removed model.
    if((action==='remove'||action==='edit'&&id!==model)&&taskRoleRequired)throw failure('SETTINGS_TASK_ROLE_REQUIRED')
    if(action==='remove'){
      if(entries.length===1)throw failure('SETTINGS_MODEL_LAST_REQUIRED')
      entries.splice(index,1)
    }else{
      const entry=action==='add'?{id:model}:{...entries[index],id:model}
      if(name!==undefined){if(name==='')delete entry.name;else entry.name=name}
      if(action==='add')entries.push(entry);else entries[index]=entry
    }
    profile.models=entries
    delete profile.modelOverrides
    catalogState(config,environment,fallbacks)
    return config
  },{checkOnly}))
}

/** Shared endpoint policy for Web and command-line model changes. Existing
 * profiles are not rewritten merely by viewing them or selecting a role. */
export function validateModelEndpoint(value){
  if(typeof value!=='string'||value.length>1024)throw failure('SETTINGS_INPUT_INVALID')
  let url;try{url=new URL(value)}catch{throw failure('SETTINGS_INPUT_INVALID')}
  if(url.username||url.password||url.href.includes('?')||url.href.includes('#')||!(url.protocol==='https:'||url.protocol==='http:'&&['127.0.0.1','localhost','[::1]'].includes(url.hostname)))throw failure('SETTINGS_INPUT_INVALID')
  return url.href.replace(/\/$/,'')
}

export function validateModelCredentialReference(value){
  if(typeof value!=='string'||value.length>256||!/^[A-Za-z_][A-Za-z0-9_]*$/.test(value))throw failure('NIGHT_BOT_CREDENTIAL_ENV_INVALID')
  return value
}

/** The Web form and CLI share this locked validation/CAS/write boundary. */
export async function saveRoleModelConfiguration(file,{role,provider,model,reasoningEffort,expectedVersion,checkOnly=false}={}){
  if(!MODEL_ROLES.includes(role))throw failure('NIGHT_BOT_MODEL_ROLE_INVALID')
  return resultWithVersion(await updateConfig(file,config=>{
    checkVersion(config,expectedVersion)
    const next=mergeRoleModelSelection(config.roleModels?.[role]??legacyRoleModelSelection(config,role),{provider,model,reasoningEffort})
    config.roleModels={...config.roleModels,[role]:next}
    validateRoleModels(config)
    return config
  },{checkOnly}))
}

/** Legacy/global model configuration uses the same entry point in headless and
 * Web flows. Keep existing models because another role may still select them. */
export async function saveModelConfiguration(file,{provider,model,baseURL,api,apiKeyEnv,reasoningEffort,expectedVersion,checkOnly=false}={}){
  return resultWithVersion(await updateConfig(file,config=>{
    checkVersion(config,expectedVersion)
    provider??=config.model?.provider;model??=config.model?.model
    if(!nonempty(provider)||!nonempty(model))throw failure('NIGHT_BOT_MODEL_REQUIRED')
    const profile={...config.providers?.[provider]}
    if(baseURL!==undefined)profile.baseURL=validateModelEndpoint(baseURL)
    if(api!==undefined)profile.api=api
    if(apiKeyEnv!==undefined)profile.apiKeyEnv=validateModelCredentialReference(apiKeyEnv)
    if(!config.providers?.[provider]&&!profile.apiKeyEnv)throw failure('NIGHT_BOT_PROVIDER_PROFILE_REQUIRED')
    if(profile.baseURL&&profile.api&&!profile.models?.some(row=>row.id===model))profile.models=[...(profile.models??[]),{id:model}]
    const selected=resolvePiProfiles({[provider]:profile}).get(provider)
    if(!selected.models.some(row=>row.id===model))throw failure('NIGHT_BOT_MODEL_NOT_CONFIGURED')
    config.providers={...config.providers,[provider]:profile}
    const next=mergeRoleModelSelection(config.model,{provider,model,reasoningEffort}),{reasoningEffort:previous,...rest}=config.model??{}
    config.model={...rest,...next}
    if(reasoningEffort!==undefined)validateRoleModels({...config,roleModels:{...config.roleModels,triage:next}})
    return config
  },{checkOnly}))
}
