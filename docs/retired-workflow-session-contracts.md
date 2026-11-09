# Retired workflow/session drivers and retained contracts

The cancelled products are the Owner/member execution split, generic workflow
node sessions, optional Claude CLI/teammate backend, and their legacy PiLoop
composition. The product runs one official Pi AgentSession per task. This is not
an import or conversion of DSH data.

## Source boundary

Removed `src/pi-loop.js`, `packages/dingtalk-core/task-session.js`,
`packages/dingtalk-core/execution-session.js` and
`packages/dingtalk-core/claude-execution-session.js`. The old
`openResidentRuntime`, `openWorkflowService`, `openExecutionRuntime` and execution
plugin driver are removed from their modules. `runtime.js` retains only the
independent task metadata helpers. `workflow-service.js` retains its business
constraint, source/authorization, readout and artifact helpers. `execution.js`
retains portable task directory resolution and pure artifact exports.
`message-agent.js` remains an explicitly injected domain controller with no
default execution/session/history driver; its separate owner preserves its SQL
contracts. Workflow instruction/catalog/authorization/artifact modules remain.

`native-sessions`, Session/surface classes and generic old Night writer are not
yet retired. Their remaining audit/backup tests do not justify using them for
model context. The native task persistence fixture no longer constructs those
services: real inference is through installed official Host, old Night records
are created only for strict routing/backup rejection tests.

## Test contract mapping

Retired files are `execution-session-native` and its near-duplicate
`execution-session-installed-cold-fix` (node/message workflow driver),
`dynamic-execution-session-native` (dynamic node driver), and
`claude-execution-session-native` (optional vendor backend). The optional
`task-session-real-model-isolated` test is also retired: it depended on an
external machine-specific provider plugin and cancelled Owner/node takeover.
No private paths/login are copied, and no current live-vendor validation is claimed. A removed test is not
counted passing because another test covers the broad category. The following
are current independent contracts, including known gaps.

| Old contract group | Current official evidence / disposition |
| --- | --- |
| Owner/member independent identities, generic execution_submit, delegation/teammates, managed-child migration, node generation/digest and workflow-stage organization | Cancelled architecture. No adapter, facade, seed history, old submit tool or automatic child reconstruction replaces it. `task-session-model-native` proves one configured execution model and no member execution rows. |
| Tool names or configured options cannot grant authority; stale source/lease cannot authorize writes | `pi-official-permission-presets` tests private capability binding, foreign actors/options, composite durable permission failure. `pi-official-business-policy` tests exact actor identity, immutable cwd/artifact binding and links. `pi-single-task-official` tests superseded runs produce zero effects and actual cleanup failures stay unproven. |
| Correctable malformed tools, same-turn bounded concurrency and no later same-batch effects after conclusion/failure | `pi-official-tools` tests actual public SDK strict inputs, canonical isError/results, awaited receipts, FIFO effect leases, abort and after-body conclusion. The old custom invalid-arguments text ABI is cancelled. Official SDK argument rejection bypasses NativeTools body middleware. The resulting real coordinator fairness defect is repaired through public AgentSession.subscribe(tool_execution_end) and public agent.finishTurn: actual strict refusals count towards the current request's slice without relaxing validation. coordination-latency-native retains all nine refusals, new image task admission before old completion, exact once action/outbox and zero retry increments; pi-business-turn-yield verifies rejection events, one-turn reset and facade/identity refusal. |
| Provider error after accepted effect, effect identity, recovery without replay, callbacks lost after durable commit | `pi-single-task-official` cold-resumes original session without replaying settled effects; unknown effects block submission/retry/replay. `task-session-provider-native` uses official retry events/classifier and holds old Night providerRecovery. `task-session-job-recovery-native` covers durable terminal receipt, cold same-file recovery, exact operator reconciliation, paused unknown effects and no replay. |
| Cancellation, supersession, late result refusal, process/job physical drain and retained ownership on failure | `pi-single-task-official` waits actual SDK/background producer and always attempts disposal; drain/startup cleanup failure remains unproven. `pi-official-tools` waits active body after queued cancellation. `pi-process-ownership` and `pi-native-process` independently verify trusted ownership, uncertain termination, pending PTY allocation and descendants surviving direct command exit. Vendor-specific Claude MCP/hooks/permissions are cancelled, not claimed verified by Pi process tests. |
| Tool/job names or textual background identities cannot manufacture producer/drain evidence | `pi-official-job-ledger` tests registered producer commit-before-start, same-id foreign initiator refusal, unknown cold starts, nonproducer/duplicate settlement refusal, cancellation during registration and typed terminal delivery. `pi-native-maintenance-receipts` rejects self-reported incomplete evidence, nonzero activity, stale binding/cut, changed effects, uncommitted tail and branch removal. A journal receipt alone is not final maintenance proof. |
| Runtime notices/live supplemental input, old submission may not consume new source | `task-session-live-supplement-native` proves same actual SDK+producer identity, exact source consumption once, unknown effects stay reconcilable and earlier TaskResult cannot acknowledge a newly arrived source. Historical node-specific supplement contracts are cancelled. |
| Native task cwd isolation, strict routes/links, Host-only writer, cancellation and cross-process compaction | `task-session-persistence-native` now runs actual Host and public official messages/compaction. It retains real parallel child processes, exact task scope, conflicting registrations, links at every persistence entry, abort identity, cold original journal prefix and strict old Night backup inspection. Its old successful subagent-spawn case becomes duplicate public activation refusal; forged-parent/cross-task negative cases remain. |
| Cold observer bytes, original media, committed projection/provenance, no activation | `pi-native-observation-read`, `pi-native-store`, `task-session-follow-conflict-native`: exact official projection, independent snapshots, abort before I/O and after gated read, writer retained, strict tail and byte preservation. |
| Request image/text privacy, signed data, source references and budgets | `pi-request-image-budget` tests original native image/history retention, signed-text immutability, strict rejection and real wire budget. `task-session-material-history` and model-context tests remain separately migrated business contracts. The exact old recursive v1/v2/v3 Host snapshot upgrade and generic-node 32-input algorithms are cancelled; no old Host history is rebuilt. Native repeated-input budget coverage must be assessed in the current model-context suite, not inferred from removal. |
| Exact provider failures/raw diagnostics despite HTTP200 | Current official provider failure and retry suites remain. Old anonymous field-v12/node-specific reclassification is not migrated or counted passing. |
| Legacy workflow history pagination/edit races/clarification/attachments | Six cases in `message-context-repair` depended on openWorkflowService and are retired with that driver. Its three independent long-source, timestamp/fileId and directed-identity tests move unchanged to `message-source-context`. Source authorization/query tools and typed Single inputs remain, but current per-task query grant wiring is a separately reported production gap; this document does not claim the six old cases execute or that Host can grant a global all-task read whitelist. |

