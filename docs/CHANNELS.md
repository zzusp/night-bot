# 渠道协议、轻量分诊与常驻 Router

Night Bot supports two channel-independent conversation types: `chat` for one
person and `chat-room` for a room with multiple senders. DingTalk is an optional
adapter; no DWS executable is required for the core or local protocol tests.

Trusted adapters submit `{type, channelId, conversationId, senderId, messageId,
text}` and optional `senderName` / `conversationName` to `ctx.channels.receive`. The adapter authenticates these identities;
this is a Host API, not an unauthenticated public HTTP endpoint. Stable namespaces
separate channel providers, conversations, private senders and rooms. All authenticated bound sessions share the Bot memory/skills store; channel and
room identity remain source metadata. Every
room message retains its actual sender in durable source metadata and model input.
No other conversation transcript is injected. Models cannot select another principal;
shared memory is reference data, not identity or authority.

Display names are presentation metadata, never identity or permission keys. The
authenticated sender ID and recorded sender name remain together in durable
message sources and model input. A verified adapter can refresh a conversation's
display title without changing its binding or replaying its messages. Missing
names use neutral labels in the Web console; raw room/member IDs are not used as
display names. Recent Web history includes channel conversations using their own
stable routes and latest recorded activity.

Register an explicitly configured transport through
`ctx.channels.registerTransport(channelId, {send, readback})`. These functions
receive a typed envelope containing the original channel/conversation, a stable
`deliveryKey`, the exact `replyToMessageId`, `senderId`, text, `recipientIds` and
optional `replyToParticipantId`. Active notifications use Host-internal
`recipientActorIds` / `replyToActorId`; Channels verifies every selected actor in
the authenticated conversation before mapping them to transport participant IDs.
This validation also applies to `chat`, whose native `recipientIds` remains `[]`;
`chat-room` recipients are mapped from the same conversation's participants. Only
the vendor plugin translates these neutral fields into native send/quote flags.
A missing transport leaves delivery prepared with an explicit
maintenance error; it never falls through to DWS. Transport implementations must
retain idempotency/readback evidence and report uncertainty honestly. No connector
or real account is enabled by initialization.

A standalone Host supports scoped conversational turns. Once the real task service
is attached (the standard managed service composition), it owns the channel
triage ingress. Adapters must start ingress after that composition is ready and
stop it before shutdown. The current SDK supplies this integration boundary;
it does not claim integrations with all messaging platforms or install accounts.
Historical resident ingress/outbox projections retain DingTalk-named fields;
active notification DTOs and adapter delivery envelopes use the neutral fields
above. Existing payloads and digests are not renamed or migrated. Host
`channels.readResource('readMessage', ...)` checks the requested message and remote
conversation, then returns an internal `conversationId`, optional `actorId` and a
neutral `quotedMessage` with internal `conversationId`, optional `actorId` and
`text`; it does not expose top-level `groupId` / `senderOpenDingTalkId` as the
public identity contract. Transport-level `readMessage` still reports the original
channel conversation and authenticated sender for that conversion.

## 渠道职责配置

职责、助手设定和工作规范由可信部署配置提供，不从入站消息或任务摘要提取为配置。每个 `dingtalk-dws` 实例以唯一 `channelId` 绑定一个群聊或私聊；多群或多对端使用多个实例，不在一个实例中列出多个目标。公开 `config` 只接受 `dingtalk_*` 字段：

| 配置 | 含义 |
| --- | --- |
| `dingtalk_profile` | 必填的账号/组织选择器；运行时按真实登录资料解析，歧义拒绝任选 |
| `dingtalk_conversation_type` | 必填，`chat-room` 或 `chat` |
| `dingtalk_group_id` / `dingtalk_group_name` | 群聊目标，至少一项；不能同时填私聊目标 |
| `dingtalk_user_id` / `dingtalk_user_name` | 私聊对端 userId 或姓名，至少一项；不能同时填群目标 |
| `dingtalk_name` / `dingtalk_prompt` | 渠道名称与本会话职责、助手设定、规范；Prompt 可用 `""` 明确清空，省略表示未指定 |
| `dingtalk_account_mode` / `dingtalk_executable` | 可选账号存储模式与 DWS 可执行文件 |
| `dingtalk_listen` / `dingtalk_writes_authorized` | 监听默认 `true`，发送默认 `false`；关闭发送不关闭监听 |

