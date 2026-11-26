# Native runtime and compatibility boundaries

Pi agent-core1.5.0 owns inference/tool iteration. Pi coding-agent SessionManager
owns current branch context and checksummed single-writer history. App-owned
services enforce authorization, side-effect intent/result receipts, bounded
concurrency, commit-before-idle and restart fencing. An uncertain terminal commit
fails the instance; completed effects are not redispatched on recovery.

生产依赖不含外部 registry DSH runtime 包。默认 Host 接入仓库内服务与官方 Pi；
Cordis、schema 和平台系统库仍是通用依赖。原 `packages/capability-compat`、
`packages/scope-compat` 已移除，不再要求靠旧包名 reexport 维持部署 ABI。
历史模块计数不是当前装配数量，来源与变化以实际 manifest/guard 为准。

## 当前保留与退休边界

- Pi 是当前历史、消息、上下文与推理权威。Host 保留业务事件、来源授权、严格提交、
  writer/owner 栅栏和副作用收据；这些职责不恢复 v4 publication/inbox façade。
- DSH v0–v4 codecs、转换器、format catalog、旧 verifier worker 和历史数据导入均已退休。
  Runtime 与离线维护仍须使用同一严格 Pi journal 解码，拒绝未提交尾并显式校验可移植路径。
  Night Bot 自身任务档案的封存/备份/受控恢复见 [TASK-ARCHIVE](TASK-ARCHIVE.md)，不导入旧 DSH 数据。
- 旧任务 Owner 的 controller/session 执行模块已移除。历史审计和只读原始核验输入不恢复
  任务团队、多执行会话、旧 driver 或旧 ABI。
- Windows ACL/runner 使用 `src/process/windows-acl.js`、`src/process/windows-acl-runner.js`，
  继续保留派生来源与 MIT notices。ACL 迁接只是部分实现；Windows 模型子进程 privacy
  尚未具备可生产接线，缺失时失败关闭，不由静态 guard 或普通文件工具通过推断内核隔离。
- 当前受管入口为 `pnpm start <CONFIG>`（`bin/night-bot-run.js`），组合 `src/application.js`；
  Web 与渠道须显式配置可选插件。旧 `start-web.ps1`、`restart-web.ps1`、
  `recover-data-change-approval.ps1` 和 `web-module-loader.cjs` 已退休，不能当作现行运行命令。

仍保留的派生算法继续署源，原始/目标哈希与许可供复核；静态来源守卫不等于功能验收。
现行映射见 [MIGRATION](MIGRATION.md)，当前源码版本、工作树和实际验收见
[唯一目标](acceptance/resident-conversation-routing/goal.md)。历史结果见 [VALIDATION](VALIDATION.md)；
DWS/厂商/业务系统、Windows/macOS 内核和可选 CLI/插件的结果按各自安装、授权和受验版本成立，
不能将某一集成的通过推广到其它平台、账号或本轮全量。

NativeSchedule is a default Host service, with local NativeSessionController for
ordinary cold-session activation and four session-bound model tools. Calendar,
record and update algorithms retain explicit MIT provenance; no registry DSH
service or remote controller is loaded. Pi retains history and inference authority.
An occurrence enters a durable Pi inbox before its schedule receipt, and the model
wakes only after both commits. Stable message identities and frozen recurrence
metadata recover partial batch commits without reenqueuing a completed effect.
Shutdown preserves unclaimed reminder input; explicit cancellation still clears it.
The CLI starts timers after Resident has mounted source/permission/delivery gates.
Receipts acknowledge inbox delivery, not model/business completion. Unknown tool
effects continue to require the existing reconciliation evidence rather than replay.

Default Host startup now checks every mandatory service read by the retained core.
`nativeJobRecovery` remains an optional trusted isolation authority: its absence
refuses that special proof path; it is not permission to fabricate process proof.
All other optional provider integrations retain their own explicit admission.

## 常驻 Router 与执行边界

当前消息入口按“认证来源 → conversation Router → 唯一任务执行会话”分工。不运行前置分诊或自动收悉；Router 通过受控动作安排事项并评估结果，不能直接执行业务脚本。Topic 不再作为活动路由实体，旧 Owner/团队路径不因更换会话而恢复。

Host/SQLite 保持直接来源、依赖、动作收据、内部事件和 active generation 的权威。依赖满足必须绑定当前授权、任务版本与证据，`completed` 和通知送达各自独立。Router 持续复用当前 Pi 会话，空闲和任务完成不再触发交接模型轮；Router 采用472,000 token目标预算（不超过模型真实窗口），60%后台压缩、80%原生前台压缩兜底；小窗口优先保留原生输出余量。旧部署已持久交接仍经严格提交证明、候选准备及 CAS 发布恢复；新代提交前不得处理业务。旧 journal、未知效果阻断和唯一业务 owner 继续保留。

完整职责与失败恢复见 [CHANNELS](CHANNELS.md)，本次版本的实际验收见 [任务入口](acceptance/resident-conversation-routing/goal.md)；此前阶段计数和 Topic 测试不替代本轮证据。

## Current portable application composition