The old `runtime-mixed`/`runtime`/`runtime-history` tests are unmigrated contract
assets outside the current default/runtime/domain selection. They mix cancelled
Owner/stage organization with retained notification, human, source and drain
requirements. They are not restored through an old driver, not deleted merely to
increase pass counts, and not represented as passing.

## Targeted evidence for this slice

- `/tmp/night-session-retirement-frozen.tap`: source/directory helpers, official session/tools/Single, public yield and malformed-call fairness, 26 passing.
- `/tmp/night-pure-workflow-helper-prune.tap`: AST-pruned pure source/directory helpers, 9 passing.
- `/tmp/night-native-persistence-official-final.tap`: 16 passing.
- `/tmp/night-retired-host-fixture.tap`: actual shared official Single fixture, 1 passing.
- `/tmp/night-session-driver-cut.tap`: fixed domain/current timezone/direct observation, 34 passing.
- `/tmp/night-retired-drivers-safety-contracts.tap`: actual Single/tools/policy/permissions/job/maintenance plus source/directory helpers, 63 passing.
- `/tmp/night-fixed-native-domain-final.tap`: actual NativeDomains fixed-topic contracts, 30 passing.
- `/tmp/night-public-yield-final.tap`: public scheduling helper, fairness, official tools and Single, 16 passing.
- `/tmp/night-official-yield-triage.tap`: helper plus actual 15/16 batch, cold unknown-send readback and startup coalescing, 5 passing.
- `/tmp/night-retired-execution-directory.tap`: task file/directory helpers, 6 passing (overlaps preceding run).

No full suite, manifest refresh, package retirement, commit or push is performed
by this slice. Source accounting and retained notices are integrated centrally.

`execution-runtime-native` is retired with the removed `openExecutionRuntime` driver. Its synthetic agent→code node pipeline and old apply/fiber service are predecessor orchestration, not a second supported runtime. Current cross-process committed Pi history/compaction and original identity are tested by `task-session-persistence-native`; actual process ownership/restart/unknown effects by `native-restart-http-drain`, `native-restart-scope-runner-native` and Single effect reconciliation. No identical node-pipeline semantics or old JSONL authority are claimed. Pure SQLite/artifact/business helper tests remain.
