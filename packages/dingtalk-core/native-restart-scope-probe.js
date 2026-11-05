import {JOB_REGISTERED,JOB_SETTLED} from '../../src/runtime/job-ledger.js'
import { win32 } from 'node:path'
import { fileURLToPath } from 'node:url'
import { isolationDigest as hash } from './native-restart-isolation.js'
import { inspectSession, executionInputFor } from './session-persistence.js'
import { postgresWrapperScope, postgresWrapperSchema, postgresWrapperInspection } from './native-postgres-wrapper.js'

// Reviewed native Job/runner source identities. Both checkout line endings are
// pinned explicitly; never hash arbitrary deployed code and bless it at runtime.
export const nativeRestartProviderFiles = Object.freeze([
  {
    "path": "src/process/contracts.js",
    "sha256": "2c3deb502db3abe91c40ffea9e204495771de2564aabe505d68eaf12b29b1b78",
    "sha256CRLF": "7a08201ebd1b0fd420a18789befb20f9de8a3ccae460b2e624f520a57ed1e947"
  },
  {
    "path": "src/process/control.js",
    "sha256": "923be45a0d625cb4da7beb2713f4e80a96ab092180c100be72c17546cbf201bc",
    "sha256CRLF": "d11cadac0cb4fb96089529446a44b1a813b0f7341f5f43d36fb0d8cc1abf7ac6"
  },
  {
    "path": "src/process/index.js",
    "sha256": "5da229501aab0ba7e1d3eaf3da55d59460f7c9fe29e3229592b068f44d2bdb67",
    "sha256CRLF": "54db87ea0ace7a5f6b2d11a890b26bc94d400ce6a087cc3cf388d71c3a01da7b"
  },
  {
    "path": "src/process/output.js",
    "sha256": "1557cbbf8c2204f17fd8d7f7af7d31862924bee82ac07ec31631965cc9277003",
    "sha256CRLF": "f7f7d2003832c0c6a9ffc6e793302c6719d3057a8e22079b8a03d09fb6adede0"
  },
  {
    "path": "src/process/runner-launch-B2zsQ1Dz.js",
    "sha256": "82805c4bc3f975ff6b8d2db4ec4b2f216b26eb6b4292751670de344960939a77",
    "sha256CRLF": "9f8bceb6843261ec01659a02614e042285e0a2b125967c5eeca24af540cb1ad5"
  },
  {
    "path": "src/process/runner.js",
    "sha256": "723b513f51f6980c3d920d5b5fa1f53800fae55a3cbb3b1b8dbd5a557bb4a2a3",
    "sha256CRLF": "6b9f3285d46c3fd795cf388f3e6b3800c10446e3d8ce274a1b70a9225c1572e5"
  },
  {
    "path": "src/process/win32.js",
    "sha256": "8c9166f720b9002035167be149e3a2ee6291f4ab5da5879496361006dd779ff4",
    "sha256CRLF": "cc2101c660c57ad54e6104135dd667892fbe7d9c83cbb44a044c90a0a01d11b3"
  },
  {
    "path": "src/legacy-v4/dsh-win32-process/lib/index.js",
    "sha256": "034c397a6da2d41904d156a5e3e520b6fc2e95b26643c7e4dd0ad83c3790bd23",
    "sha256CRLF": "239d8c7607a062c5c5bd6175072a349898e5a5e8518ff83df7cdcf72959f3c41"
  },
  {
    "path": "src/legacy-v4/dsh-subprocess/lib/control.js",
    "sha256": "4afd0f7d7a7054b6fc8d727ea3f76731a78c9a972ddb6d5d2eef81cac4ffee3a",
    "sha256CRLF": "9646167f3aa40b5ca717eff8d0635b482d9a62606161878aeca007b89044db18"
  },
  {
    "path": "src/legacy-v4/dsh-sandbox-windows-acl/lib/runner.js",
    "sha256": "67b71b8988583451a8c21451f06960f5266d3d27d133276aa74cd7096a612246",
    "sha256CRLF": "b0584b10516d213b22b58c64034a7c40d6f71bcd98c2614187d93d58702645ae"
  },
  {
    "path": "src/legacy-v4/dsh-sandbox-windows-acl/lib/types-Cl_DXjhk.js",
    "sha256": "d42375a720d7f628a93cde5cd4a8964f3d75cd1d2fcd589d379d210883e91ee4",
    "sha256CRLF": "bdb7b217029b3ce1457b4dd166905049fad25389d14e44b15249c32389e42482"
  }
].map(Object.freeze))
const nativeRuntimeRoot = fileURLToPath(new URL('../..', import.meta.url))

