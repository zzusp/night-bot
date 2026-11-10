#!/usr/bin/env node
import {runSettingsCli} from '../src/settings/cli.js'
import {safeSettingsError} from '../src/settings/http.js'
const controller=new AbortController(),abort=()=>controller.abort()
for(const signal of ['SIGINT','SIGTERM'])process.once(signal,abort)
try{await runSettingsCli(process.argv.slice(2),{signal:controller.signal})}
catch(error){const cancelled=controller.signal.aborted||error.code==='SETTINGS_CANCELLED';console.error(error.code==='SETTINGS_RESPONSE_UNCERTAIN'?error.code:cancelled?'SETTINGS_CANCELLED':safeSettingsError(error));process.exitCode=cancelled?130:1}
finally{for(const signal of ['SIGINT','SIGTERM'])process.removeListener(signal,abort)}
