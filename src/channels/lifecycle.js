import {isDeepStrictEqual} from 'node:util'
import {channelPluginRows} from './loader.js'
import {prepareProfileEntries} from '../native-profile-preflight.js'
import {failure} from '../runtime/files.js'
import {applyChannelIngress,declareChannelIngress} from './ingress-control.js'

const channelId=row=>row.channelId??row.config?.channelId??row.type
const same=isDeepStrictEqual
const settingsOnly=(before,after)=>{
  if(before?.type!=='dingtalk-dws'||after?.type!==before.type)return false
  const strip=row=>{const value=structuredClone(row);delete value.enabled;for(const key of ['dingtalk_name','dingtalk_prompt','dingtalk_writes_authorized'])delete value.config[key];return value}
  return same(strip(before),strip(after))
}
const sameBindingSettings=(before,after)=>{
  const strip=row=>{const value=structuredClone(row);delete value.enabled;for(const key of ['dingtalk_name','dingtalk_prompt','dingtalk_writes_authorized','dingtalk_group_id','dingtalk_group_name','dingtalk_user_id','dingtalk_user_name','dingtalk_binding','dingtalk_storage_key'])delete value.config[key];return value}
  return (before.config.dingtalk_storage_key??'legacy')===(after.config.dingtalk_storage_key??'legacy')&&same(strip(before),strip(after))
}
/** Own individual adapters, never reload the core service tree. Configuration
 * transactions hold the installation config lock and the per-channel gate.
 * Trusted third-party adapters opt in only with an explicit joinable lifecycle. */
