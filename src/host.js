import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import {loadNativeEnvironment} from './native-environment.js'
import { createRequire } from 'node:module'
import { mkdir } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { pathToFileURL } from 'node:url'

const require = createRequire(import.meta.url)
const row = (name, config) => ({ name: pathToFileURL(require.resolve('@deepseek-ai/dsh-' + name)).href,
  ...(config ? { config } : {}) })
/** Compose host storage, policy and tools around the Pi agent loop. No GUI plugins. */
export async function createHost(config, { extraPlugins = [], environmentOptions = {}, environmentSnapshot } = {}) {
  const root = resolve(config.stateDir), workspace = resolve(config.workspaceDir)
  await mkdir(root, { recursive: true }); await mkdir(workspace, { recursive: true })
  const ctx = new Context()
  try {
    ctx.provide('launchEnvironment',environmentSnapshot ?? await loadNativeEnvironment({...environmentOptions,materialize:false,warn:message=>ctx.logger.warn(message)}))
    ctx.baseUrl = pathToFileURL(join(root, 'cordis.yml')).href
    await ctx.plugin(Loader)
    ctx.loader.builtins.group = require('@deepseek-ai/cordis-plugin-group').default
    const shell = config.shell ?? (process.platform === 'win32' ? 'pwsh' : 'bash')
    if (!['pwsh','bash'].includes(shell)) throw new Error('NIGHT_BOT_SHELL_INVALID')
    const rows = [
      { name: new URL('./native-agents.js', import.meta.url).href }, { name: new URL('./native-sessions.js', import.meta.url).href }, { name: new URL('./native-projections.js', import.meta.url).href }, { name: new URL('./native-system-prompt.js', import.meta.url).href, config: { includeHarnessIdentity: false } },
      { name: new URL('./native-llm.js', import.meta.url).href }, { name: new URL('./native-tools.js', import.meta.url).href }, { name: new URL('./native-tool-timeout.js', import.meta.url).href }, { name: new URL('./native-web.js', import.meta.url).href, config: config.web ?? {} }, { name: new URL('./native-http-fetch.js', import.meta.url).href, config: config.webFetch ?? {} }, { name: new URL('./native-llm-retry.js', import.meta.url).href }, { name: new URL('./native-authorization.js', import.meta.url).href },
      { name: new URL('./native-credentials.js', import.meta.url).href, config: { path: join(root, 'credentials.json'), watch: config.credentialsWatch ?? true } },
      { name: new URL('./native-attachments.js', import.meta.url).href, config: { dshHome: root } },
      { name: new URL('./native-pi-provider.js', import.meta.url).href, config: { providers: config.providers ?? {} } },
      { name: new URL('./native-state.js', import.meta.url).href, config: { root: join(root, 'storage'), model: config.model } },
      { name: new URL('./native-jobs.js', import.meta.url).href }, { name: new URL('./native-tool-jobs.js', import.meta.url).href }, { name: new URL('./process/index.js', import.meta.url).href }, { name: new URL('./native-sandbox.js', import.meta.url).href },
      { name: new URL('./native-policy.js', import.meta.url).href, config: { mode: 'workspace-write', workspaceRoot: workspace } },
      row(shell + '-sandbox', { cwd: workspace }), { name: new URL('./native-approval.js', import.meta.url).href, config: { policy: 'never' } },
      { name: new URL('./native-permission-presets.js', import.meta.url).href, config: { defaultPreset: 'workspace-write', presets: {
        'read-only': { sandbox: 'read-only', approval: 'never' },
        'workspace-write': { sandbox: 'workspace-write', approval: 'never' },
        'danger-full-access': { sandbox: 'danger-full-access', approval: 'never' },
      } } },
      { name: new URL('./native-session-title.js', import.meta.url).href, config: { fallbackMaxWords: 10, fallbackMaxBytes: 120, maxTitleBytes: 200 } },
      { name: new URL('./pi-authority.js', import.meta.url).href },
      { name: new URL('./pi-session-persistence.js', import.meta.url).href, config: { root: join(root, 'sessions'), compression: 'none' } },
      { name: new URL('./native-session-query.js', import.meta.url).href }, { name: new URL('./native-workspace.js', import.meta.url).href }, { name: new URL('./native-skills.js', import.meta.url).href }, { name: new URL('./native-fs-sandbox.js', import.meta.url).href, config: { cwd: workspace } }, { name: new URL('./native-working-directory.js', import.meta.url).href, config: { defaultDirectory: workspace } },
      { name: new URL('./native-subagents.js', import.meta.url).href }, { name: new URL('./native-subagent-providers.js', import.meta.url).href }, { name: new URL('./native-tool-subagent-control.js', import.meta.url).href }, { name: new URL('./native-agent-presets.js', import.meta.url).href, config: { default: 'night-bot' } },
      { name: new URL('./pi-loop.js', import.meta.url).href, config: { agents: [], maxParallelToolCalls: config.maxParallelToolCalls ?? 4 } },
      ...(config.plugins ?? []), ...extraPlugins,
    ]
    await ctx.loader.root.update(rows)
    await ctx.loader.await()
    for (const service of ['agents','agentLoop','sessions','sessionProjections','piAuthority','sessionPersistence','credentials','authorization','workingDirectory','attachments','skills','workspaceRegistry','systemPrompt','llmRetry','nativeSubagentProviders','subagents','sessionQuery','web','nativeHttpFetch','nativeToolTimeout','approval','permissionPresets'])
      if (!ctx.get(service)) throw new Error('NIGHT_BOT_REQUIRED_SERVICE_UNAVAILABLE:'+service)
    if (!ctx.get('llm')) throw new Error('NIGHT_BOT_LLM_RUNTIME_UNAVAILABLE')
    if (!ctx.get('nativePiProvider')) throw new Error('NIGHT_BOT_NATIVE_PROVIDER_UNAVAILABLE')
    if (!ctx.get('tools')) throw new Error('NIGHT_BOT_TOOL_RUNTIME_UNAVAILABLE')
    if (!ctx.get('jobs')) throw new Error('NIGHT_BOT_JOB_RUNTIME_UNAVAILABLE')
    if (!ctx.get('sandbox')) throw new Error('NIGHT_BOT_SANDBOX_UNAVAILABLE')
    if (!ctx.get('subprocess')) throw new Error('NIGHT_BOT_SUBPROCESS_UNAVAILABLE')
    await ctx.plugin({ inject: ['agentPresets'], async *apply(child) {
      yield await child.agentPresets.register({ id: 'night-bot', plugins: [{ name: 'cordis:group', group: true,
        isolate: { fs: true, workingDirectory: true, shellEnv: true, nativeAgentInstructions: true }, config: [
          { name: new URL('./native-fs-sandbox.js', import.meta.url).href, config: { cwd: workspace } }, { name: new URL('./native-working-directory.js', import.meta.url).href, config: { defaultDirectory: workspace } },
          { name: new URL('./native-shell-env.js', import.meta.url).href }, row('tool-fs'), row('tool-fs-search', { sampleOverCapGlobResults: false }), { name: new URL('./native-fs-observation-policy.js', import.meta.url).href },
          row('tool-' + shell, { enableRunInBackground: true, promoteOnTimeout: true }),
          { name: new URL('./native-skill-filesystem.js', import.meta.url).href, config: { includeDefaultRoots: true, customSkillDirs: config.skillDirs ?? [], watch: config.skillWatch ?? true } }, { name: new URL('./native-tool-skill.js', import.meta.url).href },
          { name: new URL('./native-agent-instructions.js', import.meta.url).href, config: { maxBytes: 65536 } }, { name: new URL('./native-tool-working-directory.js', import.meta.url).href },
          { name: new URL('./native-tool-subagent.js', import.meta.url).href, config: { provider: 'spawn' } },
          { name: new URL('./native-tool-todo.js', import.meta.url).href, config: { allowParallelInProgress: true } }, { name: new URL('./native-tool-web.js', import.meta.url).href, config: config.webTools ?? {} },
        ] }] })
    } })
    const preset = await ctx.agentPresets.resolve('night-bot')
    if (preset.broken) throw new Error('NIGHT_BOT_PRESET_BROKEN:' + JSON.stringify(preset.broken))
    return { ctx, close: () => ctx.fiber.dispose() }
  } catch (error) { await ctx.fiber.dispose(); throw error }
}
