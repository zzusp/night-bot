import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import { createRequire } from 'node:module'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { artifactPolicySource } from '../scripts/sandbox-artifact-policy.mjs'

const require = createRequire(import.meta.url)
const row = (name, config) => ({ name: pathToFileURL(require.resolve('@deepseek-ai/dsh-' + name)).href,
  ...(config ? { config } : {}) })
/** Compose host storage, policy and tools around the Pi agent loop. No GUI plugins. */
export async function createHost(config, { extraPlugins = [] } = {}) {
  const root = resolve(config.stateDir), workspace = resolve(config.workspaceDir)
  await mkdir(root, { recursive: true }); await mkdir(workspace, { recursive: true })
  const ctx = new Context()
  try {
    ctx.baseUrl = pathToFileURL(join(root, 'cordis.yml')).href
    await ctx.plugin(Loader)
    ctx.loader.builtins.group = require('@deepseek-ai/cordis-plugin-group').default
    const original = require.resolve('@deepseek-ai/dsh-sandbox-policy')
    let code = artifactPolicySource(await readFile(original))
    const policyRequire = createRequire(original)
    for (const dependency of ['@deepseek-ai/cordis', 'zod', '@deepseek-ai/schemastery'])
      code = code.replace(`from "${dependency}"`, `from "${pathToFileURL(policyRequire.resolve(dependency)).href}"`)
    const policy = join(root, 'artifact-policy.mjs'); await writeFile(policy, code, { mode: 0o600 })
    const shell = config.shell ?? (process.platform === 'win32' ? 'pwsh' : 'bash')
    if (!['pwsh','bash'].includes(shell)) throw new Error('NIGHT_BOT_SHELL_INVALID')
    const rows = [
      row('agent'), row('session'), row('session-projection'), row('system-prompt', { includeHarnessIdentity: false }),
      row('llm'), { name: new URL('./native-tools.js', import.meta.url).href }, row('web'), row('llm-retry'), row('authorization'),
      row('credentials-local', { path: join(root, 'credentials.json'), watch: false }),
      row('attachment-local', { dshHome: root }), row('launch-environment'), row('timeout'),
      { name: new URL('./native-pi-provider.js', import.meta.url).href, config: { providers: config.providers ?? {} } },
      { name: new URL('./native-state.js', import.meta.url).href, config: { root: join(root, 'storage'), model: config.model } },
      { name: new URL('./native-jobs.js', import.meta.url).href }, row('tool-jobs'), row('subprocess-local'), row('sandbox-local'),
      { name: pathToFileURL(policy).href, config: { mode: 'workspace-write', workspaceRoot: workspace } },
      row(shell + '-sandbox', { cwd: workspace }), row('user-approval', { policy: 'never' }),
      row('permission-presets', { defaultPreset: 'workspace-write', presets: {
        'read-only': { sandbox: 'read-only', approval: 'never' },
        'workspace-write': { sandbox: 'workspace-write', approval: 'never' },
        'danger-full-access': { sandbox: 'danger-full-access', approval: 'never' },
      } }),
      row('session-title', { fallbackMaxWords: 10, fallbackMaxBytes: 120, maxTitleBytes: 200 }),
      { name: new URL('./pi-authority.js', import.meta.url).href },
      { name: new URL('./pi-session-persistence.js', import.meta.url).href, config: { root: join(root, 'sessions'), compression: 'none' } },
      row('workspace'), row('skill'), row('fs-sandbox', { cwd: workspace }), row('working-directory', { defaultDirectory: workspace }),
      row('subagent'), row('subagent-spawn-in-process'), row('subagent-fork-in-process'), row('tool-subagent-control'), row('agent-preset-registry', { default: 'night-bot' }),
      { name: new URL('./pi-loop.js', import.meta.url).href, config: { agents: [], maxParallelToolCalls: 4 } },
      ...(config.plugins ?? []), ...extraPlugins,
    ]
    await ctx.loader.root.update(rows)
    await ctx.loader.await()
    if (!ctx.get('nativePiProvider')) throw new Error('NIGHT_BOT_NATIVE_PROVIDER_UNAVAILABLE')
    if (!ctx.get('tools')) throw new Error('NIGHT_BOT_TOOL_RUNTIME_UNAVAILABLE')
    if (!ctx.get('jobs')) throw new Error('NIGHT_BOT_JOB_RUNTIME_UNAVAILABLE')
    await ctx.plugin({ inject: ['agentPresets'], async *apply(child) {
      yield await child.agentPresets.register({ id: 'night-bot', plugins: [{ name: 'cordis:group', group: true,
        isolate: { fs: true, workingDirectory: true, shellEnv: true }, config: [
          row('fs-sandbox', { cwd: workspace }), row('working-directory', { defaultDirectory: workspace }),
          row('shell-env'), row('tool-fs'), row('tool-fs-search', { sampleOverCapGlobResults: false }), row('fs-observation-policy'),
          row('tool-' + shell, { enableRunInBackground: true, promoteOnTimeout: true }),
          row('skill-filesystem', { includeDefaultRoots: true, customSkillDirs: config.skillDirs ?? [], watch: false }), row('tool-skill'),
          row('agent-instructions', { maxBytes: 65536 }), row('tool-working-directory'),
          row('tool-subagent', { provider: 'spawn' }),
          row('tool-todo', { allowParallelInProgress: true }), row('tool-web'), row('web-fetch-http'),
        ] }] })
    } })
    const preset = await ctx.agentPresets.resolve('night-bot')
    if (preset.broken) throw new Error('NIGHT_BOT_PRESET_BROKEN:' + JSON.stringify(preset.broken))
    return { ctx, close: () => ctx.fiber.dispose() }
  } catch (error) { await ctx.fiber.dispose(); throw error }
}
