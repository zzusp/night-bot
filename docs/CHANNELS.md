# 渠道协议、轻量分诊与常驻 Router

Night Bot supports two channel-independent conversation types: `chat` for one
person and `chat-room` for a room with multiple senders. DingTalk is an optional
adapter; no DWS executable is required for the core or local protocol tests.

Trusted adapters submit `{type, channelId, conversationId, senderId, messageId,
text}` to `ctx.channels.receive`. The adapter authenticates these identities;
this is a Host API, not an unauthenticated public HTTP endpoint. Stable namespaces
separate channel providers, conversations, private senders and rooms. Private
sessions use personal memory; room sessions use only that room's memory. Every
room message retains its actual sender in durable source metadata and model input.
No private note is injected into a room. Models cannot select another principal.

Register an explicitly configured transport through
`ctx.channels.registerTransport(channelId, {send, readback})`. These functions
receive a typed envelope containing the original channel/conversation, a stable
`deliveryKey`, the exact original `replyToMessageId`, sender and text. `chat`
envelopes have no group mentions; `chat-room` mentions are derived from registered
participants. A missing transport leaves delivery prepared with an explicit
maintenance error; it never falls through to DWS. Transport implementations must
retain idempotency/readback evidence and report uncertainty honestly. No connector
or real account is enabled by initialization.

A standalone Host supports scoped conversational turns. Once the real task service
is attached (the standard managed service composition), it owns the channel
triage ingress. Adapters must start ingress after that composition is ready and
stop it before shutdown. The current SDK supplies this integration boundary;
it does not claim integrations with all messaging platforms or install accounts.
The retained internal transport facade has historical DingTalk field names, while
the public typed protocol and adapter delivery envelopes remain channel-neutral.

## 渠道职责配置

职责、助手设定和工作规范由可信部署配置提供，不从入站消息或任务摘要提取为配置。DWS 使用 `channelPlugins[].config.groups` 列出群，每项可为群 ID 字符串或 `{groupId,responsibility}`；`config.responsibility` 是该插件已列群的可选默认职责。解析顺序为本群显式字符串 → 本插件默认字符串 → 未指定；空字符串 `""` 明确清空，未指定时保留本群原职责，新群采用通用默认。重复群 ID、空群 ID 或非字符串职责拒绝。

配置只匹配已认证的 `chat-room` / `channelId` / `conversationId`，不借用其它群或其它渠道的职责，也不将群配置套给 `chat` 或未列群。插件启动时读取配置快照；文件修改后须正常停止并重启。已存在的认证会话同样解析本次配置，入站时仅明确配置值变化才更新 resident 群记录，不限于首次订阅。

标准任务服务把同一会话职责传入四个角色的系统指令：一级分诊 `channel-triage-scope`、Router `resident-conversation-scope`、执行会话 `task:group-responsibility`，以及按任务所属群解析的独立无工具复盘。分诊与 Router 在每次系统指令编译时解析，执行和复盘在本次调用时取值；配置文字不进行模板插值，不混入用户事实，也不产生任务控制权、外发许可或跨会话记忆权限。职责配置不改变四角色分工、任务版本与依赖守卫。`task.completed` 只证明任务账本完成，不证明群消息或附件送达；复盘保留该证据边界。

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

`resident_router_reply` 可用 `atOpenDingTalkIds` 明确选择同一会话中有受信身份依据的一人或多人，`[]` 表示不提及。不得按姓名猜 ID，也不默认通知所有参与人；Router 不开放 `atAll`。指定受众时使用普通 Markdown，不隐式引用或额外 @ 原作者。受众与正文、来源、文件选择一并冻结在 `replyRequest`，相同 operationId 改换受众明确冲突，不能变成新一轮发送。

## Router 最终文件交付

