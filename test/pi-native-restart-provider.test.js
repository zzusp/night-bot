import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {createHash} from 'node:crypto'
import {restartScopeProbePlan,nativeRestartProviderFiles} from '../packages/dingtalk-core/native-restart-scope-probe.js'
const digest=b=>createHash('sha256').update(b).digest('hex')
function request(){return{command:String.raw`& D:\postgres\postgres.exe -D D:\data -h 127.0.0.1 -p 25428`,binding:{startedAt:Date.now()-1000},evidence:{hostPid:123,hostLogPath:'D:\\logs\\host.log',hostLogSha256:'a'.repeat(64),producerScopeReviewed:true,localEffectsOnlyConfirmed:true,excludeOriginalSourcesConfirmed:true},runtimeRoot:'D:\\night-bot'}}
test('native restart scope binds reviewed native provider bytes and excludes legacy installation layout',async()=>{
 const plan=restartScopeProbePlan(request());assert.ok(plan)
 assert.equal(plan.spec.managedProviderKind,'night-bot-pi');assert.equal(plan.spec.providerFiles.length,nativeRestartProviderFiles.length)
 assert.doesNotMatch(JSON.stringify(plan.spec.providerFiles),/profiles|node_modules|dsh-subprocess-local/)
 assert.match(plan.command,/\$allowedHashes -notcontains/)
 for(const file of nativeRestartProviderFiles){
  const bytes=await readFile(new URL('../'+file.path,import.meta.url)),lf=Buffer.from(bytes.toString().replaceAll('\r\n','\n'))
  assert.equal(digest(lf),file.sha256,file.path)
  assert.equal(digest(Buffer.from(lf.toString().replaceAll('\n','\r\n'))),file.sha256CRLF,file.path)
 }
 for(const runtimeRoot of [null,'relative','D:\\unsafe;command'])assert.equal(restartScopeProbePlan({...request(),runtimeRoot}),null)
 assert.equal(restartScopeProbePlan({...request(),dshHome:null}),null)
})
test('DSH provider roots are refused and native plans retain every review fence',()=>{
 for(const dshHome of [null,'D:\\legacy','relative'])assert.equal(restartScopeProbePlan({...request(),dshHome}),null)
 assert.equal(restartScopeProbePlan({...request(),evidence:{...request().evidence,producerScopeReviewed:false}}),null)
 assert.equal(restartScopeProbePlan({...request(),evidence:{...request().evidence,excludeOriginalSourcesConfirmed:false}}),null)
 assert.equal(restartScopeProbePlan({...request(),evidence:{...request().evidence,localEffectsOnlyConfirmed:false}}),null)
})
