import { spawn } from 'node:child_process'
const groups = {
  runtime: ['fixed-topics-native','task-session-follow-conflict-native','task-session-service-native','task-session-provider-native','task-session-model-native','task-session-persistence-native','task-session-skills-native','task-session-progress-native','task-session-human-native','task-session-execution-provider-recovery-native','task-session-job-recovery-native'],
  routing: ['task-topic-routing-native','topic-routing-clarification-native','topic-routing-hold-native','task-notification-retry-native'],
  containment: ['task-artifact-scope-native','native-tools-runtime','native-sandbox-runtime','native-shell-env-kernel-wire','native-shell-kernel-wire','native-memory-privacy-kernel'],
  domain: ['dws-adapter','dws-file-adapter','dws-bridge','group-notification','native-dws-send','task-final-delivery','task-artifact-files','task-artifact-write','coordination-schedule-revisions','task-notification-readback','topic-runtime','topic-facts','workflow-uat-build-authorization'],
}
const files = groups[process.argv[2]]
if (!files) throw new Error('Expected runtime, routing, containment or domain')
const child = spawn(process.execPath, ['--test','--test-concurrency=1',...files.map(name => `test/${name}.test.js`)], {
  stdio: 'inherit', env: { ...process.env },
})
child.on('error', error => { console.error(error.message); process.exitCode = 1 })
child.on('exit', (code, signal) => { process.exitCode = code ?? 1; if (signal) console.error('Test process terminated:', signal) })
