import {readdir, realpath} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import { spawn } from 'node:child_process'
const groups = {
  runtime: ['fixed-topics-native','task-session-follow-conflict-native','task-session-service-native','task-session-provider-native','task-session-model-native','task-session-persistence-native','task-session-skills-native','task-session-progress-native','task-session-human-native','task-session-execution-provider-recovery-native','task-session-job-recovery-native','task-session-live-supplement-native'],
  routing: ['pi-source-stage-timing','pi-resident-triage','pi-triage','pi-resident-router','pi-resident-router-flow','pi-router-ledger','pi-router-task-e2e','pi-resident-router-upgrade','task-topic-routing-native','topic-routing-clarification-native','topic-routing-hold-native','task-notification-retry-native'],
  containment: ['task-single-artifact-kernel-native','native-tools-runtime','native-sandbox-runtime','native-shell-env-kernel-wire','native-shell-kernel-wire','native-memory-privacy-kernel'],
  domain: ['dws-adapter','dws-file-adapter','dws-bridge','group-notification','native-dws-send','task-final-delivery','task-artifact-files','task-artifact-write','coordination-schedule-revisions','task-notification-readback','topic-runtime','topic-facts','workflow-uat-build-authorization'],
}
const files = process.argv[2]==='default' ? (await readdir('test')).filter(name=>/^pi-.*\.test\.js$/.test(name)).map(name=>name.slice(0,-8)) : groups[process.argv[2]]
if (!files) throw new Error('Expected default, runtime, routing, containment or domain')
const concurrency=Number(process.env.NIGHT_BOT_TEST_CONCURRENCY??1)
if(!Number.isSafeInteger(concurrency)||concurrency<1||concurrency>8)throw new Error('Test concurrency must be an integer from 1 to 8')
const env = { ...process.env }
// macOS /var is an alias; portable fixtures require a physical installation root.
if (process.platform === 'darwin') env.TMPDIR = await realpath(tmpdir())
const child = spawn(process.execPath, ['--experimental-test-module-mocks','--test',`--test-concurrency=${concurrency}`,...files.map(name => `test/${name}.test.js`)], {
  stdio: 'inherit', env,
})
child.on('error', error => { console.error(error.message); process.exitCode = 1 })
child.on('exit', (code, signal) => { process.exitCode = code ?? 1; if (signal) console.error('Test process terminated:', signal) })
