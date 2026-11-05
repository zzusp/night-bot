# One execution session per task

In the portable Night Bot kit, a task has one durable Pi execution session. It
uses native file, shell, web, memory and skill tools directly, and commits
`task_result`. There is no task coordinator/owner conversation, delegate tool,
execution team or child-execution driver. The default portable preset also omits
subagent tools. Topic dialogue and the two routing tiers are conversational roles,
not additional task execution sessions. A retrospective is a separate tool-free
model request after completion, not another execution session.

The authoritative task ledger owns creation, requirement/control versions,
claim/drain, cancellation, waiting and terminal completion. `createTask` starts the
single session directly; a trusted typed `channel` envelope retains the sender and
room/private scope. A stable request ID prevents duplicate creation. Cancellation
changes control, aborts the live turn, drains it and never creates a replacement.
Restart uses the existing task session ID and Pi journal. Task sessions are not
resumed by the ordinary conversation/reminder controller.

Task workspaces are `data/workspaces/tasks/<task-id>/`, with materials, work,
outputs and temporary task-local material separated inside that owner directory.
Raw Pi journals live in `data/state/sessions`, outside model filesystem access;
new portable tasks do not install the old workspace `.dsh` journal router.
File/process fences expose only the current task/conversation workspace, not other
users' workspaces. Linux system dependencies stay read-only. The generic task API
and the model cannot choose an external business directory.

Before a potentially mutating tool call, the runtime durably records an intent;
a synchronous tool result gets a durable result record before the next step.
Repeating the same tool/arguments in the same requirement/context/control version
is denied as already attempted. An unresolved intent after a crash blocks
automatic continuation with `TASK_EFFECT_UNCERTAIN_NO_REPLAY`. A final result also
requires no live background jobs. This is conservative protection for identical
calls, not a proof that two differently worded commands have different effects.
Unknown external effects require reconciliation; a provider retry or directory
restore is not authorization to replay them. Cancellation/failed tools can have
partial effects and must be reported honestly.

Completed tasks trigger the independent scoped retrospective. Failure to learn or
send a notification cannot reverse task completion. The older multi-execution
source remains attributed, inactive compatibility/reference code for explicit-root
tests; the supported portable composition does not construct those drivers, expose
their tools or accept their existing execution rows. This is a new project, so no
old plugin/task-team data import or migration is supplied.

Final file delivery selects only explicitly reported files under that task workspace.
The Host checks physical scope (including links), freezes original bytes with a
digest, and validates task/version ownership before preparing channel delivery.
Later edits do not change the frozen artifact. Selection is not a transport receipt;
actual upload/readback belongs to the optional channel. Local tests exercise the
real single-session completion and reject unreported files and path/link escapes.
