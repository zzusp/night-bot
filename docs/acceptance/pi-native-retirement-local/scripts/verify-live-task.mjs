import assert from 'node:assert/strict'
import {readFile,readdir} from 'node:fs/promises'
import {join,resolve} from 'node:path'
import {createHash} from 'node:crypto'
const [install,taskId,base='http://127.0.0.1:19198']=process.argv.slice(2)
if(!install||!/^task-[a-f0-9]{32}$/.test(taskId??''))throw Error('Expected install root, task ID, optional loopback URL')
const url=new URL(base);assert.ok(['127.0.0.1','localhost'].includes(url.hostname))
const health=await(await fetch(base+'/health')).json();assert.equal(health.status,'ok');assert.equal(health.modelMode,'real')
const task=(await(await fetch(base+'/state/tasks')).json()).find(task=>task.taskId===taskId)
assert.equal(task.state,'completed');assert.equal(task.result.action,'complete');assert.match(task.result.summary,/703/)
const root=join(resolve(install),'data/workspaces/tasks',taskId),bytes=await readFile(join(root,'work/pi-native-proof.txt'))
assert.equal(bytes.toString('utf8').trim(),'NIGHT_BOT_PI_NATIVE_OK');assert.deepEqual(await readdir(join(root,'work')),['pi-native-proof.txt'])
const files=(await readdir(join(root,'sessions'))).filter(name=>name.endsWith('.pi.jsonl'));assert.equal(files.length,1)
const journal=await readFile(join(root,'sessions',files[0])),entries=journal.toString('utf8').trim().split('\n').map(JSON.parse)
const calls=entries.filter(e=>e.type==='message'&&e.message.role==='assistant').flatMap(e=>e.message.content??[]).filter(p=>p.type==='toolCall')
for(const name of ['write','read','task_result'])assert.ok(calls.some(call=>call.name===name),name)
assert.equal(calls.filter(call=>call.name==='write').length,1)
assert.ok(calls.every(call=>['write','read','task_result'].includes(call.name)))
const digest=bytes=>createHash('sha256').update(bytes).digest('hex')
console.log(JSON.stringify({taskId,state:task.state,action:task.result.action,modelMode:health.modelMode,health:health.status,workspace:'data/workspaces/tasks/'+taskId,proofSha256:digest(bytes),journalSha256:digest(journal),calls:calls.map(call=>call.name),resultContains703:true},null,2))
