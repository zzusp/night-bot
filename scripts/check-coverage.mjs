import { readFile, access, readdir } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { resolve, dirname } from 'node:path'
const manifest = JSON.parse(await readFile('docs/source-manifest.json','utf8'))
const excluded = new Set(['client.js','web-client.js','index.js'])
const adapted = new Set(["dws-runner.js", "dynamic-task-store.js", "dynamic-operation-readback.js", "topic-runtime.js", "agent-query-tools.js", "agent-work.js", "claude-execution-session.js", "coordination-sessions.js", "execution-controller.js", "execution-session.js", "fake-llm.js", "group-coordinator-session.js", "host-context.js", "independent-coordination-planner.js", "model-context.js", "platform-schedule.js", "native-restart-scope-probe.js", "native-maintenance-drain.js", "runtime.js", "session-skill-refresh.js", "status-query.js", "storage-v8-schema.js", "store.js", "task-general-workflow.js", "task-owner-session.js", "task-session-persistence.js", "task-session-service.js", "task-session.js", "task-topic-coordinator.js", "task-workflow-contracts.js", "workflow-configuration.js", "topic-facts.js", "session-workspaces.js", "dws-adapter.js", "dws-bridge.js", "performance.js", "topic-model.js"])
const adaptedCount = adapted.size
let retained = 0
for (const entry of manifest.files) {
  const path = resolve('packages/dingtalk-core', entry.source)
  if (entry.status === 'excluded-ui') {
    if (!excluded.delete(entry.source)) throw new Error('Unexpected source exclusion: ' + entry.source)
    continue
  }
  const bytes = await readFile(path)
  const hash = createHash('sha256').update(bytes).digest('hex')
  if (hash !== entry.sha256) throw new Error('Unrecorded core change: ' + entry.source)
  if (entry.sourceSha256 !== hash && !adapted.delete(entry.source)) throw new Error('Unreviewed upstream difference: ' + entry.source)
  if (entry.source.endsWith('.js')) {
    for (const [, specifier] of bytes.toString().matchAll(/(?:\bfrom\s*|\bimport\s*\(\s*)['"](\.{1,2}\/[^'"\r\n]+)['"]/g)) {
      await access(resolve(dirname(path), specifier))
    }
  }
  retained++
}
if (excluded.size || adapted.size) throw new Error('Source accounting incomplete')
const actual = (await readdir('packages/dingtalk-core')).filter(name => /\.(js|ps1)$/.test(name))
if (actual.length !== retained) throw new Error('Unexpected core modules outside source accounting')
const routes = await readFile('docs/HTTP-ROUTES.md','utf8')
const http = await readFile('packages/dingtalk-core/http.js','utf8')
for (const [, route] of routes.matchAll(/^- `([^`]+)`/gm)) if (!http.includes("'" + route + "'")) throw new Error('HTTP route missing: ' + route)
const loop = await readFile('src/pi-loop.js','utf8')
if (!loop.includes("await runAgentLoop(")) throw new Error('Pi loop is not wired')
console.log(JSON.stringify({source: manifest.sourceCommit, retainedModules: retained, excludedUiModules: 3, explicitlyAdaptedModules: adaptedCount, relativeImports: 'closed', httpRoutes: 'retained'}))
