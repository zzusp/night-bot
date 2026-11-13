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

## 钉钉消息编辑与撤回

- 同一原生消息 ID 的差异由插件串行处理，用绑定 profile 精确回读当前详情，核对会话与原作者后递增 `messageVersion`。来源保留旧正文、版本与审计；并发重复和迟到旧事件不会覆盖当前正文或重复生成修订。可证明的附件/引用展示补全沿原冻结指纹去重，不把任意变化当重复。
- 群聊、单聊显式订阅 `message,recall`。只有带原作者、撤回人、消息 ID 和有效时间的绑定会话原生 recall 才生成中立 `retracted` 墓碑。同一事务撤销该消息各版本来源授权，墓碑不进入模型分诊；旧正文再次补拉不复活。原版本、Pi 历史、任务与已发生的外部效果保留，不自动取消任务或回滚操作。
- 原 `ingress.json` 的 `pendingRecalls` 只持久化待完成撤回的原生身份与时间，不复制正文；它与 `deferredMessages` 一起固定恢复下界，阻止旧桥接快照覆盖及完整空页提前推进。上下文先提交、来源未提交的中断窗口在冷启动或既有范围补拉前补齐，正式接纳墓碑后才解除对应暂缓项。
- 历史缺项、空页、not-found 均不证明撤回。详情读取失败、作者/会话不符或历史不完整时保留原记录和恢复界，不清游标、不手工改账本。离线期间未收到的撤回没有可靠发现保证；不声称从消息缺失自动推断。
- 已撤回或被修订的来源不能开启新回复或安排；已经 `starting` / `unknown` 的外发继续原独立回读，不因编辑或撤回重发。编辑、撤回都不赋予新业务权限。

## 轻量一级分诊

每个认证 conversation 保留一个独立的常驻 Pi 分诊会话，跨批次保留原生上下文；进程重启时按稳定 session ID 延迟恢复同一 journal。过去的一次性分诊记录只保留审计，不拼接成新会话。只提交最新批次的来源，历史输入/工具结果/摘要不作为新交办；最新来源版本和职责优先。

分诊预算为64K（65,536 token），使用 Pi 原生 `compaction.enabled/reserveTokens/keepRecentTokens`，不修改真实模型窗口。有效预算 B=min(65,536,模型窗口)，在约 B−16,384 token 时触发，通常保留最近约20,000 token；小窗口按 Router 同一安全策略缩减，过小窗口明确报错。它是触发水位，不是硬输入限制；压缩同步占用该会话，未宣称零等待或生产压缩时延。不同 conversation 不共享摘要，任务/Router角色预算不变。

成功提交后不 dispose owner；每批使用独立快照、输入许可与计时，防止旧工具调用结清新批次。失败/版本替换先排空并释放 owner，后续从同一 journal 恢复，只从来源账本重新构造未完成的有效批次；旧未投递 Pi 包被 Host 退休，不重放发送。已提交的回复继续由通知账本去重。正常停机排空所有分诊 owner，不复制历史、不新建自研压缩或每轮交接摘要。

一级分诊只用本批原消息、已附带的引用/提及、认证身份及快速可得的本地信息判断是否需要处理、是否需要回复。它不拉长历史、不解析大附件、不拆分事项、不选择 taskId、不创建或控制任务。信息不足且需要进一步业务判断时转交 Router，不把未知记成无需处理。

每条来源版本有四种处置：

| 需要处理 | 简短回复 | Host 动作 |
| --- | --- | --- |
| 否 | 无 | 记录静默，不唤醒 Router |
| 否 | 有 | 准备短回复，不创建任务或唤醒 Router |
| 是 | 无 | 仅在本批上下文无需新增反馈时将原消息可靠转入 Router，并说明静默依据 |
| 是 | 有 | 独立推进 Router 转交与短回复，发送失败不阻断转交 |

