import {hostFeedback} from './feedback/service.js'
import {createOperatorSettings} from './settings/operator.js'
import {resolveRoleModels,roleModelSelection,legacyRoleModelSelection,materializeRoleModelSelection} from './role-models.js'
import {taskModelSelection} from '../packages/dingtalk-core/task-model-config.js'
import {savePermissionConfiguration} from './settings/configuration.js'
import {openToolPermissions} from './tool-permissions.js'
import {configFileOf,updateConfig,validateConfig} from './config.js'
import {assertPiTaskBackendConfiguration} from './runtime/pi-task-backend.js'
import {prepareProfileEntries} from './native-profile-preflight.js'
import {taskSessionRoutes} from './tasks/session-routes.js'
import {createChannelLifecycle} from './channels/lifecycle.js'
import {createChannelIngressConfiguration} from './channels/ingress-control.js'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import {loadNativeEnvironment} from './native-environment.js'
import { createRequire } from 'node:module'
import { mkdir,realpath } from 'node:fs/promises'
import { resolve, join,dirname } from 'node:path'
import { pathToFileURL } from 'node:url'
import {portablePaths} from './runtime/portable.js'
import {runtimePaths,prepareRuntimePaths,environmentPaths,inside} from './runtime/paths.js'
import {acquireLock,readRegular,failure} from './runtime/files.js'
import {createPrivacy,installProcessPrivacy} from './memory/privacy.js'

