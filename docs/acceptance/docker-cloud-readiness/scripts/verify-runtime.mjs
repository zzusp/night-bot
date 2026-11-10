import assert from 'node:assert/strict'
import {spawnSync} from 'node:child_process'
import {createHash} from 'node:crypto'
import {readFile, writeFile, mkdir, stat} from 'node:fs/promises'
import {resolve, dirname} from 'node:path'
import {fileURLToPath} from 'node:url'
import {createServer} from 'node:net'

const args = process.argv.slice(2), imageAt = args.indexOf('--image'), outputAt = args.indexOf('--output')
if (imageAt < 0 || !args[imageAt + 1] || args.some((v, i) => !['--check', '--image', '--output'].includes(v) && i !== imageAt + 1 && i !== outputAt + 1)) {
  throw Error('Usage: node verify-runtime.mjs --image IMAGE [--check] [--output NEW_RESULT_FILE]')
}
const image = args[imageAt + 1], root = fileURLToPath(new URL('../../../../', import.meta.url))
const seccomp = resolve(root, 'docs/ops/docker-bwrap-seccomp.json')
const output = outputAt < 0 ? undefined : resolve(root, args[outputAt + 1])
const evidence = {image, startedAt: new Date().toISOString(), checks: {}}
function docker(...argv) {
  const p = spawnSync('docker', argv, {encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, windowsHide: true})
  if (p.error) throw p.error
  if (p.status !== 0) throw Error(`docker ${argv.slice(0, 2).join(' ')} exited ${p.status}: ${p.stderr.trim()}`)
  return p.stdout.trim()
}
const imageId = docker('image', 'inspect', image, '--format', '{{.Id}}')
evidence.imageId = imageId
evidence.revision = docker('image', 'inspect', image, '--format', '{{index .Config.Labels "org.opencontainers.image.revision"}}')
evidence.seccompSha256 = createHash('sha256').update(await readFile(seccomp)).digest('hex')
assert.equal(evidence.seccompSha256, '9264f1689d786e212fcfc1dc63eed5d08a2be4c236a252d5676f43f40691201f')
if (args.includes('--check')) {
  console.log(JSON.stringify({check: true, sideEffects: false, imageId, revision: evidence.revision, seccompVerified: true}))
  process.exit(0)
}
if (!output) throw Error('--output is required; use a new round result path')
await stat(output).then(() => {throw Error('Refusing to overwrite existing evidence')}, error => {if (error.code !== 'ENOENT') throw error})
const prefix = `night-cloud-check-${Date.now()}`, volume = `${prefix}-data`, container = `${prefix}-app`
evidence.resources = {container, volume}
const boundary = ['--cap-drop=ALL', '--security-opt=no-new-privileges', `--security-opt=seccomp=${seccomp}`, '--read-only', '--tmpfs', '/tmp:rw,nosuid,nodev,size=64m,mode=1777']
const mount = ['--mount', `type=volume,source=${volume},target=/opt/night-bot/data`]
const probe = code => JSON.parse(docker('run', '--rm', '--network', 'none', ...boundary, ...mount, '-e', 'NODE_DISABLE_COMPILE_CACHE=1', '--entrypoint', 'node', imageId, '--input-type=module', '-e', code))
const snapshot = `import {readdir,lstat,readFile} from 'node:fs/promises';import {createHash} from 'node:crypto';const rows=[];async function scan(path,rel=''){for(const name of (await readdir(path)).sort()){const at=path+'/'+name,sub=rel+name,s=await lstat(at);rows.push({path:sub,directory:s.isDirectory(),uid:s.uid,mode:s.mode&0o777,bytes:s.size,...s.isFile()?{sha256:createHash('sha256').update(await readFile(at)).digest('hex')}:{} });if(s.isDirectory())await scan(at,sub+'/')}}await scan('/opt/night-bot/data');console.log(JSON.stringify(rows))`
const model = `
import {createServer} from 'node:http';
let calls=0;createServer(async(req,res)=>{
 if(req.method==='GET'){res.setHeader('content-type','application/json');return res.end(JSON.stringify({calls}))}
 try {let raw='';for await(const chunk of req)raw+=chunk;const body=JSON.parse(raw);calls++;
 const texts=body.messages.flatMap(m=>typeof m.content==='string'?[m.content]:(m.content??[]).filter(p=>p.type==='text').map(p=>p.text));
 const line=texts.toReversed().flatMap(t=>t.split('\\n')).find(t=>t.startsWith('一级分诊请求：'));
 let decision;if(line){const input=JSON.parse(line.slice('一级分诊请求：'.length));decision={tool:'channel_triage_submit',args:{dispositions:input.messages.map(m=>({sourceId:m.sourceId,messageVersion:m.version??m.messageVersion,needsHandling:false,reason:'isolated Docker verification',reply:'Docker runtime verified'}))}}}
 res.writeHead(200,{'content-type':'text/event-stream'});
 const chunk=(delta,finish_reason=null)=>res.write('data: '+JSON.stringify({id:'docker-check-'+calls,object:'chat.completion.chunk',created:1,model:body.model,choices:[{index:0,delta,finish_reason}]})+'\\n\\n');
 if(decision){chunk({role:'assistant',tool_calls:[{index:0,id:'call-'+calls,type:'function',function:{name:decision.tool,arguments:JSON.stringify(decision.args)}}]});chunk({},'tool_calls')}else{chunk({role:'assistant',content:'Docker runtime verified'});chunk({},'stop')}
 res.end('data: [DONE]\\n\\n');
 }catch{res.writeHead(500);res.end('scripted model failure')}
}).listen(4011,'127.0.0.1');`
const startModel = () => docker('exec', '--detach', container, 'node', '--input-type=module', '-e', model)
const modelCalls = () => JSON.parse(docker('exec', container, 'node', '-e', "fetch('http://127.0.0.1:4011/').then(r=>r.text()).then(console.log)")).calls
const pause = () => new Promise(r => setTimeout(r, 250))
async function eventually(read, description) {
  const signal = AbortSignal.timeout(120_000)
  for (;;) {
    signal.throwIfAborted()
    const value = await read()
    if (value) return value
    const state = JSON.parse(docker('inspect', '--format', '{{json .State}}', container))
    if (!state.Running) throw Error(`Container exited before ${description}: ${state.ExitCode}`)
    await pause()
  }
}
try {
  docker('volume', 'create', volume)
  const before = probe(snapshot)
  assert.equal(before.length, 1); assert.equal(before[0].path, 'temp'); assert.equal(before[0].mode, 0o700); assert.equal(before[0].uid, 1000)
  assert.match(docker('run', '--rm', '--network', 'none', ...boundary, ...mount, imageId, '--check'), /NIGHT_DOCKER_PREFLIGHT_OK/)
  assert.deepEqual(probe(snapshot), before)
  evidence.checks.preflight = {passed: true, defaultMode: 'full', volumeUnchanged: true, uid: 1000, tempMode: '0700'}
  const socket = createServer(); await new Promise(r => socket.listen(0, '127.0.0.1', r)); const port = socket.address().port; await new Promise(r => socket.close(r))
  const origin = `http://127.0.0.1:${port}`
  const env = {
    NIGHT_BOT_ACTOR_ID: 'docker-check-operator', NIGHT_BOT_MODEL_PROVIDER: 'openai', NIGHT_BOT_MODEL: 'gpt-4.1',
    NIGHT_BOT_MODEL_API: 'openai-completions', NIGHT_BOT_MODEL_BASE_URL: 'http://127.0.0.1:4011/v1',
    NIGHT_BOT_MODEL_KEY_ENV: 'DOCKER_CHECK_API_KEY', DOCKER_CHECK_API_KEY: 'local-scripted-model-only',
    NIGHT_BOT_WEB_ENABLED: 'true', NIGHT_BOT_WEB_HOST: '0.0.0.0', NIGHT_BOT_WEB_PORT: '3080',
    NIGHT_BOT_WEB_PUBLIC_ORIGIN: origin, NIGHT_BOT_WEB_CHANNEL_ID: 'docker-check-web', NIGHT_BOT_WEB_SENDER_ID: 'docker-check-operator',
  }
  docker('run', '--detach', '--name', container, ...boundary, ...mount, '--publish', `127.0.0.1:${port}:3080`, ...Object.entries(env).flatMap(([k, v]) => ['-e', `${k}=${v}`]), imageId)
  await eventually(async () => {try {const r = await fetch(origin); return r.status === 200 && (await r.text()).includes('<div id="root">')} catch {return false}}, 'Web readiness')
  const host = JSON.parse(docker('inspect', '--format', '{{json .HostConfig}}', container))
  assert.equal(host.ReadonlyRootfs, true); assert.deepEqual(host.CapDrop, ['ALL']); assert.ok(host.SecurityOpt.includes('no-new-privileges')); assert.equal(host.PortBindings['3080/tcp'][0].HostIp, '127.0.0.1'); assert.ok(host.SecurityOpt.some(value => value.startsWith('seccomp=')))
  evidence.checks.boundary = {passed: true, readOnlyRoot: true, capDropAll: true, noNewPrivileges: true, loopbackPublish: true, seccomp: true}
  const browserProbe = `
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,readdir} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {chromium} from '/opt/night-bot/node_modules/playwright/index.mjs';
const installed=await readdir('/opt/playwright');
assert.ok(installed.some(name=>name.startsWith('chromium_headless_shell-')));
assert.ok(!installed.some(name=>/^chromium-[0-9]+$/.test(name)));
const server=createServer((req,res)=>{res.setHeader('content-type','text/html');res.end('<!doctype html><title>Headless runtime check</title><h1 id="ready">Headless Chromium</h1><p id="result"></p><script>document.querySelector("#result").textContent=String(6*7)</script>')});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const url='http://127.0.0.1:'+server.address().port;
try {
 const browser=await chromium.launch();let version;
 try {version=browser.version();const page=await browser.newPage();await page.goto(url);assert.equal(await page.locator('#result').textContent(),'42');await page.screenshot({path:'headless-api.png'});} finally {await browser.close()}
 await promisify(execFile)('/usr/local/bin/playwright',['screenshot','--browser','chromium','--wait-for-selector','#ready',url,'headless-cli.png']);
 const dimensions=async path=>{const bytes=await readFile(path);assert.equal(bytes.subarray(0,8).toString('hex'),'89504e470d0a1a0a');return {bytes:bytes.length,width:bytes.readUInt32BE(16),height:bytes.readUInt32BE(20)}};
 console.log(JSON.stringify({passed:true,version,installed,apiDom:'42',apiScreenshot:await dimensions('headless-api.png'),cliScreenshot:await dimensions('headless-cli.png')}));
} finally {await new Promise(r=>server.close(r))}`
  evidence.checks.browser = JSON.parse(docker('exec', '--workdir', '/opt/night-bot/data/workspaces', container, 'node', '--input-type=module', '-e', browserProbe))
  await mkdir(dirname(output), {recursive: true})
  docker('cp', container + ':/opt/night-bot/data/workspaces/headless-cli.png', resolve(dirname(output), 'browser.png'))
  const tokenPath = '/opt/night-bot/data/secrets/web-console-' + createHash('sha256').update('docker-check-web').digest('hex').slice(0, 16) + '/access-token'
  const readToken = () => docker('exec', container, 'node', '-e', `process.stdout.write(require('fs').readFileSync(${JSON.stringify(tokenPath)},'utf8'))`)
  const token = readToken()
  let cookie, csrf
  async function api(path, {method = 'GET', body, auth = true, header = {}} = {}) {
    const r = await fetch(origin + path, {method, headers: {origin, ...auth && cookie ? {cookie} : {}, ...body ? {'content-type': 'application/json'} : {}, ...header}, ...body ? {body: JSON.stringify(body)} : {}})
    return {status: r.status, body: await r.json(), cookie: r.headers.get('set-cookie')?.split(';')[0]}
  }
  async function login() {
    const r = await api('/api/login', {method: 'POST', body: {token}, auth: false}); assert.equal(r.status, 200)
    cookie = r.cookie; csrf = r.body.csrfToken
  }
  assert.equal((await api('/api/settings', {auth: false})).status, 401)
  await login(); assert.equal((await api('/api/settings')).status, 200)
  const permission = await api('/api/permissions'); assert.equal(permission.status, 200); assert.equal(permission.body.mode, 'full')
  assert.equal((await api('/api/settings', {header: {origin: 'http://outside.invalid'}})).status, 403)
  const chat = (await api('/api/chat-current')).body.conversationId; assert.ok(chat)
  const request = {conversationId: chat, requestId: 'docker-runtime-smoke', text: 'Docker runtime local verification'}
  assert.equal((await api('/api/chat', {method: 'POST', body: request})).status, 403)
  startModel()
  const sent = await api('/api/chat', {method: 'POST', body: request, header: {'x-csrf-token': csrf}})
  assert.equal(sent.status, 202); assert.equal(sent.body.accepted, true)
  const history = await eventually(async () => {const r = await api('/api/chat/' + chat); assert.equal(r.status, 200); return r.body.messages?.some(m => m.role === 'assistant' && m.text === 'Docker runtime verified') && r.body}, 'committed visible reply')
  const count = modelCalls(); assert.ok(count > 0)
  evidence.checks.web = {passed: true, authenticatedSettings: true, defaultPermission: 'full', unauthenticated: 401, wrongOrigin: 403, missingCsrf: 403}
  evidence.checks.conversation = {passed: true, requestStatus: 202, replyVisible: true, modelRequests: count, messages: history.messages.length, realVendorCalls: 0}
  const configCode = "const fs=require('fs');const c=JSON.parse(fs.readFileSync('/opt/night-bot/data/config/config.json','utf8'));console.log(JSON.stringify({instanceId:c.resident.taskSessions.instanceId,actor:c.resident.taskSessions.ownerActorId,mode:c.permissionMode}))"
  const configBefore = JSON.parse(docker('exec', container, 'node', '-e', configCode))
  docker('stop', '-t', '-1', container)
  const state = JSON.parse(docker('inspect', '--format', '{{json .State}}', container))
  assert.equal(state.ExitCode, 0); assert.equal(state.Pid, 0); assert.equal(state.OOMKilled, false)
  const stoppedData = probe(snapshot)
  assert.ok(!stoppedData.some(row => row.path.startsWith('runtime/.host.lock')))
  assert.ok(stoppedData.some(row => row.path === 'state/tasks.sqlite'))
  assert.ok(stoppedData.some(row => row.path.startsWith('state/sessions/') && row.path.endsWith('.pi.jsonl')))
  assert.match(docker('run', '--rm', '--network', 'none', ...boundary, ...mount, imageId, '--check'), /NIGHT_DOCKER_PREFLIGHT_OK/)
  assert.deepEqual(probe(snapshot), stoppedData)
  evidence.checks.drain = {passed: true, exitCode: 0, pid: 0, oomKilled: false, hostLockAbsent: true, existingVolumeCheckUnchanged: true}
  docker('start', container)
  await eventually(async () => {try {return (await api('/api/settings')).status === 401} catch {return false}}, 'same-volume restart')
  assert.equal(readToken(), token)
  assert.deepEqual(JSON.parse(docker('exec', container, 'node', '-e', configCode)), configBefore)
  await login(); assert.equal((await api('/api/chat-current')).body.conversationId, chat)
  const restored = await api('/api/chat/' + chat); assert.equal(restored.status, 200); assert.equal(restored.body.messages.length, history.messages.length)
  startModel(); assert.equal(modelCalls(), 0)
  assert.equal((await api('/api/chat', {method: 'POST', body: request, header: {'x-csrf-token': csrf}})).status, 202)
  assert.equal(modelCalls(), 0)
  assert.equal((await api('/api/chat/' + chat)).body.messages.length, history.messages.length)
  evidence.checks.persistence = {passed: true, instanceAndActorPreserved: true, tokenPreserved: true, oldCookieRejected: true, chatAndReplyPreserved: true, duplicateRequestModelCalls: 0}
  docker('stop', '-t', '-1', container)
  const finalState = JSON.parse(docker('inspect', '--format', '{{json .State}}', container)); assert.equal(finalState.ExitCode, 0); assert.equal(finalState.Pid, 0)
  evidence.checks.finalStop = {passed: true, exitCode: 0, pid: 0}
  docker('rm', container); docker('volume', 'rm', volume)
  evidence.cleanup = {containerRemoved: true, volumeRemoved: true}
  evidence.passed = true
} catch (error) {
  evidence.passed = false; evidence.error = {message: error.message, stack: error.stack}
  evidence.cleanup = {retainedForDiagnosis: true, container, volume}
  process.exitCode = 1
} finally {
  evidence.finishedAt = new Date().toISOString()
  await mkdir(dirname(output), {recursive: true}); await writeFile(output, JSON.stringify(evidence, null, 2) + '\n')
  console.log(JSON.stringify(evidence, null, 2))
}
