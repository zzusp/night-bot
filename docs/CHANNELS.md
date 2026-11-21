# 渠道协议与常驻 Router

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
Router ingress. Adapters must start ingress after that composition is ready and
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

标准任务服务把同一会话职责传入当前三个角色的系统指令：Router `resident-conversation-scope`、执行会话 `task:group-responsibility`，以及按任务所属认证会话解析的独立无工具复盘。Router 在每次系统指令编译时解析，执行和复盘在本次调用时取值；配置文字不进行模板插值，不混入用户事实，也不产生任务控制权、外发许可或跨会话记忆权限。职责配置不改变当前角色分工、任务版本与依赖守卫。`task.completed` 只证明任务账本完成，不证明群消息或附件送达；复盘保留该证据边界。

## 钉钉消息编辑与撤回

- 同一原生消息 ID 的差异由插件串行处理，用绑定 profile 精确回读当前详情，核对会话与原作者后递增 `messageVersion`。来源保留旧正文、版本与审计；并发重复和迟到旧事件不会覆盖当前正文或重复生成修订。可证明的附件/引用展示补全沿原冻结指纹去重，不把任意变化当重复。
- 群聊、单聊显式订阅 `message,recall`。只有带原作者、撤回人、消息 ID 和有效时间的绑定会话原生 recall 才生成中立 `retracted` 墓碑。同一事务撤销该消息各版本来源授权，墓碑不进入模型分诊；旧正文再次补拉不复活。原版本、Pi 历史、任务与已发生的外部效果保留，不自动取消任务或回滚操作。
- 原 `ingress.json` 的 `pendingRecalls` 只持久化待完成撤回的原生身份与时间，不复制正文；待写入墓碑的撤回固定恢复下界；只有因通知身份未决而已进入单条待核对队列的撤回，才与普通逐条暂缓一样不堵住历史范围。上下文先提交、来源未提交的中断窗口在冷启动或既有范围补拉前补齐，正式接纳墓碑后才解除对应暂缓项。
- 历史缺项、空页、not-found 均不证明撤回。详情读取失败、作者/会话不符或历史不完整时保留原记录和恢复界，不清游标、不手工改账本。离线期间未收到的撤回没有可靠发现保证；不声称从消息缺失自动推断。
- 已撤回或被修订的来源不能开启新回复或安排；已经 `starting` / `unknown` 的外发继续原独立回读，不因编辑或撤回重发。编辑、撤回都不赋予新业务权限。

## 渠道直入 Router 与历史分诊

新渠道消息通过既有认证、去重、版本、撤回与来源准入后，在同一来源事务直接入对应会话 Router 的持久收件箱。没有前置模型分诊、自动收悉或分诊结论；不预筛“无需处理”的正文。Router 根据职责、真实作者、受话对象、原文和引用决定回复、任务或静默，入站本身不是交办或授权。

没有任务关联的直接来源须显式结清：`context-only` 表示无需动作的背景，`not-assigned` 表示未交办，`handled-inline` 须有同来源版本的 Router 冻结答复，`clarification` 保留原具体缺项与回执要求。静默原文留在同一原生 Router 上下文，不重新注入整个历史，不作为别的会话来源；Pi 原生压缩仍负责上下文预算。每批最多 15 条用户来源，沿用编码预算及溢出排队。任务派发与执行分离，Router 不等待任务结果才处理独立消息。

新显式历史回补同样直接入箱，不调用分诊。此次不扫描或补跑旧的未分诊来源。升级前已分诊入 Router 的原事件、首答、分诊绑定和冻结 packet 保留原身份；已静默处理的旧来源不重新排队。旧分诊 journal、通知和统计仅供内部恢复兼容，Web 不再提供历史分诊入口、记录 API 或统计展示，旧配置 `roleModels.triage` 保留但不再选择或执行；新模型角色仅 Router / 任务执行。

## 常驻 Router 与事项直连

Router 对与原文、引用和职责一致的明确分诊结论直接做原任务匹配、续接/新建或查证后答复，不逐条重新分诊。结论不确定、受话对象不清、原文/引用冲突、涉及敏感动作或旧记录无结论时仍针对性核对。原文与当前权限优先，不重复首答，needsHandling=false 不重新入队；Host 的结清收据、批次上限与恢复身份校验不变。

每个已认证 `chat` / `chat-room` 有一个稳定 Router 身份。渠道账号命名空间、conversation 类型和 ID 共同隔离；私聊继续绑定已认证对端。群内共享安排上下文，真实 Router 对所属会话的执行 session 拥有完整调度权；原消息作者不是 Router 的调度许可人。Host 仍核对当前 Router 身份、代际及任务/会话归属，不能因为标题相同合并其它群的任务。

Router 负责理解转入原话、拆分/关联事项、查询和调整任务、澄清歧义以及评估执行结果。它使用受控的任务查询、任务动作、记忆/Skill 读取、来源绑定的长期记忆写入和回复能力，不代替执行会话运行业务脚本或外部写入。每个任务只有一个执行会话，补充和返工沿用原任务；没有每任务 Owner 或执行团队。Topic 不再是活动业务实体。

Router 区分新事项准入与已有事项后续。结合当前会话职责、原消息和历史关联识别进度追问，不仅凭提及操作者就判定未交办，也不要求用户重新点名或授权。先查同会话原任务，必要时回查来源；已有足够证据时直接回复具体进展和限制，以 `handled-inline` 结清，不为查询进度新建、重开或恢复任务。证据不足需执行会话补查时，沿原任务补充具体查询要求，不重复发布或扩大原执行范围。只有确实交给其他人且没有要求助手参与时，才使用 `not-assigned`；分诊首答不构成业务权限。

普通任务确需补充信息时，业务和技术问题均引用原会话的真实交办消息，不要求配置操作者收件人。仅投递适合当前会话公开的问题，不转发内部证据或已有操作者私信；没有真实 IM 来源时留在 Web。问题投递与工具审批、安装管理权限无关。

任务带问题等待后，Router 可使用 `resident_task_action(kind: "resume")` 或 `control(active)` 直接继续原执行会话，不要求新的操作者批准、新的人类消息或指定问题 ID；省略来源时沿用原任务来源作为审计。此类主动恢复将旧等待记为 superseded，不伪造“人已回答”。若 Router 明确判断一条实际答复回答了具体问题，可继续提供 `humanRequestId`、`expectedContextRevision` 和 `reason`，同一事务保存原文、answered 状态及决策依据；Host 保留问题和版本一致性，不按 audience、原作者白名单或消息必须晚于问题创建时间再审批。信息仍不足时 `supplement` 保存原文并保留等待。重复动作沿原业务回执去重。

暂停、取消、完成及本地已归档任务均可由 Router 重新启动/重开，仍沿用原 session。Host 可靠提交动作后实际取消并 join 原 owner，旧工具、进程和 writer 退出后再启动；重试旧动作不能取消新的合法租约。本地归档再激活只恢复同库真实行，保留原事件/收据正文与 ID，不读 task.json 重放命令、不重新发送旧通知。离线复制恢复的业务效果待审仍保留；可以唤起会话读取原材料，但在实际恢复核验完成前不执行副作用或完成交付。

已结清的未知效果不再要求后续独立调用/完成提交匹配专门的操作者新目标授权，也不增加另一道 Router 调度证明。旧具体调用永久不重放。未结未知效果不阻止会话被唤起核验；尚未核实的副作用和业务完成仍受保护。已批准原结清事务的 prepare/journal 中断由 Host 在同一准入边界收齐，不让 Router 另找人授权。

