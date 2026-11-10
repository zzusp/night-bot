# Windows 本机隔离运行

## 范围

使用 Windows 11、PowerShell 7、Node.js 24+ 和 pnpm。这里的隔离实例用于本机验收，不替换已有安装，不注册开机服务；默认不监听或发送渠道消息。指定群接入按本页分阶段操作，真实连接和发送须分别得到明确授权。运行时使用源码 ESM 入口，项目没有独立的 `build` 脚本。

已有 `scripts/deploy-local.ps1` 属于历史 DSH 安装流程，不适用于当前 Night Bot。代码升级只更新代码与依赖，保留各安装自己的 `data/`；不搬运账号文件、业务数据或旧 DSH 历史。正常 IPC 停机仍须等待业务、复盘、投影和真实进程排空，但不为每个任务遍历文件并生成离线 seal。需要备份时，在进程退出后显式执行 [单任务离线备份](../TASK-ARCHIVE.md#offline-commands)；普通停机后的 live-projection 不能直接当作封存备份。

## 只读检查

在目标安装目录运行，先确认分支和已有改动：

```powershell
Get-Location
git status --short --branch
node --version
pnpm --version
Get-NetTCPConnection -State Listen | Where-Object LocalPort -eq 19198 | Select-Object LocalAddress,LocalPort,OwningProcess
```

端口被其他实例占用时，给本次配置选一个空闲 loopback 端口；不要终止未知进程。检查现有 `data/config/config.json` 是否存在，不输出其正文。已存在时不重新初始化。

## 安装与配置

```powershell
pnpm install --frozen-lockfile
pnpm check
```

仅在全新安装且目标配置不存在时初始化：

```powershell
pnpm init:assistant --actor YOUR_LOCAL_ACTOR --provider openai --model YOUR_MODEL --key-env OPENAI_API_KEY
```

初始化拒绝覆盖已有配置。审核安装内 `data/config/config.json`：`installRoot` 为 `../..`，`shell` 为 `pwsh`，`resident.host` 为 `127.0.0.1`，本机验收端口可用 `19198`，`channelPlugins` 为 `[]`。不要把配置、凭据或任务产物加入 Git。

Codex 使用 `openai-codex` provider 与固定 Pi SDK 实际支持的模型；模型名从官方 catalog 选择。当前代理环境下的本机验收使用该 profile 的 `transport: "sse"`。应用与 SDK 的 undici 均固定在 8.12.3，并显式使用 CONNECT，避免 SDK 导入后覆盖代理 dispatcher。

## 工具权限模式

配置使用顶层 `permissionMode`，默认 `full`（显式 `ask` / `auto` 保持不变）；初始化支持 `--permission-mode ask|auto|full`。

本次实施与验收范围为 `full`；`ask` / `auto` 合同保留，但受限执行尚未完成，本次不交付。此范围调整不改变默认 `full`（显式 `ask` / `auto` 保持不变），也不自动修改实际实例配置。

以下示例仅用于可信安装操作者明确选择 `full`；离线更改先检查，再保存并正常重启：

```powershell
node bin/night-bot-config.js data/config/config.json permissions --permission-mode full --check
node bin/night-bot-config.js data/config/config.json permissions --permission-mode full
```

`ask` 请求人工单次批准外部业务操作；`auto` 使用当前配置 Pi 模型作无工具审查，不确定或失败转人工。批准后的文件/进程必须实际限制到该调用的准确范围，不能以配置存在、Job/ConPTY 原语通过或单次 ACL 探针成功宣称 Windows 默认受限链已可用；生产 owned Profile、秘密/跨任务隔离和完整回收的未验项仍见本页限制与[当前目标](../acceptance/resident-conversation-routing/goal.md)。缺少受限后端时失败关闭，不自动升级。

`full` 仅供可信安装操作者显式选择，按当前运行环境 OS 账号直接访问，不取得管理员权限，不承诺工作区或同账号 Host 私有文件仍被 OS 隔离。Host API 的身份、业务授权、审计、取消与 no-replay 继续保留；full 的实际执行与受限模式分别验收，不能互相抵扣。认证 Web 的在线选择与单次审批见[Web 权限入口](web-console-local.md#安装权限与单次审批)，保存后以 Host 回读为准。

Windows `full` 已分阶段实跑外部文件写入、配置持久化与冷启动、任务 actor 不能改档、旧批准不重放、前后台 PowerShell、超时转后台后的单次执行与增量输出，以及准备期取消/超时不产生外部写入。本轮补齐 `grep` 授权投影后，真实工作区/外部目录命中、正常无匹配、82 文件分两批完整检索及切回非 `full` 后保留拒绝均通过，同一候选的前台 PowerShell 关联复验通过。各批绑定的源码及结果见[唯一验收入口](../acceptance/resident-conversation-routing/goal.md)；未重跑无关场景，不宣称全部工具、运行中子进程取消或三平台全量通过。

Pi 的 Project Trust 仅控制项目配置、扩展、技能等项目资源的加载信任，不限制代码执行后的 OS 访问；它不是 OS 沙箱，也不表示 Night Bot 已新增该信任入口。

## 认证

只读列出官方认证状态，不读取凭据正文：

```powershell
node bin/night-bot-auth.js data/config/config.json list
```

只有状态确实缺失且需要授权时，才由使用者本人完成官方流程：

```powershell
node bin/night-bot-auth.js data/config/config.json login openai-codex
```

API Key profile 使用声明的 `apiKeyEnv` 引用。可通过既有环境或 `night-bot-auth ... set-ref NAME` 的隐藏输入配置；不把密钥写入命令行、日志、源码或验收报告。配置文件只含变量名不代表已经具备可用密钥，必须分别记录配置可解析与真实 API 调用结果。不要为补齐引用搜索其他秘密文件。

## 启动与停止

```powershell
node bin/night-bot-run.js data/config/config.json
```

受管入口将服务日志追加到 `data/logs/service.log`，并把子进程临时目录和缓存指向安装内 `data/temp`、`data/cache`。在另一终端检查：

```powershell
Invoke-RestMethod http://127.0.0.1:19198/health | Select-Object status,transport,modelMode,recoveryIssueCount,inboundConfigured,outboundAuthorized
```

标准入口的 `transport` 为 `channels`。当前兼容 `/health` 的 `inboundConfigured` 只识别旧 `dws` 模式，`outboundAuthorized` 只反映是否注册了 transport，不能据此判断插件监听状态或 `dingtalk_writes_authorized`。`status:ok` 也不证明 DWS 已登录、指定群已订阅或消息已送达。

前台停止使用 Ctrl+C，等待 launcher 正常退出。Node 父进程托管时，必须保留 IPC 通道并发送 `{type:'night-bot-shutdown'}`；launcher 会转发给服务，等现有关闭路径排空后退出。Windows 的 `Stop-Process` 或 `child.kill('SIGTERM')` 是强制终止，不能当成优雅排空证据。本机验收的临时监督器仅管理它自己启动的实例，不是正式 Windows 服务管理器。

启动工作区只枚举一次受信会话目录；每份 Pi 日志仍完整校验提交链、身份和上下文，路径及链接检查保留，小批并行读取失败会先排空本批再报错。共享 cwd 只在同次索引内复用解析，后续索引重新核验，不使用跨次启动缓存或只读 header 绕过日志校验。完整重启计时应从正常停机请求直到 Web、resident 和全部启用渠道实际就绪，分别记录停机与启动恢复，不能仅记录停机耗时。

不要清理仍被进程使用的数据、SQLite WAL、会话或临时文件。

若冷启动保留 `ROUTER_BATCH_UNSETTLED`，应核对任务服务 `recover()` 的 `degraded` 结果和现有恢复告警，不能把入口可用或已完成任务当作 Router 已消费。继续处理须由已授权 Host 集成按[原批次续办合同](../CHANNELS.md#已接纳未结批次的显式续办)绑定原失败 checkpoint；没有新增可供操作者直接使用的 HTTP/CLI，不直调 SDK、不重建任务、不改 journal、DB 或通知收据。其它恢复错误仍停止启动。若关闭报错，保留错误和原资源，独立核对实际排空；Host/application 异常关闭短路风险尚未修复，不能因正常路径曾退出就认定异常路径资源已释放。

## 文件工具纠错与未知效果

Pi 编辑出现多处匹配、找不到匹配等写入前错误时，受信文件适配器在实际执行排空后证明从未进入 `fs.writeText`，Host 保留原始工具错误并提交 `isError: true, effect: not-started` 的失败收据。任务可重新读取、补足唯一上下文并发起独立修正调用，无需人工解除未知效果；这不改变编辑的唯一匹配要求、权限审批和版本检查，也不自动重放原调用。

开始调用文件写入后报错、写后结果丢失、取消、未知后台作业及不能提供真实边界证明的工具，仍按原防重放流程等待核验。普通进程非零退出不证明无外部效果。旧版误拦任务若只保留通用未知错误，升级不会补造未写入证明或自动解除：保留原任务/收据，经现有可信 Host 对账与另行授权继续，不直接编辑 SQLite、journal 或重新发布。此次修复未新增对账 HTTP/CLI，也不授权重启当前安装或执行外部业务发布。

新失败终态仍使用原 journal 的严格解码与提交协议；旧版不认识新增的 `effect` 字段。产生该收据后，回滚须使用匹配代码与离线备份，不能删字段或改历史收据来让旧版读取。

## 正文拒发与待核实

重启前先用本页认证命令检查安装的凭据引用，确认当前启动环境或安装凭据能提供模型密钥；旧进程运行正常不代表密钥已持久保存。缺少引用时保持原服务运行，使用 `night-bot-auth ... set-ref NAME` 的隐藏输入补齐，不从其他账号或进程提取秘密。

任务完成与通知送达分开核对。正文包含私有内部任务编号时，Router 应在冻结交付前收到校验错误并订正；原用户已公开指定的同值业务标记和报告名可保留。发送通道的本地安全拒发落为“失败、已知未发送、不可自动重试”，不继续空回读。旧版留下的同类 unknown，在授权升级并正常排空重启后，由既有通知扫描按原错误、单次发送许可和无接纳回执的严格条件结清失败；有网络异常或接纳证据的不适用。

若根因为公开业务标记误拦，修复并正常重启后，须经当前安装操作者明确恢复原交付。复用 `POST /config/groups/:groupId/notifications/:notificationId/retry`，携带从当前通知恢复描述符取得的 `expectedToken`；仅 loopback 合法 Host/Origin 请求可用。Host 消费 CAS 并复核完整未发送证明、原来源授权/版本/作者、任务完成版本及原冻结文件，再校验正文；不改 payload/hash 或收据、不重新执行任务。后台扫描仍不重试本地拒发，未知结果只回读。验收必须核对父说明与所有文件 delivered、实际文件字节验证，以及 Web 原消息状态；仅 failed 结清或发送 ACK 均不代表业务完成。

结清不表示已经送达，不修改冻结正文、不重新执行任务、不自动补发说明或附件；文件仍须等待父说明确认送达。不要直接改 SQLite 或把状态手工置为 delivered。现场未运行修复版本前，不以源码回归通过宣称原通知已恢复。

## 真实验收

通过本机 HTTP 创建明确授权的有限任务，例如仅在任务 `work/` 中写入标记、读回并提交完成。必须观察任务 `completed`、正式 `task_result`、实际文件和官方 Pi journal；健康响应或模型的一句成功说明不足以证明任务完成。

早期标记文件任务的专用核验入口：

```powershell
node docs/acceptance/pi-native-retirement-local/scripts/verify-live-task.mjs . TASK_ID http://127.0.0.1:19198
```

该脚本只适用于约定的标记文件验收任务。冷重启后比较同一任务、文件 SHA-256、journal SHA-256 和工具调用次数；不得重新创建任务代替持久性检查。SG10 的默认 CLI、私有 Skill 及原安装 Router 恢复结果见[第八轮报告](../acceptance/resident-conversation-routing/round-8.md)，按各组源码指纹生效；第八轮没有新增真实模型或 DWS 调用。

[第七轮](../acceptance/resident-conversation-routing/round-7.md)的指定群旧文字/附件交付已在[第九轮](../acceptance/resident-conversation-routing/round-9.md)按 `67d2d50` 及其核对的 R8 源码指纹完成真实只读回读；随后同安装冷启动有真实模型调用及一次文字答复，正常 IPC 关闭通过，但自身回声进入来源/分诊为 FAIL。第九轮结束时实例已关闭，尚未收到约定的新文件/原生 quote/@ 请求，没有该新事项的文件交付、无工具复盘或再冷恢复通过证据。本次引用参数与登记前回声 guard 的实现合同不能据此追认为新版现场已通过。正常关闭通过不证明异常关闭风险已消失；取消路径仍未专项验证。

## 指定钉钉群接入

复用上述独立安装、空闲 loopback 端口和私有 `data/config/config.json`，不启动第二个进程争用同一实例。具体群、profile、账号和凭据只进私有运行配置，不写进 Git 或公开证据。以下是可操作流程，不是本轮真实渠道验收通过声明；当前结果见 [唯一验收入口](../acceptance/resident-conversation-routing/goal.md)。

### 历史恢复失败

`recovering` 包含历史补拉、Host 接纳和持久消费水位，不只表示网络重连。卡片「历史恢复失败」按固定错误码说明：

- `CHANNEL_MESSAGE_ID_CONFLICT`：旧消息与同 ID、同版本的冻结输入不一致。核对来源及插件去重证据，不直接改 DB、清游标或反复重启。
- `CHANNEL_HISTORY_INCOMPLETE`：历史页不完整或已知暂缓消息仍缺失。核对原绑定账号的读取权限与查询完整性，不因供应商返回 `complete` 就丢弃暂缓来源。
- `CHANNEL_HISTORY_RECOVERY_FAILED`：其他补拉/接纳错误。服务日志可能只有安全错误分类；当前 Web 不暴露任意原始异常、账号或消息 ID，不能用空错误码证明恢复成功。

已处理重复项只在原作者/会话/版本及资源稳定身份一致、冻结 payloadHash 能完整重建时消费，兼容已观察到的 DWS 标记富化、文件提示/字段顺序和引用作者省略；未处理来源仍走原接纳，真实正文/作者/提及/资源变化仍失败关闭。恢复后核对实际插件健康、补拉成功、无遗留 deferred 和耐久水位，不仅检查子进程存在或端口可用。若更新修复代码，仍按正常停机、已合并版本发布及启动流程操作，不以手工注入旧消息代替验收。

### 隔离准备

1. 默认保持 `channelPlugins:[]` 或实例 `enabled:false`。公开配置只接受 `dingtalk_*`：`dingtalk_listen:false` 关闭监听，`dingtalk_writes_authorized:false` 关闭发送，两者不能代替禁用实例。`enabled:true` 即会核对登录与目标，即使监听关闭也可能调用 DWS；未获连接授权不启用。额外 `dingtalk_operator_notifications` 默认关闭，不扩大到 operator 私聊。
2. Windows 明确用 `dingtalk_account_mode:"system"` 和 `dingtalk_profile:"YOUR_PROFILE"`。system 是当前 OS 用户账号存储，不要求 LocalSystem 或管理员。复用已核实的已有登录态，不执行登录、切换账号、重置、凭据复制/导出或改注册表。多个实例/profile 可能共享账号存储，不能声明账号隔离；Windows 显式 private 请求拒绝。
3. 每个实例只绑定一个目标，使用唯一 `channelId`。群聊设 `dingtalk_conversation_type:"chat-room"` 与群 ID 或群名；私聊另建实例，设 `"chat"` 与 userId 或姓名，不填群目标。`dingtalk_name` 是渠道名称，`dingtalk_prompt` 是该会话职责、设定与规范，`""` 清空、缺省未指定；不再使用 `groups[].responsibility`、`config.responsibility`、`directChats` 或旧无前缀字段。多群/私聊使用多个实例，职责与四角色消费见 [渠道职责配置](../CHANNELS.md#渠道职责配置)。

在安装根目录做离线准备。以下 `add` 仅适用于尚未登记的 `dingtalk-room`，占位目标按获准范围填写；已有实例用专用 `set` 修改，不覆盖其它实例：

```powershell
Get-Command dws -CommandType Application | Select-Object Name,Source
$config = (Resolve-Path 'data/config/config.json').ProviderPath
node bin/night-bot-dingtalk.js $config list
$room = '{"dingtalk_profile":"YOUR_PROFILE","dingtalk_account_mode":"system","dingtalk_conversation_type":"chat-room","dingtalk_group_id":"YOUR_ROOM_ID","dingtalk_name":"指定群助手","dingtalk_prompt":"仅处理本会话明确授权的请求。","dingtalk_listen":false,"dingtalk_writes_authorized":false}'
node bin/night-bot-dingtalk.js $config add --channel-id dingtalk-room --enabled false --json $room --check
if ($LASTEXITCODE -ne 0) { throw '配置检查失败，不保存或启用插件。' }
```

`Get-Command` 只定位程序；自定义程序用 `dingtalk_executable`。`--check` 只读校验拟改配置和水位，不写盘、不创建锁、不调用 DWS；通过也不证明 profile 已登录、目标存在或权限有效。确认拟改无误，先按本页流程正常停止 Host、核实实际退出，再保存：

```powershell
node bin/night-bot-dingtalk.js $config add --channel-id dingtalk-room --enabled false --json $room
if ($LASTEXITCODE -ne 0) { throw '配置保存失败，保留错误和原数据。' }
node bin/night-bot-dingtalk.js $config list
```

保存须取得离线 Host 锁，运行中拒绝写入；不靠停掉未知进程或删除锁绕过。保存返回 `liveApplied:false`，`changed/restartRequired` 也包含渠道暂停/补拉检查点变化；按返回值正常重启，不声称热更新。已存在实例修改名称/Prompt 使用 `set --channel-id dingtalk-room --json '{"dingtalk_name":"指定群助手","dingtalk_prompt":"新的已授权规范"}' --check`，通过后同样离线保存。`disable --channel-id ID --check` 检查后去掉 `--check` 才保存，`enable` 同理；均不自动连接正在运行的 Host。

显式环境导入只走 `node bin/night-bot-dingtalk.js $config env --check`，核对后去掉 `--check` 保存。单实例使用 `DINGTALK_CHANNEL_ID`、`DINGTALK_ENABLED` 与公开字段对应大写名称；多实例用 `DINGTALK_CHANNELS_JSON` 完整实例数组，不同时设置其它非空 `DINGTALK_*`。首次准备显式禁用并关闭监听/发送，布尔只写 `true/false`；普通 CLI 参数不与环境变量混用。不要把凭据正文传入 JSON、命令行、日志或 Git。

### 授权后的真实闭环

仅在明确获得指定账号、指定群的连接和发送授权后执行；缺一项就停在准备阶段，不让其它会话代连或代发。

1. 由授权执行者核实 DWS/profile 实际身份和唯一目标；只记录脱敏证据，不转储账号配置。正常停机后，经专用 CLI `set --check` 核对再保存 `dingtalk_listen:true`，仅获发送授权时设 `dingtalk_writes_authorized:true`；实例的 `enable --check` 通过后再离线保存，按 `restartRequired` 重启。名称解析必须得到唯一、完整候选，实际绑定保存于该安装，不手工猜造 `dingtalk_binding`。缺登录时渠道为 `waiting-auth`，其它 Host/Web 能力仍可运行；获准完成官方登录后由元数据观察重新解析接入，不能把等待态当在线，也不将普通权限/歧义错误当未登录重试。登录或切账号仍需相应授权。
2. 在指定群实际发送有限、明确授权的验收请求，注明需要群内说明和附件。验证来源确为订阅事件或真实历史补读，保留消息身份/版本与渠道、群、真实作者的对应证据；不能用 `acceptHistoryMessage`、SDK/HTTP 注入、fake 或仅启动 ready 替代。同账号在单成员群中的消息是否进入订阅/补读，必须单独实测；没有收到不能宣称已承接，也不改账号绕过。
3. 从本机 `GET /state/groups?summary=true` 找到内部 conversation ID，再按 `GET /state/groups/:groupId/messages`、`/outbox` 分页读原消息处理及通知状态；任务看 `GET /state/tasks/:taskId/detail`。外部原生 ID 与内部 conversation ID 不混用。受信 Host 可读 `ctx.channels.plugins.get(channelId).health` 的监听与补拉状态；可选 Web 的认证 `/api/channels` 只给白名单阶段及真实健康布尔，不透原始错误、路径或登录资料。配置启用、`ready`、`listening`、`recovering`、健康正常和真正送达分别核实，不能从 `/health` 兼容布尔值推断。停用、恢复和重启沿该渠道耐久 ingress 水位补拉，检查原消息去重且停用消息未丢；不删除水位、重初始化或倒退业务 `ingressEpoch`。群聊与单对端私聊复用此机制，真实私聊仍需另行授权验收。
4. 观察同任务唯一执行 session、正式 `task_result`、`completed` 且排空，以及实际冻结文件 descriptor/字节哈希。Router 必须选用本任务当前完成版本的 `taskDelivery`，说明父通知送达后再发文件子件；原请求明确要求原生引用时，可组合仅接受 `true` 的 `replyToSource`，由 Host 从本次 `sourceId` / `messageVersion` 绑定原消息/作者，且 `recipientActorIds` 须显式含原作者。省略该选项时默认行为不变；引用仅作用于父说明，文件子件不继承原生 quote/@。核对指定群内实际可见消息、附件原名/内容与持久 readback/receipt。`unknown` 只回读，不重授发送；检查回声命中本实例精确收据，不重新进入业务或造新任务。不能把同账号消息一律当回声过滤。
5. 独立核对带原完成事件引用的持久复盘报告及该群范围内的经验目的地；合法空经验可为 `skipped`，不能仅以已调度或任务完成代替报告。复盘无工具、保持原记忆范围，不能依据 `task.completed` 声称附件已送达。最后正常停止并冷恢复，核同一任务/会话/产物和发送收据没有重放；未核或阻断的环节逐项报告。

当前登记前回声 guard 仅覆盖 Router/任务队列通知：即使关闭 `dingtalk_operator_notifications`，也用该插件自身 adapter 和原生/内部会话映射精确查身份，在消息事实/来源登记前过滤自身消息。同会话 `starting` / `unknown` 通知身份未决时，typed 入站以 `CHANNEL_NOTIFICATION_IDENTITY_PENDING` 暂缓，沿既有持久补读水位恢复；不把暂缓记为已接纳或已完成，也不靠绕过沙箱、注入或重发旧事项继续。原 native operation 的 send/status 尚未统一 typed 接线，不能外推 shell 原生发送的通用回声已修复或已验收；完整合同见 [CHANNELS](../CHANNELS.md)。

## 既有 Night Bot 的 Router 离线升级

新安装直接创建目标账本，不需要运行升级。已有 Night Bot 的旧账本会以 `ROUTER_SCHEMA_UPGRADE_REQUIRED` 拒绝启动，禁止手工改 `user_version`、删 marker 或让新旧 Topic/Router 链同时处理消息。以下命令仅适用于标准 portable 安装；它们不导入 DSH 数据，不搬迁目录，也不会替代业务授权或真实渠道验收。

1. 在**实际安装根目录**记录当前代码版本、锁文件和配置引用。停止入口并等待任务/进程排空；先处理 unknown/starting 发送、未决效果和未完成恢复。不要通过删除 WAL 或强杀 writer 伪造排空。
2. 用新版代码提供的 `--check` 做零副作用检查。它读取现有 SQLite、初始化 marker、旧 resident 来源和已认证 conversation；输出计划、阻断原因与 `expectedDigest`，不创建新来源或运行任务。
3. `ready: true` 后，创建该安装 `backups/` 下的新离线整安装备份，再用该次 digest 执行。升级会逐文件核验备份哈希及当前账本/来源一致性，路径、实例或 digest 变化会拒绝，不能复制旧 digest 重试。

```powershell
$config = (Resolve-Path 'data/config/config.json').ProviderPath
$checkJson = node scripts/migrate-resident-router.mjs --check --config $config
if ($LASTEXITCODE -ne 0) { throw '升级检查未通过：先解决输出中的阻断，不执行升级。' }
$check = $checkJson | ConvertFrom-Json
$backup = Join-Path (Get-Location).ProviderPath ('backups/router-pre-upgrade-' + (Get-Date -Format 'yyyyMMdd-HHmmss'))
node bin/night-bot-data.js $config backup $backup
if ($LASTEXITCODE -ne 0) { throw '离线备份失败，不执行升级。' }
node scripts/migrate-resident-router.mjs --execute --config $config --backup $backup --expected-digest $check.expectedDigest
if ($LASTEXITCODE -ne 0) { throw '升级失败：保留现场与备份，按拒绝原因排查。' }
node scripts/migrate-resident-router.mjs --check --config $config
if ($LASTEXITCODE -ne 0) { throw '升级后检查失败，不启动服务。' }
```

升级目标为 SQLite `user_version=4`、`dynamic_meta.router_schema=1`；这与单任务档案 snapshot/ledger v2、seal manifest v1 是不同版本维度。检查报告包含 `fromVersion/toVersion`、`alreadyUpgraded`、`blockers`、`sourceDispositions`、`heldMessages`、`taskConversions`、`sourceLinks` 及 `dependenciesCreated`。正常写入返回 `applied: true`、`heldEffects: true`、`automaticDelivery: false`；再次检查/执行可识别已升级状态，但这不证明业务已经执行或渠道已送达。

重点复核：

- 活 Host/ledger writer、非空 WAL、未排空 task/execution/group、非终态 operation、unknown/starting notification 或恢复 marker 都会阻断。账本、marker、可选 resident/context 与备份文件均检查完整父链及单链接普通文件；外部 `channels` junction、symlink、hardlink 或特殊文件拒绝，正常缺省 context 允许但不能推断认证身份。权限/路径/实例不匹配照常报错，不静默跳过。
- 可靠已处理或已被新版替代的来源保留为历史，不重新入队；有明确未处理证据且可证明认证身份的来源进入分诊待处理队列。其它来源保持 held；没有认证账本来源的旧消息保留在升级审计中，不虚构身份。
- 已知任务保存直接来源链接；归属/来源不足且任务尚可执行时暂停并标记 `routingUpgradeHold`。原 taskId、执行 session、产物和效果收据不改名。升级不从 Topic 摘要制造依赖，`dependenciesCreated` 为 0。
- 旧 Topic 数据留作只读历史；升级不自动发送消息或触发旧业务重放。审阅 `sourceDispositions`、`heldMessages` 和 `taskConversions`；受信任 Host 的账本只读查询 `router.upgrade-held` 可按 conversation 返回 `triageHold` 来源及 `dynamic_router_upgrade_audit` 历史审计。它不是新增公开 HTTP/CLI 或清 hold 工具；后续仍以有权限的原消息/控制入口逐项处理，不能批量清 hold 当成授权。

上述命令及字段已按源码核对；本轮实际升级/拒绝路径、默认接线和恢复验证以 [常驻 Router 验收入口](../acceptance/resident-conversation-routing/goal.md) 为准。先前本机标记任务成功不代表这次升级通过。

## 升级失败与回退

- 事务失败时保留升级错误、检查输出和离线备份，不删未知 marker、WAL 或效果证据。状态变更导致 `ROUTER_UPGRADE_STATE_CHANGED` 时重新检查并生成匹配备份；不要只替换 digest 绕过核验。
- schema 已升级后，旧代码不得读取新数据。回退必须先停机排空，再恢复**升级前同一快照的代码/依赖与数据**；不能只回退 Git 或覆盖 `tasks.sqlite`，也不能混用新版 Pi/来源文件和旧账本。
- 整安装恢复只接受空的离线目标数据目录，且目标根须与升级前代码匹配；现有配置和默认排除的凭据按既有恢复合同保留。按 [DATA-LAYOUT](../DATA-LAYOUT.md) 的 `night-bot-data ... restore` 流程校验并恢复，不覆盖运行中的目录；需要保留升级后数据时先独立封存，不在此流程中删除它。
- 离线备份默认排除 secrets、日志、缓存和 temp；它可能含私有聊天、任务文件及 Pi 历史，不是脱敏或加密包。恢复后仍需当前身份、权限、未知效果对账与依赖核验，备份不能恢复外部效果或授权重复执行。

## 平台限制

- Windows 本轮已验证官方文件工具的受控任务执行；不据此宣称任意插件、shell 或系统路径统一隔离。
- SG11 的私有策略准备与 runner IPC 代码不代表 Windows 隔离已准入；既有 9 对象的 apply/拒写专项不能证明生产执行链或完整 cleanup，真实 Profile/token 准备、ConPTY 与强制资源清理仍须完成并验证。 Windows 的 `native-sandbox` 配置自定义 `runnerCommand` 时，因其尚不支持私有 LPAC launch 契约，明确返回 `SANDBOX_UNAVAILABLE`；不放宽 `read-only` 缺省，也不剥除自定义 wrapper 后执行。
- 当前 LABEL-only setter 无法据返回0证明 NULL SACL 完整控制位恢复。范围冻结会在首个业务 Set 前拒绝真实受影响对象/继承后代的此类变化，保留原文件与失败原因；不为无关 NULL 对象泛拒，也不改目标标签、掩控制位或自动升级权限求通过。仅 `read-only` 策略本次新建、空且未发布的私有 temp 在创建时请求固定 Low/NW；实际完整 SD 必须满足精确 SACL 与控制位门，只有缺 DACL 自动继承位时才允许同 FileID 空根一次同 DACL 初始化。创建期 SD 与初始化后业务基线分开，最终恢复按业务原 SD 逐字比较；组件 Native 通过不替代真实 Profile/mandatory/ConPTY 验收，`scopeReady=false` 保持。此私有 temp 组件不替代已有读根资格、`workspace-write` 或外部树验收，也不改变 ConPTY pipe；禁止以此路径转换既有业务标签。
- 新默认任务 work/tmp 已接创建期候选；[第38轮](../acceptance/resident-conversation-routing/round-38.md)13项非 Native 合同回归通过，[第39轮](../acceptance/resident-conversation-routing/round-39.md)一个真实新任务初始化为ready、work/tmp 均9814→9c14且原初始化资源全关闭，但同轮 SDK seal 组件在 NUL 准备阶段失败，不能称完整 Native 验收通过。创建合同保持：Web 与 Router 创建任务在事务中登记 Host 未就绪，提交后才独占 Create 普通继承 SD 的 task 根及两个 Low/NW 子目录；仅 work/tmp 新空根按原精确资格各允许至多一次同 DACL 的 Set4 初始化，不做业务 LABEL 往返。Native 资源闭合并准备其余用途目录后才提交 ready；失败或未知保持未就绪，阻止 claim/kick/工作区解析与归档普通 ensure 发布半成品，保留目录、原错误及未知资源，不自动重试 Low 或清理。旧收据、已有任务、restore/adopt 不触发初始化，其他四用途目录和非 Windows 平台不改。ready 不是永久 SD 授权；下段已取得挂起 token/SDK seal 组件证据，旧 NULL/外部写树恢复、完整业务 grant/release/mandatory 与原 runner 准入仍未完成，不能据本候选宣称 Windows 已可用。
- LPAC 的 `LOCALAPPDATA` 由同 Profile 创建期 `SHGetKnownFolderPath(FOLDERID_LocalAppData)` 的已核可信值提供，大小写无关移除调用方同名项再注入；不是新的配置开关或宿主环境整包继承。HOME/USERPROFILE/temp 仍由原批准根决定，不将 LocalAppData 改成 task/work、私有 temp 或 SDK AC，也不因此增加目录权限。[第40轮](../acceptance/resident-conversation-routing/round-40.md)的 NUL 端点通过与创建记录203分列；后续准确新组件已在本机实测环境来源/大小写覆盖、挂起 child/Job 绑定、SDK seal、受控排空及 released/实时/严格冷读通过，见[第41轮组件验收](../acceptance/resident-conversation-routing/round-41.md)。它始终未 Resume，且只走零业务 scopeEffects 的回收分支。[第42轮](../acceptance/resident-conversation-routing/round-42.md)进一步进入业务 scope 准备，但在冻结前被 Host READ_CONTROL/WRITE_DAC 维护权校验拒绝，实际 scopeEffects 始终0；原无 plan 清理最终 released0/0，Job 仍 failed、task blocked/no-replay。该轮尚未定位具体目标或原态/候选阶段，不能据此初始化既有读根、扩大 ACL、切 full 或放宽校验求绿。
- [第43轮](../acceptance/resident-conversation-routing/round-43.md)已正式 FAIL 审闭，已定位 materials 只读根在 `prepare.candidate/scope` 的 Host `WRITE_DAC` 校验被拒；原态维护权校验通过，但候选新增的 `OW`（OWNER RIGHTS）READ_CONTROL ACE 抑制 owner 隐式维护权，且无独立 Host ACE 补足。失败发生在 scope 冻结前，没有实际业务 scope 效果，不能以原无 plan 清理代替有 plan mandatory 恢复。R43 后的维护权候选按既有统一 planner 为每份直接 grant 增加可信 Host SID 的独立 `READ_CONTROL|WRITE_DAC`（`0x60000`）维护 ACE；仍先核原态 Host 维护权，保留 Profile 业务 mask 与 OW READ_CONTROL，不增加 `WRITE_OWNER`、Host 业务写/删除或任意主体授权。第三类维护 ACE 的来源核验与共享撤权同批处理：旧两类 delta 不补造第三 ACE，每个 Profile 只撤自身已提交的一份，保留原生同字节 ACE 及其他活跃 Profile 有来源的权限，缺源、矛盾或份数不足仍拒绝。[第44轮](../acceptance/resident-conversation-routing/round-44.md)真实验收仍为 FAIL，首错为 `Native scope inheritance changed Host maintenance ownership`，未到 scope-frozen、scopeEffects 为0，原无 plan 的 released 不抵有 plan mandatory 恢复。当前诊断增量仅将失败点已持有的父子前后 SD、类型、分支与计数附入非枚举 `cause`（`kind: 'scope-host-inheritance'`），无额外 Native 调用；受 Git 忽略的私有诊断投影名为 `privateScopeHostInheritance`。该增量不是修复，尚无新 Native 通过；业务 scope 授予/有 plan mandatory 完整恢复、`scopeReady`、正向 runner ACK/Resume、ConPTY 和完整 Windows 验收仍未通过，原资格门不变。
- 以下子进程隐私限制针对 `ask` / `auto` 的受限执行，不描述显式 `full` 的 OS 账号直接模式。安装模式的模型子进程隐私 namespace 当前只有 Linux 实现。Windows 缺少该能力时，真实 shell、后台作业及仍调用受控 rg 子进程的内容检索 `grep` 继续失败关闭；`grep` 报 `SEARCH_FAILED` 并保留 `MEMORY_PROCESS_PRIVACY_UNAVAILABLE` 原因，这些成功路径仍未覆盖，不关闭 sandbox 迁就测试。文件名查找 `find` 在原文件授权边界内枚举普通文件，再用进程内 glob 匹配，不启动 rg、不依赖该子进程隐私能力；原路径/链接限制、结果上限及 Pi schema/render 保留。
- 目录 junction 可用于真实 reparse-point 边界验证；普通文件 symlink 在没有权限时不能声称已覆盖。
- POSIX `chmod` 位不能证明 Windows DACL 隐私。Linux `/proc/self/fd` 启动协议、POSIX 权限和内核隔离结果不移作 Windows 认证。
- DWS 是可选渠道，本机核心验收不加载它。真实渠道验收单独授权，钉钉仅使用约定测试群。
