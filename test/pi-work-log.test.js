import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,readFile,writeFile,mkdir,readdir,symlink,link,rm} from 'node:fs/promises'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {DailyWorkLog} from '../src/work-log/runner.js'
import {localStamp,lastDueDay,inDay} from '../src/work-log/calendar.js'
import {collectWorkLogEvidence,renderWorkLog} from '../src/work-log/evidence.js'
import {workLogText,workLogSecrets} from '../src/work-log/redaction.js'
import {backupData,restoreData} from '../src/runtime/backup.js'
import {createLaunchEnvironmentSnapshot} from '../src/native-environment.js'
import {memoryHost} from './fixtures/memory-host.js'
const empty=()=>({active:false,messages:[],progress:[],plans:[],blockers:[],notes:[]})
const active=()=>({...empty(),active:true,messages:[{id:'source-1',text:'核对部署进度'}]})
async function fixture(t,{now='2026-11-10T23:59:00Z',collect=async()=>active(),config={}}={}){
 const root=await mkdtemp(join(tmpdir(),'night-work-log-'));t.after(()=>rm(root,{recursive:true,force:true}))
 const paths={state:join(root,'data/state'),data:join(root,'data'),workLogs:join(root,'data/work-logs')};let time=Date.parse(now)
 const runner=new DailyWorkLog({paths,config:{enabled:true,time:'23:59',timezone:'UTC',...config},collect,clock:()=>time});t.after(()=>runner.close())
 return {root,paths,runner,setTime:value=>{time=Date.parse(value)},file:day=>join(paths.workLogs,day.slice(0,4),day.slice(5,7),day+'.md')}
}

