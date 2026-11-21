# One execution session per task

In the portable Night Bot kit, a task has one durable Pi execution session. It
uses native file, shell, web, memory and skill tools directly, and commits
`task_result`. There is no task coordinator/owner conversation, delegate tool,
execution team or child-execution driver. The default portable preset also omits
subagent tools. New channel messages go straight to the durable Router. It
decides what needs work, relays the request and sends the result; it is not
another task execution session. Topic is no longer an active routing
entity. A retrospective is a separate tool-free
model request after completion, not another execution session.

## 目标推进

- **先对齐结果。** 从当前要求和已有材料确定要交付什么、实际对象和限制、什么证据能证明做完。改动前先看现状；默认猜测、历史线索和其他版本的结果不当成当前事实。
- **按复杂度规划。** 简单任务直接做；有多个环节、依赖或明显不确定性的任务，在同一会话用短计划记下各环节的结果、先后依赖和验法。优先核实会让后续返工或扩大影响的假设；新证据改变了判断，只调整剩余计划。续办沿当前要求和已核实证据，从首个未完成的环节接着做。不要求提交计划、建子任务或新增审批。
- **取证后推进。** 用现有工具做能推进结果、验证结果或解除阻塞的最小一步。够用就行动，不旁查无关问题。用实际结果或可靠回执验证用户要的结果；已调度、已接纳和中间环节通过不等于最终成功。若现有信息已足够回答且不需行动或验证，直接提交 `task_result`。

## 排查和补问

失败时先读实际结果，核对走的是哪个对象、版本和路径。选一个能区分可能原因的小检查，再根据结果继续原路径、改走获准的独立路径，或先做不依赖卡点的工作。换命令但仍经过同一失败环节，不算独立证据。允许在隔离环境或对照资料上验证能验证的部分，但不得以此证明现场结果。不盲目重试，不绕过拒绝、不复用未经确认范围的访问权，也不重放效果未知的调用。

执行不主动提问，也不向 Router 或渠道播报中间进展。只有没有能实质推进当前目标的获准步骤时，才提交 `task_result(blocked)`，说明已证实的部分、实际缺少的前提和还未到达的检查；不把任务本身可以产出的材料列为前提。`question` / `audience` 已从执行工具移除，Host 与账本也拒绝新建问询。用户主动补充仍由 Router 判断是否恢复原执行会话；补充本身不批准工具调用、不扩大权限。旧待答记录和已冻结通知保留原身份、回执及恢复边界，不转换、不新建自动追问。

任务完成或确实无法继续时，Router 默认把可用结果和必要卡点送回原渠道。用户只说不用发文件时，仍反馈文字结果；明确要求不发结果才静默。普通等待或运行时巡检不是执行结论；已排空的技术失败可由 Router 说明本轮停止原因，但不代写业务结果。

## 执行生命周期

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

任务只在 Pi 原有压缩时机使用任务摘要，保留当前目标、必需验收、已核实的决定、未决问题和原证据入口，方便同一会话从下一项待验证工作继续。摘要不替代原始历史、当前授权或效果回执，也不触发额外的审核或重试。

