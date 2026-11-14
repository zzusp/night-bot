import assert from 'node:assert/strict'
import {readFile,lstat,realpath} from 'node:fs/promises'
import {createHash} from 'node:crypto'
import {resolve,join,dirname,relative} from 'node:path'
import {pathToFileURL} from 'node:url'
import {createRequire} from 'node:module'
import {DatabaseSync} from 'node:sqlite'
const [install,taskId,expectedSha]=process.argv.slice(2)
assert.ok(install&&/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(taskId)&&/^[0-9a-f]{40}$/.test(expectedSha))
const configFile=resolve(install,'data/config/config.json'),c=JSON.parse(await readFile(configFile,'utf8'))
const m=JSON.parse(await readFile(resolve(install,'data/runtime/local-launcher.json'),'utf8'));assert.equal(m.release,expectedSha)
const load=path=>import(pathToFileURL(join(m.codeRoot,path)).href)
const {runtimePaths}=await load('src/runtime/paths.js'),{portablePaths}=await load('src/runtime/portable.js')
const {decodePiJournal,piJournalFilename}=await load('src/runtime/pi-journal.js'),{unresolvedNativeJobReceipts}=await load('src/runtime/job-ledger.js')
const {checkedTaskDirectory}=await load('packages/dingtalk-core/session-workspaces.js'),paths=runtimePaths(c,configFile)
const web=c.channelPlugins.find(r=>r.type==='web-console'&&r.enabled),origin='http://127.0.0.1:'+web.config.port,core='http://127.0.0.1:'+c.resident.port
const digest=bytes=>createHash('sha256').update(bytes).digest('hex')
const get=async(url,headers={})=>{const r=await fetch(url,{headers});assert.equal(r.status,200);return r.json()}
const raw=await get(core+'/state/tasks/'+encodeURIComponent(taskId)+'/detail')
assert.equal(raw.state,'waiting');assert.equal(raw.session.status,'failed');assert.equal(raw.drained,false);assert.equal(raw.recovering,false)
assert.equal(raw.sessionFailure.code,'TASK_SESSION_DRAIN_FAILED')
const journal=resolve(paths.workspaces,'tasks',taskId,'sessions',piJournalFilename(raw.session.sessionId))
assert.equal(relative(journal,resolve(raw.session.logPath)),'');await checkedTaskDirectory(dirname(journal));assert.equal(relative(journal,await realpath(journal)),'')
const info=await lstat(journal);assert.ok(info.isFile()&&!info.isSymbolicLink()&&info.nlink===1)
const bytes=await readFile(journal),decoded=decodePiJournal(bytes,raw.session.sessionId,{codec:portablePaths(paths),requireComplete:true})
assert.equal(decoded.header.id,raw.session.sessionId)
const unresolved=unresolvedNativeJobReceipts(decoded.audit,raw.session.sessionId);assert.ok(unresolved.length>0)
const last=decoded.entries.findLast(e=>e.type==='message'&&e.message?.role==='assistant')
assert.equal(last.message.stopReason,'error');assert.match(last.message.errorMessage,/NIGHT_JOB_OUTCOME_UNCERTAIN_NO_REPLAY/)
const db=new DatabaseSync(join(paths.state,'tasks.sqlite'),{readOnly:true})
let unacked
try{unacked=db.prepare("SELECT count(*) AS n FROM dynamic_wakes WHERE json_extract(body,'$.taskId')=? AND json_extract(body,'$.state')!='acked'").get(taskId).n;assert.ok(unacked>0)}finally{db.close()}
const hash=createHash('sha256').update(web.channelId).digest('hex').slice(0,16),token=(await readFile(join(paths.secrets,'web-console-'+hash,'access-token'),'utf8')).trim()
const login=await fetch(origin+'/api/login',{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify({token})});assert.equal(login.status,200)
const cookie=login.headers.get('set-cookie').split(';')[0],{csrfToken}=await login.json(),headers={origin,cookie}
try{
 const task=await get(origin+'/api/tasks/'+encodeURIComponent(taskId),headers)
 assert.equal(task.state,'waiting');assert.equal(task.session.status,'failed');assert.match(task.blockers.find(b=>b.kind==='session')?.title,/排空失败/)
 const waiting=await get(origin+'/api/tasks?state=waiting',headers),running=await get(origin+'/api/tasks?state=running',headers)
 assert.ok(waiting.items.some(t=>t.taskId===taskId));assert.ok(!running.items.some(t=>t.taskId===taskId))
 const linked=await get(origin+'/api/conversations/'+encodeURIComponent(raw.groupId)+'/tasks',headers)
 assert.equal(linked.taskSummaries.find(t=>t.taskId===taskId)?.state,'waiting')
 const {chromium}=createRequire(join(m.codeRoot,'packages/web-console/package.json'))('@playwright/test'),browser=await chromium.launch(process.platform==='win32'?{channel:'msedge'}:{})
 try{
  const context=await browser.newContext({viewport:{width:1440,height:960},locale:'zh-CN'}),separator=cookie.indexOf('=')
  await context.addCookies([{name:cookie.slice(0,separator),value:cookie.slice(separator+1),url:origin,httpOnly:true,sameSite:'Strict'}])
  const page=await context.newPage();await page.goto(origin+'/#/tasks/'+encodeURIComponent(taskId))
  await page.locator('.blockers').getByText(/执行会话排空失败/).waitFor()
  assert.equal(await page.locator('.task-facts').getByText('等待中',{exact:true}).count(),1)
  assert.equal(await page.locator('.agent-progress.is-running').count(),0)
  await page.getByRole('navigation',{name:'任务信息分类'}).getByRole('link',{name:'执行',exact:true}).click()
  await page.locator('.task-execution-states').getByText('失败',{exact:true}).waitFor()
 }finally{await browser.close()}
 const htmlResponse=await fetch(origin+'/');assert.equal(htmlResponse.status,200);const html=await htmlResponse.text(),asset=html.match(/src="([^"]+\.js)"/)?.[1];assert.ok(asset)
 const served=await fetch(origin+asset);assert.equal(served.status,200);assert.equal(digest(Buffer.from(await served.arrayBuffer())),digest(await readFile(join(m.codeRoot,'packages/web-console/dist',asset))))
 assert.ok(bytes.equals(await readFile(journal)),'read-only checks must not resume or rewrite the failed journal')
 const health=await get(core+'/health'),all=await get(origin+'/api/tasks',headers)
 console.log(JSON.stringify({release:m.release,state:task.state,session:task.session.status,drained:raw.drained,recovering:raw.recovering,failure:raw.sessionFailure.code,failureAt:raw.sessionFailure.at,leaseEpoch:raw.leaseEpoch,pendingInputs:unacked,unknownJobs:unresolved.length,lastAssistantError:'NIGHT_JOB_OUTCOME_UNCERTAIN_NO_REPLAY',journalBytes:bytes.length,journalUnchangedDuringChecks:true,waitingFilter:true,runningFilterExcluded:true,linkedSummary:true,browser:true,assetMatchesRelease:true,taskCounts:{total:all.total,completed:all.items.filter(t=>t.state==='completed').length},health:health.status,recoveryIssueCount:health.recoveryIssueCount}))
}finally{
 const r=await fetch(origin+'/api/logout',{method:'POST',headers:{...headers,'x-csrf-token':csrfToken,'content-type':'application/json'},body:'{}'});assert.equal(r.status,200);console.log(JSON.stringify({logout:200}))
}
