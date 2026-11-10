import {createHash} from 'node:crypto'
import {updateConfig} from '../config.js'
import {resolvePiProfiles} from '../pi-provider-catalog.js'
import {MODEL_ROLES,legacyRoleModelSelection,mergeRoleModelSelection,validateRoleModels} from '../role-models.js'
import {failure} from '../runtime/files.js'

export const configVersion=config=>createHash('sha256').update(JSON.stringify(config)).digest('hex')
const checkVersion=(config,expected)=>{if(expected!==undefined&&expected!==configVersion(config))throw failure('SETTINGS_VERSION_CONFLICT')}
const nonempty=value=>typeof value==='string'&&value.trim()===value&&value.length>0&&value.length<=256&&!/[\x00-\x1f\x7f]/.test(value)
const resultWithVersion=result=>({...result,version:configVersion(result.config)})

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
