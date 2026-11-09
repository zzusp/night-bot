# Session driver retirement evidence

This records contracts, not an assertion that every historical test has migrated.
Pi 1.5 public `AgentSession`, `SessionManager`, `buildSessionProjection` and
`convertToLlm` own inference, history, context and message projection. Night owns
strict committed storage, routing, authorization and typed business receipts.
No DSH history import is introduced.

## Retired query and title slice

Removed `native-session-query.js`, `runtime/committed-session-query.js` and
`runtime/session-image-selection.js`. No default production consumer called these
services. The remaining static query callers belonged to the cancelled legacy
subagent driver. `fixed-topics-native` unnecessarily installed query without using
it; that registration was removed. The current task observation contract uses
`readNative`, not fabricated `events` or a mutable Session.

| Removed tests/contracts | Current evidence or explicit cancellation |
| --- | --- |
| `pi-native-session-query-journal`: cold source authority, writer isolation, byte preservation | `task-session-follow-conflict-native`: real Single finishes, strict `readNative` compares entries/audit/bytes/registry, controller and direct open reject task writer acquisition, next Host lease resumes same identity. |
| Same file: copied portable paths/context | `pi-native-store`: native portable copy restores cwd without rewriting original Pi bytes or user text. `pi-native-task-archive`: actual archive/backup/restore retains task identity and explicit portable codec. |
| `pi-native-committed-query`: official sourceEntry/messages, branch/compaction/context-edit preservation | `pi-native-store`: direct official commit, compaction+branch summary, context edits, cold reopen; compares official projection/messages. `pi-native-observation-read`: read result equals public `buildSessionProjection` exactly. |
| Same file: committed cut, pending manager data excluded, independent snapshots, no flush | `pi-native-store`: `readNative uses committed cut without flushing live manager or copying authority`; byte and manager pending-message checks remain. |
| Same file: physical tail | Native strict mode rejects rather than silently observing the prefix: `pi-native-store` open rejects tail; `pi-native-task-archive` strict maintenance rejects tail; `pi-native-observation-read` direct read rejects tail and preserves bytes. This is a deliberate stronger native-format contract. |
| Query files: cancellation and no writer acquisition | `pi-native-observation-read`: pre-abort performs zero file checks; gated in-flight cancellation rejects result, preserves writer ownership and bytes, competing open remains refused. `pi-single-task-official`: cancellation joins actual SDK and disposal. |
| `pi-native-session-query`: cache revisions, retain/release, synthetic interrupted-turn closers, checkpoint hydration, self-disposal | Explicitly retired with the unused query service. Current `readNative` returns a detached snapshot with no observer lease/cache/service lifecycle, no synthetic turn events, and no Session publication. These exact obsolete APIs are not claimed covered by native storage tests. Actual actor cancellation/drain remains independently tested. |
| Query files: header/source races and lineage | Native store validates journal/header/identity; task router and `task-session-follow-conflict-native` retain exact task binding and writer refusal. Fake backend revision races and custom event-index lineage pagination were properties of the removed cache; no replacement cache or generic query ABI is added. |
| `pi-native-image-selection`: event-folded visibility/offload/reattach state | Explicitly retired unused model-history algorithm. Official projection determines native history. Original image preservation/independent read snapshots are in `pi-native-observation-read`; actual request image privacy/budgets, signed-message refusal and abort are in `pi-request-image-budget`. This does not claim old image/offload event decisions are replayed into Pi history. Night old audit codec remains readable independently. |
| `pi-native-session-title`: legacy normalization/fallback/provider differential | Retired custom history-based title/provider protocol and comparison fixture. `pi-session-names` tests real SDK name entries, receipt validation, default-off automation, explicit approved public labels, immutable pin, secret/control/budget rejection, cancellation and actual inference drain. Old automatic title derivation from raw history and old provider registration ABI are cancelled. |

The first slice's official storage/business tests no longer instantiate
`NativeSessions` merely to produce a header: they use the same explicit Night
header envelope as `OfficialAgentFactory`. They retain real Pi managers, strict
native commits and original negative assertions.

Validation is recorded separately by the integrator. Targeted new observation
checks: `/tmp/night-official-observation-retirement.tap` (3 passing). Initial
query/title regression: `/tmp/night-retired-query-title.tap` (33 passing).

## Attribution boundary

The removed query algorithms have no remaining copied query implementation in
`src` or `packages`; strings in the old subagent driver are dependency references,
not copies. The removed title implementation has no remaining title service copy.
However `src/native-capability-errors.js` retains the source-derived public
`SessionTitleInvalidError` vocabulary, so title attribution cannot be dropped on
the strength of deleting the service alone. The old title comparison fixture is
removed. The image projection removed here was Night-owned; the earlier legacy
image-offload source directory was already absent. `native-message-protocol.js`
still documents historical image/offload audit records; that is not a Pi history
projection. Public notice/license/manifests are maintained by the root integrator.

## Remaining driver work, not completed evidence

`native-sessions`, mutable `Session`/surface state and the old generic writer are
still required by unmigrated Night audit/backup tests. Keeping a read codec does
not justify keeping a model-history writer. Tests must split strict Night backup
reading from inference and use native fixtures for retained business contracts.

The old `openResidentRuntime` Owner/leaf driver has no default production caller.
Its `runtime-mixed` fixture serves `runtime.test`, `runtime-history`, and
`performance-runtime`: these contain a mixture of cancelled Owner/member/stage
architecture and still-required source admission, human review, effect recovery,
notification readback, cancellation/drain and configuration contracts. They are
not deleted or counted passing merely because the driver is obsolete. One live
contract needing a current production port is timezone-only agent configuration:
the old runtime supports it, while the current task resident facade did not at
this checkpoint. No codec is extracted to keep old Owner/leaf behavior alive.

The shared `task-session-native-host` fixture now uses the real installed official
Host. It does not convert obsolete task_delegate/execution_submit calls or invent
Session/steer/history facades. Historical scripts which still request cancelled
architecture need explicit test migration; they are not silently translated.
