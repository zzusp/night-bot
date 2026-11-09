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

当前消息入口按“认证来源 → 轻量一级分诊 → conversation Router → 唯一任务执行会话”分工。分诊只决定转交/短回复；Router 通过受控动作安排事项并评估结果，不能直接执行业务脚本。Topic 不再作为活动路由实体，旧 Owner/团队路径不因更换会话而恢复。

Host/SQLite 保持直接来源、依赖、动作收据、内部事件和 active generation 的权威。依赖满足必须绑定当前授权、任务版本与证据，`completed` 和通知送达各自独立。Router 空闲交接时先通过 admission 完成无工具总结及 Pi 提交，再维护、准备新代并 CAS 发布；禁止在暂停 admission 后才请求模型，禁止绕过 admission 直接投递 custom message。旧 journal、未知效果阻断和严格提交证明继续保留。

完整职责与失败恢复见 [CHANNELS](CHANNELS.md)，本次版本的实际验收见 [任务入口](acceptance/resident-conversation-routing/goal.md)；此前阶段计数和 Topic 测试不替代本轮证据。

## Current portable application composition

The supported CLI starts `src/application.js` with channel-neutral resource and
notification interfaces. `src/channels/service.js` owns authenticated `chat` and
`chat-room` namespaces; optional `channelPlugins` register vendor capabilities.
DWS is loaded only by `src/channels/plugins/dingtalk-dws.js` when enabled. The
historical DWS resident remains attributed reference code, not the CLI entry.

The installation layout, scoped Markdown memory, durable task retrospectives,
single task execution session and handling/reply-only first-tier triage are documented in
[DATA-LAYOUT](DATA-LAYOUT.md), [MEMORY](MEMORY.md), [SELF-EVOLUTION](SELF-EVOLUTION.md),
[SINGLE-TASK](SINGLE-TASK.md) and [CHANNELS](CHANNELS.md). Reference-domain tests still
cover historical API contracts; current default wiring has separate portable Host
and real local Pi-protocol tests. Neither test category proves live vendor access.
