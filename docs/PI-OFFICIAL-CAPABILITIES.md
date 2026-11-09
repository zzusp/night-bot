> 当前默认接线与受验状态见 [RUNTIME](RUNTIME.md) 和[唯一目标](acceptance/resident-conversation-routing/goal.md)。下文绑定 `4568d3f` 的调用者盘点、default-switch 与 Direct AgentSession assembly（含“不是默认工厂”）均为早期源码检查点，不能反推当前仍装配子代理或尚未切换 Pi；官方/应用职责与授权要求继续适用。

# Official Pi ownership: required migration boundary

Version: the exact `@earendil-works/*` 1.5.0 packages pinned in package.json and
pnpm-lock.yaml. Source identity and MIT provenance are recorded in
pi-license-source.json. This is a capability inventory, not a declaration that
all remaining adapters have been retired.

Current default runtime: `4568d3f` uses public createAgentSession/AgentSession
and SessionManager; the old Host session/LLM driver is no longer mounted. Default
file capabilities also use official read/write/edit. Earlier migration-stage
paragraphs below are historical capability notes, not a current wiring report.
See PI-NATIVE-DEFAULT-STATUS.md and PI-TASK-INPUT-AND-RETRY.md for current boundaries
and explicitly unresolved limitations.

Session history, context, message conversion, branching and compaction must use
Pi's official implementation. Night must not build a second implementation when
an official component exists. An adapter limitation is not an upstream gap.

| Responsibility | Public official component | Night boundary |
| --- | --- | --- |
| Active branch, entry tree, context edits | SessionManager getBranch/getTree/getChildren/appendContextEdit | Task ownership, controlled paths and portable archive references |
| Compaction and branch summaries | SessionManager appendCompaction/branchWithSummary; AgentSession compact | External effects are not inferred from a summary |
| Provenance-preserving context projection | buildSessionProjection / buildContextEntries | Strictly admitted commit cut and bounded transport pages |
| Runtime messages to provider messages | convertToLlm | Trusted channel metadata, attachment authorization and memory revocation policy via documented hooks |
| Inference/tool iteration and session lifecycle | agent-core Agent; coding-agent AgentSession/createAgentSession | Task leases, admission and durable external-effect receipts |
| Incomplete tool protocol pairs | pi-ai/api/transform-messages | A synthesized missing-result message is not an effect receipt or retry authorization |
| Tool declarations and state changes | pi-ai getCurrentTools/getDeclaredTools/getToolStateChanges | Executable registry and permissions remain application capabilities |

The root exports buildSessionProjection, buildContextEntries, buildSessionContext,
sessionEntryToContextMessages and convertToLlm were checked against the actual
installed package. projectContextEntry exists internally but is not a usable root
export; private deep imports are not an integration route.

The former Night system/developer custom-message encoding and middleware contracts
are integration work. Pi already supports system messages and official custom
message conversion hooks. They must be migrated without downgrading instruction
priority, accepting untrusted source metadata, bypassing attachment access, or
reviving revoked memory. The current driver is still under this migration.

The application strict journal admission, owner locks, commit receipts, queue,
permissions, task data, schedules, archive seals, delivery deduplication and unknown
external effects remain Night responsibilities. These controls must not compute a
parallel model history or substitute audit folds for Pi's current context.

## Search: supported options and actual product callers

The official npm latest and current main were checked: both remain 1.5.0. There
is no newer public headless helper to adopt. Official SessionManager.list supplies
allMessagesText from user/assistant text; the official selector searches that plus
name/id/cwd (words, phrases and regex). It selects sessions rather than returning
message hits; it excludes tool/custom/thinking content and is not a current-branch
message-search API. Official fullscreen transcript search and /tree provide
interactive single-session search/filtering.

The production AST call graph has no external caller of sessionQuery filterEvents,
traceSession/traceEvent/readSession/readEvent or the new projection transport.
The four actual observer call sites are subagent continuation/catalog/label and
session-controller recovery. Business effect receipts use inspectSession directly;
Conversation/task source queries and Markdown memory search use their own business
stores; historical Topic references do not restore active Topic routing. No Night HTTP/CLI session-fulltext route is registered.