首答用于及时反馈会处理对应事项。对职责范围内已明确交办且需要继续处理的请求，一级分诊应在本次提交中给出简短 `reply`，告知已收到、会继续处理，不等待 Router 安排、工具查询或任务结果。是否回复在一级分诊完成时判断，回复与 Router 转交独立推进；无需处理且无需回复的消息保持静默，不对全部消息机械发送收悉。

短回复通常为一两句，保留来源版本、真实作者和精确引用。承接只说明接纳和后续处理意图，不声称已创建任务、已开始执行、已查明或已完成，也不扩大授权；初步判断应说明尚未核实。问候或收悉无需强加暂定前缀。`reason` 同时说明是否处理及回复或静默的依据；仅在无需回复时省略 `reply`。每条消息必须有完整处置才可提交；模型失败或遗漏仍为待处理，不能自动变成静默。

程序负责以下边界：

- 一级分诊每批最多 15 条来源，溢出排队；批次封存前的新来源可 steer 到同一 Pi 会话，不重启分类会话。若同一消息的更高版本已可靠落盘，Host 取消并排空旧在途分诊，再重读仍有效的来源形成最多 15 条的新批次；不能放宽 latest 来源校验或让旧快照提交。旧的、不完整的模型提交不能覆盖更新后的批次。
- 提交前重新校验来源、作者、版本、引用和批次覆盖；分诊决定、Router 待消费引用及必要的回复意图具有稳定身份，恢复不生成另一份相同决定。
- 转交保留原消息、发送人、版本、引用和附件引用；原入站资源读取与阶段回调继续接入，按 residentStore 实际富化后的消息版本登记来源，不能拿旧版本继续提交。资源读取失败明确保留 unavailable，不伪造附件正文。分诊短回复或初判不能替代原消息。接纳表示可靠入队，不表示 Router 已处理或任务已完成。
- 回复正文冻结，编辑后的旧来源不能开启新发送。unknown-send 先回读，不因超时重新发送；同一来源版本不重复转交或确认。

## 常驻 Router 与事项直连

每个已认证 `chat` / `chat-room` 有一个稳定 Router 身份。渠道账号命名空间、conversation 类型和 ID 共同隔离；私聊继续绑定已认证对端。群内共享安排上下文，真实 Router 对所属会话的执行 session 拥有完整调度权；原消息作者不是 Router 的调度许可人。Host 仍核对当前 Router 身份、代际及任务/会话归属，不能因为标题相同合并其它群的任务。

Router 负责理解转入原话、拆分/关联事项、查询和调整任务、澄清歧义以及评估执行结果。它使用受控的任务查询、任务动作、记忆/Skill 读取、来源绑定的长期记忆写入和回复能力，不代替执行会话运行业务脚本或外部写入。每个任务只有一个执行会话，补充和返工沿用原任务；没有每任务 Owner 或执行团队。Topic 不再是活动业务实体。

任务带问题等待后，Router 可使用 `resident_task_action(kind: "resume")` 或 `control(active)` 直接继续原执行会话，不要求新的操作者批准、新的人类消息或指定问题 ID；省略来源时沿用原任务来源作为审计。此类主动恢复将旧等待记为 superseded，不伪造“人已回答”。若 Router 明确判断一条实际答复回答了具体问题，可继续提供 `humanRequestId`、`expectedContextRevision` 和 `reason`，同一事务保存原文、answered 状态及决策依据；Host 保留问题和版本一致性，不按 audience、原作者白名单或消息必须晚于问题创建时间再审批。信息仍不足时 `supplement` 保存原文并保留等待。重复动作沿原业务回执去重。

暂停、取消、完成及本地已归档任务均可由 Router 重新启动/重开，仍沿用原 session。Host 可靠提交动作后实际取消并 join 原 owner，旧工具、进程和 writer 退出后再启动；重试旧动作不能取消新的合法租约。本地归档再激活只恢复同库真实行，保留原事件/收据正文与 ID，不读 task.json 重放命令、不重新发送旧通知。离线复制恢复的业务效果待审仍保留；可以唤起会话读取原材料，但在实际恢复核验完成前不执行副作用或完成交付。