test('local dates respect midnight, DST gaps and repeated hours',()=>{
 assert.equal(localStamp('2026-11-10T16:00:00Z','Asia/Shanghai').day,'2026-11-11')
 assert.equal(lastDueDay(Date.parse('2026-03-08T07:00:00Z'),{timezone:'America/New_York',time:'02:30'}),'2026-03-08')
 for(const at of ['2026-11-01T05:31:00Z','2026-11-01T06:31:00Z'])assert.equal(lastDueDay(Date.parse(at),{timezone:'America/New_York',time:'01:30'}),'2026-11-01')
 assert.equal(inDay('2026-11-10T16:00:00Z','2026-11-10','Asia/Shanghai',Date.parse('2026-11-11T00:00Z')),false)
})
test('first activation waits until configured time and skips empty Markdown, restart catches missed dates',async t=>{
 const calls=[],f=await fixture(t,{now:'2026-11-10T10:00:00Z',collect:async({day})=>{calls.push(day);return day==='2026-11-10'?empty():active()}})
 await f.runner.tick();assert.deepEqual(calls,[])
 f.setTime('2026-11-11T23:59:00Z');const rows=await f.runner.tick()
 assert.deepEqual(rows.map(row=>[row.day,row.status]),[['2026-11-10','empty'],['2026-11-11','written']])
 await assert.rejects(readFile(f.file('2026-11-10')),{code:'ENOENT'});assert.match(await readFile(f.file('2026-11-11'),'utf8'),/当天工作进展/)
 assert.deepEqual(await f.runner.tick(),[])
})
test('concurrent runners, restart and changing run time cannot duplicate or replace a day',async t=>{
 let calls=0;const f=await fixture(t,{collect:async()=>{calls++;return active()}})
 const other=new DailyWorkLog({paths:f.paths,config:{enabled:true,time:'00:00',timezone:'UTC'},collect:async()=>{calls++;return active()},clock:()=>Date.parse('2026-11-10T23:59Z')});t.after(()=>other.close())
 await Promise.all([f.runner.tick(),other.tick()]);assert.equal(calls,1)
 const body=await readFile(f.file('2026-11-10'),'utf8');await writeFile(join(f.paths.state,'work-log/scheduler.json'),JSON.stringify({version:1,nextDay:'2026-11-10'}))
 assert.equal((await other.tick())[0].status,'existing');assert.equal(calls,1);assert.equal(await readFile(f.file('2026-11-10'),'utf8'),body)
})
test('collection failures remain retryable and shutdown joins in-flight work without publishing after close',async t=>{
 let fail=true;const f=await fixture(t,{collect:async()=>{if(fail)throw Object.assign(Error('secret diagnostic'),{code:'SOURCE_UNAVAILABLE'});return active()}})
 await f.runner.tick();assert.equal(f.runner.lastError,'SOURCE_UNAVAILABLE');await assert.rejects(readFile(f.file('2026-11-10')),{code:'ENOENT'})
 fail=false;await f.runner.tick();assert.equal(f.runner.lastError,null)
 const entered=Promise.withResolvers(),release=Promise.withResolvers(),g=await fixture(t,{collect:async()=>{entered.resolve();await release.promise;return active()}})
 const work=g.runner.tick();await entered.promise;const closing=g.runner.close();release.resolve();await Promise.all([work,closing]);await assert.rejects(readFile(g.file('2026-11-10')),{code:'ENOENT'})
})
test('pre-existing files are preserved and unsafe output links fail closed',async t=>{
 const f=await fixture(t);await mkdir(join(f.paths.workLogs,'2026/11'),{recursive:true});await writeFile(f.file('2026-11-10'),'user-authored diary')
 await f.runner.tick();assert.equal(await readFile(f.file('2026-11-10'),'utf8'),'user-authored diary')
 const g=await fixture(t),outside=join(g.root,'outside');await mkdir(outside);await mkdir(g.paths.workLogs,{recursive:true});await symlink(outside,join(g.paths.workLogs,'2026'),'dir')
 await g.runner.tick();assert.equal(g.runner.lastError,'WORK_LOG_PATH_UNSAFE');assert.deepEqual(await readdir(outside),[])
 const h=await fixture(t);await mkdir(join(h.paths.workLogs,'2026/11'),{recursive:true});await writeFile(join(h.root,'original'),'do not overwrite');await link(join(h.root,'original'),h.file('2026-11-10'));await h.runner.tick();assert.equal(h.runner.lastError,'WORK_LOG_PATH_UNSAFE')
})
function storeFixture({sources=[],tasks=[],decisions=[],events=[]}={}){return {query:async query=>{if(query.kind==='source.list')return sources;if(query.kind==='task.list')return tasks;if(query.kind==='task.decisions')return {decisions:decisions.filter(row=>row.taskId===query.taskId),nextBefore:null};if(query.kind==='task.events')return {events,nextCursor:events.length,hasMore:false};throw Error(query.kind)}}}
test('factual report includes exact-day progress, registered next-day plans and blockers without inventing commitments',async()=>{
 const day='2026-11-10',at=day+'T12:00:00Z',cutoff=Date.parse(day+'T23:59:00Z')
 const store=storeFixture({sources:[{sourceId:'a',text:'先核验',receivedAt:at},{sourceId:'late',text:'tomorrow',receivedAt:'2026-11-11T00:00Z'}],tasks:[{taskId:'task',title:'部署核验',createdAt:at}],decisions:[{taskId:'task',id:'decision',recordedAt:at,decision:{action:'wait',summary:'核验已开始',question:'等待确认环境'}}],events:[]})
 const schedule={catalog:async()=>[{id:'plan',status:'active',scheduledAt:'2026-11-11T09:00Z',title:'检查核验结果',prompt:'private internal framing'},{id:'later',status:'active',scheduledAt:'2026-11-12T09:00Z',title:'not tomorrow'}]}
 const evidence=await collectWorkLogEvidence({store,schedule,day,timezone:'UTC',cutoff})
 assert.equal(evidence.messages.length,1);assert.equal(evidence.plans.length,1);assert.equal(evidence.blockers.length,1)
 const body=renderWorkLog({day,timezone:'UTC',cutoff,evidence});assert.match(body,/核验已开始/);assert.match(body,/09:00：检查核验结果/);assert.doesNotMatch(body,/not tomorrow|tomorrow/)
 const historical=await collectWorkLogEvidence({store,schedule,day,timezone:'UTC',cutoff:Date.parse('2026-11-12T12:00Z')});assert.equal(historical.plans.length,0);assert.equal(historical.blockers[0].historical,true)
})
test('redaction removes known credentials, secret fields, private keys and executable Markdown',async()=>{
 const value='opaque-provider-key password: not-save\nBearer abcdef\nhttps://name:pass@site.test/?token=secret\n![remote](https://site.test/x) <script>x</script>\n-----BEGIN PRIVATE KEY-----\nprivate\n-----END PRIVATE KEY-----'
 const text=workLogText(value,['opaque-provider-key']);for(const secret of ['opaque-provider-key','not-save','abcdef','name:pass','token=secret','\nprivate\n'])assert.ok(!text.includes(secret),secret)
 assert.ok(!text.includes('<script>'));assert.ok(!text.includes('![remote]'))
 assert.deepEqual(await workLogSecrets({providers:{x:{apiKeyEnv:'KEY'}}},{resolve:async()=>({value:'configured-secret'}),listRecords:async()=>[{key:'oauth'}],readRecord:async()=>({accessToken:'record-secret'})},{KEY:'env-secret'}),['configured-secret','env-secret','record-secret'])
})
test('default Host service summarizes committed ordinary Pi conversation without another model call',async t=>{
 const f=await memoryHost(t,()=>({text:'已核对测试范围'}),{hostConfig:{workLog:{time:'00:00',timezone:'UTC'}}})
 const handle=await f.agent('daily-work-log-user');await f.say(handle.agent,'请核对测试范围');await handle.dispose()
 const calls=f.requests.length,service=f.host.ctx.get('workLog');assert.ok(service)
 await service.attach({tasks:{store:storeFixture()}})
 assert.equal(service.runner.lastError,null);assert.equal(f.requests.length,calls)
 const day=localStamp(Date.now(),'UTC').day,path=join(f.host.ctx.runtimePaths.workLogs,day.slice(0,4),day.slice(5,7),day+'.md')
 const body=await readFile(path,'utf8');assert.match(body,/请核对测试范围/);assert.match(body,/已核对测试范围/);assert.doesNotMatch(body,/local-fixture/)
 await service.close();assert.equal(service.runner.timer,undefined)
})