Router 每批最多接纳 15 条转入用户消息，内部任务事件另有受限预算；同一 conversation 只允许一个活动业务轮次。任务完成、等待或变化事件直接进入 Router inbox，不再交一级分诊过滤。分诊处置游标与 Router 业务游标分别记录，单纯转交不会宣称后续动作完成。Router 查询分诊已准备/发送的回复，避免重复确认。

直连消息的观察状态也分阶段：分诊尚未提交为 `routing`；需要处理且 Router 事件尚未 settle 为 `processing`；Router 已消费事件才为 `processed`。无需 Router 的短回复/静默在分诊提交后完成其处置。通知状态独立展示，任务 `completed` 或一条已发送回复都不能代替消息处理终态。

“先 A 后 B”同时保存真实来源追溯和 SQLite 依赖。创建 B 与其依赖必须原子完成，调度和 claim 都拦住未满足依赖。A 完成后，Router 读取当前版本、验收条件和真实证据，选择认可、继续 A 或等待补充；Host 再校验 Router 身份、版本、当前前置状态和真实完成证据，才允许释放 B。旧版本完成、重复事件或模型摘要不能替代当前依赖评估。来源被编辑/撤回时旧安排变为 pending，Router 可以重新评估或重安排，不要求来源原作者另批。业务完成、依赖满足和通知送达分别记录。执行会话及实时补充仅接收本任务入边对应的当前完成证据、原事件/评估/条件和授权来源标识，入模前拒绝旧评估或版本错配；不复制前置会话、完整来源正文或全依赖图，见[单任务依赖输入](SINGLE-TASK.md)。

调整既有 B 的先后关系使用 `resident_task_action(kind: "arrange")`：提交真实来源、B 当前要求/控制版本、`expectedArrangementRevision` 和新的 `dependencies` **全集**，空数组表示清空依赖。Host 校验实际 Router、当前版本和依赖环后原子替换条件，递增安排版本并使旧评估失效；活动执行由同一接纳屏障实际取消/排空，等待及取消状态不构成额外调度许可门槛。重安排不结清未知效果、不伪造成功证据。旧依赖/旧评估冻结在 B 自己的 `task.arranged` 事件中保留审计。`resident_task_plan` 只为本次新建任务建立依赖，不能夹带新任务去无 CAS 修改既有 B。

普通已认证 Web `task.revise/reopen/control` 与 Router 共用账本的依赖重绑定责任层，不能因入口不同留下旧要求/控制版本。控制动作的合法新来源进入任务 `sourceRefs`，随任务归档保留；来源授权仍逐条核验，人工确认或复制档案不会扩权。仅有 Web 来源的任务可以保留 `requester` / `waiting-reply` 问题，但关联 `groupId` 不赋予 IM 来源、群成员或交付权限；无真实群来源时不发群、不回退操作者私聊、不声称已通知，授权 Web 答复仍按原任务/问题及要求、控制版本校验后由原执行会话续办，见 [单任务合同](SINGLE-TASK.md)。

执行会话以当前 `request/objective/requirements` 为有效范围：明确移除或交由其他执行者承担的检查不再作为本任务完成门槛，仍保留当前要求的验证。范围外并发改动保持现值；只有实际阻断授权修改或验证的冲突才需澄清，不为追查无关改动的归属而挂起交付。短检查使用前台和配置默认超时；真正长作业使用完成通知或阻塞式 `job_output`，不以连续即刻轮询代替等待。这些提示不替代 Host 权限、真实证据和取消排空。

## 当前受控工具

一级分诊只挂载 `channel_triage_submit`。参数 `dispositions` 必须完整覆盖本批，逐条含 `sourceId`、`messageVersion`、`needsHandling`、`reason` 和可选 `reply`；省略 `reply` 表示不回复。`topicKey`、任务列表和依赖计划不是分诊字段，不能靠自由文本绕过工具提交。

Router 的业务工具按实际职责区分：

- `resident_task_query`、`resident_source_get`：按当前 conversation 查询任务/依赖与完整原始来源；不能跨群读取。
- `resident_task_plan`：依据当前来源原子保存新任务和依赖；`resident_task_action`：按要求/控制版本补充、修订、重开、暂停/恢复、取消原任务，或经安排版本 CAS 重安排。
- `resident_dependency_evaluate`：绑定完成事件、前后置版本、安排版本和证据，提交 `satisfied`、`continue` 或 `wait`，不能以通知送达替代业务评估。
- `resident_memory_remember` / `resident_memory_forget`：Router 依据完整语境直接增改删记忆，无固定授权句首。Host 只允许当前接纳批次的认证原消息，核对作者、版本、会话、live generation 与权限；记忆正文保留完整原话及 context 的场景/边界推断，删除不要求原话包含内部 key。引用、任务结果或交接不能冒充当前来源，个人偏好仍按主体投影。提交后回读，只有 `ok:true,persisted:true` 才可确认；普通群 Router 的通用写权限不变。
- `resident_skill_query` / `resident_skill_mutate`：Router 直接维护 Bot 共享 learned Skill，无需空任务、先写经验或另设授权模型。查询目标及版本，按稳定 operationId 和 expectedRevision 新增、更新或删除；Host 保留完整来源、秘密拒绝、受管名称、版本、持久回执及旧操作不重放，派生文件失败如实反馈。不能改安装模板、写任意路径或执行脚本。
- `resident_router_reply`：冻结和可靠发送有来源的回复，可用 `taskDelivery` 显式选择当前已完成单任务的冻结文件；`resident_router_settle`：必要动作已有收据后结清本批事件，不表示任务或发送已完成。
- `platform_task_query`：不创建空任务的状态/日期查询；`platform_schedule_submit`：依据原消息安排一次未来平台事项，时间须带明确偏移，过期不自动改排次日，收到 `scheduled` 后才可确认安排。
- `platform_config_query({})`：只读当前会话白名单配置，包含职责、时区、provider/model/effort、`agentPreset`、`maxConcurrentTasks`，不返回路径、凭据或其它会话配置；修改仍走已认证 HTTP 管理入口。已安装的 `skill`、`memory_read`、`memory_search`、`memory_status` 按当前认证 scope 提供读取，换代不扩展权限。

这些是应用授权的模型工具，不是公开 HTTP 接口。动作的稳定 `operationId` 按 conversation 和业务键派生，不依赖本次 Pi sessionId；跨 generation 仍按原收据去重。当前 generation、来源版本、真实作者和任务权限均在 Host 校验，模型不能自选其它身份。

`resident_router_reply` 可用 `recipientActorIds` 明确选择同一会话中有受信身份依据的一人或多人，值为 Host namespace 内部 actor 标识，`[]` 表示不提及。渠道插件负责将 Host 受众映射为原生 sender/mention/quote 字段；模型和显示名不能直接指定 vendor open ID。不得按姓名猜 ID，也不默认通知所有参与人；Router 不开放 `atAll`。支持原生引用的渠道中，新 Router 进展和结果回复（含附件的父说明）默认引用本次已验证的原消息；若明确选择的受众不含原作者（含 `[]`），发送普通消息，不隐式通知原作者。省略受众时，默认引用原消息并以原作者为受众；不支持原生引用的渠道维持原规则。受众与正文、来源、文件选择一并冻结在 `replyRequest`，相同 operationId 改换受众明确冲突，不能变成新一轮发送。