已结清的未知效果不再要求后续独立调用/完成提交匹配专门的操作者新目标授权，也不增加另一道 Router 调度证明。旧具体调用永久不重放。未结未知效果不阻止会话被唤起核验；尚未核实的副作用和业务完成仍受保护。已批准原结清事务的 prepare/journal 中断由 Host 在同一准入边界收齐，不让 Router 另找人授权。

Router 每批最多接纳 15 条转入用户消息，内部任务事件另有受限预算；同一 conversation 只允许一个活动业务轮次。任务完成、等待或变化事件直接进入 Router inbox，不再交一级分诊过滤。分诊处置游标与 Router 业务游标分别记录，单纯转交不会宣称后续动作完成。Router 查询分诊已准备/发送的回复，避免重复确认。

直连消息的观察状态也分阶段：分诊尚未提交为 `routing`；需要处理且 Router 事件尚未 settle 为 `processing`；Router 已消费事件才为 `processed`。无需 Router 的短回复/静默在分诊提交后完成其处置。通知状态独立展示，任务 `completed` 或一条已发送回复都不能代替消息处理终态。

“先 A 后 B”同时保存真实来源追溯和 SQLite 依赖。创建 B 与其依赖必须原子完成，调度和 claim 都拦住未满足依赖。A 完成后，Router 读取当前版本、验收条件和真实证据，选择认可、继续 A 或等待补充；Host 再校验 Router 身份、版本、当前前置状态和真实完成证据，才允许释放 B。旧版本完成、重复事件或模型摘要不能替代当前依赖评估。来源被编辑/撤回时旧安排变为 pending，Router 可以重新评估或重安排，不要求来源原作者另批。业务完成、依赖满足和通知送达分别记录。执行会话及实时补充仅接收本任务入边对应的当前完成证据、原事件/评估/条件和授权来源标识，入模前拒绝旧评估或版本错配；不复制前置会话、完整来源正文或全依赖图，见[单任务依赖输入](SINGLE-TASK.md)。

调整既有 B 的先后关系使用 `resident_task_action(kind: "arrange")`：提交真实来源、B 当前要求/控制版本、`expectedArrangementRevision` 和新的 `dependencies` **全集**，空数组表示清空依赖。Host 校验实际 Router、当前版本和依赖环后原子替换条件，递增安排版本并使旧评估失效；活动执行由同一接纳屏障实际取消/排空，等待及取消状态不构成额外调度许可门槛。重安排不结清未知效果、不伪造成功证据。旧依赖/旧评估冻结在 B 自己的 `task.arranged` 事件中保留审计。`resident_task_plan` 只为本次新建任务建立依赖，不能夹带新任务去无 CAS 修改既有 B。

普通已认证 Web `task.revise/reopen/control` 与 Router 共用账本的依赖重绑定责任层，不能因入口不同留下旧要求/控制版本。控制动作的合法新来源进入任务 `sourceRefs`，随任务归档保留；来源授权仍逐条核验，人工确认或复制档案不会扩权。仅有 Web 来源的任务可以保留 `requester` / `waiting-reply` 问题，但关联 `groupId` 不赋予 IM 来源、群成员或交付权限；无真实群来源时不发群、不回退操作者私聊、不声称已通知，授权 Web 答复仍按原任务/问题及要求、控制版本校验后由原执行会话续办，见 [单任务合同](SINGLE-TASK.md)。

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

`resident_router_reply` 可用 `recipientActorIds` 明确选择同一会话中有受信身份依据的一人或多人，值为 Host namespace 内部 actor 标识，`[]` 表示不提及。渠道插件负责将 Host 受众映射为原生 sender/mention/quote 字段；模型和显示名不能直接指定 vendor open ID。不得按姓名猜 ID，也不默认通知所有参与人；Router 不开放 `atAll`。指定受众时默认使用普通 Markdown，不隐式引用或额外 @ 原作者。受众与正文、来源、文件选择一并冻结在 `replyRequest`，相同 operationId 改换受众明确冲突，不能变成新一轮发送。