test('publication-link crash is recovered without duplicate collection or overwriting committed Markdown',async t=>{
 let calls=0;const f=await fixture(t,{collect:async()=>{calls++;return active()}}),file=f.file('2026-11-10')
 await mkdir(join(f.paths.workLogs,'2026/11'),{recursive:true})
 const temp=join(f.paths.workLogs,'2026/11/.write-2026-11-10.md-12345678-1234-1234-1234-123456789abc')
 await writeFile(temp,'committed before crash');await link(temp,file)
 assert.equal((await f.runner.tick())[0].status,'existing');assert.equal(calls,0);assert.equal(await readFile(file,'utf8'),'committed before crash');await assert.rejects(readFile(temp),{code:'ENOENT'})
})
test('portable backup preserves daily work logs as business records rather than excluding them as diagnostic logs',async t=>{
 const f=await fixture(t);await f.runner.tick()
 const config={installRoot:f.root,model:{provider:'fixture',model:'m'},providers:{fixture:{apiKeyEnv:'FIXTURE_KEY'}}},backup=join(f.root,'backups/daily-log')
 await backupData(config,backup);const manifest=JSON.parse(await readFile(join(backup,'manifest.json'),'utf8'))
 assert.ok(manifest.files.some(file=>file.path==='work-logs/2026/11/2026-11-10.md'))
 const restored=await mkdtemp(join(tmpdir(),'night-diary-restore-'));t.after(()=>rm(restored,{recursive:true,force:true}));await restoreData({...config,installRoot:restored},backup)
 assert.equal(await readFile(join(restored,'data/work-logs/2026/11/2026-11-10.md'),'utf8'),await readFile(f.file('2026-11-10'),'utf8'))
})


