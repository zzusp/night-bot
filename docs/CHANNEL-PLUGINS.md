# Channel plugins (API version 1)

The default Host starts with no channels and never probes DWS. Channel code is
trusted executable Host code, installed by the operator, with service-account
permissions; it is not a model sandbox or an untrusted marketplace installation.

## Discovery and activation

Configure `channelPluginDirs` with installation-relative (or explicit absolute)
directories. Each immediate package subdirectory may contain `night-channel.json`:

```json
{"apiVersion":1,"type":"example-chat","entry":"index.mjs"}
```

Entry paths must resolve inside that package. Discovery reads manifests only;
it does not execute their modules. Duplicate types, including overrides of built-in
types, fail startup. A directory listing alone never enables a plugin. Enable
instances explicitly:

```json
{
  "channelPluginDirs": ["plugins/channels"],
  "channelPlugins": [
    {"type":"example-chat","channelId":"personal-account","enabled":true,"config":{}},
    {"type":"dingtalk-dws","channelId":"dingtalk-room","enabled":false}
  ]
}
```

Enabled instance IDs must be unique. Disabled instances do not import or invoke
code, create account directories, register transports or probe executables.
`dingtalk-dws` remains a built-in optional type for compatibility; the Host has no
vendor-specific composition logic. Multiple enabled instances may use the same
type when the plugin supports it. DWS namespaces cache/state/workspace directories
by channel ID; account directories are namespaced only in private-account mode.
System-account instances share the external CLI credential context. Instances are available by their explicit channel ID in `channels.plugins`;
do not select a target by assuming a first-instance service alias.

## 钉钉专用 CLI 与离线配置

`node bin/night-bot-dingtalk.js CONFIG` 提供 `list`、`add --channel-id ID --json CONFIG_JSON [--enabled true|false]`、`set --channel-id ID --json PATCH_JSON`、`enable`、`disable` 及显式 `env` 导入。`add/set` 的 JSON 只含公开 `dingtalk_*` 配置；`channelId/enabled` 属于实例外层。名称与 Prompt 通过 `dingtalk_name/dingtalk_prompt` 设置，不接受旧的 `groups[].responsibility`、`config.responsibility`、`accountMode`、`listen`、`writesAuthorized` 或任意扩展字段。

所有修改先加 `--check`：只校验拟改配置和 ingress 检查点，不创建锁、不落盘、不调用 DWS 或验证登录。去掉 `--check` 后，CLI 必须取得离线 Host 锁，再保存每渠道暂停/补拉检查点和配置；Host 运行时拒绝写入，不提供在线热更新。返回 `changed`、`checkOnly`、`restartRequired`、`liveApplied:false`；配置未变化但检查点变化也会要求重启。`list` 只显示实例标识、启用、名称、会话类型和是否配 Prompt，不输出绑定、账号登录资料或 Prompt 正文。

`env` 只消费本次显式传入环境的 `DINGTALK_*`：单实例用 `DINGTALK_CHANNEL_ID`、`DINGTALK_ENABLED` 和对应公开字段的大写名称；布尔值只接受 `true/false`。多实例用 `DINGTALK_CHANNELS_JSON` 的完整实例数组，不能同时提供其它非空 `DINGTALK_*`。普通 `add/set` 参数不与环境字段混用；环境中没有相关字段时 `env` 不改配置。首次准备保持实例禁用、监听/发送为 false，不依赖默认值阻止连接。

启用实例后才按已配置的账号和目标核真实登录并绑定。缺登录为 `waiting-auth`，登录元数据更新可触发重新解析接入；其它错误保留失败，不放宽身份或循环尝试未知目标。普通配置修改和离线 `enable/disable` 按 `restartRequired` 正常重启；停用期间的原下界和未完成补拉保留，恢复继续既有 bridge 与去重，不删除 ingress 文件或倒退业务 `ingressEpoch`。binding 在安装内 `data/config/channels/`，水位在 `data/state/channels/`，工作文件、缓存和私有账号另按安装目录分区；均不入 Git。 已认证的暂缓消息只在同一渠道游标中保存 ID/时间、不存正文；未找回已知消息的 `complete` 补拉不能清除恢复界，旧 bridge 快照也不能覆盖新消费/暂缓记录，具体完成判据见 [渠道恢复合同](CHANNELS.md)。

