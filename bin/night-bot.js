#!/usr/bin/env node
import { loadConfig } from '../src/config.js'
import {loadNativeEnvironment} from '../src/native-environment.js'
import {runtimePaths,prepareSecrets,environmentPaths} from '../src/runtime/paths.js'

const path = process.argv[2]
if (!path || process.argv.includes('--help')) {
  console.log('Usage: node bin/night-bot.js /absolute/path/config.json\nSee config.example.json and README.md. HTTP API binds to loopback; no visual frontend.')
  process.exitCode = path ? 0 : 2
} else {
  let host, stopping, releaseProxy, starting = true, shutdownRequested = false
  const close = () => stopping ??= (async () => { const errors=[];try{await host?.close()}catch(error){errors.push(error)}try{await releaseProxy?.()}catch(error){errors.push(error)}if(errors.length===1)throw errors[0];if(errors.length)throw new AggregateError(errors,'Night Bot shutdown failed') })()
  // HTTP may listen while application recovery is still in progress. Capture
  // shutdown before startup exposes it, then drain only once startup settles.
  // Keep listeners installed during draining so a repeated signal is idempotent.
  const shutdown = () => {
    shutdownRequested = true
    if (starting) return
    close().catch(error => { console.error(error.message); process.exitCode = 1 }).finally(() => { if(process.connected)process.disconnect() })
  }
  for (const signal of ['SIGINT','SIGTERM']) process.on(signal, shutdown)
  if(process.send)process.on('message', message => { if(message?.type==='night-bot-shutdown')shutdown() })
  try {
    const config = await loadConfig(path)
    if(runtimePaths(config).mode!=='portable')throw new Error('NIGHT_NEW_INSTALL_LAYOUT_REQUIRED')
    await prepareSecrets(runtimePaths(config))
    const environmentSnapshot = await loadNativeEnvironment({...environmentPaths(config,path),materialize:true,warn:message=>console.error(message)})
    const {installProxyFromEnvironment} = await import('../src/native-http-proxy.js')
    releaseProxy = await installProxyFromEnvironment(environmentSnapshot,message=>console.error(message))
    const {createHost} = await import('../src/host.js')
    const {apply:applyApplication,inject:applicationInject} = await import('../src/application.js')
    host = await createHost(config, { environmentSnapshot, deferScheduledDelivery: true })
    await host.ctx.plugin({inject:applicationInject,apply:ctx=>applyApplication(ctx,config)})
    starting = false
    if (shutdownRequested) shutdown()
    else host.ctx.schedule.start()
  } catch (error) {
    starting = false
    console.error(error.message)
    try { await close() } catch (cleanup) { console.error('Cleanup failed:', cleanup.message) }
    process.exitCode = 1
    if(process.connected)process.disconnect()
  }
}