`replyToSource` 是仅接受 `true` 的可选公开字段，不接受 `false`；只在原请求明确要求原生引用本次原消息时使用。Host 从已校验的本次 `sourceId` / `messageVersion` 绑定原消息和真实作者，不开放另选引用消息/作者的参数。`recipientActorIds` 必须显式包含该原作者；缺省、空数组或缺作者均拒绝，其余受众仍须是同会话受信成员。引用目标、作者及受众按现有 `replyRequest` 冻结与去重，省略 `replyToSource` 时保留默认行为。

## Router 最终文件交付

`resident_router_reply` 的可选 `taskDelivery` 为 `{taskId, requirementRevision, artifactIds}`。Router 先经 `resident_task_query` 读取任务 `completion.result.artifactFiles`，再显式选择该任务当前完成版本的 1–20 个不同冻结 artifactId；不接受任意路径或模型拼出的 descriptor，也不默认附上所有产物。Host 校验原任务来源、当前要求版本、完整 descriptor/manifest 与原 caption；源已撤权/过期、任务不再完成或恢复仍 held 时拒绝。

最终说明与平台到期回复复用现有通知格式，保留原文件名和 caption。`replyToSource:true` 可与 `taskDelivery` 组合，但仅引用父说明；文件子通知不继承引用，不宣称文件消息自身具备原生 quote/@ 能力。任务交付写入属于该 task 的 `status` 父通知及文件子通知，先确认最终说明送达，再依原顺序发送文件；冻结、`accepted` 或 Router settle 均不表示送达，unknown 先回读，不自动重发。归档包含该任务自己的父子通知，不带整群上下文；已归档任务只能继续已有合法未送达通知，不能重新创建交付，档案恢复仍保持 hold。未指定 `taskDelivery` 且未显式选择受众时，普通文本回复规则不变。

选择 `taskDelivery` 时，Host 在冻结正文和父子通知之前校验所选 taskId，内部编号不得出现在公开正文；失败直接返回 Router 工具，由模型订正正文后继续，不产生半条交付。发送通道仍保留安全兜底。本地正文校验若明确在外部发送前拒绝，记录为 `failed`、`knownNotSent:true`、`retryable:false`，不回读、不重试。旧版误记的 `unknown` 仅在单次发送、无 ACK/receipt、发送许可与 payloadDigest/fence 全匹配且原正文可重现同一精确本地错误时结清失败；网络异常、参数不匹配或已有接纳证据仍保持未知。此结清不改写冻结正文、不重跑已完成任务，也不放行依赖它的文件子件。

原始用户来源已公开指定的业务标记可能被选作同值 taskId；仅这种同值任务身份不按私有编号拦截，保留用户指定的文件名，其他身份及机制格式照常拒绝。准备与发送使用同一判定，发送时由 Host 按精确来源/版本/作者/会话临时提供原文，不接受模型声明豁免，不改冻结 payload/hash。安装操作者可通过既有本机通知恢复入口显式重评估 taskDelivery 的本地拒发：必须重现完整原错误并逐字段核对已持久化证明、唯一尝试及 permit/fence，消费 CAS 后重新核对当前来源授权、任务完成版本、未归档和冻结产物，正文仍不合法则拒绝。只有通过全部校验才续原通知；自动扫描不重试此失败。父说明真实 delivered 后才释放原文件子件；已有接纳证据或网络未知结果仅回读，不适用重发。

若前序通知尚未确认送达，文件子件的 `notification.start` 可先记录“未获发送许可”。前序说明/文件经回读确认为 delivered 后，Host 可按原固定 start 命令 ID 重新判定；仅限冻结 payload 不变、仍为 `prepared`、sendAttempt 为 0 且从未有 permit/token/开始时间/发送收据的子件。第一次获许可后同 ID 永不再授新发送；`starting` / `unknown` 仍只能回读，旧 false 收据既不能永久卡住首次发送，也不能成为重复发送的授权。档案恢复 hold 等原有门禁不因此解除。

## 平台到期回复与既有冻结发送