1. Recommended current scope: do not add headless fulltext search. This removes no
   connected user feature; keep official projection and required observation.
2. Operator search: use the official CLI or public SessionSelectorComponent /
   TreeSelectorComponent. An embedded UI must use authorized read-only committed
   snapshots; never point an interactive resume/rename/delete flow at live task
   writer files without a separate authorized ownership operation.
3. A future HTTP/model tool returning message hits is a new requirement: seek an
   official public headless API or decide an official extension integration first.
   Do not deep import session-selector-search internals or invent a second search.

Sources: [official registry](https://registry.npmjs.org/@earendil-works%2Fpi-coding-agent),
[official sessions](https://github.com/earendil-works/pi/blob/v1.5.0/packages/coding-agent/docs/sessions.md),
[official keybindings](https://github.com/earendil-works/pi/blob/v1.5.0/packages/coding-agent/docs/keybindings.md).

## Separate tool support

pi-schema provides official strict validation; Night keeps lossless capture,
allowed-vocabulary policy, permissions and error framing. pi-codemode/declarations
provides official TypeScript declaration generation. Official validation requires
explicit formats and coerce:false for Night's contract; extreme generated schema
depth can fail compilation and must fail closed.

Codemode declaration/execution support is separate from the requirement that
sessions and context use Pi. Official QuickJS execution and the existing optional
Node worker/Python presentation have different capabilities. This inventory does
not authorize replacing or expanding those runtimes or treating their differences
as a blocker for official session adoption.

## Direct AgentSession assembly checkpoint

`src/runtime/pi-official-session.js` now assembles the public AgentSession,
ModelRuntime, native SessionManager store, official resource loader and actual
custom tools. It is an integration seam, **not the default application factory**.
The real integration test executes a tool, commits its receipt, cold-reads and
reopens the session without model/effect replay. Native store tests separately
cover fsync/prefix/lease rules. Controlled commit-barrier tests establish that
the awaited public agent subscriber runs after SDK append and before effects.

The prompt wrapper returns the original typed policy failure after the official
extension runner aborts: extension exceptions alone are swallowed by Pi. Real
signed-memory tests verify zero provider dispatch and unchanged native signatures.
Forgetting the fact succeeds; subsequent inference through the affected signed
context remains blocked. Whole-turn exclusion and paired tool-result omission
remain explicit alternatives, never an automatic loss of history.

Night business ports are bound to actor object identities for approval, cwd and
sandbox state; equal IDs and arbitrary options do not grant capabilities. Native
task archives preserve original Pi bytes and typed task identity. Legacy event
inspection and maintenance proof cannot interpret native receipts yet and reject
explicitly. Native read paths return official projections and business audit,
without manufacturing an empty legacy events array.

Remaining default-switch work includes durable task/schedule admission and
effect reconciliation, all business consumers, tool supplemental packets,
background memory extraction, and explicit old Night-to-native upgrade. Settings
must be supplied explicitly: the legacy unlimited/custom-code retry policy is
not claimed identical to public SDK retry settings. No DSH notice is removed at
this checkpoint. See `pi-official-session-integration-validation.json` for results
and the distinction between targeted and complete regression runs.

## Official source

- [Session manager, v1.5.0](https://github.com/earendil-works/pi/blob/v1.5.0/packages/coding-agent/src/core/session-manager.ts)
- [Message conversion, v1.5.0](https://github.com/earendil-works/pi/blob/v1.5.0/packages/coding-agent/src/core/messages.ts)
- [Agent configuration and hooks, v1.5.0](https://github.com/earendil-works/pi/blob/v1.5.0/packages/agent/src/types.ts)
- [Coding-agent SDK, v1.5.0](https://github.com/earendil-works/pi/blob/v1.5.0/packages/coding-agent/docs/sdk.md)
