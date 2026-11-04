import { access } from 'node:fs/promises'
import { homedir } from 'node:os'
import { resolve } from 'node:path'
const failure=(code,message)=>Object.assign(new Error(message),{code})
const recordId=id=>typeof id==='string'&&/^[a-z][a-z0-9-]*$/.test(id)
const reference=name=>typeof name==='string'&&/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)
const fromRecord=record=>record===undefined?undefined:record.kind==='api-key'?{type:'api_key',...(record.key===undefined?{}:{key:record.key}),...(record.env===undefined?{}:{env:structuredClone(record.env)})}:structuredClone(record.payload)
function jsonGrant(value) {
  if(Array.isArray(value))return value.map(item=>item===undefined?null:jsonGrant(item))
  if(value!==null&&typeof value==='object'&&Object.getPrototypeOf(value)===Object.prototype)return Object.fromEntries(Object.entries(value).filter(([,item])=>item!==undefined).map(([key,item])=>[key,jsonGrant(item)]))
  return value
}
const toRecord=credential=>credential.type==='api_key'?{kind:'api-key',...(credential.key===undefined?{}:{key:credential.key}),...(credential.env===undefined?{}:{env:structuredClone(credential.env)})}:{kind:'grant',payload:jsonGrant(credential)}
/** Keep the existing durable namespace while Pi owns login/refresh semantics.
 * getCredentials and getEnvironment are late-bound: never cache keys in catalog
 * snapshots, and never silently turn a failed save into successful sign-in.
 */
export function piAuthentication({getCredentials=()=>undefined,getEnvironment=name=>process.env[name],fileExists}={}) {
  const writable=()=>{const store=getCredentials();if(!store)throw failure('NO_CREDENTIAL_STORE','No durable credential store is mounted');return store}
  const key=id=>'llm-pi-ai/'+id
  const credentials={
    async read(id){if(!recordId(id))return undefined;return fromRecord(await getCredentials()?.readRecord(key(id)))},
    async list(){const records=await getCredentials()?.listRecords()??[];return records.filter(entry=>entry.key.startsWith('llm-pi-ai/')&&recordId(entry.key.slice(10))).map(entry=>({providerId:entry.key.slice(10),type:entry.kind==='api-key'?'api_key':'oauth'}))},
    async modify(id,mutate){if(!recordId(id))throw failure('UNSTORABLE_PROVIDER_ID','Provider id cannot address a durable credential record');return fromRecord(await writable().modifyRecord(key(id),async record=>{const next=await mutate(fromRecord(record));return next===undefined?undefined:toRecord(next)}))},
    async delete(id){if(recordId(id))await writable().deleteRecord(key(id))},
  }
  const authContext={
    async env(name){if(reference(name)){const hit=await getCredentials()?.resolve(name);if(hit!==undefined)return hit.value}return getEnvironment(name)},
    async fileExists(path){if(fileExists)return fileExists(path);const expanded=path==='~'||path.startsWith('~/')?resolve(homedir(),path.slice(1).replace(/^\//,'')):path;try{await access(expanded);return true}catch{return false}},
  }
  return{credentials,authContext,
    async resolveApiKey(profile){
      if(profile.apiKeyEnv===undefined)return undefined
      if(!reference(profile.apiKeyEnv))throw failure('INVALID_CONFIG','Invalid credential reference')
      const store=getCredentials(),value=store?(await store.resolve(profile.apiKeyEnv))?.value:await getEnvironment(profile.apiKeyEnv)
      if(typeof value!=='string'||!value)throw failure('MISSING_CREDENTIAL','No credential is available for provider '+profile.provider)
      const normalized=value.trim()
      if(!/^[\x21-\x7E]+$/.test(normalized))throw failure('INVALID_CREDENTIAL','Provider credential is blank or contains invalid characters')
      return normalized
    },
  }
}