任务技术停下时，记录本轮最后的模型结果：请求超时、输入超限、供应方明确拒绝和正常返回但没有提交结果应分开看，不用一次后来恢复的报错解释最后的停止。技术等待不是业务结论，不增加自动续办。详见[输入与重试](PI-TASK-INPUT-AND-RETRY.md#retry-behavior)。

关联 conversation 的任务带问题等待后，常驻 Router 负责判断真实补充是否足以继续；`resident_task_action(kind: "resume")` 绑定原 `humanRequestId`、来源/任务版本和判断理由，Host 校验后原子保存补充及 answered 状态，再通过原 session 的普通执行输入接纳。普通 supplement 保留等待，不启动执行侧重复语义复核。任务原要求、权限模式、单调用批准、依赖与未知效果对账保持不变；未关联 Router 的既有人工答复路径不变。

执行输入 `packet.task.dependencies` 仅包含当前任务的真实入边：依赖条件、匹配的当前前置完成记录、原完成事件引用与评估，以及授权来源的 `sourceId` / `messageVersion` / `actorId`。Host 在入模前核对要求、控制、安排及前置完成版本和事件一致性，拒绝旧评估或版本错配；首次执行与 Router、Web 两条实时补充路径复用同一构造器。该依赖字段不复制前置任务会话、完整来源正文或全依赖图；上下文说明不创造授权，调度、claim 与 CAS 仍由 Host 强制校验。

仅有 Web 来源的任务同样不主动创建待答问题。已有历史 `requester` / `waiting-reply` 记录仍可只读追溯，并由有权 Web 答复校验已认证 `webActor`、原任务及 `humanRequestId`、当前要求/控制版本 CAS；真实补充沿原执行 session 接纳。`groupId` 不创造真实 IM 来源、引用、成员身份或群交付许可；没有真实群来源时不发群、不回退操作者私聊，也不能宣称已通知。

未关联 `groupId` 的 Web 任务也可由配置的 `webActor` 答复等待问题、补充上下文、修订或重开：新输入沿用创建时的 `task:<taskId>` 来源作用域，不要求订阅群，也不将该作用域注册为渠道群。关联 `groupId` 的任务仍校验原群订阅；版本 CAS、稳定请求去重和原执行 session 续办规则不变，取消仍直接走任务控制；这些入口均不创造 IM 来源、群身份或外发许可。

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

活跃任务接收原会话 steer；不活跃时唤起原会话并交付新输入。过去租约的未知回执留在
历史里，不阻断独立的新调用或当前目标的独立验证。当前轮未决效果、活跃进程和未释放资源
仍须核实。旧记录缺终态不证明曾运行或已退出；provider retry、换 call ID 或恢复目录
都不授权重放原调用。部分效果可能已发生，必须如实报告。

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

### 任务期间面向人的对外输出

所有执行会话的 `task:reply-scope` 都带共享 ELI5 原则和 `communication/v1` 索引，渠道关联任务另带渠道边界。面向人的正文直接按规则写：先说关键结论，用日常词解释必要的技术词，保留已确认和未核实的边界。`communication_guidance_read` 按需补充详细规则。它同时约束过程反馈、最终渠道回复、Issue/PR 描述与评论、代码审查回复，以及通过工具、CLI、API 提交的这些正文。围绕当前读者和线程写具体结论、进度或问题；版本、环境、验证证据、风险和未验证事项仅在影响判断或应读者要求时展开；需要区分对象时直接在结论里说清，不重复问题或正文已交代的范围，也不照搬调查记录。仓库模板、必要技术结构、复现步骤与明确要求的详细报告继续保留，机器参数、协议、原始记录和审计不改写。

普通执行只在有最终成功或真实阻塞结果时交回 Router，由 Router 按原目标核对，再依既有来源、受众、权限和回复时机决定对外回复。阻断结果写明实际尝试、眼下阻断下一步的条件和证据，区分未走到的后续检查；本任务应当且获准产出的内容，不要求事先提供。显式用户任务对话仍可只读答复；历史非 Router 待答的只读核查可记录来源与条件，不新建自动渠道追问，不解除本轮只读限制，也不使用额外模型复核。

沟通规则不授予外发权限：草稿和发布分开，发布仍核对目标、可访问范围、秘密和当前授权；未知提交结果先回读，不为了改措辞重复发帖。渠道引用/署名机制不自动扩展到 GitHub 评论。测试验证正式执行请求及后续工具轮次携带规则，并回归既有效果/权限边界；不向真实 Issue/PR 发送测试评论，脚本模型不能证明真实模型每次正文都合规或自然。

读取入口复用现有工具注册与 Pi 原生工具执行/结果循环，仅返回应用内固定的版本化沟通规范，不接受文件路径、URL 或业务查询参数。它不调用模型、不读业务材料或创建副作用；任务只读/未知效果场景按原定义身份绑定为观察工具，同名替换不继承豁免。是否按索引触发阅读仍由模型判断，程序不以内容模板强制外发或自动重发。