操作命令见 [Windows 接入流程](ops/windows-local-runtime.md#指定钉钉群接入)，容器配置见 [Docker 运维](ops/docker-deployment.md)。以上为实现与操作合同，离线保存、监听 ready 或健康状态均不替代当前版本的隔离测试和真实账号/订阅/送达验收；当前结果统一见 [验收入口](acceptance/resident-conversation-routing/goal.md)。

## Lifecycle and capabilities

An ESM plugin exports `inject=['channels','runtimePaths']` and `apply(ctx,config)`
(the standard Cordis plugin contract). `config.enabled` and `config.channelId` are
Host-selected. In `apply`, register its transport and optional observers; attach
listeners to `night/ready`, after the application and durable services exist.
Register an idempotent stop via both `night/stopping` and `ctx.effect(()=>stop)`.
Stop ingress, terminate/await subscriptions, then invoke every unregister callback.
Host shutdown drains admitted channel work. Exceptions during loading fail Host
startup and dispose loaded plugins; no partial-success startup is claimed.

`channels.registerTransport(channelId,transport)` requires `send` and `readback`.
Optional methods are `sendFile`, `readbackFile`, `readMessage`, `readResource`,
`readMentioned` and `canSend`. Optional `capabilities.conversationTypes`, `files`
and `quotedReplies` list the supported `chat`/`chat-room` kinds. File and
conversation admission use these declarations; a plugin must reject unsupported
operations itself too. Quote support describes actual delivery, not an inference
from a successful plain-text send. `registerPlugin` can publish health/controls
without adding a global vendor-specific Host service.

Ingress is `channels.receive({type,channelId,conversationId,senderId,messageId,text,
sentAt?,resourceRefs?,quotedMessage?,mentionedAgent?,mentions?,platformFlags?})`.
The adapter must authenticate conversation and sender IDs. `quotedMessage` has
`messageId`, optional `senderId` and `text`. `mentions` contains platform-authenticated
sender IDs, not display names. `platformFlags` is scalar metadata; the reserved
neutral boolean `automated` marks platform-proven automated output. Missing flags
are unknown; adapters must not infer them from display names or prose.

Room participants share a room scope; a `chat` includes its sender in the scope.
Channel ID separates accounts and plugins. Principal IDs are namespaced by channel.
Message deduplication includes metadata; conflicting reuse of an ID fails.

Outbound methods receive a neutral envelope with type/channel/conversation,
`deliveryKey`, text, `replyToMessageId`, `senderId`, `recipientIds` and optional
`replyToParticipantId`, followed by the durable notification. Active notification
fields `recipientActorIds` / `replyToActorId` are trusted Host-internal actors;
Channels validates them in the authenticated conversation before mapping them to
transport participant IDs. `chat` also validates the actors but sends native
`recipientIds: []`. The DWS plugin alone maps the envelope to
`atOpenDingTalkIds` / `replyToSenderOpenDingTalkId`. Preserve the notification's
idempotency identity. If a send may have happened, use readback; missing evidence
never authorizes a fresh send.

Transport `readMessage` returns a matching `messageId`, original channel
`conversationId`, authenticated `senderId`, text and optional quote with
`senderId`/text. The Host checks the message/conversation and converts
`channels.readResource('readMessage', ...)` to internal `conversationId`, optional
`actorId` and neutral `quotedMessage` (`conversationId`, optional `actorId`,
`text`). This public read view omits top-level `groupId` / `senderOpenDingTalkId`;
it is distinct from the preserved historical resident ingress/outbox projections.
Historical notification payloads, digests and source identities are not migrated
or rehashed; the read projection accepts the old fields. Old sourceKind values
remain readable; new unified ingress uses `sourceKind: 'channel'` and persists
channel type/ID, quote author, mentions and platform flags through restart.

## DWS interfaces verified and remaining limits

Checked the official CLI tag **v1.0.63**, commit
`4cd5d05393a8748e89d9265eb9f7ec85745a0331` (source inspection, not a locally
installed binary or a live account):

- `event +listen-im --kind group --chat-id ... --events message --format ndjson`
  is declared in `internal/app/event_listen_im.go`. The broader `all-direct`
  intent exists but is never used by this adapter.
- `internal/event/personal/output.go` publishes `quoted_message` with
  `sender_open_dingtalk_id`, message/conversation IDs, content and create time.
  The event schema does not promise @ or automation metadata. When present in
  compatible output/history, those fields are preserved; absence stays unknown.
- `chat +messages-send --as user --open-dingtalk-id ... --text ...
  --idempotency-key ... --yes --format json` is supported by
  `internal/shortcut/chat/unified_send.go`. Open IDs are not passed as `--user`,
  which performs a different identity resolution. Group quoted sends retain the
  existing native reply path and native mention flags.

钉钉公开配置以 `dingtalk_*` 为唯一入口，完整目标字段见 [渠道职责配置](CHANNELS.md#渠道职责配置)。每个实例必须有独立 `channelId`，并用 `dingtalk_conversation_type` 选择一个群聊或一个私聊目标。群名/姓名仅用于显式查找；实际登录资料、组织、userId/open ID 与 conversation 须完整解析并耐久绑定，未找到、多候选或身份变化拒绝。`dingtalk_binding` 可提供版本 1 的固定身份约束，但不得手工猜造身份；正常运行由插件保存安装内绑定，重新启动也须核对。

私聊用 `dingtalk_conversation_type:"chat"` 和 `dingtalk_user_id` 或 `dingtalk_user_name` 显式选择对端。内部 `directPeers`、`assistantActorId` 由绑定派生，`directChats` 不是公开开关。实时订阅沿用 `event consume user_im_message_receive_o2o --open-dingtalk-id PEER --flatten --format ndjson`，不使用 all-direct 或泛发送人订阅；此 specific-conversation 事件及 target/flatten 参数由官方 `internal/event/personal/registry.go`、`internal/app/event_command.go` 定义。

额外 operator 回复只在 `dingtalk_operator_notifications:true` 且提供非空 `dingtalk_operator_peers` 时启用；可选 `dingtalk_human_user_id`、`dingtalk_current_user_name` 供已有 operator 适配路径使用，不替代业务对端绑定或授权。operator 和业务私聊是两条路径，不希望双路处理时不要配置同一对端。只列 peers 不开启功能不会订阅；订阅、事件和恢复均限制在明确对端/会话，不能收集任意私聊。原始字段名及 vendor 命令继续留在插件，Host 使用中性身份。

Private quoted replies use `chat +messages-reply --open-dingtalk-id ...
--conversation-id ... --message-id ... --ref-sender ... --content ...
--idempotency-key ... --yes`, verified in `chat/lark_alignment.go` and
`chat/reply_extensions.go`. The CLI verifies both source identity and the peer's
conversation before sending. Plain text sends without a source use `+messages-send`.
Both paths retain idempotency and exact SUCCESS status readback
bound to the original conversation. They do **not** claim private-chat
mentions or file delivery. Missing send acknowledgment stays unresolved without
resending. Group/history/media/file and operator capabilities retain their prior
adapter paths. 新版业务私聊已复用 bridge 的暂停/恢复与范围历史补读：只读绑定对端的 `chat +chat-messages --open-dingtalk-id ... --start ... --end ... --order asc --page-all`，必须取得完整结果并逐条校验身份及时间；不完整或错会话/对端拒绝。群聊和私聊均保留每渠道持久水位及去重，不按重启重新定起点。此为当前实现合同，未证明真实私聊订阅、补拉、引用或发送已验收；operator 恢复仍独立核对。

本节最初的 v1.0.63 官方接口/源码检查阶段未配置 CLI 二进制或真实账号，也未发送钉钉消息；当时的“不连接、不部署、不发送”只描述该阶段，不代表当前分支从未做过现场验收。后续 SG9 已在明确授权的指定测试群完成独立事项的文本/附件交付、平台回读、持久复盘及必要冷恢复，实际受验版本和未验边界见[第七轮报告](acceptance/resident-conversation-routing/round-7.md)。该结果不外推为任意账号、私聊、重连或全平台能力均已验收。

SG10 的[第八轮报告](acceptance/resident-conversation-routing/round-8.md)已记录默认 CLI、渠道中立映射/附件、operator/requester 分流、私有 Skill 读取、Host 显式续办与原安装普通交接恢复的实际终态；各组结论只绑定各自源码/测试指纹，不相加为最新版本全量通过。本轮使用 loopback 脚本模型及 fake 渠道，没有新增真实模型或厂商请求、监听、发送，也没有部署 Linux；fake 映射回归不追认为第七轮在新版代码上的现场验证。长期目标和交付状态以[唯一验收入口](acceptance/resident-conversation-routing/goal.md)为准。

## Existing system login and optional private-account storage

The official v1.0.63 `pkg/config/constants.go` selects `DWS_CONFIG_DIR` over
`~/.dws`. Configuration location is separate from credentials:

- Linux `internal/keychain/keychain_linux.go` stores encrypted token files and DEK
  below `DWS_KEYCHAIN_DIR/dws-cli` (otherwise `~/.local/share/dws-cli`).
- macOS `keychain_darwin.go` uses ciphertext below `DWS_KEYCHAIN_DIR/dws-cli`
  (otherwise `~/Library/Application Support/dws-cli`) and a system Keychain DEK.
  The system Keychain dependency remains; no claim of an independent OS security
  principal or validated macOS runtime is made.
- Windows `keychain_windows.go` stores DPAPI-protected values in
  `HKCU\Software\DwsCli\keychain\dws-cli`. `DWS_KEYCHAIN_DIR` only affects portable
  auth-bundle placement there, **not** the credential backend. HOME, USERPROFILE,
  XDG, APPDATA and DWS_CONFIG_DIR cannot partition these registry credentials.
  `DWS_KEYCHAIN_TEST_NAMESPACE` changes the registry namespace, but its declaration
  in `keychain.go` explicitly says production must not set it.

Existing operating-system credentials are a legitimate external CLI dependency.
Night Bot does not need to own or relocate them to use the current user's DWS
login. Central storage rules apply to Night Bot-managed secrets; they do not turn
third-party system credential storage into a prerequisite for independent login.

`config.dingtalk_account_mode` selects the actual behavior:

| Mode | Default | Behavior |
| --- | --- | --- |
| `system` | Windows | Use the current OS user's existing CLI configuration and protected credentials. Preserve HOME, USERPROFILE, APPDATA/LOCALAPPDATA and explicit inherited DWS_CONFIG_DIR/DWS_KEYCHAIN_DIR selections. No credential copy/export, login, registry edit or encryption changes. |
| `private` | Linux/macOS | Set the official config/keychain paths below the plugin's private account directory. Independent token/config files; macOS still uses a system Keychain DEK. No guarantee of separation from other trusted programs running as the same OS user. |

`system` is also available explicitly on Linux/macOS. Windows `system` works
without an extra opt-in or isolation acknowledgment beyond enabling the channel.
Only an explicit Windows request for `private` fails with
`DWS_PRIVATE_ACCOUNT_UNSUPPORTED_ON_WINDOWS`, because that requested capability
cannot be supplied by the examined CLI. This is a mode-specific error, not a ban
on the Windows channel. Disabled plugins still do nothing.

准备复用当前用户已认证账号的禁用配置如下；启用仍须另获连接授权：

```json
{"channelPlugins":[{"type":"dingtalk-dws","channelId":"dingtalk-room","enabled":false,"config":{
  "dingtalk_account_mode":"system","dingtalk_profile":"YOUR_PROFILE",
  "dingtalk_conversation_type":"chat-room","dingtalk_group_id":"YOUR_ROOM_ID",
  "dingtalk_name":"指定群助手","dingtalk_prompt":"仅处理本会话明确授权的请求。",
  "dingtalk_listen":false,"dingtalk_writes_authorized":false
}}]}
```

The plugin publishes `accountPolicy` in `channels.plugins.get(channelId)` and
`transport.capabilities.account`: system mode reports `credentialScope:'os-user'`,
`sharedAcrossInstances:true`, `independentLogin:false` and external CLI ownership
of configuration. `accountDirectory` is undefined in system mode; no empty private
vault is created that could imply the system credentials were moved there.
Per-channel state/workspace isolation still holds, but channel IDs and profile
names do not prove separate external accounts.

Multiple system-mode instances can share DWS credential slots, account indexes,
refreshes and current-login/config selection. DWS may use identity-scoped token
entries internally, but profiles or separate HOME/config folders do not provide
an independent Windows keychain. Logging in, switching account, resetting auth or
changing CLI config elsewhere under the same OS user can affect running instances.
Use an explicit profile, keep account-changing CLI operations out of the bot's
runtime workflow, and revalidate the account after a deliberate login switch.
运行时绑定中的 `actorId` 用于核对精确发送身份与回读；它不是公开的
`assistantActorId` 配置入口，也不能以同账号发送人替代消息级回声收据。 If genuinely
independent Windows account lifecycles are needed, use separate OS users or wait
for an upstream production-supported credential namespace. This is an optional
multi-account deployment choice, not a single-account startup requirement.

Neither mode injects plaintext `DWS_*` authentication overrides, a test registry
namespace or DWS_DISABLE_KEYCHAIN into children. Both preserve OS protections and
scope the subprocess temp directory. In system mode, DWS-owned config/keychain
state and any CLI diagnostic/cache files may remain outside Night Bot's `data/`;
Night Bot backup does not include those credentials. A restore needs a separately
available CLI login. 本节最初的账号策略检查仅覆盖 Windows 环境/策略单元测试及无账号连接的注册 fixture，没有在该阶段使用真实 Windows 账号；这不是当前全分支的运行结论。后续指定群的 Windows 现场事实见[第七轮报告](acceptance/resident-conversation-routing/round-7.md)，SG10 当前分组结果见[第八轮报告](acceptance/resident-conversation-routing/round-8.md)，不据历史策略测试或本轮 fake 映射回归推断新增现场结果。

## 旧 DSH 对照与只读边界

旧 DSH 的 README 和实现只作为能力对照，不是 Night Bot 已完成的实测证明，也不是迁移入口。Night Bot 不恢复旧的 `Topic → Owner → 多 execution session` 编排：当前每个认证 conversation 只有一个常驻 Router，每个事项只有一个执行 session；任务安排、依赖释放、效果收据、排空和恢复仍由 Host/SQLite 强制执行。

- `src/channels/loader.js` 中内置 `dingtalk-dws` 的 entry URL/type 只是可选插件类型注册；`src/config.js` 校验通用 Host 配置，钉钉公开字段由插件纯校验器处理。默认 `channelPlugins` 为空，或实例为 `enabled:false` 时，不导入渠道插件实例、不注册 transport、不探测 DWS 可执行文件、不订阅、不创建账号目录。该合同不要求默认依赖图中历史消息/收据 helper 全部零加载；保留 `group-message` 兼容 helper 不代表运行 DWS。第八轮两个默认 CLI 受验分组实际观察 launcher/服务两进程：DWS 插件、runner、bridge、adapter 加载为 0，DWS 进程调用为 0，历史 `group-message` 格式 helper 加载为 1；均完成本地任务和正常 IPC 退出。结果按该报告所列分组版本成立，不能由静态 URL 外推，也不能宣称所有历史 helper 已从依赖图移除。
- `src/tasks/single-session.js` 使用 `src/channels/message-safety.js` 的中性会话规则进入单一执行会话；它不创建旧式 Owner 或子执行会话。Router 的 `resident_router_reply.recipientActorIds` 是 Host namespace 内部 actor 标识，空数组表示不提及；Channels 先在已认证 conversation 校验，再映射为 transport 的 `recipientIds` / `replyToParticipantId`，DWS 插件最后映射原生 mention/quote 字段。显示名、正文中的姓名、旧报告或通用 DWS 标记都不能替代 recipient authorization；引用、提及和署名由 Host 依据冻结 payload 处理，模型不得自行拼接内部身份或重复署名。
- 旧 DSH 的连续执行、skill 读取/`skillNames` 传递、`job_list`/`job_output` 和后台进程排空可作为行为对照。Night Bot 复用受控 skill、文件/进程工具和 job 观测能力，但 skill 只提供读取/提示，不产生动作授权；后台 job 必须在当前事项的 Host scope 内，终态和 drain 证据不能由模型自报替代。第八轮核证原安装一个已授权的通用只读计划审查 Skill 及配套引用的实际读取，原 task/session/completion 和 `completed/drained/run1` 保持；并非旧技能全集兼容、后台命令或业务效果全覆盖。技能正文/引用只留原安装忽略目录，独立包版本与公开分发许可未核，不随代码提交。旧 DSH 的委派协议、共享工作区和多 execution 生命周期不自动兼容，也不应通过适配器恢复。
- 旧 DSH 将 operator 技术问题与 requester 业务问题分流；Night Bot 的技术问题缺省为 `operator`，业务问题须显式选择 `requester`。第八轮本地 Host 验证缺省问题仅留内部 Web，显式 requester 保持原 conversation/session/受众，Web-only requester 不创造 IM 权限；不表示本轮实测了 operator 私聊发送。回复来源、权限、版本 CAS 和真实送达收据仍按当前任务合同核验，既有持久问题/unknown 通知不改写。
- 旧 DSH 的 alias、secret binding 和署名配置不迁移个人身份或秘密。Night Bot 只接受部署者私有配置中的明确 actor、profile、`replySignature` 和群职责；Host 最多附加一次署名，配置文字不创造授权、跨群访问或外发许可。账号登录、profile、群成员、真实回声、附件上传下载、readback/receipt 和无工具复盘必须分别做 live acceptance。
- Windows 的安装模式只在当前实现支持的隐私边界内宣称能力：`find` 在已授权普通文件表内进程内 glob，不启动 `rg`；`grep`、shell 和后台作业仍需要模型子进程 privacy，缺失时失败关闭并保留 `MEMORY_PROCESS_PRIVACY_UNAVAILABLE`。这不由小文件演示或旧 DSH 的 Linux sandbox 记录覆盖。Linux 运行前置和验证入口见 [Linux 隔离运行](ops/linux-contained-runtime.md)；未满足 bubblewrap/内核前置时不得关闭 sandbox 或改成无隔离执行。

旧仓源码、历史 README、fake/SDK 注入、`acceptHistoryMessage`、listener ready、health=ok、send accepted 或本地脚本通过都不能证明 Night Bot 已等价替代真实 DWS 监听、模型执行、群内交付、附件回读、同账号回声过滤或持久复盘。旧仓保持只读，不导入历史数据、身份、业务设定、凭据或绝对路径；替代结论以当前 Night Bot 源码、定向测试和实际部署环境的独立证据为准。