export function createChannelLifecycle({ctx,paths,running,dependencies={}}){
  const instances=new Map()
  const publish=(id,row)=>{
    const rows=running.channelPlugins??=[],index=rows.findIndex(value=>channelId(value)===id)
    if(row){if(index<0)rows.push(structuredClone(row));else rows[index]=structuredClone(row)}else if(index>=0)rows.splice(index,1)
    running.channelPlugins=rows
  }
  const prepare=async(row,config,normalized)=>{
    if(!row?.enabled)return
    const [entry]=normalized?[normalized]:await channelPluginRows({...config,channelPlugins:[row]},paths)
    if(!entry||prepareProfileEntries(ctx,[entry],ctx.baseUrl)[0].disabled)throw failure('CHANNEL_PLUGIN_UNAVAILABLE')
    const module=await import(entry.name)
    return {entry,module}
  }
  const mount=async(row,prepared)=>{
    if(!row?.enabled)return
    let fiber,cleanup
    const previousPlugin=ctx.channels.plugins.get(channelId(row))
    try{
      const plugin=prepared.module
      fiber=row.type==='dingtalk-dws'?ctx.plugin({...plugin,apply:child=>plugin.apply(child,prepared.entry.config,{...dependencies,registerStopAndDrain:stop=>{cleanup=stop}})}):ctx.plugin(plugin.default??plugin,prepared.entry.config)
      await fiber
      declareChannelIngress(ctx.channels.plugins.get(channelId(row)),plugin)
      return {row:structuredClone(row),fiber,module:plugin}
    }catch(error){
      if(fiber){
        // Never broadcast night/stopping: global Cordis listeners bypass a
        // context filter and could shut down unrelated channels.
        const published=ctx.channels.plugins.get(channelId(row))
        const stop=cleanup??(published!==previousPlugin?published?.stopAndDrain:undefined)
        if(stop){
          try{await stop()}catch(cause){instances.set(channelId(row),{row:structuredClone(row),fiber,module:prepared.module});throw Object.assign(new AggregateError([error,cause],'CHANNEL_DRAIN_FAILED'),{lifecycleUndrained:true})}
        }else if(prepared.module.channelLifecycle===1){
          instances.set(channelId(row),{row:structuredClone(row),fiber,module:prepared.module})
          throw Object.assign(failure('CHANNEL_DRAIN_FAILED'),{cause:error,lifecycleUndrained:true})
        }
        await fiber.dispose()
      }
      throw error
    }
  }
  const stop=async entry=>{
    if(!entry)return
    const plugin=ctx.channels.plugins.get(channelId(entry.row))
    if(typeof plugin?.stopAndDrain!=='function')throw failure('CHANNEL_LIVE_LIFECYCLE_UNSUPPORTED')
    await plugin.stopAndDrain()
    await entry.fiber.dispose()
  }
  const start=async(entry,application,{targetValidated=false}={})=>{
    if(!entry||!application)return
    const plugin=ctx.channels.plugins.get(channelId(entry.row))
    if(typeof plugin?.start!=='function'||typeof plugin?.stopAndDrain!=='function')throw failure('CHANNEL_LIVE_LIFECYCLE_UNSUPPORTED')
    await plugin.start(application,{targetValidated})
    if(plugin.health?.state==='error')throw failure('CHANNEL_ACTIVATION_FAILED')
    await ctx.channels.observerDrain(channelId(entry.row))
  }
  return {
    instances,
    canEdit:id=>instances.get(id)?.module.channelLifecycle===1,
    applyIngress:(transaction,id)=>applyChannelIngress(transaction,id,{ctx,instances,publish}),
    async initialize(config){const normalized=await channelPluginRows(config,paths);for(const row of config.channelPlugins??[]){if(!row.enabled)continue;const prepared=await prepare(row,config,normalized.find(entry=>entry.config.channelId===channelId(row))),entry=await mount(row,prepared);instances.set(channelId(row),entry)}},
    async apply({current,next,commit},id,{removing=false}={}){
      const before=current.channelPlugins?.find(row=>channelId(row)===id),after=next.channelPlugins?.find(row=>channelId(row)===id),old=instances.get(id),application=ctx.get('application')
      // Offline configuration tools intentionally remain file-only. A running
      // operator API takes the coordinated path below, never a global restart.
      if(!application){await commit();return {restartRequired:!!after?.enabled,liveApplied:false}}
      if(before&&old&&!same(before,old.row))throw failure('CHANNEL_RUNTIME_VERSION_CONFLICT')
      // Rows mounted outside this manager (including embedded integrations) are
      // not ours to unload. Preserve the explicit file-only contract.
      if(before?.enabled&&!old){
        if(removing&&(ctx.channels.plugins.has(id)||[...ctx.channels.contexts.values()].some(context=>context.channelId===id)))throw failure('CHANNEL_LIVE_LIFECYCLE_UNSUPPORTED')
        await commit();return {restartRequired:true,liveApplied:false}
      }
      const prepared=await prepare(after,next)
      if((prepared&&prepared.module.channelLifecycle!==1)||(old&&old.module.channelLifecycle!==1)){
        if(removing||old)throw failure('CHANNEL_LIVE_LIFECYCLE_UNSUPPORTED')
        await commit();return {restartRequired:!!after?.enabled||!!old,liveApplied:false}
      }
      const guarded=!!old||[...ctx.channels.contexts.values()].some(context=>context.channelId===id)
      const gate=ctx.channels.holdLifecycle(id),previousTarget=ctx.channels.activeTargets.get(id)
      let release=true
      try{
        try{await gate.drain()}catch(error){release=false;throw error}
        const currentPlugin=ctx.channels.plugins.get(id)
        const sameBinding=old&&after?.type==='dingtalk-dws'&&after.config.dingtalk_binding&&same(currentPlugin?.bindingIdentity,after.config.dingtalk_binding)&&sameBindingSettings(before,after)
        if(old&&after&&(settingsOnly(before,after)||sameBinding)){
          const plugin=ctx.channels.plugins.get(id),normalized=old.module.validateConfig(after.config)
          try{
            await plugin.updateLive({...normalized,enabled:after.enabled,receivePaused:after.receivePaused===true})
            await commit()
          }catch(error){
            if(error.committed===true){old.row=structuredClone(after);publish(id,after);release=false;throw error}
            try{await plugin.updateLive({...old.module.validateConfig(before.config),enabled:before.enabled,receivePaused:before.receivePaused===true})}catch(cause){release=false;throw new AggregateError([error,cause],'CHANNEL_ROLLBACK_FAILED')}
            throw error
          }
          old.row=structuredClone(after);publish(id,after)
          return {restartRequired:false,liveApplied:after.enabled&&plugin.bindingActive===true}
        }
        if(old?.row.config?.dingtalk_operator_notifications===true)throw failure('CHANNEL_LIVE_LIFECYCLE_UNSUPPORTED')
        gate.sealReads()
        try{await gate.drain()}catch(error){release=false;throw error}
        let candidate,oldStopped=false
        const swap=async()=>{
          try{
            if(old){await stop(old);oldStopped=true;instances.delete(id)}
            candidate=await mount(after,prepared)
            await start(candidate,application,{targetValidated:guarded})
            await commit()
            if(candidate)instances.set(id,candidate)
            publish(id,after)
          }catch(error){
            if(error.lifecycleUndrained){release=false;throw error}
            if(error.committed===true){if(candidate)instances.set(id,candidate);publish(id,after);release=false;throw error}
            // A failed stop is not proof of quiescence. Keep its owner and the
            // gate, do not construct a competing adapter or claim rollback.
            if(old&&!oldStopped){release=false;throw error}
            try{
              if(candidate)await stop(candidate)
              if(previousTarget)ctx.channels.activeTargets.set(id,previousTarget);else ctx.channels.activeTargets.delete(id)
              if(old){const restored=await mount(before,await prepare(before,current));await start(restored,application,{targetValidated:true});instances.set(id,restored)}
            }catch(cause){release=false;throw new AggregateError([error,cause],'CHANNEL_ROLLBACK_FAILED')}
            throw error
          }
        }
        if(guarded){
          const binding=after?.config?.dingtalk_binding
          await application.tasks.withChannelTargetSwitch({channelId:id,includeAllScopes:true,nextTarget:binding?{type:binding.conversationType,conversationId:binding.conversationId,peerId:binding.peerId}:{type:'chat-room',conversationId:'retired-channel'}},swap,{activate:!!binding&&after?.enabled===true})
        }else await swap()
        if(!after)ctx.channels.activeTargets.delete(id)
        return {restartRequired:false,liveApplied:!!after?.enabled&&!!ctx.channels.plugins.get(id)&&(after.type!=='dingtalk-dws'||ctx.channels.plugins.get(id).bindingActive===true)}
      }catch(error){if(!release){ctx.channels.configurationErrors??=new Map();ctx.channels.configurationErrors.set(id,error.committed===true?'CHANNEL_CONFIGURATION_COMMIT_UNCERTAIN':'CHANNEL_DRAIN_FAILED')}throw error}
      finally{if(release)gate.release()}
    },
  }
}
