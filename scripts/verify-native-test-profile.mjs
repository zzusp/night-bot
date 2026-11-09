import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

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


export async function collectSourceEvidence() {
  const hash = bytes => createHash('sha256').update(bytes).digest('hex')
  return {
    lockSha256: hash(await readFile(new URL('../pnpm-lock.yaml', import.meta.url))),
    profileSha256: hash(await readFile(new URL('../test/fixtures/native-profile/package.json', import.meta.url))),
    piVersions: await verifyOfficialPi(),
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(JSON.stringify({ officialPi: await verifyOfficialPi(), credentialsLoaded: false }))
}