const require = createRequire(import.meta.url)
/** Compose host storage, policy and tools around the Pi agent loop. No GUI plugins. */
export async function createHost(config, { extraPlugins = [], environmentOptions = {}, environmentSnapshot, deferScheduledDelivery = false, dingtalkProfileRunner, dingtalkPluginDependencies = {} } = {}) {
  assertPiTaskBackendConfiguration(config)
  const paths=runtimePaths(config)
  await prepareRuntimePaths(paths)
  if(paths.mode==='portable'){
    if(config.skillDirs!==undefined&&(!Array.isArray(config.skillDirs)||config.skillDirs.some(path=>typeof path!=='string')))throw failure('NIGHT_SKILL_DIRECTORIES_INVALID')
    for(const path of config.skillDirs??[]){const target=resolve(paths.installRoot,path);if(!inside(paths.installRoot,target))throw failure('NIGHT_SKILL_DIRECTORY_OUTSIDE_INSTALL');let ancestor=target;for(;;){try{if(await realpath(ancestor)!==ancestor)throw failure('NIGHT_SKILL_DIRECTORY_ALIAS_UNSAFE');break}catch(error){if(error.code!=='ENOENT')throw error;ancestor=dirname(ancestor)}}}
  }
  const root = paths.state, workspace = paths.workspaces
  const ctx = new Context()
  let releaseData,closing,permissionService,channelLifecycle
  const configurationCalls=new Set()
  const configurationCall=operation=>{
    if(!releaseData||closing)throw failure('CHANNEL_CONFIGURATION_UNAVAILABLE')
    if(ctx.get('agents')?.currentInitiator()!==undefined)throw failure('CHANNEL_CONFIGURATION_OPERATOR_REQUIRED')
    const call=Promise.resolve().then(operation);configurationCalls.add(call)
    call.finally(()=>configurationCalls.delete(call)).catch(()=>{})
    return call
  }
  const close=()=>closing??=(async()=>{
    const errors=[]
    const attempt=async action=>{try{await action()}catch(error){errors.push(error)}}
    // 已接纳的配置保存先排空，安装锁持续持有到原子提交结束。
    await Promise.allSettled([...configurationCalls])
    await attempt(()=>ctx.get('errorFeedback')?.close())
    await attempt(()=>permissionService?.close())
    await attempt(()=>ctx.get('application')?.close?.())
    await attempt(()=>ctx.get('officialAgentFactory')?.close())
    // Cordis 仅记录 effect 清理错误；须显式等待原 Job/进程 join 的真实结果。
    await attempt(()=>ctx.get('jobs')?.disposeAll())
    await attempt(()=>ctx.get('subprocess')?.disposeManagedProcesses())
    // 未证排空时保留 owner 依赖及安装锁，不能靠拆依赖制造关闭成功。
    if(!errors.length)await attempt(()=>ctx.fiber.dispose())
    if(!errors.length)await attempt(()=>releaseData?.())
    if(errors.length)throw new AggregateError(errors,'Host shutdown failed; ownership retained')
  })()
  try {
    if(paths.mode==='portable'){releaseData=await acquireLock(join(paths.runtime,'.host.lock'),{timeoutMs:0});if(await readRegular(join(paths.runtime,'task-restore.pending.json'))!==undefined)throw failure('TASK_ARCHIVE_RESTORE_INCOMPLETE');if(await readRegular(join(paths.runtime,'restore.pending.json'))!==undefined)throw failure('NIGHT_RESTORE_INCOMPLETE')}
    if(paths.mode==='portable'){
      const file=configFileOf(config)??join(paths.config,'config.json')
      ctx.provide('operatorSettings',createOperatorSettings({file,paths,running:config,getCredentials:()=>ctx.get('credentials'),getRoleModels:()=>ctx.get('roleModels'),getEnvironment:()=>ctx.get('launchEnvironment'),getFallbackRoleModels:saved=>{
        const task=ctx.get('application')?.store.getTaskSessionModelConfig?.()
        return {triage:saved.model,router:saved.model,task:task?taskModelSelection(saved.model,task):legacyRoleModelSelection(saved,'task')}
      },getRuntimeRoleModels:()=>{
        const defaults=ctx.get('agentDefaultModel')?.currentSelection()??config.model,task=ctx.get('application')?.runtime.getAgentConfig().taskSessionModel
        return Object.fromEntries(['triage','router','task'].map(role=>[role,roleModelSelection(ctx,role,role==='task'?(task?taskModelSelection(defaults,task):legacyRoleModelSelection(config,role)):defaults)]))
      },run:configurationCall,applyChannel:(transaction,id)=>channelLifecycle.apply(transaction,id),canEditChannel:id=>channelLifecycle?.canEdit(id)===true}))
      ctx.provide('channelConfiguration',{
        ...createChannelIngressConfiguration({file,run:configurationCall,getChannels:()=>ctx.get('channels'),getLifecycle:()=>channelLifecycle}),
        read:()=>configurationCall(async()=>{
          const result=await updateConfig(file,next=>next,{checkOnly:true})
          return result.config.channelPlugins??[]
        }),
        getDingtalk:channelId=>configurationCall(async()=>{
          const {dingtalkEditable}=await import('./channels/plugins/dingtalk-config.js')
          const result=await updateConfig(file,next=>next,{checkOnly:true})
          const row=result.config.channelPlugins?.find(row=>row.channelId===channelId&&row.type==='dingtalk-dws')
          if(!row)throw failure('DINGTALK_CHANNEL_NOT_FOUND')
          return dingtalkEditable(row)
        }),
        editDingtalk:(channelId,input)=>configurationCall(async()=>{
          const fields=['expectedVersion','name','prompt','conversationType','targetKind','target']
          if(!input||Array.isArray(input)||typeof input!=='object'||fields.some(key=>!Object.hasOwn(input,key))||Object.keys(input).some(key=>![...fields,'writesAuthorized'].includes(key))||input.writesAuthorized!==undefined&&typeof input.writesAuthorized!=='boolean'||!['id','name'].includes(input.targetKind)||!['chat','chat-room'].includes(input.conversationType)||typeof input.expectedVersion!=='string'||!/^[a-f0-9]{64}$/.test(input.expectedVersion)||['name','prompt','target'].some(key=>typeof input[key]!=='string'||input[key].includes('\0'))||!input.target.trim())throw failure('DINGTALK_CHANNEL_REQUEST_INVALID')
          const {validateConfig:validateDingtalkConfig,validateDingtalkInstance,dingtalkEditable,dingtalkBindingKey,dingtalkConfigVersion}=await import('./channels/plugins/dingtalk-config.js')
          const {dingtalkChannelPaths,assertDingtalkStoragePath,assertDingtalkTargetSwitch,openDingtalkIngress,readDingtalkBinding}=await import('./channels/plugins/dingtalk-storage.js')
          const {bindDingtalkConfig}=await import('./channels/plugins/dingtalk-binding.js')
          const {dwsEnvironment}=await import('./channels/plugins/dws-environment.js')
          const {createNodeDwsRunner}=await import('../packages/dingtalk-core/dws-runner.js')
          const current=(await updateConfig(file,next=>next,{checkOnly:true})).config.channelPlugins?.find(row=>row.channelId===channelId&&row.type==='dingtalk-dws')
          if(!current)throw failure('DINGTALK_CHANNEL_NOT_FOUND')
          if(dingtalkConfigVersion(current)!==input.expectedVersion)throw failure('DINGTALK_CHANNEL_VERSION_CONFLICT')
          const before=dingtalkEditable(current),row=structuredClone(current),body={...input,name:input.name.trim(),target:input.target.trim()}
          if(body.name)row.config.dingtalk_name=body.name;else delete row.config.dingtalk_name
          // 缺省空职责保持缺省，避免相同快照生成虚假的配置版本。
          if(body.prompt||Object.hasOwn(row.config,'dingtalk_prompt'))row.config.dingtalk_prompt=body.prompt
          const targetChanged=['conversationType','targetKind','target'].some(key=>body[key]!==before[key])
          if(targetChanged&&body.writesAuthorized===true)throw failure('DINGTALK_CHANNEL_REQUEST_INVALID')
          if(body.writesAuthorized!==undefined)row.config.dingtalk_writes_authorized=body.writesAuthorized
          let binding,switched=false,includeAllScopes=false
          if(targetChanged){
            const oldConfig=validateDingtalkConfig(current.config),storage=dingtalkChannelPaths(paths,channelId,oldConfig.storageKey)
            await assertDingtalkStoragePath(paths,storage.bindingFile)
            const savedBinding=await readDingtalkBinding(storage.bindingFile)??oldConfig.binding
            if(savedBinding){
              if(oldConfig.binding&&dingtalkBindingKey(savedBinding)!==dingtalkBindingKey(oldConfig.binding))throw failure('DINGTALK_BINDING_CHANGED')
              validateDingtalkConfig({...current.config,dingtalk_binding:savedBinding,...oldConfig.conversationType==='chat-room'?{dingtalk_group_id:oldConfig.groupId??savedBinding.conversationId}:{dingtalk_user_id:oldConfig.userId??savedBinding.peerUserId}})
            }
            const runner=dingtalkProfileRunner??createNodeDwsRunner({executable:oldConfig.executable??'dws',cwd:storage.workspace,env:dwsEnvironment(paths,storage.privateHome,storage.cache,{accountMode:oldConfig.accountMode})})
            const running=ctx.get('channels')?.plugins.get(channelId)
            if(!savedBinding&&(running?.bindingIdentity||running?.bindingActive===true))throw failure('DINGTALK_BINDING_REQUIRED')
            const previousBinding=savedBinding
            includeAllScopes=!previousBinding
            for(const key of ['dingtalk_group_id','dingtalk_group_name','dingtalk_user_id','dingtalk_user_name','dingtalk_binding','dingtalk_storage_key'])delete row.config[key]
            row.config.dingtalk_profile=previousBinding?.profile??oldConfig.profile
            row.config.dingtalk_conversation_type=body.conversationType
            row.config['dingtalk_'+(body.conversationType==='chat-room'?'group':'user')+'_'+body.targetKind]=body.target
            row.config=await bindDingtalkConfig(row.config,{runner});binding=row.config.dingtalk_binding
            if(binding.profile!==oldConfig.profile||previousBinding&&['profile','corpId','userId','actorId'].some(key=>binding[key]!==previousBinding[key]))throw failure('DINGTALK_BOUND_ACCOUNT_CHANGED')
            switched=!previousBinding||dingtalkBindingKey(previousBinding)!==dingtalkBindingKey(binding)
            if(!switched)row.config.dingtalk_storage_key=oldConfig.storageKey??'legacy'
            else{
              const legacy=dingtalkChannelPaths(paths,channelId)
              await assertDingtalkStoragePath(paths,legacy.bindingFile)
              const oldLegacy=await readDingtalkBinding(legacy.bindingFile)
              row.config.dingtalk_storage_key=!includeAllScopes&&oldLegacy&&dingtalkBindingKey(oldLegacy)===dingtalkBindingKey(binding)?'legacy':dingtalkBindingKey(binding)
              row.config.dingtalk_writes_authorized=false
            }
          }
          validateDingtalkInstance(row)
          const save=()=>updateConfig(file,async next=>{
            const index=next.channelPlugins?.findIndex(value=>value.channelId===channelId&&value.type==='dingtalk-dws')??-1
            if(index<0)throw failure('DINGTALK_CHANNEL_NOT_FOUND')
            if(dingtalkConfigVersion(next.channelPlugins[index])!==body.expectedVersion)throw failure('DINGTALK_CHANNEL_VERSION_CONFLICT')
            if(switched){
              await assertDingtalkTargetSwitch(paths,channelId,binding)
              const storage=dingtalkChannelPaths(paths,channelId,row.config.dingtalk_storage_key)
              await assertDingtalkStoragePath(paths,storage.bindingFile)
              const saved=await readDingtalkBinding(storage.bindingFile)
              if(saved&&dingtalkBindingKey(saved)!==dingtalkBindingKey(binding))throw failure('DINGTALK_BINDING_CHANGED')
              const ingress=await openDingtalkIngress(paths,channelId,{storageKey:row.config.dingtalk_storage_key,fromAt:new Date().toISOString()})
              await ingress.drain()
            }
            next.channelPlugins[index]=row
            return next
          },{apply:transaction=>channelLifecycle.apply(transaction,channelId)})
          let result
          if(switched&&!channelLifecycle.instances.has(channelId)&&current.enabled){
            const tasks=ctx.get('application')?.tasks
            if(!tasks)throw failure('CHANNEL_CONFIGURATION_UNAVAILABLE')
            result=await tasks.withChannelTargetSwitch({channelId,nextTarget:{type:binding.conversationType,conversationId:binding.conversationId,peerId:binding.peerId},includeAllScopes},save)
          }else result=await save()
          return {changed:result.changed,restartRequired:result.restartRequired,liveApplied:result.liveApplied??false,channel:row,detail:dingtalkEditable(row)}
        }),
        setEnabled:(channelId,input)=>configurationCall(async()=>{
          if(typeof channelId!=='string'||!channelId||!input||Object.keys(input).some(key=>!['expectedVersion','enabled'].includes(key))||typeof input.expectedVersion!=='string'||typeof input.enabled!=='boolean')throw failure('DINGTALK_CHANNEL_REQUEST_INVALID')
          const {dingtalkConfigVersion}=await import('./channels/plugins/dingtalk-config.js')
          const result=await updateConfig(file,next=>{
            const row=next.channelPlugins?.find(row=>(row.channelId??row.config?.channelId??row.type)===channelId)
            if(!row)throw failure('DINGTALK_CHANNEL_NOT_FOUND')
            if(row.type==='web-console')throw failure('CHANNEL_LIVE_LIFECYCLE_UNSUPPORTED')
            if(dingtalkConfigVersion(row)!==input.expectedVersion)throw failure('DINGTALK_CHANNEL_VERSION_CONFLICT')
            row.enabled=input.enabled;return next
          },{apply:transaction=>channelLifecycle.apply(transaction,channelId)})
          return {changed:result.changed,restartRequired:result.restartRequired,liveApplied:result.liveApplied??false}
        }),
        remove:(channelId,input)=>configurationCall(async()=>{
          if(typeof channelId!=='string'||!channelId||!input||Object.keys(input).some(key=>key!=='expectedVersion')||typeof input.expectedVersion!=='string')throw failure('DINGTALK_CHANNEL_REQUEST_INVALID')
          const {dingtalkConfigVersion}=await import('./channels/plugins/dingtalk-config.js')
          const result=await updateConfig(file,next=>{
            const index=next.channelPlugins?.findIndex(row=>(row.channelId??row.config?.channelId??row.type)===channelId)??-1
            if(index<0)throw failure('DINGTALK_CHANNEL_NOT_FOUND')
            const row=next.channelPlugins[index]
            if(row.type==='web-console')throw failure('CHANNEL_LIVE_LIFECYCLE_UNSUPPORTED')
            if(dingtalkConfigVersion(row)!==input.expectedVersion)throw failure('DINGTALK_CHANNEL_VERSION_CONFLICT')
            next.channelPlugins.splice(index,1);return next
          },{apply:transaction=>channelLifecycle.apply(transaction,channelId,{removing:true})})
          return {changed:result.changed,restartRequired:result.restartRequired,liveApplied:result.liveApplied??false}
        }),
        addDingtalk:input=>configurationCall(async()=>{
          const fields=['channelId','conversationType','targetKind','target','name','prompt','writesAuthorized']
          if(!input||Array.isArray(input)||typeof input!=='object'||Object.keys(input).some(key=>!fields.includes(key))||input.writesAuthorized!==undefined&&typeof input.writesAuthorized!=='boolean'||!['id','name'].includes(input.targetKind)||!['chat','chat-room'].includes(input.conversationType))throw failure('DINGTALK_CHANNEL_REQUEST_INVALID')
          const body=structuredClone(input),target='dingtalk_'+(body.conversationType==='chat-room'?'group':'user')+'_'+body.targetKind
          const {validateDingtalkInstance}=await import('./channels/plugins/dingtalk-config.js')
          const row={type:'dingtalk-dws',channelId:body.channelId,enabled:true,config:{
            dingtalk_conversation_type:body.conversationType,[target]:body.target,
            dingtalk_account_mode:'system',dingtalk_writes_authorized:body.writesAuthorized===true,dingtalk_listen:true,
            ...body.name!==undefined?{dingtalk_name:body.name}:{},...body.prompt!==undefined?{dingtalk_prompt:body.prompt}:{},
          }}
          const {openDingtalkIngress}=await import('./channels/plugins/dingtalk-storage.js')
          const configuredAt=new Date().toISOString()
          const result=await updateConfig(file,async next=>{
            if((next.channelPlugins??[]).some(value=>(value.channelId??value.config?.channelId??value.type)===row.channelId)||ctx.get('channels')?.plugins.has(row.channelId))throw failure('DINGTALK_CHANNEL_EXISTS')
            const {dwsReadJson,selectDwsProfile}=await import('./channels/plugins/dingtalk-binding.js')
            const {dwsEnvironment}=await import('./channels/plugins/dws-environment.js')
            const {createNodeDwsRunner}=await import('../packages/dingtalk-core/dws-runner.js')
            const runner=dingtalkProfileRunner??createNodeDwsRunner({cwd:paths.workspaces,env:dwsEnvironment(paths,undefined,undefined,{accountMode:'system'})})
            let profiles
            try{profiles=await dwsReadJson(runner,['profile','list'])}catch(error){
              if(['ENOENT','EACCES','EPERM','ENOEXEC'].includes(error.code))throw failure('DINGTALK_CLI_UNAVAILABLE')
              if(error.code?.startsWith('DINGTALK_'))throw error
              throw failure('DINGTALK_PROFILE_LOOKUP_FAILED')
            }
            const current=selectDwsProfile(profiles)
            row.config.dingtalk_profile=current.corpId+':'+current.userId
            try{validateDingtalkInstance(row)}catch{throw failure('DINGTALK_CONFIG_INVALID')}
            next.channelPlugins??=[];next.channelPlugins.push(row)
            validateConfig(structuredClone(next),file)
            // 初始化新渠道补拉下界；事务协调器负责加载和发布。
            const ingress=await openDingtalkIngress(paths,row.channelId,{fromAt:configuredAt}),state=ingress.snapshot()
            await ingress.saveBridgeState({...state,paused:true,pausedAt:state.pausedAt??configuredAt})
            await ingress.drain()
            return next
          },{apply:transaction=>channelLifecycle.apply(transaction,row.channelId)})
          return {changed:result.changed,restartRequired:result.restartRequired,liveApplied:result.liveApplied??false,channel:row}
        }),
      })
    }
    ctx.provide('runtimePaths',paths)
    ctx.provide('portablePaths',portablePaths(paths))
    const taskRoutes=await taskSessionRoutes(paths);ctx.provide('taskSessionRoutes',taskRoutes)
    const privacy=await createPrivacy(paths);ctx.provide('memoryPrivacy',privacy)
    ctx.provide('launchEnvironment',environmentSnapshot ?? await loadNativeEnvironment({...environmentPaths(config),...environmentOptions,materialize:false,warn:message=>ctx.logger.warn(message)}))
    // Configuration is operator-owned and fixed for this Host lifetime. It is
    // independent of Web and takes precedence over historical model stores.
    const roleModels=resolveRoleModels(config,ctx.get('launchEnvironment'))
    ctx.baseUrl = pathToFileURL(join(root, 'cordis.yml')).href
    await ctx.plugin(Loader)
    ctx.loader.builtins.group = require('@deepseek-ai/cordis-plugin-group').default
    const shell = config.shell ?? (process.platform === 'win32' ? 'pwsh' : 'bash')
    if (!['pwsh','bash'].includes(shell)) throw new Error('NIGHT_BOT_SHELL_INVALID')
    const configurationCandidate=paths.mode==='portable'?(configFileOf(config)??(await readRegular(join(paths.config,'config.json'))!==undefined?join(paths.config,'config.json'):undefined)):undefined
    // Legacy read-only bootstrap files outside data/config remain supported,
    // but cannot be made writable by bypassing updateConfig's controlled path.
    const modelConfigurationFile=configurationCandidate&&inside(paths.config,configurationCandidate)?configurationCandidate:undefined
    const rows = [
      { name: new URL('./native-agents.js', import.meta.url).href }, { name: new URL('./application-session-catalog.js', import.meta.url).href }, { name: new URL('./native-system-prompt.js', import.meta.url).href, config: { includeHarnessIdentity: false } },
      { name: new URL('./native-tools.js', import.meta.url).href }, { name: new URL('./native-tool-timeout.js', import.meta.url).href }, { name: new URL('./native-web.js', import.meta.url).href, config: config.web ?? {} }, { name: new URL('./native-http-fetch.js', import.meta.url).href, config: config.webFetch ?? {} }, { name: new URL('./native-authorization.js', import.meta.url).href },
      { name: new URL('./native-credentials.js', import.meta.url).href, config: { path: paths.credentials, watch: config.credentialsWatch ?? true } },
      { name: new URL('./native-attachments.js', import.meta.url).href, config: { storageRoot: paths.attachmentsHome } },
      { name: new URL('./native-pi-provider.js', import.meta.url).href, config: { providers: config.providers ?? {} } },
      { name: new URL('./native-state.js', import.meta.url).href, config: { root: join(root, 'storage'), model: config.model,modelConfigurationFile } },
      { name: new URL('./native-spill.js', import.meta.url).href, config: { root: paths.spills } }, { name: new URL('./native-jobs.js', import.meta.url).href }, { name: new URL('./native-tool-jobs.js', import.meta.url).href }, { name: new URL('./process/index.js', import.meta.url).href }, { name: new URL('./native-sandbox.js', import.meta.url).href },
      { name: new URL('./native-policy.js', import.meta.url).href, config: { mode: 'workspace-write', workspaceRoot: workspace } },
      { name: new URL('./native-' + shell + '-sandbox.js', import.meta.url).href, config: { cwd: workspace } }, { name: new URL('./native-approval.js', import.meta.url).href, config: { policy: 'ask' } },
      { name: new URL('./native-permission-presets.js', import.meta.url).href, config: { defaultPreset: 'workspace-write', presets: {
        'read-only': { sandbox: 'read-only', approval: 'ask' },
        'workspace-write': { sandbox: 'workspace-write', approval: 'ask' },
        'danger-full-access': { sandbox: 'danger-full-access', approval: 'never' },
      } } },
      { name: new URL('./pi-authority.js', import.meta.url).href },
      { name: new URL('./pi-session-persistence.js', import.meta.url).href, config: { root: join(root, 'sessions'), compression: 'none' } },
      { name: new URL('./native-workspace.js', import.meta.url).href }, { name: new URL('./native-skills.js', import.meta.url).href }, { name: new URL(paths.mode==='portable'?'./memory/private-fs.js':'./native-fs-sandbox.js', import.meta.url).href, config: { cwd: workspace } }, { name: new URL('./native-working-directory.js', import.meta.url).href, config: { defaultDirectory: workspace } },
      { name: new URL('./native-agent-presets.js', import.meta.url).href, config: { default: 'night-bot' } },
      { name: new URL('./pi-official-runtime.js', import.meta.url).href, config: { model: config.model, memoryModel: config.memory?.model??config.model, roleModels, skillDirs:config.skillDirs, fileTools:config.fileTools, maxParallelToolCalls: config.maxParallelToolCalls ?? 4 } },
      { name: new URL('./native-session-controller.js', import.meta.url).href },
      { name: new URL('./native-schedule.js', import.meta.url).href, config: config.schedule ?? {} },
      { name: new URL('./memory/service.js', import.meta.url).href, config: {...config.memory,skillDirs:config.skillDirs??[]} },
      { name: new URL('./memory/reflection.js', import.meta.url).href, config: config.reflection ?? {} },
      { name: new URL('./work-log/service.js', import.meta.url).href, config },
      { name: new URL('./channels/service.js', import.meta.url).href },
      ...(config.plugins ?? []), ...extraPlugins,

    ]
    await ctx.loader.root.update(prepareProfileEntries(ctx,rows,ctx.baseUrl))
    await ctx.loader.await()
    for(const [role,selection]of Object.entries(roleModels)){
      await ctx.nativePiProvider.official.resolve(selection)
      // Pi 1.5 defaults new sessions to medium and clamps via its public API.
      // Make the explicit role default concrete so a resumed journal cannot
      // silently restore an earlier role's effort after an operator reset.
      roleModels[role]=Object.freeze(materializeRoleModelSelection(config,selection))
    }
    ctx.provide('roleModels',Object.freeze(roleModels))
    const feedback=hostFeedback(ctx,config,paths)
    ctx.provide('errorFeedback',feedback)
    ctx.effect(()=>()=>feedback.close(),'feedback session drain')
    channelLifecycle=createChannelLifecycle({ctx,paths,running:config,dependencies:{...dingtalkPluginDependencies,...dingtalkProfileRunner?{runner:dingtalkProfileRunner}:{}}})
    ctx.provide('channelLifecycle',channelLifecycle)
    await channelLifecycle.initialize(config)
    if (!ctx.get('nativePiProvider')) throw new Error('NIGHT_BOT_NATIVE_PROVIDER_UNAVAILABLE')
    for (const service of ['agents','credentials','officialAgentFactory','nativeModelRoutes','sessionCatalog','piAuthority','sessionPersistence','authorization','fs','workingDirectory','attachments','skills','workspaceRegistry','systemPrompt','sessionController','schedule','memory','sandboxPolicy','web','nativeHttpFetch','nativeToolTimeout','spillStore','approval','permissionPresets'])
      if (!ctx.get(service)) throw new Error('NIGHT_BOT_REQUIRED_SERVICE_UNAVAILABLE:'+service)
    if (!ctx.get('tools')) throw new Error('NIGHT_BOT_TOOL_RUNTIME_UNAVAILABLE')
    if (!ctx.get('jobs')) throw new Error('NIGHT_BOT_JOB_RUNTIME_UNAVAILABLE')
    if (!ctx.get('sandbox')) throw new Error('NIGHT_BOT_SANDBOX_UNAVAILABLE')
    if (!ctx.get('subprocess')) throw new Error('NIGHT_BOT_SUBPROCESS_UNAVAILABLE')
    // Full process output is recovery evidence, not disposable launcher temp.
    if(paths.mode==='portable')ctx.subprocess.internals={...ctx.subprocess.internals,spillDir:paths.processSpills}
    permissionService=await openToolPermissions({ctx,mode:config.permissionMode??'full',
      saveMode:async value=>{const file=configFileOf(config)??(paths.mode==='portable'?join(paths.config,'config.json'):undefined);if(!file)throw failure('NIGHT_BOT_PERMISSION_CONFIG_UNAVAILABLE');await savePermissionConfiguration(file,{mode:value});config.permissionMode=value},
      resolveModel:(actor,{signal})=>ctx.nativePiProvider.official.resolve({...ctx.agentDefaultModel.currentSelection(),signal},{credentials:actor.ctx.get('credentials')})})
    ctx.provide('toolPermissions',permissionService)
    ctx.effect(()=>()=>permissionService.close(),'Host tool permission requests drain')
    await installProcessPrivacy(ctx,privacy)
    await ctx.plugin({ inject: ['agentPresets'], async *apply(child) {
      for(const id of ['night-bot','night-bot-task'])yield await child.agentPresets.register({ id, plugins: [{ name: 'cordis:group', group: true,
        isolate: { fs: true, workingDirectory: true, shellEnv: true, nativeAgentInstructions: true }, config: [
          { name: new URL(paths.mode==='portable'?'./memory/private-fs.js':'./native-fs-sandbox.js', import.meta.url).href, config: { cwd: workspace } }, { name: new URL('./native-working-directory.js', import.meta.url).href, config: { defaultDirectory: workspace } },
          { name: new URL('./native-shell-env.js', import.meta.url).href }, { name: new URL('./native-tool-fs-search.js', import.meta.url).href }, { name: new URL('./native-fs-observation-policy.js', import.meta.url).href },
          { name: new URL('./native-tool-' + shell + '.js', import.meta.url).href, config: { enableRunInBackground: true, promoteOnTimeout: true } },
          { name: new URL('./native-skill-filesystem.js', import.meta.url).href, config: { includeDefaultRoots: paths.mode!=='portable', customSkillDirs: paths.mode==='portable'?[paths.skills,join(paths.agentsHome,'skills'),join(paths.harnessHome,'skills'),...(config.skillDirs??[]).map(path=>resolve(paths.installRoot,path))]:(config.skillDirs??[]), watch: config.skillWatch ?? true, agentsHome:paths.agentsHome } }, { name: new URL('./native-tool-skill.js', import.meta.url).href },
          { name: new URL('./native-agent-instructions.js', import.meta.url).href, config: { maxBytes: 65536, instructionHome:paths.harnessHome,agentsHome:paths.agentsHome } }, { name: new URL('./native-tool-working-directory.js', import.meta.url).href },
          { name: new URL('./native-tool-todo.js', import.meta.url).href, config: { allowParallelInProgress: true } }, { name: new URL('./native-tool-web.js', import.meta.url).href, config: config.webTools ?? {} },
          { name: new URL('./native-tool-schedule.js', import.meta.url).href },
          { name: new URL('./memory/tools.js', import.meta.url).href },
        ] }] })
    } })
    const preset = await ctx.agentPresets.resolve('night-bot')
    if (preset.broken) throw new Error('NIGHT_BOT_PRESET_BROKEN:' + JSON.stringify(preset.broken))
    if (!deferScheduledDelivery) ctx.schedule.start()
    return { ctx, close }
  } catch (error) {
    try{await close()}
    catch(cause){throw new AggregateError([error,cause],'Host startup and cleanup failed')}
    throw error
  }
}