一次平台排期到期后仍用独立受限平台会话中的 `platform_task_query` 和 `platform_reply_submit`。这不新建业务任务，也不恢复 Topic 推理。平台回复保留 `sourceId` / `sourceRef` 审计来源；普通 Markdown 默认不引用原消息、不自动 @ 原作者。`platform_reply_submit` 可明确选择有同群身份依据的受众、`atAll` 及受控附件，只有平台类通知有权使用 `atAll`；内部来源不能被模型替换为其它群或账号。

既有已冻结的 `fixed-topic-reply` 及按原 unit 身份保存的平台排期可沿原来源、版本、正文和收据校验恢复，不重新调用 Topic 做决定。若缺少 SQL 发送账但已有开始发送、尝试次数、已送达 ID 或 unknown 等证据，保持 `fixed_topic_reply_delivery_unproven` 阻断，不能重建一条新发送掩盖未知结果。通知真正送达仍以 transport 收据/回读为准。

## 持续 Router 会话、Pi 压缩与旧交接恢复

每个认证 conversation 持续复用自己的 Pi 会话，队列排空或任务结清不再触发额外无工具交接/换代。任务状态、依赖、来源和回执仍以 SQLite 账本为准，原始 Pi journal 留存；压缩仅改变后续模型上下文投影，不删除历史，不授予新权限。

Router 单独采用 **256K = 262,144 token** 的有效预算，通过 Pi 1.5.0 的原生 `compaction.modelOverrides[provider/model]` 配置，不伪造模型真实 `contextWindow`。模型窗口为 C 时预算 B = min(C, 262144)，`reserveTokens = C - B + 16384`；Pi 在估算 token **大于 B - 16384** 时触发自动压缩。窗口不小于 256K 时水位是 **245,760 token**。这是检查水位，不是每次输入或工具返回的硬上限；超大单批仍可超过预算，真实上下文溢出仍由 Pi 处理。

`keepRecentTokens` 使用 Pi 默认约 20,000 token，较小窗口降为不超过 `(B - 16384) / 2`，让摘要和后续输入仍有空间。更小模型不能被扩成 256K；窗口无效或不大于原生 16,384 预留时明确报错。一级分诊采用独立64K预算；任务执行不继承 Router 的配置，保持 Pi 默认值。模型选择在创建/恢复时重新解析并建立该 provider/model 的覆盖；其它模型不会误继承大模型的 reserve。模型配置仍遵循现有 `restartRequired` 契约：设置保存后重启 Host 生效，再恢复同一 Router journal 并重算预算。当前 Host 无运行中模型切换入口，若以后增加，必须同步重算其覆盖。

Pi 保留最近原始尾部和较早内容的模型摘要；不会机械保证摘要语义完整，也不保证压缩耗时。压缩期间当前 Router 仍可能等待。生产应观察压缩耗时、前后 token 和消息等待，不把本地脚本验证称为真实模型性能验收。

旧部署可能留下 `handoff`、`summarized`、`candidate-committed` 或 `published` 记录。本版本仍恢复这些记录：未完成摘要按严格 journal 证明恢复原 owner；已提交摘要/候选验证旧提交、准备/发布新 owner；保留原历史和迟到输入且不重放业务。不再生成新的日常交接摘要或累计本代全量 source 引用。


摘要失败、截断、必要引用缺失或新代提交不完整时，不清空旧 journal，不回滚已完成业务，不重放动作。只有旧代提交、owner 和排空仍可信时才可恢复普通处理；SQL/Pi 不一致、旧实例已 fence 或效果不确定时保持阻断，依既有严格 journal 解码和维护证据恢复。连续流量未排空时继续处理，不假装空闲；Pi 原生阈值压缩仍保留。

### 已接纳未结批次的安全续办