`replyToSource` 是仅接受 `true` 的可选公开字段，不接受 `false`；只在原请求明确要求原生引用本次原消息时使用。Host 从已校验的本次 `sourceId` / `messageVersion` 绑定原消息和真实作者，不开放另选引用消息/作者的参数。`recipientActorIds` 必须显式包含该原作者；缺省、空数组或缺作者均拒绝，其余受众仍须是同会话受信成员。引用目标、作者及受众按现有 `replyRequest` 冻结与去重；旧冻结回复重试不会补加引用或重发。

## Router 最终文件交付

`resident_router_reply` 的可选 `taskDelivery` 为 `{taskId, requirementRevision, artifactIds}`。Router 先经 `resident_task_query` 读取任务 `completion.result.artifactFiles`，再显式选择该任务当前完成版本的 1–20 个不同冻结 artifactId；不接受任意路径或模型拼出的 descriptor，也不默认附上所有产物。Host 校验原任务来源、当前要求版本、完整 descriptor/manifest 与原 caption；源已撤权/过期、任务不再完成或恢复仍 held 时拒绝。

最终说明与平台到期回复复用现有通知格式，保留原文件名和 caption。`taskDelivery` 只会给父说明绑定引用；文件子通知不继承引用，不宣称文件消息自身具备原生 quote/@ 能力。任务交付写入属于该 task 的 `status` 父通知及文件子通知，先确认最终说明送达，再依原顺序发送文件；冻结、`accepted` 或 Router settle 均不表示送达，unknown 先回读，不自动重发。归档包含该任务自己的父子通知，不带整群上下文；已归档任务只能继续已有合法未送达通知，不能重新创建交付，档案恢复仍保持 hold。原生引用和结构化提及是不同字段；引用可能由平台隐式通知原作者。

选择 `taskDelivery` 时，Host 在冻结正文和父子通知之前校验所选 taskId，内部编号不得出现在公开正文；失败直接返回 Router 工具，由模型订正正文后继续，不产生半条交付。发送通道仍保留安全兜底。本地正文校验若明确在外部发送前拒绝，记录为 `failed`、`knownNotSent:true`、`retryable:false`，不回读、不重试。旧版误记的 `unknown` 仅在单次发送、无 ACK/receipt、发送许可与 payloadDigest/fence 全匹配且原正文可重现同一精确本地错误时结清失败；网络异常、参数不匹配或已有接纳证据仍保持未知。此结清不改写冻结正文、不重跑已完成任务，也不放行依赖它的文件子件。

原始用户来源已公开指定的业务标记可能被选作同值 taskId；仅这种同值任务身份不按私有编号拦截，保留用户指定的文件名，其他身份及机制格式照常拒绝。准备与发送使用同一判定，发送时由 Host 按精确来源/版本/作者/会话临时提供原文，不接受模型声明豁免，不改冻结 payload/hash。安装操作者可通过既有本机通知恢复入口显式重评估 taskDelivery 的本地拒发：必须重现完整原错误并逐字段核对已持久化证明、唯一尝试及 permit/fence，消费 CAS 后重新核对当前来源授权、任务完成版本、未归档和冻结产物，正文仍不合法则拒绝。只有通过全部校验才续原通知；自动扫描不重试此失败。父说明真实 delivered 后才释放原文件子件；已有接纳证据或网络未知结果仅回读，不适用重发。

若前序通知尚未确认送达，文件子件的 `notification.start` 可先记录“未获发送许可”。前序说明/文件经回读确认为 delivered 后，Host 可按原固定 start 命令 ID 重新判定；仅限冻结 payload 不变、仍为 `prepared`、sendAttempt 为 0 且从未有 permit/token/开始时间/发送收据的子件。第一次获许可后同 ID 永不再授新发送；`starting` / `unknown` 仍只能回读，旧 false 收据既不能永久卡住首次发送，也不能成为重复发送的授权。档案恢复 hold 等原有门禁不因此解除。

## 平台到期回复与既有冻结发送

一次平台排期到期后仍用独立受限平台会话中的 `platform_task_query` 和 `platform_reply_submit`。这不新建业务任务，也不恢复 Topic 推理。平台回复保留 `sourceId` / `sourceRef` 审计来源；普通 Markdown 默认不引用原消息、不自动 @ 原作者。`platform_reply_submit` 可明确选择有同群身份依据的受众、`atAll` 及受控附件，只有平台类通知有权使用 `atAll`；内部来源不能被模型替换为其它群或账号。

既有已冻结的 `fixed-topic-reply` 及按原 unit 身份保存的平台排期可沿原来源、版本、正文和收据校验恢复，不重新调用 Topic 做决定。若缺少 SQL 发送账但已有开始发送、尝试次数、已送达 ID 或 unknown 等证据，保持 `fixed_topic_reply_delivery_unproven` 阻断，不能重建一条新发送掩盖未知结果。通知真正送达仍以 transport 收据/回读为准。

## 持续 Router 会话、Pi 压缩与旧交接恢复

每个认证 conversation 持续复用自己的 Pi 会话，队列排空或任务结清不再触发额外无工具交接/换代。任务状态、依赖、来源和回执仍以 SQLite 账本为准，原始 Pi journal 留存；压缩仅改变后续模型上下文投影，不删除历史，不授予新权限。

Router 采用 **472,000 token** 目标预算，通过 Pi 1.5.0 原生 `compaction.modelOverrides[provider/model]` 配置前台水位，不伪造模型真实 `contextWindow`。模型窗口为 C 时预算 B=min(C,472000)，输出余量 R=max(16384,实际配置的输出上限)，前台水位 H=min(floor(0.8×B),B−R)，`reserveTokens=C−H`；Pi 在估算 token **大于 H** 时自动压缩。普通大窗口的后台/前台水位分别为283,200/377,600 token。后台水位为min(floor(0.6×B),floor(0.75×H))，确保小窗口提前启动且保留原生输出余量。这是检查水位，不是每次输入或工具返回的硬上限。

`keepRecentTokens` 使用 Pi 默认约20,000 token，较小窗口降为不超过 H/2，为摘要及后续输入留出空间。更小模型不能被扩成472K；窗口无效或不大于原生16,384预留时明确报错。任务执行不继承该角色配置。模型选择在创建/恢复时重新解析并建立该 provider/model 的覆盖，其它模型不会误继承大模型的 reserve。模型配置仍遵循现有 `restartRequired` 契约：保存后重启 Host 生效，恢复时重算预算；以后增加运行中模型切换时，也必须重新计算水位并废弃旧配置的后台候选。

Pi 保留最近原始尾部和较早内容的模型摘要；不会机械保证摘要语义完整，也不保证压缩耗时。压缩期间当前 Router 仍可能等待。生产应观察压缩耗时、前后 token 和消息等待，不把本地脚本验证称为真实模型性能验收。

旧部署可能留下 `handoff`、`summarized`、`candidate-committed` 或 `published` 记录。本版本仍恢复这些记录：未完成摘要按严格 journal 证明恢复原 owner；已提交摘要/候选验证旧提交、准备/发布新 owner；保留原历史和迟到输入且不重放业务。不再生成新的日常交接摘要或累计本代全量 source 引用。


摘要失败、截断、必要引用缺失或新代提交不完整时，不清空旧 journal，不回滚已完成业务，不重放动作。只有旧代提交、owner 和排空仍可信时才可恢复普通处理；SQL/Pi 不一致、旧实例已 fence 或效果不确定时保持阻断，依既有严格 journal 解码和维护证据恢复。连续流量未排空时继续处理，不假装空闲；Pi 原生阈值压缩仍保留。

