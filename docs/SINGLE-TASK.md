# One execution session per task

In the portable Night Bot kit, a task has one durable Pi execution session. It
uses native file, shell, web, memory and skill tools directly, and commits
`task_result`. There is no task coordinator/owner conversation, delegate tool,
execution team or child-execution driver. The default portable preset also omits
subagent tools. First-tier triage only decides handling and short replies. The
conversation's durable Router arranges tasks and assesses their results; neither
role is an additional task execution session. Topic is no longer an active routing
entity. A retrospective is a separate tool-free
model request after completion, not another execution session.

The authoritative task ledger owns creation, requirement/control versions,
claim/drain, cancellation, waiting and terminal completion. `createTask` starts the
single session when its execution conditions permit; a trusted typed `channel`
envelope retains the sender and room/private scope. Router actions retain direct,
versioned source references rather than taking authority from a Topic or a handoff
summary. Dependencies gate scheduling and claim independently of pause/cancel;
completion needs a current authorized assessment before dependent work can run.
A stable request ID prevents duplicate creation. Cancellation
changes control, aborts the live turn, drains it and never creates a replacement.
Restart uses the existing task session ID and Pi journal. Task sessions are not
resumed by the ordinary conversation/reminder controller.

仅有 Web 来源的 `createTask` 即使关联 `groupId`，也允许在任务内持久保存 `requester` / `waiting-reply` 问题；`groupId` 不创造真实 IM 来源、引用、成员身份或群交付许可。没有真实群来源时不发群、不回退操作者私聊，也不能宣称已通知；旧 Topic 错误码不构成拒绝整个 Web 提问的合同。有权 Web 答复仍校验已认证 `webActor`、原任务及 `humanRequestId`、当前要求/控制版本 CAS，持久记录真实新来源后沿原执行 session 续办。

Task workspaces are `data/workspaces/tasks/<task-id>/`, with materials, work,
outputs and temporary task-local material separated inside that owner directory.
Task Pi journals live under the task `sessions/` directory, outside model file
access; ordinary conversations remain in `data/state/sessions`. New portable tasks
do not install the old workspace `.dsh` journal router. Task model writes are
confined to `work/` and `tmp/`; frozen delivery bytes/descriptors live in `outputs/`.
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
actual upload/readback belongs to the optional channel.

Router 最终交付另经 `resident_router_reply.taskDelivery` 显式选择该任务当前完成版本的冻结 artifactId，先查询 `completion.result.artifactFiles`，不自动附全部产物，也不允许传路径或自造 descriptor。Host 重新核对原来源、任务版本与 manifest；最终说明和原文件名/caption 进入该任务的父子通知，说明确认送达后才发送附件。任务完成、文件冻结、Router settle 和 transport 送达分别记录；未知发送继续回读，恢复 hold 不解除。

Local tests exercise the
real single-session completion and reject unreported files and path/link escapes.

The task directory is independently sealed/backed up through [TASK-ARCHIVE](TASK-ARCHIVE.md).
SQLite stays authoritative; restore is paused and cannot authorize effect replay.
