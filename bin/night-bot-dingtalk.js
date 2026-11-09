#!/usr/bin/env node
import {runDingtalkCli} from '../src/channels/plugins/dingtalk-cli.js'
try{await runDingtalkCli(process.argv.slice(2))}
catch(error){console.error(typeof error.code==='string'&&/^(?:DINGTALK_|NIGHT_|ERR_PARSE_ARGS_)[A-Z_:a-z0-9.-]+$/.test(error.code)?error.code:'DINGTALK_CLI_FAILED');process.exitCode=1}