`resident_router_reply` 的可选 `taskDelivery` 为 `{taskId, requirementRevision, artifactIds}`。Router 先经 `resident_task_query` 读取任务 `completion.result.artifactFiles`，再显式选择该任务当前完成版本的 1–20 个不同冻结 artifactId；不接受任意路径或模型拼出的 descriptor，也不默认附上所有产物。Host 校验原任务来源、当前要求版本、完整 descriptor/manifest 与原 caption；源已撤权/过期、任务不再完成或恢复仍 held 时拒绝。

最终说明与平台到期回复复用现有通知格式，保留原文件名和 caption。任务交付写入属于该 task 的 `status` 父通知及文件子通知，先确认最终说明送达，再依原顺序发送文件；冻结、`accepted` 或 Router settle 均不表示送达，unknown 先回读，不自动重发。归档包含该任务自己的父子通知，不带整群上下文；已归档任务只能继续已有合法未送达通知，不能重新创建交付，档案恢复仍保持 hold。未指定 `taskDelivery` 且未显式选择受众时，普通文本回复规则不变。

若前序通知尚未确认送达，文件子件的 `notification.start` 可先记录“未获发送许可”。前序说明/文件经回读确认为 delivered 后，Host 可按原固定 start 命令 ID 重新判定；仅限冻结 payload 不变、仍为 `prepared`、sendAttempt 为 0 且从未有 permit/token/开始时间/发送收据的子件。第一次获许可后同 ID 永不再授新发送；`starting` / `unknown` 仍只能回读，旧 false 收据既不能永久卡住首次发送，也不能成为重复发送的授权。档案恢复 hold 等原有门禁不因此解除。

## 平台到期回复与既有冻结发送

一次平台排期到期后仍用独立受限平台会话中的 `platform_task_query` 和 `platform_reply_submit`。这不新建业务任务，也不恢复 Topic 推理。平台回复保留 `sourceId` / `sourceRef` 审计来源；普通 Markdown 默认不引用原消息、不自动 @ 原作者。`platform_reply_submit` 可明确选择有同群身份依据的受众、`atAll` 及受控附件，只有平台类通知有权使用 `atAll`；内部来源不能被模型替换为其它群或账号。

既有已冻结的 `fixed-topic-reply` 及按原 unit 身份保存的平台排期可沿原来源、版本、正文和收据校验恢复，不重新调用 Topic 做决定。若缺少 SQL 发送账但已有开始发送、尝试次数、已送达 ID 或 unknown 等证据，保持 `fixed_topic_reply_delivery_unproven` 阻断，不能重建一条新发送掩盖未知结果。通知真正送达仍以 transport 收据/回读为准。

## 无工具交接与恢复

Router 常驻的是逻辑身份和业务记录，Pi 物理会话按 generation 管理。处理过新业务且当前轮次与待输入均排空后，Router 执行一次无工具交接：保留当前意图、未决问题、必要指代、标记为推测的假设、证据引用和截止游标。任务状态/依赖/回执仍由 SQLite 权威保存；大日志、附件正文和旧讨论留在原存储，不复制整个记忆或 Skill scope。

交接 JSON 总量限制为 **32 KiB UTF-8**；`currentIntent` 非空且最多 4000 个字符串长度单位，`unresolvedQuestions`、`referents`、`assumptions` 各最多 16 项、每项非空且最多 2000，`evidenceRefs` 最多 128 条、sourceId/taskId 最多 512。字段长度按 JavaScript UTF-16 `string.length` 计算，非 UTF-8 字节数。超限、截断或引用不全拒绝轮换，不裁剪关键语义，不清空原 journal；这些预算不等于语义保真证明。

交接先通过应用 admission 完成模型请求与 Pi 提交，再进入维护/排空边界、准备下一代并 CAS 发布 active 指针。新代提交前不能处理业务；发布后旧代失去业务权。切换期间的新消息继续耐久排队，只交给有权的 generation。尚在执行的任务不妨碍 Router 自身空闲交接，纯短回复/静默、交接本身和空新代不触发连续换代。

摘要失败、截断、必要引用缺失或新代提交不完整时，不清空旧 journal，不回滚已完成业务，不重放动作。只有旧代提交、owner 和排空仍可信时才可恢复普通处理；SQL/Pi 不一致、旧实例已 fence 或效果不确定时保持阻断，依既有严格 journal 解码和维护证据恢复。连续流量未排空时继续处理，不假装空闲；Pi 原生阈值压缩仍保留。