const safePath = value => typeof value === 'string' && win32.isAbsolute(value) && !/[\r\n'";&|<>`$]/u.test(value)
const shellPath = '[A-Za-z]:\\\\[^\\s;\'"&|<>`$]+'

// An operator may retain evidence of the original Host's exit without knowing
// its cause. This is reviewed evidence, not a fabricated native exit receipt.
export const observedHostExitSchema = { type: 'object', properties: {
 observedAt: { type: 'string', format: 'date-time' }, evidenceRef: { type: 'string', minLength: 1, maxLength: 2000 },
}, required: ['observedAt', 'evidenceRef'], additionalProperties: false }

export function localRestartScope(command) {
 const pg = new RegExp(`^& (${shellPath}\\\\postgres\\.exe) -D (${shellPath}) -h 127\\.0\\.0\\.1 -p ([0-9]+)$`, 'i').exec(command)
 if (pg && Number(pg[3]) > 0 && Number(pg[3]) <= 65535) return { kind: 'local-postgres', executable: pg[1], directory: pg[2], port: Number(pg[3]) }
 const prefix = /^\$env:JAVA_HOME='([^']+)'; \$env:PATH="\$env:JAVA_HOME\\bin;\$env:PATH"; \$env:JAVA_TOOL_OPTIONS='-Dfile.encoding=UTF-8'; /u
 const stripped = command.replace(prefix, '')
 if (stripped === command) return null
 const compile = new RegExp(`^python (${shellPath}\\\\verification_run\\.py) --cwd (${shellPath}) --evidence-dir (${shellPath}) --name ([A-Za-z0-9_-]+) -- (${shellPath}\\\\mvn\\.cmd) -o '-Dmaven\\.repo\\.local=(${shellPath})' -DskipTests test-compile$`, 'i').exec(stripped)
 if (!compile) return null
 return { kind: 'local-maven-compile', wrapper: compile[1], directory: compile[2], evidenceFile: win32.join(compile[3], compile[4] + '.json') }
}

// Shared by the actual probe and executable PowerShell classification tests.
export const restartProducerFilter = `
function Get-RestartSourceText($Entry) {
 $text = [string]$Entry.CommandLine
 if ($text -match '(?i)-EncodedCommand\\s+"?([A-Za-z0-9+/=]+)') {
  try { $text += ' ' + [Text.Encoding]::Unicode.GetString([Convert]::FromBase64String($Matches[1])) } catch {}
 }
 return $text.Replace('/','\\')
}
function Get-RestartRelatedProducer($Processes, $Spec, $WindowStart, $WindowEnd, $OriginalSourcePid) {
 $related = [Collections.Generic.HashSet[long]]::new()
 [void]$related.Add([long]$Spec.hostPid)
 if ($OriginalSourcePid -gt 0) { [void]$related.Add([long]$OriginalSourcePid) }
 do {
  $changed = $false
  foreach ($entry in $Processes) {
   if ($related.Contains([long]$entry.ParentProcessId) -and $related.Add([long]$entry.ProcessId)) { $changed = $true }
  }
 } while ($changed)
 $providerRoot = $Spec.managedProviderRoot.Replace('/','\\')
 foreach ($entry in $Processes) {
  if ($related.Contains([long]$entry.ProcessId)) { $entry; continue }
  $sourceText = Get-RestartSourceText $entry
  $inWindow = $null -eq $entry.CreationDate -or ($entry.CreationDate.ToUniversalTime() -ge $WindowStart -and $entry.CreationDate.ToUniversalTime() -le $WindowEnd)
  if ($inWindow -and $sourceText.IndexOf($providerRoot,[StringComparison]::OrdinalIgnoreCase) -ge 0) { $entry }
 }
}
`