可选 operator 字段及耐久绑定见 [插件接口](CHANNEL-PLUGINS.md)。原 `groups[].responsibility`、`config.responsibility`、`profile`、`listen`、`writesAuthorized`、`directChats` 等不再是钉钉公开配置字段；插件内部标准化别名和历史审计字段不构成旧配置兼容入口，不机械迁移历史记录。

配置只匹配本实例已认证的 conversation 类型、`channelId` 和目标 `conversationId`；私聊与群聊分别绑定，不借用其它会话职责。首次连接核对账号、组织、目标及对端身份并耐久绑定；未找到、多候选、资料不完整或后续身份不符均不得猜选。普通配置修改通过专用 CLI 离线保存，按 `restartRequired` 正常重启；保存不代表在线生效，也不验证真实登录、监听或外发。CLI 的 `--check` 不写盘、不调用 DWS；命令及环境导入见 [接入流程](ops/windows-local-runtime.md#指定钉钉群接入)。

标准任务服务把同一会话职责传入四个角色的系统指令：一级分诊 `channel-triage-scope`、Router `resident-conversation-scope`、执行会话 `task:group-responsibility`，以及按任务所属认证会话解析的独立无工具复盘。分诊与 Router 在每次系统指令编译时解析，执行和复盘在本次调用时取值；配置文字不进行模板插值，不混入用户事实，也不产生任务控制权、外发许可或跨会话记忆权限。职责配置不改变四角色分工、任务版本与依赖守卫。`task.completed` 只证明任务账本完成，不证明群消息或附件送达；复盘保留该证据边界。

## 轻量一级分诊

一级分诊只用本批原消息、已附带的引用/提及、认证身份及快速可得的本地信息判断是否需要处理、是否需要回复。它不拉长历史、不解析大附件、不拆分事项、不选择 taskId、不创建或控制任务。信息不足且需要进一步业务判断时转交 Router，不把未知记成无需处理。

每条来源版本有四种处置：

| 需要处理 | 简短回复 | Host 动作 |
| --- | --- | --- |
| 否 | 无 | 记录静默，不唤醒 Router |
| 否 | 有 | 准备短回复，不创建任务或唤醒 Router |
| 是 | 无 | 将完整原消息可靠转入 Router，自身不回复 |
| 是 | 有 | 独立推进 Router 转交与短回复，发送失败不阻断转交 |

短回复通常为一两句，保留来源版本、真实作者和精确引用。初步判断应说明尚未核实；问候或收悉无需强加暂定前缀。回复不能承诺尚未执行的工作或已验证的业务结果。每条消息必须有完整处置才可提交；模型失败或遗漏仍为待处理，不能自动变成静默。

程序负责以下边界：

- 一级分诊每批最多 15 条来源，溢出排队；批次封存前的新来源可 steer 到同一 Pi 会话，不重启分类会话。若同一消息的更高版本已可靠落盘，Host 取消并排空旧在途分诊，再重读仍有效的来源形成最多 15 条的新批次；不能放宽 latest 来源校验或让旧快照提交。旧的、不完整的模型提交不能覆盖更新后的批次。
- 提交前重新校验来源、作者、版本、引用和批次覆盖；分诊决定、Router 待消费引用及必要的回复意图具有稳定身份，恢复不生成另一份相同决定。
- 转交保留原消息、发送人、版本、引用和附件引用；原入站资源读取与阶段回调继续接入，按 residentStore 实际富化后的消息版本登记来源，不能拿旧版本继续提交。资源读取失败明确保留 unavailable，不伪造附件正文。分诊短回复或初判不能替代原消息。接纳表示可靠入队，不表示 Router 已处理或任务已完成。
- 回复正文冻结，编辑后的旧来源不能开启新发送。unknown-send 先回读，不因超时重新发送；同一来源版本不重复转交或确认。

## 常驻 Router 与事项直连

每个已认证 `chat` / `chat-room` 有一个稳定 Router 身份。渠道账号命名空间、conversation 类型和 ID 共同隔离；私聊继续绑定已认证对端。群内共享安排上下文，但每个动作按原消息真实发送人校验权限，不能因为标题相同合并其它群的任务。

Router 负责理解转入原话、拆分/关联事项、查询和调整任务、澄清歧义以及评估执行结果。它使用受控的任务查询、任务动作、记忆/Skill 读取和回复能力，不代替执行会话运行业务脚本或外部写入。每个任务只有一个执行会话，补充和返工沿用原任务；没有每任务 Owner 或执行团队。Topic 不再是活动业务实体。

Router 每批最多接纳 15 条转入用户消息，内部任务事件另有受限预算；同一 conversation 只允许一个活动业务轮次。任务完成、等待或变化事件直接进入 Router inbox，不再交一级分诊过滤。分诊处置游标与 Router 业务游标分别记录，单纯转交不会宣称后续动作完成。Router 查询分诊已准备/发送的回复，避免重复确认。

直连消息的观察状态也分阶段：分诊尚未提交为 `routing`；需要处理且 Router 事件尚未 settle 为 `processing`；Router 已消费事件才为 `processed`。无需 Router 的短回复/静默在分诊提交后完成其处置。通知状态独立展示，任务 `completed` 或一条已发送回复都不能代替消息处理终态。

“先 A 后 B”同时保存来源授权和 SQLite 依赖。创建 B 与其依赖必须原子完成，调度和 claim 都拦住未满足依赖。A 完成后，Router 读取当前版本、验收条件和真实证据，选择认可、继续 A 或等待补充；Host 再校验权限、版本、取消与未决效果，才允许释放 B。旧版本完成、重复事件或模型摘要不能创造权限。业务完成、依赖满足和通知送达分别记录。执行会话及实时补充仅接收本任务入边对应的当前完成证据、原事件/评估/条件和授权来源标识，入模前拒绝旧评估或版本错配；不复制前置会话、完整来源正文或全依赖图，见[单任务依赖输入](SINGLE-TASK.md)。

调整既有 B 的先后关系使用 `resident_task_action(kind: "arrange")`：提交真实来源、B 当前要求/控制版本、`expectedArrangementRevision` 和新的 `dependencies` **全集**，空数组表示清空依赖。Host 校验权限、排空、未决效果及依赖环后原子替换条件，递增安排版本并使旧评估失效；活动执行、待人工输入、未完成恢复或未知效果不能借重安排绕过。旧依赖/旧评估冻结在 B 自己的 `task.arranged` 事件中保留审计。`resident_task_plan` 只为本次新建任务建立依赖，不能夹带新任务去无 CAS 修改既有 B。

普通已认证 Web `task.revise/reopen/control` 与 Router 共用账本的依赖重绑定责任层，不能因入口不同留下旧要求/控制版本。控制动作的合法新来源进入任务 `sourceRefs`，随任务归档保留；来源授权仍逐条核验，人工确认或复制档案不会扩权。仅有 Web 来源的任务可以保留 `requester` / `waiting-reply` 问题，但关联 `groupId` 不赋予 IM 来源、群成员或交付权限；无真实群来源时不发群、不回退操作者私聊、不声称已通知，授权 Web 答复仍按原任务/问题及要求、控制版本校验后由原执行会话续办，见 [单任务合同](SINGLE-TASK.md)。

## 当前受控工具

一级分诊只挂载 `channel_triage_submit`。参数 `dispositions` 必须完整覆盖本批，逐条含 `sourceId`、`messageVersion`、`needsHandling`、`reason` 和可选 `reply`；省略 `reply` 表示不回复。`topicKey`、任务列表和依赖计划不是分诊字段，不能靠自由文本绕过工具提交。

Router 的业务工具按实际职责区分：

- `resident_task_query`、`resident_source_get`：按当前 conversation 查询任务/依赖与完整原始来源；不能跨群读取。
- `resident_task_plan`：依据当前来源原子保存新任务和依赖；`resident_task_action`：按要求/控制版本补充、修订、重开、暂停/恢复、取消原任务，或经安排版本 CAS 重安排。
- `resident_dependency_evaluate`：绑定完成事件、前后置版本、安排版本和证据，提交 `satisfied`、`continue` 或 `wait`，不能以通知送达替代业务评估。
- `resident_router_reply`：冻结和可靠发送有来源的回复，可用 `taskDelivery` 显式选择当前已完成单任务的冻结文件；`resident_router_settle`：必要动作已有收据后结清本批事件，不表示任务或发送已完成。
- `platform_task_query`：不创建空任务的状态/日期查询；`platform_schedule_submit`：依据原消息安排一次未来平台事项，时间须带明确偏移，过期不自动改排次日，收到 `scheduled` 后才可确认安排。
- `platform_config_query({})`：只读当前会话白名单配置，包含职责、时区、provider/model/effort、`agentPreset`、`maxConcurrentTasks`，不返回路径、凭据或其它会话配置；修改仍走已认证 HTTP 管理入口。已安装的 `skill`、`memory_read`、`memory_search`、`memory_status` 按当前认证 scope 提供读取，换代不扩展权限。

这些是应用授权的模型工具，不是公开 HTTP 接口。动作的稳定 `operationId` 按 conversation 和业务键派生，不依赖本次 Pi sessionId；跨 generation 仍按原收据去重。当前 generation、来源版本、真实作者和任务权限均在 Host 校验，模型不能自选其它身份。

`resident_router_reply` 可用 `recipientActorIds` 明确选择同一会话中有受信身份依据的一人或多人，值为 Host namespace 内部 actor 标识，`[]` 表示不提及。渠道插件负责将 Host 受众映射为原生 sender/mention/quote 字段；模型和显示名不能直接指定 vendor open ID。不得按姓名猜 ID，也不默认通知所有参与人；Router 不开放 `atAll`。指定受众时默认使用普通 Markdown，不隐式引用或额外 @ 原作者。受众与正文、来源、文件选择一并冻结在 `replyRequest`，相同 operationId 改换受众明确冲突，不能变成新一轮发送。

`replyToSource` 是仅接受 `true` 的可选公开字段，不接受 `false`；只在原请求明确要求原生引用本次原消息时使用。Host 从已校验的本次 `sourceId` / `messageVersion` 绑定原消息和真实作者，不开放另选引用消息/作者的参数。`recipientActorIds` 必须显式包含该原作者；缺省、空数组或缺作者均拒绝，其余受众仍须是同会话受信成员。引用目标、作者及受众按现有 `replyRequest` 冻结与去重，省略 `replyToSource` 时保留默认行为。

## Router 最终文件交付

`resident_router_reply` 的可选 `taskDelivery` 为 `{taskId, requirementRevision, artifactIds}`。Router 先经 `resident_task_query` 读取任务 `completion.result.artifactFiles`，再显式选择该任务当前完成版本的 1–20 个不同冻结 artifactId；不接受任意路径或模型拼出的 descriptor，也不默认附上所有产物。Host 校验原任务来源、当前要求版本、完整 descriptor/manifest 与原 caption；源已撤权/过期、任务不再完成或恢复仍 held 时拒绝。

最终说明与平台到期回复复用现有通知格式，保留原文件名和 caption。`replyToSource:true` 可与 `taskDelivery` 组合，但仅引用父说明；文件子通知不继承引用，不宣称文件消息自身具备原生 quote/@ 能力。任务交付写入属于该 task 的 `status` 父通知及文件子通知，先确认最终说明送达，再依原顺序发送文件；冻结、`accepted` 或 Router settle 均不表示送达，unknown 先回读，不自动重发。归档包含该任务自己的父子通知，不带整群上下文；已归档任务只能继续已有合法未送达通知，不能重新创建交付，档案恢复仍保持 hold。未指定 `taskDelivery` 且未显式选择受众时，普通文本回复规则不变。

若前序通知尚未确认送达，文件子件的 `notification.start` 可先记录“未获发送许可”。前序说明/文件经回读确认为 delivered 后，Host 可按原固定 start 命令 ID 重新判定；仅限冻结 payload 不变、仍为 `prepared`、sendAttempt 为 0 且从未有 permit/token/开始时间/发送收据的子件。第一次获许可后同 ID 永不再授新发送；`starting` / `unknown` 仍只能回读，旧 false 收据既不能永久卡住首次发送，也不能成为重复发送的授权。档案恢复 hold 等原有门禁不因此解除。

## 平台到期回复与既有冻结发送

一次平台排期到期后仍用独立受限平台会话中的 `platform_task_query` 和 `platform_reply_submit`。这不新建业务任务，也不恢复 Topic 推理。平台回复保留 `sourceId` / `sourceRef` 审计来源；普通 Markdown 默认不引用原消息、不自动 @ 原作者。`platform_reply_submit` 可明确选择有同群身份依据的受众、`atAll` 及受控附件，只有平台类通知有权使用 `atAll`；内部来源不能被模型替换为其它群或账号。

既有已冻结的 `fixed-topic-reply` 及按原 unit 身份保存的平台排期可沿原来源、版本、正文和收据校验恢复，不重新调用 Topic 做决定。若缺少 SQL 发送账但已有开始发送、尝试次数、已送达 ID 或 unknown 等证据，保持 `fixed_topic_reply_delivery_unproven` 阻断，不能重建一条新发送掩盖未知结果。通知真正送达仍以 transport 收据/回读为准。

## 无工具交接与恢复

Router 常驻的是逻辑身份和业务记录，Pi 物理会话按 generation 管理。处理过新业务且当前轮次与待输入均排空后，Router 执行一次无工具交接：保留当前意图、未决问题、必要指代、标记为推测的假设、证据引用和截止游标。任务状态/依赖/回执仍由 SQLite 权威保存；大日志、附件正文和旧讨论留在原存储，不复制整个记忆或 Skill scope。

交接 JSON 总量限制为 **32 KiB UTF-8**；`currentIntent` 非空且最多 4000 个字符串长度单位，`unresolvedQuestions`、`referents`、`assumptions` 各最多 16 项、每项非空且最多 2000，`evidenceRefs` 最多 128 条、sourceId/taskId 最多 512。字段长度按 JavaScript UTF-16 `string.length` 计算，非 UTF-8 字节数。超限、截断或引用不全拒绝轮换，不裁剪关键语义，不清空原 journal；这些预算不等于语义保真证明。

交接先通过应用 admission 完成模型请求与 Pi 提交，再进入维护/排空边界、准备下一代并 CAS 发布 active 指针。新代提交前不能处理业务；发布后旧代失去业务权。切换期间的新消息继续耐久排队，只交给有权的 generation。尚在执行的任务不妨碍 Router 自身空闲交接，纯短回复/静默、交接本身和空新代不触发连续换代。

摘要失败、截断、必要引用缺失或新代提交不完整时，不清空旧 journal，不回滚已完成业务，不重放动作。只有旧代提交、owner 和排空仍可信时才可恢复普通处理；SQL/Pi 不一致、旧实例已 fence 或效果不确定时保持阻断，依既有严格 journal 解码和维护证据恢复。连续流量未排空时继续处理，不假装空闲；Pi 原生阈值压缩仍保留。

### 已接纳未结批次的显式续办

Router 批次已经 `admitted`、随后模型轮失败且事件尚未 `settled` 时，普通恢复不能把它重新 `enqueue` / `deliver` 成另一份业务输入。只有受信 Host 可显式调用 `application.tasks.resumeRouterBatch({conversationId,generation,sessionId,packetId,failedEntryId})`，绑定原 conversation、当前 generation/Router active session、原 packet 和原生失败 checkpoint；该方法拒绝模型域调用，没有新增 HTTP、CLI 或模型工具入口。它是 Host 集成合同，不是让操作者绕过应用直调 Pi SDK 的操作方式。

续办前重新校验 active owner、原官方会话 idle、来源权限、packet/历史一致性及未结事件全集。除逐项核对原事件 ID 外，还检查 pending 总数等于原 `eventIds.length`，避免只读前 30 条而漏过较新输入；不扩大用户消息 15 条或批次 30 条上限。并发、重复/过期 checkpoint、较新输入、外来会话、未决工具效果及 owner/store 不一致均拒绝，不因局部 idle 绕过。

Host 经公开 Pi 生命周期接口先持久消费原失败 checkpoint 的非业务 claim，再沿同一历史/packet 继续；控制记录不是新用户来源或授权，不重跑已经完成的任务，不重放原业务输入或未知外部效果。失败保留原 journal 和未结事件，不自动循环重试；只有本批全部事件真正 `settled` 后，才恢复正常排空/交接并清除对应 Router 恢复告警。

普通 `recover()` 的 phase 恢复和已 `published` 交接的旧 owner 清理，也经同一 conversation 的 tail 串行执行；排队后重新读取当前 row/rotation，不把仍在途的交接当作冷中断。不暂停恢复 timer、不因 busy 静默跳过，也不放宽 live owner 守卫。原批次已经 `settled` 时不再调用 `resumeRouterBatch`，只由正式普通恢复推进该 Router 尚待完成的无工具交接/换代，不重跑原任务或业务输入。

默认冷启动仅将确定的 `ROUTER_BATCH_UNSETTLED` 保留为任务服务 `recover()` 的 `degraded` 结果及现有 `listAlerts` 恢复告警，以保留上述 Host 入口；不代表恢复完成或消息已消费。其它 journal、owner、store 恢复错误仍失败关闭，不能被另一个 conversation 的未结告警遮蔽。正常关闭的结果不证明错误关闭已安全释放全部资源；Host/Application 异常关闭及未证排空时的依赖保留规则见下文。

[第八轮报告](acceptance/resident-conversation-routing/round-8.md)记录了 Host checkpoint 续办及模型前拒绝反例，并在最新 `423a2e97` lifecycle 版本验证 live handoff/普通 recover 的确定性交错、另一 scope 错误传播和原安装已结批次的普通恢复。原安装最后仅一次无工具交接，原任务/执行 session/`run1` 与配置、私有 Skill、其它 journal 保持，重复恢复不重放且正常关闭。各组只绑定报告所列受验指纹，不宣称同版全量通过；第八轮仅使用 loopback 脚本模型，没有新增真实模型或厂商调用。该轮当时仍保留 Windows 进程隐私限制、异常关闭风险及未专项验证的取消路径；历史 Topic/Owner 或此前局部结果不能替代当前专项证据，当前关闭规则见下文。

### 正常关闭

正常关闭先拒绝新的 Router 工作，通过同 generation/actor 的 Host-only `interrupt` 中断官方 Pi 当前推理，再等待全部在途 work、工具/Job 真实排空和 Pi 提交，最后由原 `dispose` 释放 owner。等待范围包括被同会话后继 tail 覆盖但尚未结束的旧 work；只豁免本次真实取消的原错误对象，在途维护、持久化及排空错误仍聚合上报。关闭期间不续批、换代或发布迟到 owner，不使用会取消待输入的业务 `cancel` 代替正常停机；耐久 pending 和 unknown 保留，推理中断不表示任务完成，也不重放已提交或未知的副作用。

Router service 与官方 Pi factory 专项之外，第16/17轮本地隔离镜像 `be1ffc45` 已验证正式 CLI 活动请求取消、精确确认批，以及同卷冷启第二次关闭后任务步骤和 Pi 日志全文不变。该两轮由 node harness 启动 CLI 子进程；第20轮镜像 `82b96bd4` 进一步保留默认 CMD/tini/PID1，实际 `docker stop -t -1` 使在途官方 Pi HTTP 请求断连，launcher/容器自然退出0、PID归零、安装锁缺席。两镜像分别绑定各自491源封包，第20轮包含 Host `2f7b8047` / Application `72e47641` / NativeJobs `deee4fd4`，不追认后续源码、Windows Native、厂商或生产。正常关闭不能代替下节异常路径的依赖保留证据；版本和最新边界见[当前验收检查点](acceptance/resident-conversation-routing/goal.md#当前检查点)。

### 异常关闭

Application 独立尝试 stopping hook、HTTP server 和任务服务关闭，并聚合原错误；任务服务关闭失败时保留其仍可能依赖的 resident runtime/store。Host 即使先前步骤报错，也继续官方 factory、原 Job 和托管进程的显式 join；任一前置步骤失败都保留 root 依赖和安装锁，不以 Cordis effect 已记日志或 fiber Promise fulfilled 代替真实排空。只有明确步骤全部成功后才继续 root dispose 与锁释放，启动失败清理复用同一关闭链。

可信临时 `jobs.start()` 没有冷恢复收据，也必须遵守运行中 producer 的真实排空合同。取消抛错产生的 failed 状态不等于 producer 已结束；`journalError`/`drainUncertain` 记录不能通过公开 `remove` 删除，迟到 done 不自动解除 unknown。原错误、记录和 owner 保留，正常真实完成的删除不变；不新增自动重试或通用清未知接口，不手删活锁强行接管，重启也不解除耐久 unknown/no-replay 阻断。

第19轮按分版专项覆盖正常 join、stopping/tasks、factory、耐久/临时 producer 取消失败及 earlyCancel 后删除拒绝：实际 HTTP 停止后仍保 root/活锁，第二 Host 被拒，测试子进程自然退出后才由正式 Host 回收死 owner。最终定点绑定 Host `2f7b8047`、Application `72e47641`、NativeJobs `deee4fd4`；它不是五注册同版整组重跑，也不是 Windows OS producer 或镜像重新验收。完整来源、失败批和最新剩余项见[当前验收检查点](acceptance/resident-conversation-routing/goal.md#当前检查点)。

## Plugin discovery

External channel packages are discovered from explicit `channelPluginDirs` and
activated only by enabled `channelPlugins` instances. API, manifest, lifecycle,
capabilities, multi-account isolation and DWS source evidence are specified in
[CHANNEL-PLUGINS](CHANNEL-PLUGINS.md).

## Optional DingTalk DWS plugin

标准 CLI 组合 `src/application.js`，不恢复历史 DWS resident。初始化使用 `channelPlugins: []`；禁用实例不导入适配器、不注册 transport、不探测二进制、不订阅或创建账号目录。以下为未授权连接时的禁用示例：

```json
{"channelPlugins":[{"type":"dingtalk-dws","enabled":false,"channelId":"dingtalk-room","config":{
  "dingtalk_profile":"YOUR_PROFILE","dingtalk_account_mode":"system",
  "dingtalk_conversation_type":"chat-room","dingtalk_group_id":"YOUR_ROOM_ID",
  "dingtalk_name":"指定群助手","dingtalk_prompt":"仅处理本会话明确授权的请求。",
  "dingtalk_listen":false,"dingtalk_writes_authorized":false
}}]}
```

`enabled:true` 会加载插件并核对登录与目标身份，即使 `dingtalk_listen:false` 仍可能调用 DWS；这不是零连接注册检查。监听默认开启，`dingtalk_writes_authorized:false` 只关闭发送，不替代连接授权或单条业务授权。只做离线检查时用专用 CLI `--check` 并保持实例禁用；获得相应授权后按 [Windows 接入流程](ops/windows-local-runtime.md#指定钉钉群接入) 分别启用实例、监听和发送。

缺少登录时，已启用的插件报告 `waiting-auth`，Host/Web 可继续提供其余能力；插件观察官方 profile 登录元数据，成功登录后重新解析并绑定，再按监听开关接入。普通权限、目标歧义、身份变更或读取错误进入失败状态，不能一概当作未登录反复重试。第20轮在同一默认入口容器中以隔离 fake CLI 实测：lastUsed 变化不重试，lastLogin 变化后重新查询并精确绑定到 `ready`，未重启容器；该轮明确 `listen=false` / `connected=false`，只证明本地认证等待与默认观察/绑定链，不代表真实登录、订阅或厂商接入。

第23轮随后复用封定镜像 `82b96bd4`，保留默认入口与安全参数，实际fake CLI监听及历史/live消息均经正式Pi分诊到持久终态：`listening` / `connected=true`，两source routed、两triage committed，重复不增源、外会话不入站，无任务或外发通知。正常停机后监听收到SIGTERM、安装锁缺席；只读停态副本复核与首批收尾驱动失败分别保留。此轮关闭本地fake监听/补拉/入站余项，不证明真实厂商或后续源码；见[第23轮验收](acceptance/resident-conversation-routing/round-23.md)。

Windows 默认 `dingtalk_account_mode:"system"`，使用当前 OS 用户受 DPAPI/HKCU 保护的已有登录态，不复制凭据，也不声称不同 profile 或 channelId 具备独立账号。Linux/macOS 默认 private 配置/keychain 文件，也可显式选择 system；Windows 显式 private 请求拒绝。Night Bot 管理的私有账号、工作文件、缓存、绑定与补拉水位按 channelId 在安装内分区，system 凭据仍归 DWS/OS 所有；账号共享影响见 [插件接口](CHANNEL-PLUGINS.md)。没有内置账号、群、actor 或凭据。

私聊实例使用 `dingtalk_conversation_type:"chat"` 与一个 `dingtalk_user_id` 或 `dingtalk_user_name`，真实解析后绑定对端、原生 conversation 和当前账号 actor；`directChats`、`directPeers`、`assistantActorId` 为内部派生值，不是公开配置。群聊与私聊均复用 bridge 的订阅、暂停/恢复和有界历史补读，恢复沿该渠道持久水位、身份校验和去重推进，不重新初始化起点丢弃停用消息。私聊支持文字和原生引用回复，不支持私聊文件交付；实现不代表真实订阅、补拉或交付已验收。

插件保留带署源的历史、资源、mention、文件与 receipt/readback 适配能力，typed 入站保留真实发送人及原引用。额外 operator 私聊须显式开启 `dingtalk_operator_notifications` 并提供非空 `dingtalk_operator_peers`，且单独核对账号、对端及授权；不要因业务私聊实例已配置就启用 operator 范围。

群消息不会仅因发送者与当前账号相同、显示名相同或带通用 DWS 标记就被视为本实例回声；Host 使用同 conversation 下精确消息 ID 与持久 outbox / send ACK / receipt 识别自己的发送。对于 Router/任务队列的通知，关闭 `dingtalk_operator_notifications` 仍使用该 DWS 插件自身 adapter 查询发送身份，经持久渠道 context 将内部 conversation 映射为原生会话并精确核对，再在消息事实和来源持久登记之前过滤自己的消息；身份回读不改变附件交付状态，也不替代文件字节验证。

同会话队列通知仍为 `starting` / `unknown` 且身份未决时，不能排除回声的 typed 入站以 `CHANNEL_NOTIFICATION_IDENTITY_PENDING` 暂缓，不能把超时、查询失败或未确认当作真人来源。bridge 沿既有持久 `recoveryFromAt` 补读水位恢复，水位写入失败保留错误，不靠注入或重放业务修补。本次 resolver 只接队列通知；原 native operation 的 send/status 分支未统一 typed scope/query 接线，不据此外推 shell 原生发送的通用回声能力或验收。有界等待只限制调用方等待时间，当前 observer 关闭不 join/cancel 在途状态查询，底层 CLI 仍可运行至 runner 自身超时；runner 超时后也未等待 child 的真实退出，不能从 bridge 消息/水位排空外推全部旁路进程已排空。正常退出只按本次实际可观察实例及资源逐项核实。上述为实现合同，不代表现场已通过；当前 DWS/profile 是否推送同账号在单成员群中的原始消息仍须实测。`dingtalk_listen:false` 下的 `acceptHistoryMessage`、SDK 注入和 fake 仅验证本地链路；真实订阅、原始入站、群内交付/回读和复盘须分项留证。

已认证且因通知身份未决而暂缓的消息，须在该渠道原有串行 ingress 游标文件中持久保存消息 ID 与发生时间，不保存正文。该记录固定补读恢复下界；只有正式入站处理成功或经持久收据确认精确自通知回声后，才解除对应暂缓标识。供应商即使返回 `complete`，只要结果缺少已知暂缓消息（包括空页），仍以 `DINGTALK_DEFERRED_HISTORY_INCOMPLETE` 拒绝，不清恢复界或推进补拉完成水位。旧 bridge 快照只更新其暂停/恢复字段，不能覆盖较新的消费水位或暂缓消息记录。继续使用既有 timer、串行落盘、drain 和去重，不另建重放通道；持久化失败保留错误。此为当前冷恢复实现合同，修复后的真实补拉与无重放结果仍须由本轮对应版本验收，历史 PASS 不替代。

`test/pi-channel-plugin.test.js` covers disabled/registered modes and the actual
standard application without any channel installed. [第八轮报告](acceptance/resident-conversation-routing/round-8.md)
records default-CLI no-DWS loading/process observations and local fake protocol,
recipient/quote/resource and attachment regressions, scoped to each tested version.
SG9 的指定群真实文本/附件交付、平台回读、复盘和冷恢复保留在[第七轮报告](acceptance/resident-conversation-routing/round-7.md)，第八轮 fake 回归不追认为新版现场验收。[第九轮报告](acceptance/resident-conversation-routing/round-9.md)绑定 `67d2d50` 及其核对的 R8 源码指纹：旧文本/48B 附件真实回读、同安装 ready/backfill 和正常 IPC 关闭通过；冷启动有真实模型调用及一次文字答复，自身回声在 ACK 后、精确回读落账前进入来源/分诊，用例 FAIL。该轮尚未收到约定的新文件/原生 quote/@ 请求，未完成新文件交付及该事项复盘/再冷恢复；本次 `replyToSource` 和登记前 guard 不被旧版本结果追认为现场通过。跨账号、订阅重连、私聊及其它平台能力不能从上述结果推断。渠道集成仍单独授权，不作为无插件核心初始化和本地任务验收的前提。


## Web single-conversation boundary

Each actual Web channel/operator identity has one writable conversation. The Web
ledger pins its earliest existing request's conversation (creation time, then
insertion order) once, or assigns a stable empty conversation on first opening.
A first direct API request may supply its initial ID before that pin exists;
subsequent requests cannot create another conversation. SQLite serializes pinning
before asynchronous admission. The UI has no new-chat action and `/chat` resolves
the pinned conversation, including in fresh browser tabs.

Older Web histories keep their normal conversation views and composers, including
their original Router/task references. New messages from these views continue the
one current Web conversation and navigate there. They are never merged, renamed,
overwritten or deleted, and the UI does not create a separate read-only category.
Exact existing request retries return their original receipts before the new-write
check, and pending/unknown receipts and already-authorized delayed deliveries
remain recoverable without replay. External channels keep their own identities;
the recent-conversation list still includes retained Web histories and external conversations.
