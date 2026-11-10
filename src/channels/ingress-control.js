import {isDeepStrictEqual} from 'node:util'
import {updateConfig} from '../config.js'
import {failure} from '../runtime/files.js'
import {hash} from '../memory/format.js'

const idOf=row=>row.channelId??row.config?.channelId??row.type
const states=new Set(['paused','receiving','recovering','error','unavailable'])
const declaredPlugins=new WeakSet()
export function declareChannelIngress(plugin,module){if(plugin&&module.channelIngressControl===1)declaredPlugins.add(plugin)}
const errors=new Set(['CHANNEL_INGRESS_APPLY_FAILED','CHANNEL_INGRESS_UNAVAILABLE','CHANNEL_INGRESS_LISTEN_DISABLED','CHANNEL_HISTORY_INCOMPLETE','CHANNEL_HISTORY_RECOVERY_FAILED','CHANNEL_MESSAGE_ID_CONFLICT','DINGTALK_CURSOR_PERSIST_FAILED','DINGTALK_AUTH_REQUIRED','DINGTALK_CHANNEL_NOT_READY','DINGTALK_CHANNEL_DISABLED','DINGTALK_HISTORY_RECOVERY_FAILED'])
export function ingressController(plugin){
  try{
    const control=plugin?.ingressControl
    return control?.version===1&&['history','none'].includes(control.backfill)&&typeof control.setPaused==='function'&&typeof control.getStatus==='function'?control:null
  }catch{return null}
}
/** A bounded public projection. Lifecycle/readMessage support never implies replay. */
export function channelIngressView(row,plugin,problem){
  const control=declaredPlugins.has(plugin)?ingressController(plugin):null,requestedPaused=row.receivePaused===true
  let available=false,status,backfill=null
  try{available=!!control&&control.available!==false&&row.enabled===true;backfill=control?.backfill??null;status=control?.getStatus()}
  catch{available=false;status={state:'unavailable',errorCode:'CHANNEL_INGRESS_UNAVAILABLE'}}
  if(!status?.errorCode&&(requestedPaused?status?.state==='paused':['receiving','recovering'].includes(status?.state)))problem=null
  const errorCode=status?.errorCode?(errors.has(status.errorCode)?status.errorCode:'CHANNEL_INGRESS_APPLY_FAILED'):problem?'CHANNEL_INGRESS_APPLY_FAILED':null
  let state=problem?'error':states.has(status?.state)?status.state:'unavailable'
  if(errorCode&&state!=='unavailable')state='error'
  if(requestedPaused&&state==='receiving')state='pausing'
  return {supported:!!control,available,backfill,requestedPaused,state,errorCode}
}
/** Config lock serializes this with edits/removal. Persist intent before applying
 * it, so a crash cannot silently undo an acknowledged user pause on cold start.
 * The adapter owns its joinable receive barrier and durable history cursor. */
export async function applyChannelIngress({current,next,commit},id,{ctx,instances,publish}){
  const before=current.channelPlugins?.find(row=>idOf(row)===id),after=next.channelPlugins?.find(row=>idOf(row)===id),entry=instances.get(id)
  if(!before||!after)throw failure('DINGTALK_CHANNEL_NOT_FOUND')
  const plugin=ctx.channels.plugins.get(id),control=ingressController(plugin)
  if(!entry||entry.module.channelIngressControl!==1||!control)throw failure('CHANNEL_INGRESS_CONTROL_UNSUPPORTED')
  if(!isDeepStrictEqual(before,entry.row))throw failure('CHANNEL_RUNTIME_VERSION_CONFLICT')
  if(!before.enabled||!after.enabled||control.available===false)throw failure('CHANNEL_INGRESS_UNAVAILABLE')
  if(ctx.channels.configurationErrors?.has(id))throw failure('CHANNEL_CONFIGURATION_COMMIT_UNCERTAIN')
  try{await commit()}catch(error){
    if(error.committed===true){ctx.channels.configurationErrors??=new Map();ctx.channels.configurationErrors.set(id,'CHANNEL_CONFIGURATION_COMMIT_UNCERTAIN')}
    throw error
  }
  entry.row=structuredClone(after);publish(id,after)
  ctx.channels.ingressErrors??=new Map()
  try{
    // Never hold the full lifecycle gate while recovering: historical messages
    // must be able to enter channels.receive. Resume only waits for its start.
    await control.setPaused(after.receivePaused===true)
    const actual=channelIngressView(after,plugin)
    if(actual.state==='error'||actual.state==='unavailable'||(after.receivePaused?actual.state!=='paused':actual.state==='paused'))throw failure('CHANNEL_INGRESS_APPLY_FAILED')
    ctx.channels.ingressErrors.delete(id)
    return {restartRequired:false,liveApplied:true}
  }catch{
    // Saved intent is authoritative, but it is not proof that the adapter applied
    // it. Expose failure and require an explicit, versioned retry, never replay.
    ctx.channels.ingressErrors.set(id,'CHANNEL_INGRESS_APPLY_FAILED')
    return {restartRequired:false,liveApplied:false}
  }
}
export function createChannelIngressConfiguration({file,run,getChannels,getLifecycle}){
  const project=row=>channelIngressView(row,getChannels()?.plugins.get(idOf(row)),getChannels()?.ingressErrors?.get(idOf(row)))
  return {
    getIngress:id=>run(async()=>{
      const result=await updateConfig(file,value=>value,{checkOnly:true}),row=result.config.channelPlugins?.find(row=>idOf(row)===id)
      if(!row)throw failure('DINGTALK_CHANNEL_NOT_FOUND')
      return project(row)
    }),
    setIngressPaused:(id,input)=>run(async()=>{
      if(typeof id!=='string'||!id||id!==id.trim()||id.length>128||id.includes('\0')||!input||Object.keys(input).some(key=>!['expectedVersion','paused','confirm'].includes(key))||typeof input.paused!=='boolean'||typeof input.expectedVersion!=='string'||!/^[a-f0-9]{64}$/.test(input.expectedVersion))throw failure('CHANNEL_INGRESS_REQUEST_INVALID')
      if(input.confirm!==true)throw failure('CHANNEL_INGRESS_CONFIRMATION_REQUIRED')
      const result=await updateConfig(file,next=>{
        const row=next.channelPlugins?.find(row=>idOf(row)===id)
        if(!row)throw failure('DINGTALK_CHANNEL_NOT_FOUND')
        if(row.type==='web-console')throw failure('CHANNEL_INGRESS_CONTROL_UNSUPPORTED')
        if(hash(JSON.stringify(row))!==input.expectedVersion)throw failure('DINGTALK_CHANNEL_VERSION_CONFLICT')
        row.receivePaused=input.paused;return next
      },{applyUnchanged:true,apply:transaction=>getLifecycle().applyIngress(transaction,id)})
      const row=result.config.channelPlugins.find(row=>idOf(row)===id)
      return {changed:result.changed,restartRequired:result.restartRequired,liveApplied:result.liveApplied===true,version:hash(JSON.stringify(row)),receivePaused:row.receivePaused,ingress:project(row),channel:row}
    }),
  }
}