test('arrangement and change events are never reported as completed work',async()=>{
 const events=['task.arranged','task.changed','task.completed'].map((kind,index)=>({id:'event-'+index,kind,taskId:'t',recordedAt:'2026-11-10T12:00Z',result:{summary:kind}}))
 const evidence=await collectWorkLogEvidence({store:storeFixture({events}),day:'2026-11-10',timezone:'UTC',cutoff:Date.parse('2026-11-10T23:59Z')})
 assert.deepEqual(evidence.progress.map(row=>row.kind),['arranged','changed','completed'])
 const body=renderWorkLog({day:'2026-11-10',timezone:'UTC',cutoff:Date.parse('2026-11-10T23:59Z'),evidence});assert.match(body,/已调整安排/);assert.match(body,/事项已更新/)
})
test('captured environment and unreferenced saved credential refs are scrubbed without exporting them',async()=>{
 const env=createLaunchEnvironmentSnapshot([{source:'process',values:{GITHUB_TOKEN:'opaque-env-no-prefix',SESSION_COOKIE:'opaque-cookie',AUTHORIZATION:'opaque-auth',PRIVATE_KEY:'opaque-private-key',PASSWD:'opaque-passwd',NORMAL_VALUE:'normal'}}])
 const credentials={redactionValues:()=>['opaque-saved-no-prefix'],listRecords:async()=>[]}
 const secrets=await workLogSecrets({},credentials,env),text=workLogText('opaque-env-no-prefix opaque-saved-no-prefix opaque-cookie opaque-auth opaque-private-key opaque-passwd normal',secrets)
 for(const value of ['opaque-cookie','opaque-auth','opaque-private-key','opaque-passwd'])assert.ok(!text.includes(value))
 assert.ok(!text.includes('opaque-env-no-prefix'));assert.ok(!text.includes('opaque-saved-no-prefix'));assert.match(text,/normal/)
})


test('restore-held task records stay out of the diary and reminder activity can create an otherwise quiet day',async()=>{
 const store=storeFixture({tasks:[{taskId:'held',title:'held material',createdAt:'2026-11-10T10:00Z',sessionId:'held-session',archiveRestore:{reviewRequired:true}}],events:[{id:'held-completion',taskId:'held',kind:'task.completed',recordedAt:'2026-11-10T10:00Z'}]})
 const persistence={list:async()=>[],stat:async()=>{throw Error('held session must not be read')}}
 const schedule={catalog:async()=>[{id:'reminder',title:'已授权提醒',prompt:'PRIVATE_INTERNAL_FRAMING',status:'inactive',lastDelivery:{deliveredAt:'2026-11-10T12:00Z'}}]}
 const evidence=await collectWorkLogEvidence({store,persistence,schedule,day:'2026-11-10',timezone:'UTC',cutoff:Date.parse('2026-11-10T23:59Z')})
 assert.equal(evidence.active,true);assert.equal(evidence.progress.length,1);assert.equal(evidence.progress[0].kind,'scheduled');assert.ok(!JSON.stringify(evidence).includes('held material'));assert.ok(!JSON.stringify(evidence).includes('PRIVATE_INTERNAL_FRAMING'))
})


test('disabled startup records no diary and re-enabling does not backfill the disabled period',async t=>{
 let calls=0;const f=await fixture(t,{collect:async()=>{calls++;return active()}})
 await f.runner.tick()
 const disabled=new DailyWorkLog({paths:f.paths,config:{enabled:false,time:'23:59',timezone:'UTC'},collect:async()=>{throw Error('disabled must not collect')},clock:()=>Date.parse('2026-11-11T12:00Z')});await disabled.start();await disabled.close()
 const enabled=new DailyWorkLog({paths:f.paths,config:{enabled:true,time:'23:59',timezone:'UTC'},collect:async()=>{calls++;return active()},clock:()=>Date.parse('2026-11-13T23:59Z')});t.after(()=>enabled.close())
 assert.deepEqual((await enabled.tick()).map(row=>row.day),['2026-11-13']);assert.equal(calls,2)
 await assert.rejects(readFile(f.file('2026-11-12')),{code:'ENOENT'})
})
