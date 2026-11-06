# Native runtime and compatibility boundaries

Pi agent-core1.5.0 owns inference/tool iteration. Pi coding-agent SessionManager
owns current branch context and checksummed single-writer history. App-owned
services enforce authorization, side-effect intent/result receipts, bounded
concurrency, commit-before-idle and restart fencing. An uncertain terminal commit
fails the instance; completed effects are not redispatched on recovery.

No external registry DSH runtime packages remain in a production-only install.
Default Host composition mounts49 locally owned replacements and native spill/
configuration support. Generic Cordis/schema/native-system libraries remain
ordinary dependencies, rather than a DSH Host. Public legacy package names map
explicitly to local owners/protocols; SDK ABI metadata is separate from Pi/app
versioning. Original Runtime classes exist only in independent test references.

Compatibility intentionally retained:

- The event/audit/publication/inbox façade preserves source business APIs and
  strict receiver/ownership semantics. Its surface fold is not model context.
- Released v0–v4 codecs preserve historical readers, adjacent migrations,
  relationship validation, corruption refusal and plain/zstd import. The app
  writes current history through Pi; legacy IO is isolated import support.
- The verifier is an isolated ESM worker using the shared owned verifier. It
  validates physical bytes, logical identity/count, prefix and complete assistant
  streams, without the old bundled model Runtime.
- Windows ACL/process support retains exact MIT source provenance and low-level
  flags. Managed restart evidence binds native source paths and reviewed LF/CRLF
  hashes. Explicit legacy deployment probes remain separate compatibility input.

The source façade/format code is not presented as newly invented algorithms or
additional active-service replacement credit. Original/target hashes, rewrites,
licenses and release-generated golden byte fixtures are retained for review.

Functional mapping and acceptance limits are in MIGRATION.md and VALIDATION.md.
Real DWS/vendor/business, Windows/macOS kernel and optional Claude/browser/plugin
integrations require their own installed, authorized environment. No current
result claims that external acceptance has occurred.

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