Router 批次已经 `admitted`、随后模型轮失败且事件尚未 `settled` 时，普通恢复不能把它重新 `enqueue` / `deliver` 成另一份业务输入。正常停机留下的最后 `aborted` 生成由 Host 普通恢复沿原会话领取一次；其它模型 `error` 仍只允许受信 Host 显式调用 `application.tasks.resumeRouterBatch({conversationId,generation,sessionId,packetId,failedEntryId})`，绑定原 conversation、当前 generation/Router active session、原 packet 和原生失败 checkpoint；该方法拒绝模型域调用，没有新增 HTTP、CLI 或模型工具入口。它是 Host 集成合同，不是让操作者绕过应用直调 Pi SDK 的操作方式。

续办前重新校验 active owner、原官方会话 idle、来源权限、packet/历史一致性及未结事件全集。原事件必须仍是队列前缀；较新事件全部经原业务 admission 校验，写成真实 `night.business-input` 后才触发推理，current 来源同时绑定原 packet 与新 packet。模型先统筹新取消/延期/变更，不能只沿旧请求执行。原 packet 不重复 enqueue/admit，控制消息不是来源或新授权。联合批次仍至多15条用户消息、30事件及原编码预算；pending 总数必须与已读取全集一致，分页外较新输入或超限仍拒绝，不能忽略后续取消以求恢复。

原批次身份比较忽略可变的来源观测计时，以及独立首答通知的发送/回读进度（如 prepared→delivered）；通知ID、种类、冻结正文/载荷摘要、来源/版本和撤销状态仍须一致。比较不改写原packet或Pi历史，不把旧packet中的发送状态当作当前送达权威；真实效果仍以Host投递账本和回读为准。

固定 Pi 1.5.0 在生成 `aborted` assistant 后先结束回合，尚未进入工具派发，因此只允许最后中断消息里的生成调用不要求 toolResult；之前 `toolUse` 的未配对/错误结果、未决 job 或 task effect-intent 仍阻断。不修改历史、不补造工具结果，也不据此宣称外部世界完全无效果。

Host 经公开 Pi 生命周期接口先持久消费原失败 checkpoint 的非业务 claim，复核后接纳较新真实输入，再沿同一历史继续；推理前再次校验完整队列、来源版本和 owner。并发、重复/过期 checkpoint、外来会话及未知效果均拒绝。失败保留 journal 和未结事件，已领取的检查点不自动循环重试；只有联合批次全部事件真正 `settled`，才继续正常排空并清除对应 Router 告警。

普通 `recover()` 的 phase 恢复和已 `published` 交接的旧 owner 清理，也经同一 conversation 的 tail 串行执行；排队后重新读取当前 row/rotation，不把仍在途的交接当作冷中断。不暂停恢复 timer、不因 busy 静默跳过，也不放宽 live owner 守卫。原批次已经 `settled` 时不再调用 `resumeRouterBatch`，只由正式普通恢复推进该 Router 旧部署尚待完成的交接/换代，不重跑原任务或业务输入。

不满足上述中止恢复条件时，冷启动仍将确定的 `ROUTER_BATCH_UNSETTLED` 保留为任务服务 `recover()` 的 `degraded` 结果及现有 `listAlerts` 恢复告警，以保留上述 Host 入口；不代表恢复完成或消息已消费。其它 journal、owner、store 恢复错误仍失败关闭，不能被另一个 conversation 的未结告警遮蔽。正常关闭的结果不证明错误关闭已安全释放全部资源；Host/Application 异常关闭及未证排空时的依赖保留规则见下文。

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

资源读取保留图片、UTF-8 文本、XLSX、在线 adoc 的既有返回形态；其它可下载附件（如 PDF、Word、未知二进制）返回完整 `file: {data: Uint8Array, name, mediaType}`，不把平台 ID 当路径或公开链接。Host 校验名称、MIME、大小与完整性，在本任务 materials 发布安全哈希名原件，计算字节数/SHA-256，并将 `{name,mediaType,path,bytes,sha256}` 传给任务。文件描述符不携带账号、签名链接、下载目录或内联二进制；临时文件在返回字节后清理。单资源上限 8 MiB，文件不可读时明确 unavailable，不以静默文本降级掩盖错误。该形态不增加格式解析器，不自动执行文件，不覆盖历史 unavailable 快照。

