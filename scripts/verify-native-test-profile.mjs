import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const fixture = fileURLToPath(new URL('../test/fixtures/native-profile/package.json', import.meta.url))
const rootManifest = new URL('../package.json', import.meta.url)
const publicApis = {
  '@earendil-works/pi-ai': ['normalizeContext', 'resolveTranscript', 'createAssistantMessageEventStream'],
  '@earendil-works/pi-agent-core': ['Agent', 'agentLoop', 'agentLoopContinue'],
  '@earendil-works/pi-coding-agent': ['ModelRuntime', 'AgentSession', 'SessionManager', 'DefaultResourceLoader', 'createAgentSession', 'buildSessionProjection', 'convertToLlm', 'createReadTool', 'createWriteTool', 'createEditTool'],
}
export async function verifyOfficialPi(manifest) {
  manifest ??= JSON.parse(await readFile(rootManifest, 'utf8'))
  const versions = {}
  for (const [name, exports] of Object.entries(publicApis)) {
    assert.equal(manifest.dependencies?.[name], '1.5.0', 'Pi must remain exactly pinned: ' + name)
    const api = await import(name)
    for (const symbol of exports) assert.equal(typeof api[symbol], 'function', 'Public Pi API missing: ' + name + ':' + symbol)
    const version = name.endsWith('/pi-ai') ? api.PI_AI_VERSION : name.endsWith('/pi-coding-agent') ? api.VERSION
      : JSON.parse(await readFile(new URL(import.meta.resolve(name + '/package.json')), 'utf8')).version
    assert.equal(version, '1.5.0', 'Installed Pi version differs: ' + name)
    versions[name] = version
  }
  return versions
}
export async function verifyNativeProfile() {
  assert.equal(resolve(process.env.DSH_NATIVE_TEST_PROFILE ?? fixture), resolve(fixture), 'Use only the isolated repository test profile')
  const name = 'dingtalk-dsh-native-test-profile', version = '0.2.1-alpha.2'
  const manifest = JSON.parse(await readFile(fixture, 'utf8'))
  assert.equal(manifest.name, name)
  assert.equal(manifest.private, true)
  assert.equal(manifest.dependencies['@deepseek-ai/dsh-base'], version)
  for (const [dependency, declared] of Object.entries(manifest.dependencies)) if (dependency.startsWith('@deepseek-ai/dsh-')) assert.equal(declared, version, dependency)
  assert.equal(manifest.dsh, undefined, 'The fixture must not load a user bundle or provider configuration')
  const profile = createRequire(fixture)
  profile.resolve('@deepseek-ai/cordis')
  profile.resolve('@deepseek-ai/cordis-plugin-loader')
  const native = createRequire(profile.resolve('@deepseek-ai/dsh-base'))
  assert.equal(JSON.parse(await readFile(native.resolve('@deepseek-ai/dsh-base/package.json'), 'utf8')).version, version)
  const shell = process.platform === 'win32' ? 'pwsh' : 'bash'
  const modules = ['agent', 'session', 'session-projection', 'system-prompt', 'llm', 'tools', 'user-approval',
    'jobs-local', 'tool-jobs', 'subprocess-local', 'sandbox-local', 'sandbox-policy', shell + '-sandbox',
    'permission-presets', 'session-title', 'session-persistence-jsonl', 'storage', 'storage-json', 'storage-domain',
    'workspace', 'agent-loop', 'fs-local', 'working-directory', 'shell-env', 'tool-fs',
    'tool-' + shell, shell + '-local', 'fs-observation-policy', 'skill', 'skill-filesystem', 'tool-skill',
    'credentials-local', 'attachment-local', 'agent-default-model', 'api-session-controller', 'file-reference-local']
  const missing = modules.filter(name => { try { native.resolve('@deepseek-ai/dsh-' + name); return false } catch { return true } })
  assert.deepEqual(missing, [], 'Isolated native fixture is missing required public modules')
  const scheduleModules = ['schedule', 'tool-schedule']
  for (const name of scheduleModules) profile.resolve('@deepseek-ai/dsh-' + name)
  return { nativeProfile: name, version, resolvedModules: modules.length + scheduleModules.length, credentialsLoaded: false }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(JSON.stringify({ officialPi: await verifyOfficialPi(), credentialsLoaded: false }))
  console.log(JSON.stringify(await verifyNativeProfile()))
}