The supported CLI starts `src/application.js` with channel-neutral resource and
notification interfaces. `src/channels/service.js` owns authenticated `chat` and
`chat-room` namespaces; optional `channelPlugins` register vendor capabilities.
DWS is loaded only by `src/channels/plugins/dingtalk-dws.js` when enabled. The
historical DWS resident remains attributed reference code, not the CLI entry.

The installation layout, scoped Markdown memory, durable task retrospectives,
single task execution session and direct channel-to-Router ingress are documented in
[DATA-LAYOUT](DATA-LAYOUT.md), [MEMORY](MEMORY.md), [SELF-EVOLUTION](SELF-EVOLUTION.md),
[SINGLE-TASK](SINGLE-TASK.md) and [CHANNELS](CHANNELS.md). Reference-domain tests still
cover historical API contracts; current default wiring has separate portable Host
and real local Pi-protocol tests. Neither test category proves live vendor access.

## 会话执行中的安全并行与等待

所有具备原生工具的官方会话共用 `runtime/parallel-read.js` 的短规则：以数据与资源依赖安排同批调用，不按工具名推断安全性。Pi 仍负责工具批次；Host 原有 `ToolLeases` 按真实注册定义的 `isConcurrencySafe`、FIFO 写屏障和 `maxParallelToolCalls` 控制工具调用，并行规则本身不新增会话或调度底座。短命令前台；长作业仅在能与其他已授权步骤重叠时后台，提交后先做独立工作，依赖结果时再等通知或阻塞读取，不忙轮询。后台 ID 不等于完成。既有 bash 默认 `enableRunInBackground=true`、`promoteOnTimeout=true`（后者还受前者约束），本轮不改开关；明确关闭仍拒绝后台参数。真实脚本夹具使用显式 full 权限，只验证作业生命周期与重叠，不证明 ask/auto 的 OS 隔离。

| 路径 | 实际能力与本轮处理 |
|---|---|
| Router、普通原生会话、任务执行 | 共用官方 context 注入；没有原生工具时不注入，不增加工具。Router 动作/回执和任务结果仍互斥；任务仍只有一个执行所有者；普通执行轮可用 [临时只读子代理](SINGLE-TASK.md#临时只读子代理)，旧委派与子执行工具不恢复。 |
| Router 只读工具 | 明确声明任务、来源、回复、当前配置与排期列表可并行；每调用仍校验会话身份/当前 generation。`platform_task_query` 会更新分页消费状态，继续互斥；记忆/Skill 读取、加载或维护也不凭名称放开。 |
| 普通文件/网页工具 | 原生文件只读与 web_search/web_fetch 本来已有安全声明。内置 HTTP 抓取的传输失败报告所在环节和已识别的底层错误码，不暴露底层原文，也不自动切换协议或路径。write/edit、shell、job_output/job_list/job_kill 等未因此自动放开。job_output 会消费读游标，wait 可能持有独占租约，取消/终态/通知/模型结果的原守卫保留。 |
| 诊断 | 独立官方 Pi 会话复用同一规则，只有原来的 diagnosis_evidence；证据别名、缓存和调查预算共享，未证明可重入，仍按 SDK 默认串行，不另建 Host 工具或放宽证据范围。 |
| Skill 生成 | 现有 creator 加载/起草流程复用规则；只有原有 creator 读取工具，先加载再起草的依赖不改变，没有新增委派或评测工具。 |
| 审批、复盘、压缩等无工具推理 | 不增加工具或伪造并行调用；原来的输入、证据与恢复边界保留。 |

Router 的 `conversationContext` 分阶段并行读取精确引用、来源→任务连接、回复索引与任务索引，返回次序确定；阶段容量取现有 Host 配置，单个阶段失败先等待已发读取结束再返回错误，不发布半份上下文。`currentEvents` 只在本次投影内复用，不跨请求缓存。单来源 latest 查询使用原有会话/消息/版本索引，调度分支不再做无用全会话扫描。新 `sourceTaskLinks` 保留来源版本绑定；`sourceQuoteLinks` 仅投影 Host 核验为 current 的精确引用。当前任务索引与准确绑定已足够时可直接安排，不机械先发模型查询；缺失、歧义、旧版本或需要完整要求/进展/完成证据时仍查询，引用不借出权限，Host 继续核对实际来源、版本与结清回执。

任务准备只并行已证明独立的阶段：缓存附件的受控路径/哈希校验、独立依赖边读取，以及材料处理后的 operation.list/execution.list。按现有 `maxParallelToolCalls` 限制单次读取阶段，保持输入顺序，失败等待已发读取退出。原本已有的多来源 Promise.all 不重复改造。未把操作、blocker 或依赖快照提前到不定时长的下载之前；多附件连接器下载、多任务材料发布、可写目录的产物范围、调度队列/wake 复查等仍按原序，缺少可重入或一致性证明时不盲目重叠。阶段内上限不等于所有任务/连接器的全局 I/O 上限。

验证入口：`pi-session-parallelism` 用显式 gate 验证真实原生 Router 查询同时在途、容量和写屏障；`pi-session-preparation` 验证实际任务准备重叠、精确绑定与旧投影对照下模型查询/请求次数；`pi-job-tools-wire` 的真实本地脚本验证后台提交→独立步骤→同作业取消/终态且不轮询输出。受控对照不是现场模型行为或百部耗时基准，不据此承诺真实延迟下降。