群消息不会仅因发送者与当前账号相同、显示名相同或带通用 DWS 标记就被视为本实例回声；Host 使用同 conversation 下精确消息 ID 与持久 outbox / send ACK / receipt 识别自己的发送。对于 Router/任务队列的通知，关闭 `dingtalk_operator_notifications` 仍使用该 DWS 插件自身 adapter 查询发送身份，经持久渠道 context 将内部 conversation 映射为原生会话并精确核对，再在消息事实和来源持久登记之前过滤自己的消息；身份回读不改变附件交付状态，也不替代文件字节验证。

同会话队列通知仍为 `starting` / `unknown` 且身份未决时，不能排除回声的 typed 入站以 `CHANNEL_NOTIFICATION_IDENTITY_PENDING` 暂缓，不能把超时、查询失败或未确认当作真人来源。bridge 沿既有持久 `recoveryFromAt` 补读水位恢复，水位写入失败保留错误，不靠注入或重放业务修补。本次 resolver 只接队列通知；原 native operation 的 send/status 分支未统一 typed scope/query 接线，不据此外推 shell 原生发送的通用回声能力或验收。有界等待只限制调用方等待时间，当前 observer 关闭不 join/cancel 在途状态查询，底层 CLI 仍可运行至 runner 自身超时；runner 超时后也未等待 child 的真实退出，不能从 bridge 消息/水位排空外推全部旁路进程已排空。正常退出只按本次实际可观察实例及资源逐项核实。上述为实现合同，不代表现场已通过；当前 DWS/profile 是否推送同账号在单成员群中的原始消息仍须实测。`dingtalk_listen:false` 下的 `acceptHistoryMessage`、SDK 注入和 fake 仅验证本地链路；真实订阅、原始入站、群内交付/回读和复盘须分项留证。

钉钉接入状态区分恢复与日常轮询：首次历史补拉、监听未 ready、持久恢复界或 `recoveryRequired` 未解除时保留 `recovering`；已有成功历史且无恢复缺口的普通增量拉取，即使 `inProgress` 也保持 `receiving`。补拉失败仍报告错误，供应商完整性、身份校验、Host 接纳和耐久消费条件不变。

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

### Router 空闲交接与任务完成延迟（历史实现，已由上述持续会话方案替代）

Router inbox 暂时为空不代表会话已空闲。会话仍有未归档的 active/active 任务时，保留当前 Pi generation，优先接纳后续补充和任务完成事件，不在每次安排结束后立即启动无工具交接。任务结清后仍经原来的耐久摘要、候选提交和唯一 owner 发布流程轮换；长会话的上下文仍由 Pi 管理。已开始的交接不能旁路，期间到达的事件继续耐久排队。此优化避免可预见的完成事件等待不必要轮换，不表示已开始的交接耗时已被消除。

### 首答承接与 Router 处置

分诊首答是反馈而非任务启动收据或新增授权。Router 根据原消息、身份/引用和
当前职责独立判断；明确交办的只读排查应创建或续接唯一任务，不退回泛泛的
“是否需要处理”。必要澄清只问具体缺少的目标、范围或输入；误分诊、明确交给
他人及当场可完成的答复允许不建任务，排查不扩大为外部写操作。

对于带冻结首答的来源，`resident_router_settle` 须有同来源/版本的任务动作关联，
或者提交 `noTaskDispositions`（eventId、完整 sourceQuote、outcome、reason；
clarification 还须 missingInformation 和同源同版本 Router 回复 notificationId，不能借用分诊首答或失败通知）。Host 校验事实绑定与处置形状并持久保存，
不按回复文案推断意图、不自动信任分诊，也不新增人类调度授权门槛。该检查不能
代替模型理解：模型仍可能给出错误但形式完整的判断，需结合日志审查语义。
prepared/delivered 首答状态不影响上述要求。计划持久化、执行输入接纳、业务
完成和通知送达是四个不同事实；验收应观察实际任务动作与 Pi 执行输入。

### Historical source context

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