export function restartScopeProbePlan({ command, binding, evidence, workspaceRoot, dshHome, runtimeRoot = process.env.NIGHT_BOT_RUNTIME_ROOT ?? nativeRuntimeRoot }) {
 if(dshHome!==undefined)return null
 const providerRoot=runtimeRoot
 const scope = evidence?.postgresWrapper ? postgresWrapperScope(command, evidence.postgresWrapper, binding, workspaceRoot) : localRestartScope(command)
 if (!scope || !safePath(providerRoot) || !safePath(evidence?.hostLogPath) || !/^[a-f0-9]{64}$/u.test(evidence.hostLogSha256 ?? '')
  || !Number.isSafeInteger(evidence.hostPid) || evidence.hostPid < 1
  || evidence.producerScopeReviewed !== true || evidence.localEffectsOnlyConfirmed !== true || evidence.excludeOriginalSourcesConfirmed !== true) return null
 const hostExit = evidence.hostExit
 const pgWrapper = scope.kind === 'local-postgres' && scope.wrapper
 if (hostExit !== undefined && (!hostExit || Object.keys(hostExit).some(key => !['observedAt', 'evidenceRef'].includes(key))
  || typeof hostExit.observedAt !== 'string' || !Number.isFinite(Date.parse(hostExit.observedAt)) || Date.parse(hostExit.observedAt) < binding.startedAt || Date.parse(hostExit.observedAt) > Date.now()
  || typeof hostExit.evidenceRef !== 'string' || !hostExit.evidenceRef.trim() || hostExit.evidenceRef.length > 2000)) return null
 const spec = { schema: hostExit ? 'native-restart-scope-v2' : 'native-restart-scope-v1', ...(hostExit ? { hostExit } : {}), binding, scope, hostPid: evidence.hostPid, hostLogPath: evidence.hostLogPath,
  hostLogSha256: evidence.hostLogSha256, managedProviderKind: 'night-bot-pi', managedProviderRoot: providerRoot, providerFiles: nativeRestartProviderFiles.map(file => ({ ...file, path: win32.join(providerRoot, file.path) })) }
 const encoded = Buffer.from(JSON.stringify(spec)).toString('base64')
 const probe = `$ErrorActionPreference = 'Stop'
${restartProducerFilter}${pgWrapper ? '\n' + postgresWrapperInspection : ''}
$s = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encoded}')) | ConvertFrom-Json${hostExit ? `
$s.hostExit.observedAt = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${Buffer.from(hostExit.observedAt).toString('base64')}'))` : ''}
$log = Get-Item -LiteralPath $s.hostLogPath -ErrorAction Stop
if ($log.PSIsContainer -or ($log.Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'HOST_LOG_NOT_REGULAR' }
$logHash = (Get-FileHash -LiteralPath $s.hostLogPath -Algorithm SHA256 -ErrorAction Stop).Hash.ToLowerInvariant()
$fatalText = [IO.File]::ReadAllText($s.hostLogPath)
$fatal = $logHash -eq $s.hostLogSha256 -and $fatalText.Contains('FATAL ERROR: Reached heap limit Allocation failed - JavaScript heap out of memory') -and $fatalText.Contains('[' + $s.hostPid + ':')
$providerOk = $true
foreach ($f in $s.providerFiles) {
 $allowedHashes = @($f.sha256)
 if ($null -ne $f.sha256CRLF) { $allowedHashes += $f.sha256CRLF }
 $i = Get-Item -LiteralPath $f.path -ErrorAction Stop
 if ($i.PSIsContainer -or ($i.Attributes -band [IO.FileAttributes]::ReparsePoint) -or $i.LastWriteTimeUtc -gt [DateTimeOffset]::FromUnixTimeMilliseconds($s.binding.startedAt).UtcDateTime -or $allowedHashes -notcontains (Get-FileHash -LiteralPath $f.path -Algorithm SHA256 -ErrorAction Stop).Hash.ToLowerInvariant()) { $providerOk = $false }
}
$all = @(Get-CimInstance Win32_Process -ErrorAction Stop)
$hostCount = @($all | Where-Object { $_.ProcessId -eq $s.hostPid }).Count
$hostChildren = @($all | Where-Object { $_.ParentProcessId -eq $s.hostPid }).Count
$windowStart = [DateTimeOffset]::FromUnixTimeMilliseconds($s.binding.startedAt - 5000).UtcDateTime
$windowEnd = ${hostExit ? "[DateTimeOffset]::Parse($s.hostExit.observedAt).UtcDateTime" : '$log.LastWriteTimeUtc'}
$portCount = 0; $preserved = $false; $sourceProcessId = 0; $artifactState = $null
if ($s.scope.kind -eq 'local-postgres') {${pgWrapper ? '\n Assert-PgWrapperEvidence $s.scope' : ''}
 $sourcePidFile = Join-Path $s.scope.directory 'postmaster.pid'
 $sourcePidLines = @([IO.File]::ReadAllLines($sourcePidFile)); $sourceProcessId = [int]$sourcePidLines[0]
 $preserved = $sourcePidLines.Count -ge 4 -and [IO.Path]::GetFullPath($sourcePidLines[1]) -eq [IO.Path]::GetFullPath($s.scope.directory) -and [int]$sourcePidLines[3] -eq $s.scope.port
 $portCount = @(Get-NetTCPConnection -ErrorAction Stop | Where-Object { $_.LocalPort -eq $s.scope.port }).Count
 $writers = @($all | Where-Object { $_.ProcessId -eq $sourceProcessId -or ((Get-RestartSourceText $_).IndexOf($s.scope.directory.Replace('/','\\'),[StringComparison]::OrdinalIgnoreCase) -ge 0)${pgWrapper ? " -or ((Get-RestartSourceText $_).IndexOf($s.scope.wrapper.script.Replace('/','\\'),[StringComparison]::OrdinalIgnoreCase) -ge 0)" : ''} }).Count
 $artifactState = 'retained-unverified-database'
} else {
 $record = [IO.File]::ReadAllText($s.scope.evidenceFile) | ConvertFrom-Json
 $sourceProcessId = [int]$record.pid
 $preserved = $sourceProcessId -gt 0 -and $record.cwd -eq $s.scope.directory -and $record.state -eq 'running' -and $null -eq $record.exitCode
 $writers = @($all | Where-Object { $_.ProcessId -eq $sourceProcessId -or ((Get-RestartSourceText $_).IndexOf($s.scope.directory.Replace('/','\\'),[StringComparison]::OrdinalIgnoreCase) -ge 0) }).Count
 $artifactState = 'retained-unverified-build'
}
$legacySourceCount = @(Get-RestartRelatedProducer $all $s $windowStart $windowEnd $sourceProcessId).Count
[ordered]@{schema=$s.schema;specDigest='${hash(spec)}';observedAt=[DateTimeOffset]::UtcNow.ToString('o');hostFatal=$fatal;hostFatalTime=$log.LastWriteTimeUtc.ToString('o');${hostExit ? "hostLogVerified=($logHash -eq $s.hostLogSha256 -and $log.LastWriteTimeUtc -le $windowEnd);hostExitObservedAt=$s.hostExit.observedAt;" : ''}providerContractVerified=$providerOk;originalHostCount=$hostCount;originalHostChildCount=$hostChildren;legacySourceCount=$legacySourceCount;sourceWriterCount=$writers;listeningCount=$portCount;originalArtifactsPreserved=$preserved;artifactState=$artifactState} | ConvertTo-Json -Compress
`
 return { command: probe, spec, specDigest: hash(spec), scriptDigest: hash({ command: probe }) }
}

export function validRestartScopeObservation(plan, observation) {
 const observedAt = Date.parse(observation?.observedAt)
 const exitAt = Date.parse(plan.spec.hostExit ? observation?.hostExitObservedAt : observation?.hostFatalTime)
 return observation?.schema === plan.spec.schema && observation.specDigest === plan.specDigest
  && (plan.spec.hostExit ? observation.hostLogVerified === true && observation.hostExitObservedAt === plan.spec.hostExit.observedAt : observation.hostFatal === true)
  && Number.isFinite(observedAt) && Number.isFinite(exitAt) && exitAt >= plan.spec.binding.startedAt && observedAt >= exitAt
  && observation.providerContractVerified === true && observation.originalHostCount === 0 && observation.originalHostChildCount === 0
  && observation.legacySourceCount === 0 && observation.sourceWriterCount === 0 && observation.listeningCount === 0 && observation.originalArtifactsPreserved === true
}

const toolMessages = event => event.type !== 'tool/result' ? [] : event.data.message?.role === 'tool' ? [event.data.message] : event.data.message?.content ?? []

export const restartScopeProbeToolName = 'execution_restart_scope_probe'
const digestSchema = { type: 'string', pattern: '^[a-f0-9]{64}$' }

/** 只把 Host 重建的原文交给原生工具；不接受模型提供的 command，不自行启动进程或补写原生事件。 */
export function registerRestartScopeProbe({ agentCtx, agent, current, readPlan, captureSettlement }) {
 const outcomes = new Map()
 agentCtx.tools.register({
  name: restartScopeProbeToolName,
  description: '执行当前只读调查绑定的 Host 重启隔离探针。expectedOperationDigest、expectedScriptDigest 和 scopeEvidence 来自正式 reply/check。Host 重新核对原调用并将固定 command 原文传给原生 pwsh，无需复制命令。成功只证明本次探针执行，仍须正式人工对账；不重放原操作。',
  effectClass: 'read',
  parameters: { type: 'object', properties: {
   expectedOperationDigest: digestSchema, expectedScriptDigest: digestSchema,
   scopeEvidence: { type: 'object', properties: {
    hostPid: { type: 'integer', minimum: 1 }, hostLogPath: { type: 'string', minLength: 1 }, hostLogSha256: digestSchema,
    hostExit: observedHostExitSchema,
    postgresWrapper: postgresWrapperSchema,
    producerScopeReviewed: { const: true }, localEffectsOnlyConfirmed: { const: true }, excludeOriginalSourcesConfirmed: { const: true },
   }, required: ['hostPid', 'hostLogPath', 'hostLogSha256', 'producerScopeReviewed', 'localEffectsOnlyConfirmed', 'excludeOriginalSourcesConfirmed'], additionalProperties: false },
  }, required: ['expectedOperationDigest', 'expectedScriptDigest', 'scopeEvidence'], additionalProperties: false },
  output: { schema: { type: 'object' }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
  // 保留失败子结果，但不改原生 isError。否则下一次调查只能看到外层报错，无法定位原子调用。
  finalizeContent(exec, result) {
   const outcome = outcomes.get(exec.token); outcomes.delete(exec.token)
   return outcome ? [{ type: 'text', text: JSON.stringify({ ...outcome, ...(result.isError ? { failure: result.error?.message ?? 'DYNAMIC_SCOPE_PROBE_EXECUTION_FAILED' } : {}) }) }] : undefined
  },
  async execute(args, exec) {
   const check = async () => { exec.signal.throwIfAborted(); if (!await current()) throw Error('execution_binding_stale') }
   await check()
   const plan = await readPlan(args)
   if (!plan || plan.spec.binding.operationDigest !== args.expectedOperationDigest || plan.scriptDigest !== args.expectedScriptDigest
    || hash({ command: plan.command }) !== plan.scriptDigest) throw Error('DYNAMIC_SCOPE_PROBE_PLAN_STALE')
   await check()
   const callId = `${exec.callId}:restart-scope`, parameters = { command: plan.command, description: '核对原 Host 及原操作生产来源是否隔离', timeoutMs: 60000 }
   // 必须经过同一 registry 的 guard、operation 账本、原生 job 和 post-execute；parent 是原生分配的外层 token。
   const { result, operationObservation } = await captureSettlement(callId, () => agentCtx.tools.execute({ callId, rootCallId: exec.rootCallId, parent: exec.token,
    name: 'pwsh', arguments: parameters, agent: exec.agent, signal: exec.signal }))
   const outcome = { probeCallId: callId, scriptDigest: plan.scriptDigest, nativeArguments: parameters,
    ...(operationObservation ? { operationObservation } : {}), nativeResult: { isError: result.isError, content: result.content } }
   outcomes.set(exec.token, outcome)
   await check()
   const events = agent.session.snapshotEvents()
   const jobs = events.filter(event => event.type === JOB_REGISTERED && event.data.version === 1 && event.data.owner === agent.id && event.data.toolCall?.callId === callId)
   const settled = jobs.length === 1 ? events.filter(event => event.type === JOB_SETTLED && event.data.version === 1 && event.data.owner === agent.id
    && event.data.jobId === jobs[0].data.jobId && event.data.startedAt === jobs[0].data.startedAt) : []
   // shell 工具可成功返回 exitCode=1；调用成功不能替代 producer 成功，缺 job 也不能生成受管成功回执。
   if (result.isError || !operationObservation || operationObservation.cancelled || operationObservation.postExecutionDecision !== 'accept'
    || jobs.length !== 1 || jobs[0].data.label !== plan.command || jobs[0].data.toolCall.rootCallId !== exec.rootCallId
    || settled.length !== 1 || settled[0].data.producerReported !== true || settled[0].data.status !== 'completed'
    || settled[0].data.detail !== 'exit code: 0') throw Error('DYNAMIC_SCOPE_PROBE_EXECUTION_FAILED')
   // 外层原生 tool/result 保存受管实参及子结果；真正派发还必须由独立 native job 记录交叉证明。
   return outcome
  },
 })
 return agentCtx.tools.get(restartScopeProbeToolName, agent)
}

/** 外层原生调用只接受 Host 返回的实参；下游还须交叉核对同 root 的唯一原生 job 和 producer 终态。 */
export function readManagedRestartProbeCall(events, input, callId) {
 const parents = events.filter(event => event.seq > input.seq && event.type === 'tool/call'
  && callId === `${event.data.callId}:restart-scope` && event.data.name === restartScopeProbeToolName)
 if (parents.length !== 1) return null
 const parent = parents[0]
 let args
 try { args = JSON.parse(parent.data.arguments) } catch { return null }
 const outer = events.filter(event => event.seq > parent.seq && toolMessages(event).some(message => message.toolCallId === parent.data.callId))
 if (outer.length !== 1) return null
 const message = toolMessages(outer[0]).find(message => message.toolCallId === parent.data.callId)
 if (typeof message?.isError !== 'boolean') return null
 let value
 try { value = JSON.parse(message.content?.filter(part => part.type === 'text').map(part => part.text).join('\n')) } catch { return null }
 if (value.probeCallId !== callId || value.scriptDigest !== args.expectedScriptDigest
  || hash({ command: value.nativeArguments?.command }) !== args.expectedScriptDigest
  || typeof value.nativeResult?.isError !== 'boolean' || !Array.isArray(value.nativeResult.content)
  || value.nativeResult.isError && !message.isError) return null
 const observation = value.operationObservation
 if (observation && (typeof observation.result?.isError !== 'boolean' || !Array.isArray(observation.result.content)
  || typeof observation.cancelled !== 'boolean' || !['accept', 'block'].includes(observation.postExecutionDecision)
  || observation.result.isError && !value.nativeResult.isError)) return null
 return { call: { seq: parent.seq, data: { callId, rootCallId: parent.data.callId, arguments: JSON.stringify(value.nativeArguments) } },
  returned: outer[0], message: { toolCallId: callId, ...value.nativeResult },
  operationMessage: observation ? { toolCallId: callId, ...observation.result } : null, operationObservation: observation,
  outerIsError: message.isError, expectedOperationDigest: args.expectedOperationDigest }
}

export async function readRestartScopeProbe({ ctx, plan, evidence, operation, executions }) {
 const readback = executions.find(item => item.executionId === evidence.probeExecutionId)
 if (!readback || readback.taskId !== operation.taskId || readback.status !== 'succeeded' || !readback.drained || readback.recovering
  || readback.definition?.recoveryReadOnly !== true || readback.input?.readbackOperationId !== operation.operationId
  || ctx.agents.get(readback.sessionId) || ctx.sessions.get(readback.sessionId)) return null
 const { events } = await inspectSession(ctx.sessionPersistence, readback.sessionId)
 const identity = events.some(event => event.type === 'plugin:dingtalk/execution-session' && event.data.identity?.taskId === operation.taskId
  && event.data.identity.executionId === readback.executionId && event.data.identity.sessionId === readback.sessionId)
 const input = executionInputFor(events, readback)
 if (!identity || !input) return null
 const direct = events.filter(event => event.seq > input.seq && event.type === 'tool/call' && event.data.callId === evidence.probeCallId && event.data.name === 'pwsh')
 const managed = readManagedRestartProbeCall(events, input, evidence.probeCallId)
 if (managed && (managed.outerIsError || !managed.operationMessage || managed.operationMessage.isError
  || managed.operationObservation.cancelled || managed.operationObservation.postExecutionDecision !== 'accept'
  || managed.expectedOperationDigest !== plan.spec.binding.operationDigest)) return null
 if (direct.length + Number(!!managed) !== 1) return null
 const call = direct[0] ?? managed.call
 let args
 try { args = JSON.parse(call?.data.arguments) } catch { return null }
 if (args.command !== plan.command || args.run_in_background === true || Object.keys(args).some(key => !['command', 'description', 'timeoutMs', 'run_in_background'].includes(key))) return null
 const registered = events.filter(event => event.seq > call.seq && event.type === JOB_REGISTERED && event.data.version === 1 && event.data.owner === readback.sessionId
  && event.data.toolCall?.callId === call.data.callId)
 if (registered.length !== 1) return null
 const registration = registered[0]
 if (registration.data.kind !== 'pwsh' || registration.data.label !== plan.command
  || managed && registration.data.toolCall.rootCallId !== call.data.rootCallId) return null
 const settled = events.filter(event => event.seq > registration.seq && event.type === JOB_SETTLED && event.data.version === 1
  && event.data.jobId === registration.data.jobId && event.data.owner === readback.sessionId && event.data.startedAt === registration.data.startedAt)
 if (settled.length !== 1 || settled[0].data.producerReported !== true || settled[0].data.status !== 'completed' || settled[0].data.detail !== 'exit code: 0') return null
 const returned = managed?.returned ?? events.find(event => event.seq > call.seq && toolMessages(event).some(message => message.toolCallId === call.data.callId))
 const message = managed?.message ?? (returned && toolMessages(returned).find(message => message.toolCallId === call.data.callId))
 if (!message || message.isError !== false || returned.seq <= settled[0].seq) return null
 let text = message.content?.filter(part => part.type === 'text').map(part => part.text).join('\n') ?? ''
 try { const receipt = JSON.parse(text).nativeJobReceipt; if (receipt) {
  if (receipt.jobId !== registration.data.jobId || receipt.status !== 'completed') return null
  text = receipt.chunks.map(chunk => chunk.text).join('')
 } } catch {}
 const raw = text.trim().replace(/\s*\[exit code: 0\]\s*$/u, '')
 let observation
 try { observation = JSON.parse(raw) } catch { return null }
 if (!validRestartScopeObservation(plan, observation)) return null
 const provenance = { kind: 'native-windows-restart-probe', scope: plan.spec.scope, isolationBasis: 'bounded-producer-exclusion', historicalJobObjectIdentity: 'unavailable', specDigest: plan.specDigest, scriptDigest: plan.scriptDigest,
  hostPid: plan.spec.hostPid, hostLogSha256: plan.spec.hostLogSha256, executionId: readback.executionId, sessionId: readback.sessionId,
  ...(plan.spec.hostExit ? { hostExit: { ...plan.spec.hostExit, basis: 'operator-observed-exit', cause: 'unknown' } } : {}),
  callId: call.data.callId, callSequence: call.seq, resultSequence: returned.seq, settledSequence: settled[0].seq, observation }
 return { kind: 'native-source-scope-isolation', receiptId: `native-scope:${hash(provenance)}`, issuer: 'native-windows-scope-evidence-v1',
  binding: plan.spec.binding, fenceRef: `retired-managed-range:${plan.specDigest}`, hostExitRef: plan.spec.hostExit ? `observed-host-exit:${hash(plan.spec.hostExit)}` : `host-fatal:${plan.spec.hostLogSha256}`,
  originalHostExited: true, sourceScopeQuiescent: true, durableSourceExclusion: true, externalWritersExcluded: true, activeSourceCount: 0,
  observedAt: observation.observedAt, provenance, provenanceDigest: hash(provenance) }
}