### 当前上下文与按需查询

Router 按当前用户目标和完成条件安排工作，仅执行目标所必需的步骤与最小充分验证。部署本身的状态确认不等于业务复测；未要求复测时不自动追加，开发也不自行扩展为长流程耗时验收。可选复测或额外验收可在主线继续推进时询问，不作为主线依赖或完成门槛，未获同意不提前创建或启动；用户补充同意部署后复测时，先部署再复测。当前指令，或记忆/Router 上下文中有可核实来源、仍有效且适用的既往明确要求，可直接执行，无需重复询问；一般经验、模型建议或旧任务流程不能当作用户要求，当前修订/取消优先。原有权限、依赖、结果证据核对与如实交付仍须保留。

原消息、引用、批次及 Pi journal 保持原样。Pi 压缩后若当前已接纳批次原文不再可见，系统仅补充原 packet 的只读引用；不重复接纳或重放已结动作，原文仍在上下文时不重复附加。Router 的应用上下文在每次模型请求前只刷新命名的 Night sections，保留 Pi 自己的基础提示、资源与工具声明；同一轮追加来源也生效。长期指令按当前认证来源适用，普通偏好只提供相关导航，深入核实交 Router。

两角色附当前/直接引用来源及直接相关任务的回复索引：通知 ID、来源版本、用途、冻结正文预览与读取时的实际状态。`prepared` 仅冻结，`unknown` 需读回原通知，只有 `delivered` 已确认送达；不能因为旧 packet 中还是 prepared 而重复承接，也不能因避免重复而省略真正的进度答复。索引不输出发送许可、恢复 token 或底层回执凭据。引用当前版本仍需核对 source-current 的状态，旧引文不成为新授权。

Router 另附现有任务表/归档表的只读轻量索引：本会话非终态任务及本批直接关联的终态任务，默认 10 项、最多 100 项；返回版本、状态、依赖就绪、待答问题数、asOf 和分页信息，不内联完整简报与完成证据。使用 `resident_task_query(detail=index,offset,limit)` 翻页；`detail=full,taskId` 保持原完整要求/证据/依赖查询。

`resident_task_query(detail=progress,taskId,cursor,limit)` 读取同会话原任务的严格已提交 Pi journal，核对 task identity audit 和当前需求/控制/租约边界，通过 Pi 官方 projection 返回最近活动（默认 10 条，最多 100 条，文本预览 1200 字符，明确截断）。模型陈述与记录的工具结果分别标记，不把意图当证据；读取期间版本变化拒绝返回旧结果。无持久记录或没有当前执行边界返回明确 unavailable；严格 journal 错误保持失败，不宽松解析物理尾部。查询不唤醒、重开或恢复任务。

`resident_reply_query` 的 sourceId/taskId/notificationId 恰选一个，Host 固定本 conversation；source/task 查询默认最近 10 条、最多 100 条，正文预览 400 字符，以 rowid cursor 向前翻页，notificationId 读取单条完整冻结正文。索引包括本会话的分诊、Router、平台回复，以及任务在原会话提出的 `question` 和任务 `status` 回复；历史操作者私信不进入业务会话索引。任务等待事件到来时，先查已有问题通知及其状态，不因换措辞再提同一问题。每次从同一个 SQLite 通知账本取当前状态，查询不创建通知或触发重试。任务进度和回复都没有第二份状态库；外部报告优先保留原引用，摘要不替代权威查询。

### 已接纳未结批次的安全续办

