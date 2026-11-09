import {z} from 'zod'
import {isAbsolute} from 'node:path'
import {bindWorkingDirectoryActor} from '../native-working-directory.js'
import {bindSandboxPolicyActor,SANDBOX_MODES} from '../native-policy.js'
import {bindPermissionPresetActor} from '../native-permission-presets.js'

const absolute=z.string().refine(isAbsolute)
const policies=z.enum(['ask','never'])
const artifact=z.strictObject({ownerId:z.string(),artifactRoot:absolute,sessionCwd:absolute})
const schemas={
 'approval/policy':z.strictObject({policy:policies}),
 'approval/asked':z.strictObject({id:z.string().min(1),toolName:z.string().min(1),callId:z.string().optional(),reason:z.string().optional()}),
 'approval/decided':z.strictObject({id:z.string().min(1),outcome:z.enum(['allowed-once','rejected','cancelled','unavailable'])}),
 'directory/changed':z.strictObject({cwd:absolute,recovered:z.boolean()}),
 'sandbox/policy':z.strictObject({mode:z.enum(SANDBOX_MODES),artifactRoot:artifact.optional()}),
 'permission/selected':z.strictObject({preset:z.string().min(1),sandbox:z.enum(SANDBOX_MODES),approval:policies}),
}
export const nativeBusinessAuditKinds=Object.freeze(Object.fromEntries(Object.entries(schemas).map(([name,schema])=>[name,value=>schema.safeParse(value).success])))
const fail=code=>Object.assign(new Error(code),{code})

/** Application policy facts only. This state has no conversation, model context,
 * message sequence, surface or generic event interface. The official manager
 * remains the sole owner of model history. Restore never runs effects.
 */
export async function createNativeBusinessState(store,{readOnly=false}={}) {
 if(store?.kind!=='pi-native'||!isAbsolute(store.header.cwd))throw new TypeError('Native store with absolute initial directory required')
 let directory=null,sandbox={mode:null,artifactRoot:null},approval,preset=null,poisoned,tail=Promise.resolve()
 function apply(receipt){
  const name=receipt.domain+'/'+receipt.kind,schema=schemas[name]
  if(!schema)return
  const data=schema.parse(receipt.payload)
  if(name==='approval/policy')approval=data.policy
  if(name==='directory/changed')directory=data.cwd
  if(name==='sandbox/policy')sandbox={mode:data.mode,artifactRoot:data.artifactRoot??sandbox.artifactRoot}
  if(name==='permission/selected'){preset=data.preset;approval=data.approval;sandbox={...sandbox,mode:data.sandbox}}
 }
 for(const receipt of await store.readAudit())apply(receipt)
 const healthy=()=>{if(poisoned)throw poisoned}
 const append=(name,payload,update=true)=>{
  if(poisoned)throw poisoned
  const data=schemas[name]?.parse(payload);if(!data)throw fail('PI_BUSINESS_FACT_UNSUPPORTED')
  if(readOnly&&(name==='approval/policy'&&data.policy!=='never'||name==='sandbox/policy'&&data.mode!=='read-only'||name==='permission/selected'&&(data.sandbox!=='read-only'||data.approval!=='never')))throw fail('PI_READ_ONLY_SCOPE')
  const [domain,kind]=name.split('/'),receipt={version:1,domain,kind,payload:data}
  store.appendAudit(receipt);if(update)apply(receipt);return receipt
 }
 const flush=async()=>{if(poisoned)throw poisoned;try{await store.commit()}catch(cause){poisoned=cause;throw cause}}
 const change=(name,payload)=>{const operation=tail.then(async()=>{const receipt=append(name,payload,false);await flush();apply(receipt)});tail=operation.catch(()=>{});return operation}
 return {
  audit({isLive,isTurnOpen}){
   if(typeof isLive!=='function'||typeof isTurnOpen!=='function')throw new TypeError('Explicit live actor and turn capabilities required')
   return {isLive:()=>!poisoned&&isLive(),isTurnOpen,approvalPolicy:()=>{healthy();return readOnly?'never':approval},append(type,data){if(!type.startsWith('approval/'))throw fail('PI_BUSINESS_FACT_UNSUPPORTED');append(type,data)},flush}
  },
  bindActor(actor,{isLive,admitNotice}){
   if(typeof isLive!=='function'||typeof admitNotice!=='function')throw new TypeError('Explicit live actor and reliable notice capabilities required')
   const initialDirectory=store.header.cwd
   const unbindDirectory=bindWorkingDirectoryActor(actor,{initialDirectory,isLive,readDirectory:()=>{healthy();return directory},appendChange:data=>change('directory/changed',data),admitNotice})
   let unbindPolicy,unbindPermissions
   try{
    unbindPolicy=bindSandboxPolicyActor(actor,{initialDirectory,isLive,readPolicy:()=>{healthy();return structuredClone(readOnly?{...sandbox,mode:'read-only'}:sandbox)},appendPolicy:data=>change('sandbox/policy',data)})
    unbindPermissions=bindPermissionPresetActor(actor,{isLive,readPermissions:()=>{healthy();return{preset:readOnly?'read-only':preset,sandbox:readOnly?'read-only':sandbox.mode,approval:readOnly?'never':approval??null,seeded:store.header.isSeeded===true}},commitPermissions:data=>change('permission/selected',data)})
   }catch(cause){unbindDirectory();unbindPolicy?.();throw cause}
   return()=>{unbindDirectory();unbindPolicy();unbindPermissions()}
  },
 }
}
