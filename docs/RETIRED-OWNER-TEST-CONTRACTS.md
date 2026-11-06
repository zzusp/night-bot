# Retired Owner and SDK-loop test compositions

Night Bot uses one official Pi execution session per task. These removals retire
cancelled implementation contracts; they are not passing versions of those tests.
No DSH AgentLoop, Goal round driver, Session history or Owner/executor team is
reintroduced to satisfy a historical fixture.

| Retired suite/cases | Disposition and retained product evidence |
| --- | --- |
| report-native-lifecycle: Goal.block; Goal restoration with stable Inbox notice; Session restore of blocked Goal; rejected step requeue without spin; yielding execution permission between A/B Owners | Goal lifecycle and multi-Owner scheduling retired. Stable delivery/pending input and restart deduplication remain in topic-native-inbox, topic-runtime and pi-business-admission. Task SDK/lease continuity remains in task-session-live-supplement-native. |
| decision-round-reuse-native: one Decision Agent across pending revisions, new Agent next accepted round | Decision round orchestration retired. Official same-session preserve, source freshness before task_result and actual producer continuity are covered by task-session-live-supplement-native; supersession/drain by pi-single-task-official. |
| coordination-native-lifecycle: post-execute drain; hidden pwsh deny; restored request not repeating effects; scope-local tool cannot bypass monotonic guard; route preemption before first step; queued routing while review handle starts | Multi-Owner route/review scheduling retired. Actual SDK body drain/durable effect barriers remain in pi-official-durability and pi-parallel-tools-wire; permission guards in pi-native-tools; cold effect identity/no replay in pi-single-task-official and pi-task-effect-call-identity. Topic source/revision decisions remain in topic-runtime. |
| message-agent-controller: the single real AgentLoop execution_node_submit integration | Split execution-node session protocol retired. The other 18 SQL/domain contracts are retained separately; task wait/new input, late cancellation and exact writer cleanup are tested by actual Single runtime suites. |
| model-context-172-native and model-context-172-decisions, their SDK host/decision fixture and measure-task-decisions-172 script | Owner task_session_submit/model_content_read and shadow-projection measurements retired. We no longer claim their byte counts, seven-scenario read counts or performance comparison. Actual Pi context/compaction/branch/signatures are covered by pi-official-context; native request/image budgets by pi-request-image-budget and pi-file-tool-budgets. This is capability evidence, not reproduction of the old performance numbers. |

`topic-native-inbox` now tests actual Host/factory business admission and official
SDK entries. There is no Inbox claim/splice replacement. A durable enqueue is not
consumption; a matching committed official entry can repair a missing ACK without
redelivery. Cancellation permanently fences that packet ID; the old permission to
reinsert an identical cancelled Inbox item is deliberately not preserved.

The retained message controller is a SQL/business-state component with mandatory
explicit runner and executed-query-reference reader capabilities. It has no
fallback agent/session driver, Session lookup, transcript decoding or default
mount. Its domain fixtures inject business results and references; they do not
claim to prove inference or transcript provenance. Actual SDK provenance remains
covered by the official business-input/effect tests.

## Explicit remaining query integration gap

`workflow-managed-query-native` assembled the cancelled v26 Owner/stage/node
workflow service and SDK loop. That composition has been retired. Its resource
configuration, readonly query, source and artifact security requirements have not
been replaced by an assertion that the current Single automatically provides them.

The independent resource/database capabilities and strict authorization/evidence
contracts remain in `agent-query-tools`, `agent-query-runtime`,
`agent-query-database-all-tables` and `configure-agent-query-resources` tests:
registered-resource allowlists, source/subject and input-generation binding,
read-only database transaction/replica checks, column/table restrictions, redaction,
content-addressed retained evidence and invalid-reference rejection.

There is currently **no default production connection** from configured query
resources to the Single task tools. The old query evidence identity supports
Owner/node/message-unit bindings, not an official Single invocation identity.
Restoring this requires an explicit per-task business resource grant, current SQL
source/revision authorization, exact official admitted-input/call provenance,
permission-change checks and durable task-scoped evidence. An installation-wide
allowlist plus a current-input check is not an equivalent task resource grant.
No new grant, tool registration, default query service or synthetic node identity
is introduced in this retirement. Moving a source repository and reopening the
old v26 workflow is no longer claimed as current production integration evidence.
