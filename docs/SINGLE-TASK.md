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

执行输入 `packet.task.dependencies` 仅包含当前任务的真实入边：依赖条件、匹配的当前前置完成记录、原完成事件引用与评估，以及授权来源的 `sourceId` / `messageVersion` / `actorId`。Host 在入模前核对要求、控制、安排及前置完成版本和事件一致性，拒绝旧评估或版本错配；首次执行与 Router、Web 两条实时补充路径复用同一构造器。该依赖字段不复制前置任务会话、完整来源正文或全依赖图；上下文说明不创造授权，调度、claim 与 CAS 仍由 Host 强制校验。

仅有 Web 来源的 `createTask` 即使关联 `groupId`，也允许在任务内持久保存 `requester` / `waiting-reply` 问题；`groupId` 不创造真实 IM 来源、引用、成员身份或群交付许可。没有真实群来源时不发群、不回退操作者私聊，也不能宣称已通知；旧 Topic 错误码不构成拒绝整个 Web 提问的合同。有权 Web 答复仍校验已认证 `webActor`、原任务及 `humanRequestId`、当前要求/控制版本 CAS，持久记录真实新来源后沿原执行 session 续办。

未关联 `groupId` 的 Web 任务也可由配置的 `webActor` 补充上下文、修订或重开：新输入沿用创建时的 `task:<taskId>` 来源作用域，不要求订阅群，也不将该作用域注册为渠道群。关联 `groupId` 的任务仍校验原群订阅；版本 CAS、稳定请求去重和原执行 session 续办规则不变，取消仍直接走任务控制；这些入口均不创造 IM 来源、群身份或外发许可。

Task workspaces are `data/workspaces/tasks/<task-id>/`, with materials, work,
outputs and temporary task-local material separated inside that owner directory.
Task Pi journals live under the task `sessions/` directory, outside model file
access; ordinary conversations remain in `data/state/sessions`. New portable tasks
do not install the old workspace `.dsh` journal router. Task model writes are
confined to `work/` and `tmp/`; frozen delivery bytes/descriptors live in `outputs/`.
File/process fences expose only the current task/conversation workspace, not other
users' workspaces. Linux system dependencies stay read-only. The generic task API
and the model cannot choose an external business directory.

潜在写入工具调用前，runtime 先持久提交 intent，成功结果在下一步前记账。
新 v2 intent 绑定实际官方 session、assistant entry、call ID、已接纳 input entry、
packet digest 和原任务绑定；同一次已登记调用不可再次执行业务效果，不按工具名/参数
或要求、上下文、控制版本相同来全局拒绝独立调用。当前授权目标需要时，独立实际 call
可以同参；不同命令文字也不证明业务效果不同。原 Night v1 收据只在实际原输入和调用
唯一匹配时读取，不改写历史，歧义保持阻断，详见 [输入与重试](PI-TASK-INPUT-AND-RETRY.md)。

崩溃后的未决 intent 以 `TASK_EFFECT_UNCERTAIN_NO_REPLAY` 阻止自动继续；最终结果
还要求没有活动后台 job。未知外部效果须对账；provider retry、换 call ID 或恢复目录
不授权重放，已对账旧效果的新动作仍须真实新来源授权。取消或工具失败可能已有部分
效果，须如实报告。

Completed tasks trigger the independent scoped retrospective. Failure to learn or
send a notification cannot reverse task completion. 旧任务 Owner/多执行 session
驱动已退休；保留历史审计或只读原始核验输入不恢复这些 driver、工具或 ABI，也不把
旧执行行当作原会话续办命令。本项目不提供旧 DSH 插件/任务团队数据导入或迁移。

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
