import test from 'node:test'
import assert from 'node:assert/strict'
import {memoryHost} from './fixtures/memory-host.js'
import {createEffectOperatorAuth,readEffectOperatorToken,effectOperatorTokenPath} from '../src/tasks/effect-operator-auth.js'

test('actual full-access model process cannot read the operator capability',{skip:process.platform!=='linux',timeout:20000},async t=>{
 let command,attempt=false
 const f=await memoryHost(t,()=>{if(attempt){attempt=false;return {tool:'bash',args:{command,description:'operator capability privacy probe'}}}})
 const paths=f.host.ctx.runtimePaths;await createEffectOperatorAuth(paths)
 const token=await readEffectOperatorToken(paths),handle=await f.agent('operator-capability-reader',{actorId:'owner'})
 await handle.agent.ctx.get('permissionPresets').set(handle.agent,'danger-full-access')
 const script='const fs=require("node:fs");try{process.stdout.write(fs.readFileSync(process.argv[1],"utf8"))}catch(e){process.stdout.write("OPERATOR_CAPABILITY_BLOCKED:"+e.code)}'
 const quote=value=>"'"+value.replaceAll("'","'\\''")+"'"
 command=[process.execPath,'-e',script,effectOperatorTokenPath(paths)].map(quote).join(' ')
 attempt=true;await f.say(handle.agent,'Run the isolated operator credential privacy probe')
 const response=JSON.stringify(f.requests.at(-1))
 assert.match(response,/OPERATOR_CAPABILITY_BLOCKED/,'actual child must run and encounter the private-root mask')
 assert.ok(!JSON.stringify(f.requests).includes(token),'credential cannot enter any model request')
})
