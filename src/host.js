import {prepareProfileEntries} from './native-profile-preflight.js'
import {taskSessionRoutes} from './tasks/session-routes.js'
import {channelPluginRows} from './channels/loader.js'
import {assertNativeScopeAuthority} from './native-scope-guard.js'
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
export async function createHost(config, { extraPlugins = [], environmentOptions = {}, environmentSnapshot, deferScheduledDelivery = false } = {}) {
  assertNativeScopeAuthority()
  const paths=runtimePaths(config)
  await prepareRuntimePaths(paths)
  if(paths.mode==='portable'){
    if(config.skillDirs!==undefined&&(!Array.isArray(config.skillDirs)||config.skillDirs.some(path=>typeof path!=='string')))throw failure('NIGHT_SKILL_DIRECTORIES_INVALID')
    for(const path of config.skillDirs??[]){const target=resolve(paths.installRoot,path);if(!inside(paths.installRoot,target))throw failure('NIGHT_SKILL_DIRECTORY_OUTSIDE_INSTALL');let ancestor=target;for(;;){try{if(await realpath(ancestor)!==ancestor)throw failure('NIGHT_SKILL_DIRECTORY_ALIAS_UNSAFE');break}catch(error){if(error.code!=='ENOENT')throw error;ancestor=dirname(ancestor)}}}
  }
  const root = paths.state, workspace = paths.workspaces
  const ctx = new Context()
  let releaseData,closing
  try {
    if(paths.mode==='portable'){releaseData=await acquireLock(join(paths.runtime,'.host.lock'),{timeoutMs:0});if(await readRegular(join(paths.runtime,'task-restore.pending.json'))!==undefined)throw failure('TASK_ARCHIVE_RESTORE_INCOMPLETE');if(await readRegular(join(paths.runtime,'restore.pending.json'))!==undefined)throw failure('NIGHT_RESTORE_INCOMPLETE')}
    ctx.provide('runtimePaths',paths)
    ctx.provide('portablePaths',portablePaths(paths))
    const taskRoutes=await taskSessionRoutes(paths);ctx.provide('taskSessionRoutes',taskRoutes)
    const privacy=await createPrivacy(paths);ctx.provide('memoryPrivacy',privacy)
    ctx.provide('launchEnvironment',environmentSnapshot ?? await loadNativeEnvironment({...environmentPaths(config),...environmentOptions,materialize:false,warn:message=>ctx.logger.warn(message)}))
    ctx.baseUrl = pathToFileURL(join(root, 'cordis.yml')).href
    await ctx.plugin(Loader)
    ctx.loader.builtins.group = require('@deepseek-ai/cordis-plugin-group').default
    const shell = config.shell ?? (process.platform === 'win32' ? 'pwsh' : 'bash')
    if (!['pwsh','bash'].includes(shell)) throw new Error('NIGHT_BOT_SHELL_INVALID')
    const rows = [
      { name: new URL('./native-agents.js', import.meta.url).href }, { name: new URL('./native-sessions.js', import.meta.url).href }, { name: new URL('./native-projections.js', import.meta.url).href }, { name: new URL('./native-system-prompt.js', import.meta.url).href, config: { includeHarnessIdentity: false } },
      { name: new URL('./native-tools.js', import.meta.url).href }, { name: new URL('./native-tool-timeout.js', import.meta.url).href }, { name: new URL('./native-web.js', import.meta.url).href, config: config.web ?? {} }, { name: new URL('./native-http-fetch.js', import.meta.url).href, config: config.webFetch ?? {} }, { name: new URL('./native-authorization.js', import.meta.url).href },
      { name: new URL('./native-credentials.js', import.meta.url).href, config: { path: paths.credentials, watch: config.credentialsWatch ?? true } },
      { name: new URL('./native-attachments.js', import.meta.url).href, config: { storageRoot: paths.attachmentsHome } },
      { name: new URL('./native-pi-provider.js', import.meta.url).href, config: { providers: config.providers ?? {} } },
      { name: new URL('./native-state.js', import.meta.url).href, config: { root: join(root, 'storage'), model: config.model } },
      { name: new URL('./native-spill.js', import.meta.url).href, config: { root: paths.spills } }, { name: new URL('./native-jobs.js', import.meta.url).href }, { name: new URL('./native-tool-jobs.js', import.meta.url).href }, { name: new URL('./process/index.js', import.meta.url).href }, { name: new URL('./native-sandbox.js', import.meta.url).href },
      { name: new URL('./native-policy.js', import.meta.url).href, config: { mode: 'workspace-write', workspaceRoot: workspace } },
      { name: new URL('./native-' + shell + '-sandbox.js', import.meta.url).href, config: { cwd: workspace } }, { name: new URL('./native-approval.js', import.meta.url).href, config: { policy: 'never' } },
      { name: new URL('./native-permission-presets.js', import.meta.url).href, config: { defaultPreset: 'workspace-write', presets: {
        'read-only': { sandbox: 'read-only', approval: 'never' },
        'workspace-write': { sandbox: 'workspace-write', approval: 'never' },
        'danger-full-access': { sandbox: 'danger-full-access', approval: 'never' },
      } } },
      { name: new URL('./pi-authority.js', import.meta.url).href },
      { name: new URL('./pi-session-persistence.js', import.meta.url).href, config: { root: join(root, 'sessions'), compression: 'none' } },
      { name: new URL('./native-workspace.js', import.meta.url).href }, { name: new URL('./native-skills.js', import.meta.url).href }, { name: new URL(paths.mode==='portable'?'./memory/private-fs.js':'./native-fs-sandbox.js', import.meta.url).href, config: { cwd: workspace } }, { name: new URL('./native-working-directory.js', import.meta.url).href, config: { defaultDirectory: workspace } },
      { name: new URL('./native-agent-presets.js', import.meta.url).href, config: { default: 'night-bot' } },
      { name: new URL('./pi-official-runtime.js', import.meta.url).href, config: { model: config.model, memoryModel: config.memory?.model??config.model, skillDirs:config.skillDirs, maxParallelToolCalls: config.maxParallelToolCalls ?? 4 } },
      { name: new URL('./native-session-controller.js', import.meta.url).href },
      { name: new URL('./native-schedule.js', import.meta.url).href, config: config.schedule ?? {} },
      { name: new URL('./memory/service.js', import.meta.url).href, config: config.memory ?? {} },
      { name: new URL('./memory/reflection.js', import.meta.url).href, config: config.reflection ?? {} },
      { name: new URL('./channels/service.js', import.meta.url).href },
      ...(config.plugins ?? []), ...extraPlugins,
      ...await channelPluginRows(config,paths),
    ]
    await ctx.loader.root.update(prepareProfileEntries(ctx,rows,ctx.baseUrl))
    await ctx.loader.await()
    if (!ctx.get('nativePiProvider')) throw new Error('NIGHT_BOT_NATIVE_PROVIDER_UNAVAILABLE')
    for (const service of ['agents','officialAgentFactory','nativeModelRoutes','sessions','sessionProjections','piAuthority','sessionPersistence','credentials','authorization','fs','workingDirectory','attachments','skills','workspaceRegistry','systemPrompt','sessionController','schedule','memory','sandboxPolicy','web','nativeHttpFetch','nativeToolTimeout','spillStore','approval','permissionPresets'])
      if (!ctx.get(service)) throw new Error('NIGHT_BOT_REQUIRED_SERVICE_UNAVAILABLE:'+service)
    if (!ctx.get('tools')) throw new Error('NIGHT_BOT_TOOL_RUNTIME_UNAVAILABLE')
    if (!ctx.get('jobs')) throw new Error('NIGHT_BOT_JOB_RUNTIME_UNAVAILABLE')
    if (!ctx.get('sandbox')) throw new Error('NIGHT_BOT_SANDBOX_UNAVAILABLE')
    if (!ctx.get('subprocess')) throw new Error('NIGHT_BOT_SUBPROCESS_UNAVAILABLE')
    // Full process output is recovery evidence, not disposable launcher temp.
    if(paths.mode==='portable')ctx.subprocess.internals={...ctx.subprocess.internals,spillDir:paths.processSpills}
    await installProcessPrivacy(ctx,privacy)
    await ctx.plugin({ inject: ['agentPresets'], async *apply(child) {
      for(const id of ['night-bot','night-bot-task'])yield await child.agentPresets.register({ id, plugins: [{ name: 'cordis:group', group: true,
        isolate: { fs: true, workingDirectory: true, shellEnv: true, nativeAgentInstructions: true }, config: [
          { name: new URL(paths.mode==='portable'?'./memory/private-fs.js':'./native-fs-sandbox.js', import.meta.url).href, config: { cwd: workspace } }, { name: new URL('./native-working-directory.js', import.meta.url).href, config: { defaultDirectory: workspace } },
          { name: new URL('./native-shell-env.js', import.meta.url).href }, { name: new URL('./native-tool-fs.js', import.meta.url).href }, { name: new URL('./native-tool-fs-search.js', import.meta.url).href, config: { sampleOverCapGlobResults: false } }, { name: new URL('./native-fs-observation-policy.js', import.meta.url).href },
          { name: new URL('./native-tool-' + shell + '.js', import.meta.url).href, config: { enableRunInBackground: true, promoteOnTimeout: true } },
          { name: new URL('./native-skill-filesystem.js', import.meta.url).href, config: { includeDefaultRoots: paths.mode!=='portable', customSkillDirs: paths.mode==='portable'?[paths.skills,join(paths.agentsHome,'skills'),join(paths.harnessHome,'skills'),...(config.skillDirs??[]).map(path=>resolve(paths.installRoot,path))]:(config.skillDirs??[]), watch: config.skillWatch ?? true, ...(paths.mode==='portable'?{agentsHome:paths.agentsHome}:{}) } }, { name: new URL('./native-tool-skill.js', import.meta.url).href },
          { name: new URL('./native-agent-instructions.js', import.meta.url).href, config: { maxBytes: 65536, ...(paths.mode==='portable'?{instructionHome:paths.harnessHome,agentsHome:paths.agentsHome}:{}) } }, { name: new URL('./native-tool-working-directory.js', import.meta.url).href },
          { name: new URL('./native-tool-todo.js', import.meta.url).href, config: { allowParallelInProgress: true } }, { name: new URL('./native-tool-web.js', import.meta.url).href, config: config.webTools ?? {} },
          { name: new URL('./native-tool-schedule.js', import.meta.url).href },
          { name: new URL('./memory/tools.js', import.meta.url).href },
        ] }] })
    } })
    const preset = await ctx.agentPresets.resolve('night-bot')
    if (preset.broken) throw new Error('NIGHT_BOT_PRESET_BROKEN:' + JSON.stringify(preset.broken))
    if (!deferScheduledDelivery) ctx.schedule.start()
    return { ctx, close: () => closing??=(async()=>{
      await ctx.get('application')?.close?.()
      await ctx.get('officialAgentFactory')?.close()
      await ctx.fiber.dispose()
      await releaseData?.()
    })() }
  } catch (error) {
    try{await ctx.get('officialAgentFactory')?.close();await ctx.fiber.dispose();await releaseData?.()}
    catch(cause){throw new AggregateError([error,cause],'Host startup and cleanup failed')}
    throw error
  }
}