Router 批次已经 `admitted`、随后模型轮失败或正常 `stop` 但事件尚未 `settled` 时，普通恢复不能把它重新 `enqueue` / `deliver` 成另一份业务输入。正常停机留下的最后 `aborted` 生成由 Host 普通恢复沿原会话领取一次；模型 `error` 和正常 `stop` 未结批次不自动续轮，只允许受信 Host 显式调用 `application.tasks.resumeRouterBatch({conversationId,generation,sessionId,packetId,failedEntryId})`，绑定原 conversation、当前 generation/Router active session、原 packet 和原生失败 checkpoint；该方法拒绝模型域调用；操作者通过本机 `night-bot-router` CLI 接入同一 Host 能力，不直调 Pi SDK。`inspect` 只读取已经打开的原 owner，返回包含 generation/session/packet/失败 entry、checkpoint revision 和完整 inbox digest 的 proposal；无 owner、busy 或不满足既有守卫时明确拒绝。`resume --check` 不领取 claim、不提交历史、不调用模型或清告警；实际 resume 重新核对 proposal，并继续执行原来源授权与全部 no-replay 检查。入口使用独立私有 capability，拒绝远端、浏览器 Origin 和普通渠道发送者；操作流程见 [Windows runbook](ops/windows-local-runtime.md#router-模型错误的显式续办)。

硬停没有留下 `aborted` 时，启动恢复沿原会话主动检查一次：沿既有 Host checkpoint 唤醒原 Pi 会话；未配对的工具调用不再作为拒绝启动模型的条件。模型 `error` / 正常 `stop` 仍走上述显式入口；无可靠检查点不猜测成功。操作者显式 proof 入口仍要求末次 assistant 调用全部是本会话只读任务查询，且每个调用都有唯一、匹配、非错误的提交结果；这与自动唤醒模型的能力分开。沿原历史开启新模型轮，不重新调用旧工具，也不把查询结果当作当前账本状态。

续办前重新校验 active owner、原官方会话 idle、来源权限、packet/历史一致性及未结事件全集。原事件必须仍是队列前缀；较新事件全部经原业务 admission 校验，写成真实 `night.business-input` 后才触发推理，current 来源同时绑定原 packet 与新 packet。模型先统筹新取消/延期/变更，不能只沿旧请求执行。原 packet 不重复 enqueue/admit，控制消息不是来源或新授权。续办提示正文只有「继续处理未完成的事项」，领取 claim 不附加说明文字；原批次、补充批次和证明仍由现有结构化记录及 admission 绑定，Host 的权限、版本、配对、收据和结清校验不交给模型。必要动作已有持久收据后仍须调用 `resident_router_settle`；纯文字结束不消费事件，Host仍不代替模型结清。学习维护失败保留真实失败，不撤销已完成交付或重开业务任务。联合批次仍至多15条用户消息、30事件及原编码预算；pending 总数必须与已读取全集一致，分页外较新输入或超限仍拒绝，不能忽略后续取消以求恢复。

原批次身份比较忽略可变的来源观测计时，以及独立首答通知的发送/回读进度（如 prepared→delivered）；通知ID、种类、冻结正文/载荷摘要、来源/版本和撤销状态仍须一致。比较不改写原packet或Pi历史，不把旧packet中的发送状态当作当前送达权威；真实效果仍以Host投递账本和回读为准。

固定 Pi 1.5.0 在生成 `aborted` assistant 后先结束回合，尚未进入工具派发，因此只允许最后中断消息里的生成调用不要求 toolResult；正常 `stop` 不享有此豁免。自动唤醒时，未配对 `toolUse` 仅在官方 `context` 扩展的只读模型视图中显示为带原 callId、工具名、参数的 `status:unknown` 事实，不补造 toolResult、不修改原记录，也不执行旧工具。Router 自行查询原任务/通知账本。Host 对未配对的原具体操作继续禁止重放；同来源版本的未知回复不能换 operationId 再发，原任务/动作也不能换键绕过。已知失败结果继续沿原工具和收据规则处理，未决 job / task effect-intent 的既有副作用校验不放宽；下述纯账本结清对账仍优先。不修改历史、不补造工具结果，也不据此宣称外部世界完全无效果。

进程崩溃留下的唯一未配对 `resident_router_settle` 允许 Host 自动对账：必须是原已 `admitted` 输入后的最后 `toolUse`、精确原 `eventIds` 和原 `operationId`，当前 conversation/generation/session/活跃 owner 与渠道目标均仍有效，其它工具已有非错误结果且无未决 job 或 task effect-intent。无原操作收据时，原事件必须仍待处理且当前来源/版本视图与原包一致；已有收据时由原业务幂等事务复核请求摘要，冲突仍拒绝。只调用原生 SQLite 结清事务，实际返回 `dispatchEligible=false` 后才向原 Pi SessionManager 追加对应 `toolResult` 并提交。旧 handle 正常关闭，再由 Pi 重开同一 session 重建上下文；不生成 assistant、不重放回复/执行工具、不伪造外部效果成功。对账失败保留真实错误并正常释放冻结 handle，下一次既有恢复可重新核验；关闭失败仍保留所有权并上报。已提交结清但结果缺失的空闲 Router 在下一事件打开时先对账，不主动加载所有空闲历史。

Host 经公开 Pi 生命周期接口先持久消费原失败 checkpoint 的非业务 claim，复核后接纳较新真实输入，再沿同一历史继续；推理前再次校验完整队列、来源版本和 owner。并发、重复/过期 checkpoint、外来会话及未知效果均拒绝。失败保留 journal 和未结事件，已领取的检查点不自动循环重试；只有联合批次全部事件真正 `settled`，才继续正常排空并清除对应 Router 告警。

启动和恢复定时器使用非等待 Router 推理的恢复入口；各 conversation 先独立排队，不等待前一会话模型结束才调度下一会话。Host 的 ready 不再等待 Router 模型请求，正常关闭仍取消并 join 全部 owner。同一活跃会话不拆成并行 owner。

部分结清的原包继续按完整冻结输入、逐项 consumed 行及原 action 收据重建校验，不能用缩短后的 pending 前缀冒充原包。新 Router 的可信执行前拒绝可记录 `router-tool/not-started` Host 审计：精确绑定 session、packet、assistant entry、call ID、原参数及实际错误结果摘要；仅来自已登记 adapter 的未歧义参数校验或 Router 业务入口前的专有 guard 能出具。普通 isError、错误码、错误正文和模型声明均不构成证明；缺失、重复、错绑定或未配对结果仍保守处理。证明不把错误改成成功，也不重放旧调用。

旧版缺少该证明的已配对错误不能追认未执行。若原部分结清包的行、收据、版本、完整原生 checkpoint 均可验证，且有独立的新来源待办，可经现有 handoff 隔离旧包：未知范围记录原已接纳 packet、原调用 task/source 及相关任务 sourceRefs，保留过往留置记录，不把从未进入旧包的新查询标为旧未知来源。任务可继续由新 Router 调度：旧代际记录的任务 ID 或历史 `sourceRefs` 不再锁住整个执行会话。显式以受限旧来源提交的写操作、受限任务的交付和依赖变更及评估仍拦截；普通调度可绑定新来源或省略来源以保留原任务追溯，继续由原事务校验修订及幂等，任务层仍保护未知作业和效果。旧日志不改写，已结清前缀不重放。缺行、缺收据、冻结输入变化、未配对调用、未决作业等仍不走此隔离路径。仅在此路径，两类已提交且精确配对的失败可原样留在旧日志：空对象参数的 `platform_schedule_list` 只读本会话排期；`resident_router_settle` 仅限目标事件全部属于原包、没有巡检评审的调用，该工具只操作本地账本，不调度任务或发送回复。两者都不补造未执行证明或结清收据。普通续办和其它未决效果的校验不变；没有独立新来源时，不因这类失败自动换代。旧现场是否满足这些证据须另行只读核实，本地合成升级不代表现场已经恢复。

若整批没有事件结清，原轮结束后优先沿既有安全规则恢复；不能安全续轮且有独立新来源时，Host 可验证原生检查点和完整冻结包并排空旧 owner，再用同一账本事务留置该批未结事件和建立交接。留置事件仍是 `pending`，在来源记录、待办查询和 `ROUTER_EVENT_DELIVERY_HELD` 告警可见，但不会重入自动投递，也不允许后继代际把它们结清。只有真正独立的、当前有效的消息能触发交接，查找不受批次截断；代际指针、原调用保护和旧 journal 保留。该路径不恢复旧任务或直接结清未知效果。

原会话无法打开时，只有确认旧 owner 不再 live，才用现有 rotation/candidate commit/publish 协议接管原持久 inbox。恢复交接记录只包含旧 session 指针、故障码和未决来源范围，不生成业务摘要或成功结论；旧日志不改写，事件不自动结清。新代可查询并处理待办，旧未决来源的变更/外发仍返回 `ROUTER_PRIOR_SESSION_EFFECT_UNKNOWN`。已消费过续办 claim 的失败会话遇到真正新入队事件时也可排空原 owner 后接管。夹在匹配的 claim 与续办轮标记之间的补充输入属于那次续办，不单独发起重试；没有新入队事件时保留未结告警。同一无进展恢复代不无限换代重试。已失去原会话全部可验证头部、路径/权限不安全、活 writer 无法排空或核心存储/模型不可用仍不是可无条件恢复的情况。

元数据目录枚举可隔离损坏 Router，但必须先从其原字节找到校验和有效的已提交前缀并确认 runtimeOwner；不把该前缀当作可继续写的旧会话。隔离不删除文件、不为其授予 workspace 身份，精确 header/read/open 和普通会话损坏仍失败关闭。随后由 Host 原账本 generation 接管，不能凭一个未验证首行忽略损坏。

普通 `recover()` 的 phase 恢复和已 `published` 交接的旧 owner 清理，也经同一 conversation 的 tail 串行执行；排队后重新读取当前 row/rotation，不把仍在途的交接当作冷中断。不暂停恢复 timer、不因 busy 静默跳过，也不放宽 live owner 守卫。原批次已经 `settled` 时不再调用 `resumeRouterBatch`，只由正式普通恢复推进该 Router 旧部署尚待完成的交接/换代，不重跑原任务或业务输入。

不满足上述中止恢复或纯账本对账条件时，冷启动仍将确定的 `ROUTER_BATCH_UNSETTLED` 保留为任务服务 `recover()` 的 `degraded` 结果及现有 `listAlerts` 恢复告警，以保留上述 Host 入口；未知工具效果保留在原历史和模型只读视图中，具体重复副作用返回 `ROUTER_PRIOR_EFFECT_UNRESOLVED`，不阻止 Router 查账和处理其他输入。已领取续办 claim 的原批次不因重复恢复或再次启动而自动循环；不代表恢复完成或消息已消费。其它 journal、owner、store 恢复错误仍失败关闭，不能被另一个 conversation 的未结告警遮蔽。正常关闭的结果不证明错误关闭已安全释放全部资源；Host/Application 异常关闭及未证排空时的依赖保留规则见下文。

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

资源读取保留图片、UTF-8 文本、XLSX、在线 adoc 的既有返回形态；其它可下载附件（如 PDF、Word、未知二进制）返回完整 `file: {data: Uint8Array, name, mediaType}`，不把平台 ID 当路径或公开链接。Host 校验名称、MIME、大小与完整性，在本任务 materials 发布安全哈希名原件，计算字节数/SHA-256，并将 `{name,mediaType,path,bytes,sha256}` 传给任务。文件描述符不携带账号、签名链接、下载目录或内联二进制；临时文件在返回字节后清理。单资源上限 8 MiB，文件不可读时明确 unavailable，不以静默文本降级掩盖错误。该形态不增加格式解析器，不自动执行文件，不覆盖历史 unavailable 快照。Router 准备和执行器领取同时请求本任务的同一材料快照时，共用一次首次下载与发布；等待方读回并校验已发布快照，后续续办仍核对绑定和哈希。

群消息不会仅因发送者与当前账号相同、显示名相同或带通用 DWS 标记就被视为本实例回声；Host 使用同 conversation 下精确消息 ID 与持久 outbox / send ACK / receipt 识别自己的发送。对于 Router/任务队列的通知，关闭 `dingtalk_operator_notifications` 仍使用该 DWS 插件自身 adapter 查询发送身份，经持久渠道 context 将内部 conversation 映射为原生会话并精确核对，再在消息事实和来源持久登记之前过滤自己的消息；身份回读不改变附件交付状态，也不替代文件字节验证。

同会话队列通知为 `starting` / `unknown` 且消息身份未决时，当前消息的明确 OpenDingTalkId 与已绑定发信身份不同时可直接接纳。DWS 的通用 `senderId` 投影可能来自不同身份命名空间；仅有该值、同账号、同名或通用 DWS 标记均不能证明不是回声。仍无法排除回声的消息与直接引用已知待核对消息的来源，在同一 `ingress.json` 中以消息 ID、发生时间和必要的引用 ID 占位，不保存正文，不登记为来源。原通知的状态探针由原观察器持有和排空，不占用 typed 入站串行队列；未知外发仍可见，不重发。此改动针对 Router/任务队列通知，不扩展原生 shell 外发识别或旁路 CLI 的排空承诺。

范围补拉和逐条核对分别推进。范围完整且页内消息已接纳、确认为回声、去重或耐久暂缓后，提交 `backfillThroughAt`。启动、重连和恢复接收保留旧文件，按最后接纳时间、最早耐久暂缓和既有恢复界中的更早边界重叠补拉，按实际发生时间接纳历史。监听可先连接，普通实时消息先缓存；完成历史范围的持久提交后才按到达顺序处理缓存。撤回仍优先落盘，历史重复走原接纳去重。同会话同原生消息 ID 的实时显式 OpenDingTalkId 可补齐历史身份；通用作者字段不能当作认证证据。普通增量从完整水位重叠读取，不阻塞实时。单条待核对复用已有补拉节奏，按同绑定 profile、会话及精确消息 ID 重新读取；缺失、错误或超时不删除记录也不证明送达、未发或撤回。暂停期间，操作员可从耐久暂缓队列补投早于本次暂停时刻的群消息。原始精确回读须提供同绑定会话、消息 ID、时间和明确作者；继续执行原接纳、去重、引用依赖和未知外发守卫，不推进范围水位或开放实时。单条失败单独记录在插件诊断（`deferredCount` / `deferredReadError`）及日志。只有正式接纳、确认精确回声或完成对应撤回时才清除；取消接收仍排空已启动的读取。身份未知和候选记录不影响收信连通判断；首次补拉、监听未 ready、完整性失败、来源冲突以及游标写入失败仍显式报告，不能以已接纳代替 Router 处理终态。

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

### Router 空闲交接与任务完成延迟（历史实现，已由上述持续会话方案替代）

Router inbox 暂时为空不代表会话已空闲。会话仍有未归档的 active/active 任务时，保留当前 Pi generation，优先接纳后续补充和任务完成事件，不在每次安排结束后立即启动无工具交接。任务结清后仍经原来的耐久摘要、候选提交和唯一 owner 发布流程轮换；长会话的上下文仍由 Pi 管理。已开始的交接不能旁路，期间到达的事件继续耐久排队。此优化避免可预见的完成事件等待不必要轮换，不表示已开始的交接耗时已被消除。

### Router 回复与处置

Router 先处理再回复：取得可核实的阶段结论、必要澄清、实际阻塞或最终结果后再答，不发送仅收悉、承诺或查询计划。长任务不必等最终完成。新 replyPurpose 不接受 acknowledgement；Host 同样拒绝新建此用途的通知。仅承接正文由写作规则约束，不再调用独立复核模型或用关键词判定。旧冻结回执及恢复沿原逻辑，正文、digest 和已知/未知效果均不改写、不重发。对状态查询先查证再回答，不把查询当启动指令，也不把承接当结果。已有冻结历史回复按原账本核对，不重复发送；保留现有授权、来源版本、任务关联和外发守卫。

### Historical source context（旧版分诊背景机制，已停用）

A first-tier `needsHandling=false` decision consumes only the immediate routing
work; the authenticated original remains in the existing source ledger. Before a
new triage batch, Host reads up to five preceding same-conversation messages as
explicitly read-only background. Each background preview is bounded to 600 text characters
(and 200 quote characters); background is not in the actionable `messages` array,
not counted against the 15-source batch limit, and cannot be submitted to triage.
Steered current-message versions are excluded from the background. This adds no
model call and no separate memory/history store.

Router can call `resident_source_query` for same-conversation history, including
ignored sources: keyword literal substring, message-time `before`/`after`, a
same-conversation `anchorSourceId`, and keyset `cursor`, with at most 20 previews
per page (1,200 text characters and 400 quote characters per preview). Ordering is ledger receipt order, newest first; time filters refer to
source timestamps, not that ordering. The SQLite query selects only the requested
page and uses the conversation/message/version index to discard obsolete versions.
Latest revoked, held, or restored-but-unreviewed versions hide earlier versions;
internal sources are not returned. No caller-provided conversation selector is
exposed in the model tool. Private sender/channel isolation follows the existing
authenticated conversation identity.

`resident_source_get` resolves full current content and attachment references;
stale IDs return a superseded marker with the current ID/version, and unavailable
sources do not return old bodies. Previews are not full attachment evidence and
must not be mistaken for new instructions, fresh authorization or unprocessed
messages. History reads never enqueue routing work or change disposition. Use
existing task plan requirements and `resident_task_action` supplements to retain
needed context, exact source/version links and original execution session rather
than creating a task for background alone. Current task revisions and existing
permission/no-replay boundaries continue to apply.

These tools preserve source evidence, not model semantic accuracy: scripted tests
exercise retrieval and task linkage, not a guarantee that a real model will
always choose the right context. Very large histories can still incur SQLite
search work; keyword matching is not semantic/vector retrieval. Already-admitted
model context is a snapshot, so current source versions must be rechecked before
relying on facts after a later edit or withdrawal.


### 周期进度检查

Router 的 `platform_schedule_submit` 使用互斥的 `at`（一次）或
`every_seconds`（至少 60 秒的持续间隔）。例如“每 10 分钟检查进度直到工作完成”
使用 `every_seconds: 600` 与 `stopWhen: {taskIds: [...]}`，不是一次性 `at`。
Router 先安排/查明本会话实际工作任务，保留工作验收定义，不创建空监控任务。
Host 核实任务属于本会话；每期从当前任务账本取新快照。只有指定任务全部存在、
无技术阻塞、状态为 completed 且完成记录对应当前需求/控制/执行轮次时，
才在完成期汇报后停止；等待、暂停、失败、旧轮次完成不满足条件。
没有 stopWhen 的显式周期请求持续运行，停止条件不明时不能声称自动停止已安排。

Native Schedule 仍是唯一计时与冷启动投递者，停机后只补最新一期。平台桥接
按真实 occurrence 建独立出站身份，已处理期不能重发；源消息失效或终止后
拒绝后续输入，冷恢复清理已终止但尚未来得及撤销的 native 排期。桥接检查与
发送只限原会话。任务 completed 是任务账本完成证据，不替代生产现场验收；
原任务必须完整保留用户要求的上线条件。旧一次性排期不会凭文本自动升级。

### Router input packing

New Router turns receive an explicit business view of each inbox event, not the
notification/source ledger serialization. It retains exact source text, author,
version, quotes, attachment references, and the first reply's text and delivery
state. Prepared/unknown replies still do not establish delivery. Duplicate
transport identifiers, send/readback tokens, receipts and processing metadata are
not model instructions. Original ledger records and same-conversation source
history/get tools remain authoritative and unchanged.

The view is versioned and bound to the immutable ledger identity outside the
model text. Recovery accepts the exact persisted compact, old neutral, or old raw
packet, without rewriting its journal or admitting the batch twice. Mutable
first-reply delivery progress and observation timing do not change input identity;
changed source version, content or frozen reply payload still fail identity checks.

Batching uses projected UTF-8 bytes (128 KiB target) and at most 15 user sources,
with at most 30 inbox events. A single larger original is delivered intact and
alone, not silently truncated. Pending overflow remains in the inbox. This is a
packing target, not a promise that arbitrary user content fits the model window.

### 执行会话交接：当前简报与本轮增量

Router 的 `resident_task_action.request` 是可显式替换的当前有效任务简报，
`text` 是本轮指令，不再把历次补充、修订或操作员输入拼接到 request。
目标或约束改变时，Router 使用 revise/reopen 同步提交完整有效的 request、
objective 与 requirements，明确移除已失效要求；Host 不通过关键词或截断猜测
哪些要求过时。升级前已有的累计 request 不自动重写，由 Router 回查真实来源后
显式修订。来源消息、来源关联、动作回执和 Pi 历史仍保留。

执行输入采用业务字段白名单，不再发送任务的历史审计数组和调度队列。
同一 Pi 会话后续轮只补入未正式 admitted 的来源版本和本轮增量；人工答复核对
仍携带完整候选来源。初次执行保留完整原始来源与材料。已持久化的待处理输入
按原字节恢复，不因升级重新生成；旧格式仍可读。当前简报不能清除 Host 的
未知效果、档案恢复待核验和精确旧调用 noReplay 约束。

### 对外回复的信息取舍

正文沿用共享 ELI5 沟通规范，不另设上线文风模板；事实、未验证边界和回复时机继续按原合同处理。

Router 的每次模型请求都带共享沟通原则：默认只说结果、必要下一步及会影响判断的事实；不列排查过程和内部状态，用户要求细节再展开。用日常词和短句，必要的技术词首次出现时说清含义或影响。每条新回复提交前，原模型以读者视角自查，删去不影响判断或行动的句子，只提交正文。渠道回复和 Web 操作者回复的 `text` 参数都提醒自查。不丢会影响结论的限制或用户要求的技术证据。`communication_guidance_read` 仍按需读取详细边界，不是写回复的前置调用。任务侧见[任务沟通规范](SINGLE-TASK.md)。

新渠道消息没有前置分诊、分流或自动首答。`resident_router_reply` 新正文（含进度、澄清和附件交付说明）、渠道关联任务向需求提出者的新提问及直接事实追问答复，不再做独立模型复核。Host 拒绝含可识别凭据的正文；不以模型复核代替程序检查。旧冻结正文、静态通知、平台定时汇报、操作者专用通知、任务详情页问答及未知投递按原合同处理。

群聊直接答复面向选中的真实问题作者。绑定完成事件或附件时，未指定受众则父说明原生提及同会话可验证的对应任务负责人（创建时默认为发起人）；其他任务进展可通过受信任务信息选定相关人。显式同会话受众优先，只有引用作者也在受众中才引用；不按名字、最新发言或历史参与名单猜测。单聊仅回已绑定对端。写作规则不授予发布权限；来源、版本、代际、受众、内容安全、署名和投递回执仍由 Host 校验。

## 渠道 Router 的 Web 操作者对话

渠道会话路由 tab 的网页发送入口已撤下，仅保留历史查看。以下是保留的后端接口及已接纳 Web-only 事件恢复合同，不是当前 UI 入口。HTTP 入口复用 Web 登录、同源与 CSRF 校验，并只允许当前可见且有真实渠道 context 的目标；身份由 Host 的 webActorId 决定，不接受浏览器提供来源作者、权限或发送目的地。消息以独立 operator.message 写入现有 router_inbox，原 requestId/目标/正文绑定幂等，不经过 channels.receive 或分诊，不伪装成渠道成员。

沿用同一 Router Pi 会话，但 Web-only 与真实渠道事件分批，恢复时亦分别接纳；完整待办快照仍用于版本与分页检查。此入口当前仅查询和网页对话：Host 动态拒绝任务创建/控制、依赖释放、记忆/Skill 写入、排期变更以及 resident_router_reply 等渠道外发工具，不能引用历史群来源借权。resident_operator_reply 只为当前 Web 事件冻结一份本地回复，工具重试按事件幂等，历史投影只显示一次；router.settle 必须校验 Web-only 范围及每条回复存在，不能用渠道批次消费这些事件。不会创建 notification 或触碰渠道出箱。原群消息照常使用原能力与权限。

旧网页输入和获确认的回复仍通过原 Router 会话投影展示；当前页面没有对应输入框、发送/重试或草稿布线。网页接纳只说明已入队，不代表推理完成；原 Router 受阻时仍遵循既有恢复和 no-replay 约束。

### 首次实际回复与历史计时
新直入来源的回复计时按确切来源/版本与 Host 可靠送达回执计算，不生成分诊兜底节点；显式 acknowledgement 和旧 triage-reply 不作为它的实际答复。静默结清由 Router context-only / not-assigned 收据证明，不能因缺回复推断静默。旧来源的历史确认及计时保留原口径，Web 不展示分诊统计；原卡位改为当前 Router 独立压缩事件耗时，普通 Router 处理跨度保留。

Router 压缩图复用既有有界 Host performance trace 的 foreground/background-compaction 真实计量，不新增采样、数据库或日志扫描。按当前 conversation 与 Router session 筛选、按完成时间取最近 8 次；后台成功需唯一采纳记录，取消/失败/缺采纳不画成功点。事件独立于消息，空消息页仍可显示已有压缩；未保留的旧计量不回填，旧 Router 代际与其他会话不混入。

## Router 的临时任务只读查询

快的已有任务状态查询仍在 Router 内联完成。慢的同会话任务状态、进展或结果整理可用 `resident_task_lookup_async`：Host 只给无工具 Pi 子推理最多三个任务的有界快照，不给原用户正文、通用上下文、Skill、shell、仓库、业务网络或写入能力。线上排查、代码问答/分析及独立调查沉淀仍走正式任务（已有事项则沿用），不能仅因只读改用临时查询。此入口不拆分任务执行会话。

受控 NativeJobs 每会话最多一个、全实例最多两个，30 秒截止；提交立即返回，Router 用 `async-query` 和精确 `lookupId` 结清查询来源，继续处理后续消息。结果与完成事件在既有 Router SQLite 事务中一起持久化，子查询不外发、不改任务、不递归。Router 收到内部结果后核对快照与当前事实，按阶段结论规则回复。来源换版或撤回丢弃迟到结果；任务修订、状态或执行租约变化只回失效状态，不冒充最新进展。结果不成为新用户指令或授权。重启将尚未完成的查询记为中断并入箱一次，不盲目重跑；旧未知效果的写入保护不因此放宽。


### Router 接续与完成的精确只读投影

`conversation-state` 在既有 sourceTaskLinks/taskIndex 旁提供 taskMatches/taskHandoffs：仅当前同会话来源版本或 Host 核验的当前引用能产生唯一绑定；无匹配、多匹配不猜任务、不自动重开。唯一匹配带原任务摘要、原要求预览、版本与依赖；requiresFullRead 或范围改变时按原 taskId 使用 resident_task_query(detail=handoff/full)。Host 仍校验 generation、来源、修订、租约、未决效果及依赖，执行沿用原单一会话；这是减少模型目录往返，不是 Router 自行调查或增加权限。记忆目录已在原按需入口；不为普通接续或无关完成强制再次读取记忆/Skill。

新完成批次使用 modelViewVersion=2 的小投影，给记录的结果摘要、限制和证据引用，截断/省略有标记；原完整 result 仍在账本中，依赖验收、附件交付及证据不足须精确读 full。原 v1 与旧包仍可重建，未决包的正文/ID不重写；完整 ledgerIdentity 仍绑定被省略字段。completionContexts 仅接纳当前 task.completed 命令/修订，提供原来源版本与本次完成的精确通知查询。记录结果不是独立核验或新用户授权；旧进展回复不能冒充这次完成回执。

完成回复可显式填 completionEventId，新 v2 批次在同源唯一完成时也会由 Host 绑定；多匹配须明确事件。通知身份固定为会话、完成事件、原 sourceId/版本，不因模型换 operationId 或省略参数重复外发。正文改变仍冲突，不替换旧冻结请求；prepared/unknown 沿原编号回查，delivered 不重发。冻结事务再次核对当前来源、完成命令和任务版本，期间变化则拒绝。旧 v1 冻结回执与恢复协议保持原样。先答复有证据的阶段结论，必要的相关记忆维护仍保留，无关 review 不挡住回复；不增加额外复核模型轮。

新 trace 保留 router-reply-lookup / router-reply-register 两个 Host 阶段，只记耗时/成败，不记正文或秘密；覆盖通知查询、冻结登记，不包括全部验证、调度、发送和回查。阶段可能嵌套/重叠，不能简单相加当工具总耗时。Router 的 handles 缓存、idle 保留、空队列不开会话均不变；首次/重启仍有真实 SDK 打开，暖消息沿用同一 handle。每轮技能、系统提示和请求准备与供应商首输出是不同边界，不做保活空推理、全会话预热或压缩策略变更。

### 明确新任务的首轮派发

当前目标、范围、约束和必要依赖已经足够且无对应原任务时，Router 首个模型请求直接提交 resident_task_plan，不把任务/Skill/记忆目录查询当固定前置。必要用户指令与当前约束仍生效，唯一原任务沿用 #223，缺证据或歧义仍精确查询/澄清，状态询问与闲聊不自动派发。现有 Host 已在持久安排及必要工作区/材料就绪后独立调度执行，不等待 Router 收尾或用户回复复核；未满足依赖、权限、租约或恢复围栏不会被这条提示越过。此条不新增调度器或第二路模型，任务完成仍由原事件回 Router。隔离边界与未通过的附加探针见 [首轮派发验证](acceptance/router-first-dispatch/controlled.md)。

### Router 向执行会话的忠实转达

Router 仍负责创建、选任务、接续及依赖调度；这些操作及其判断保留在原账本/审计中，不作为用户交给执行的指令。新 Router 计划和操作由 Host 标记 source-only-v1：执行输入只保留任务身份/版本及必要的真实依赖结果，去掉 Router 写的标题、目标、简报、要求和依赖评估文字，直接关联同会话原始消息、作者、版本、引用和附件。多消息可用 sourceRefs 关联，quote 仅允许实际原文片段作为分工定位，不能自造步骤或限制。当前修订优先，仍有效的旧限制来自原始来源；引用、历史和内部事件不能成为新授权。

普通重入及运行中的即时补充共用该投影。Host 从真实来源取补充正文，不采 Router 的 text；省略来源的调度不合成新用户消息。未变化的来源依照原接纳记录去重；保留多条真实追加和版本变化。没有人类来源的系统/定时任务继续原契约。旧已冻结输入、操作收据与历史不迁移、不改写；该规则适用于新输入，不能撤回模型已经看过的旧文本。

新的附件通知如同时绑定完成事件，两者必须属于同一任务；自动完成绑定只匹配选中的附件任务，不能借同源消息绑定另一任务。历史已冻结通知沿原 payload、digest 和回执处理，不重写或替换。钉钉 DWS 文件子消息不支持原生 @；负责人提及只作用于父说明，不改变文件发送协议。


### 执行会话只回传最终结果

执行会话自行推进已授权工作，不主动向 Router/渠道提问或播报中间进展。
`task_result` 不再提供 question/audience；Host 同样拒绝这两项，不从旧待答记录新建自动问询或追问通知。
成功以 complete 交付；资料不足且无安全路径时，以 blocked 记录真实缺项、证据和限制，不伪造完成或自旋。
普通 wait 仅保留内部决定/审计，不进入 Router 收件箱；blocked 以持久 task.blocked 事件交 Router。
完成和阻断的文字回报走同一 `resident_router_reply`：当前账本投影 `taskOutcomeReplies` 为可回报的当批结果提供绑定好的参数，Router 按 `outcomeEventId`（即 `taskEventId`）选对应项并补 `text`，不必查历史推断原消息。实际提交时 Host 重新核对当前事件、原发起人及来源版本，复用同一通知身份。Web 补充只影响执行上下文，不是渠道来源；回报不按 Router 交接代际另分流程，不放行旧普通回复或附件。Router 对照原目标判断结果；有具体、未尝试且获准的下一步就沿原会话推进，没有新依据不重复唤醒。回报先说实际结果和眼下卡点，不把尚未核实的后续条件说成已确认阻断，不照搬执行报告。Router 决定是否和如何回报；没有冻结通知也可以结清，账本明确区分 `not-reported`（未回报）和 `notification-frozen`（已冻结，仍需查送达）。已结清旧结果不自动补发。
未知效果、异常退出等仍走原巡检与恢复协议，只产生巡检事件，避免同一次停态重复回传。
用户主动补充、任务对话、权限审批、依赖、既有冻结通知及其回读不因此获得新权限，也不删除旧记录或重放历史。

锁文件固定的官方 `@earendil-works/pi-coding-agent` 1.5.0，在安装包
`dist/core/slash-commands.js` 的内置命令及 `dist/core/agent-session.d.ts` 的公开接口中均无 goal 能力；
本改动不模拟 `/goal`、不接第三方扩展、不升级依赖。执行仍由原 Pi 循环和既有 task_result 收尾。