当前默认接线、失败路径与平台限制以 [本轮验收](acceptance/resident-conversation-routing/goal.md) 为入口；历史 Topic 分诊测试及本地协议计时不代表新 Router 或真实模型/渠道已验收。

## Plugin discovery

External channel packages are discovered from explicit `channelPluginDirs` and
activated only by enabled `channelPlugins` instances. API, manifest, lifecycle,
capabilities, multi-account isolation and DWS source evidence are specified in
[CHANNEL-PLUGINS](CHANNEL-PLUGINS.md).

## Optional DingTalk DWS plugin

The standard CLI composes `src/application.js`, not the historical DWS resident.
Initialization uses `channelPlugins: []`. Disabled rows do not load the adapter,
register a transport, probe a binary, subscribe or create an account home. The repository example is disabled; this registration-only example also disables listening and sending:

```json
{"channelPlugins":[{"type":"dingtalk-dws","enabled":true,"channelId":"dingtalk-dws","config":{
  "profile":"YOUR_PROFILE","accountMode":"system","listen":false,"writesAuthorized":false,
  "responsibility":"仅处理本渠道已配置群中明确授权的请求。",
  "groups":[{"groupId":"YOUR_ROOM_ID","responsibility":"填写该群职责、助手设定和工作规范。"}]
}}]}
```

`enabled:true` 会注册插件；`listen:false` 阻止自动监听，并不表示未加载插件。省略 `listen` 会在 `night/ready` 启动群订阅和历史补读，即使 `writesAuthorized:false`。后者只控制渠道发送，不替代连接授权或单条业务授权。真实接入前核对所列群和显式 profile，按 [Windows 接入流程](ops/windows-local-runtime.md#指定钉钉群接入) 分别启用监听和交付；本示例不会自动执行这些步骤。

Windows defaults to `accountMode:"system"`, using the current user's existing DWS
login with its DPAPI/HKCU protection. This does not copy credentials or claim
independent login per plugin. Linux/macOS default to private config/keychain files;
`accountMode:"system"` may also be selected explicitly there. Only an explicit
private-account request is unsupported on Windows. Credential ownership, shared
account effects and configuration examples are in
[CHANNEL-PLUGINS](CHANNEL-PLUGINS.md).
No account, actor ID, group or credential is bundled. Enable writes separately
only after checking authorization. `listen:false` supports explicit SDK ingress
without starting listeners. The plugin retains attributed DWS history, resource,
mention, file, subscription and receipt/readback adapters; typed ingress retains
the real sender and source quote. Night Bot-managed private account files live
in `data/secrets/dingtalk-dws`; system-mode credentials remain owned by DWS/OS.
Optional operator notifications require explicit plugin configuration and actual
operator/account identity validation. General private-chat ingress is separately
opt-in via `directChats`, `directPeers` and `assistantActorId`; it supports native
quoted text replies, not private-chat file delivery or general history catch-up.

群消息不会仅因发送者与当前账号相同、显示名相同或带通用 DWS 标记就被视为本实例回声；Host 使用同 conversation 下精确消息 ID 与持久 outbox / send ACK / receipt 识别自己的发送。这不证明当前 DWS/profile 会推送同账号在单成员群中的原始消息，也不证明真实回声已被正确抑制。`listen:false` 下的 `acceptHistoryMessage`、SDK 注入和 fake 仅验证本地链路；真实订阅、原始入站、群内交付/回读和复盘须分项留证。

`test/pi-channel-plugin.test.js` checks disabled/registered modes and the actual
standard application without any channel installed. Local adapter/domain contracts
exercise vendor protocol behavior with fixtures. A real DWS executable, login,
subscription reconnect, private operator routing and upload/download have not been
accepted against a live account. These remain channel integration checks and do
not block core initialization, tasks or local acceptance.
