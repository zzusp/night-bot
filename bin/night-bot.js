#!/usr/bin/env node
import { loadConfig } from '../src/config.js'
import { createHost } from '../src/host.js'
import { apply as applyResident } from '../packages/dingtalk-core/resident.js'
import { join } from 'node:path'

const path = process.argv[2]
if (!path || process.argv.includes('--help')) {
  console.log('Usage: node bin/night-bot.js /absolute/path/config.json\nSee config.example.json and README.md. HTTP API binds to loopback; no visual frontend.')
  process.exitCode = path ? 0 : 2
} else {
  let host, stopping
  const close = () => stopping ??= host?.close()
  try {
    const config = await loadConfig(path)
    host = await createHost(config)
    const resident = config.resident ?? {}
    const taskSessions = { ...config.model, ...resident.taskSessions, workspaceDir: config.workspaceDir,
      dbPath: join(config.stateDir, 'tasks.sqlite') }
    await host.ctx.plugin({ inject: ['storage','storageDomain','credentials','agents','agentDefaultModel','agentPresets','permissionPresets','agentLoop','sessions','sessionPersistence','sessionProjections','workspaceRegistry','tools','llm','systemPrompt','attachments'],
      apply: ctx => applyResident(ctx, { ...resident, agentPreset: 'night-bot', agentWorkspaceDir: config.workspaceDir,
        taskSessions, dws: { enabled: false, writesAuthorized: false, ...resident.dws } }) })
    for (const signal of ['SIGINT','SIGTERM']) process.once(signal, () => { close().catch(error => { console.error(error.message); process.exitCode = 1 }) })
  } catch (error) {
    console.error(error.message)
    try { await close() } catch (cleanup) { console.error('Cleanup failed:', cleanup.message) }
    process.exitCode = 1
  }
}
