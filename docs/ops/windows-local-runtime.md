# Windows 本机隔离运行

## 范围

使用 Windows 11、PowerShell 7、Node.js 24+ 和 pnpm。这里的隔离实例用于本机验收，不替换已有安装，不注册开机服务；默认不监听或发送渠道消息。指定群接入按本页分阶段操作，真实连接和发送须分别得到明确授权。运行时使用源码 ESM 入口，项目没有独立的 `build` 脚本。

已有 `scripts/deploy-local.ps1` 属于历史 DSH 安装流程，不适用于当前 Night Bot。代码升级只更新代码与依赖，保留各安装自己的 `data/`；不搬运账号文件、业务数据或旧 DSH 历史。

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

标准入口的 `transport` 为 `channels`。当前兼容 `/health` 的 `inboundConfigured` 只识别旧 `dws` 模式，`outboundAuthorized` 只反映是否注册了 transport，不能据此判断插件监听状态或 `writesAuthorized`。`status:ok` 也不证明 DWS 已登录、指定群已订阅或消息已送达。

前台停止使用 Ctrl+C，等待 launcher 正常退出。Node 父进程托管时，必须保留 IPC 通道并发送 `{type:'night-bot-shutdown'}`；launcher 会转发给服务，等现有关闭路径排空后退出。Windows 的 `Stop-Process` 或 `child.kill('SIGTERM')` 是强制终止，不能当成优雅排空证据。本机验收的临时监督器仅管理它自己启动的实例，不是正式 Windows 服务管理器。

不要清理仍被进程使用的数据、SQLite WAL、会话或临时文件。

若冷启动保留 `ROUTER_BATCH_UNSETTLED`，应核对任务服务 `recover()` 的 `degraded` 结果和现有恢复告警，不能把入口可用或已完成任务当作 Router 已消费。继续处理须由已授权 Host 集成按[原批次续办合同](../CHANNELS.md#已接纳未结批次的显式续办)绑定原失败 checkpoint；没有新增可供操作者直接使用的 HTTP/CLI，不直调 SDK、不重建任务、不改 journal、DB 或通知收据。其它恢复错误仍停止启动。若关闭报错，保留错误和原资源，独立核对实际排空；Host/application 异常关闭短路风险尚未修复，不能因正常路径曾退出就认定异常路径资源已释放。

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

### 隔离准备

1. 默认保持 `channelPlugins:[]` 或示例插件 `enabled:false`。确需检查注册时使用 [CHANNELS 配置片段](../CHANNELS.md#optional-dingtalk-dws-plugin)，设 `enabled:true`、`listen:false`、`writesAuthorized:false`；不要把关闭发送当成关闭监听。`directChats` 与 `operatorNotifications` 不启用，避免扩成私聊范围。
2. Windows 明确使用 `accountMode:"system"` 和 `profile:"YOUR_PROFILE"`。这里的 system 指当前 OS 用户账号存储，不要求以 LocalSystem 或管理员身份启动。使用同一 OS 用户已有、已核实的 DWS 登录态；不执行登录、切换账号、重置、凭据复制/导出或改注册表。多个实例和不同 profile 可能共享账号存储，不能据此声明账号隔离；Windows 的 `accountMode:"private"` 会拒绝。
3. `config.groups` 只列获准群；用该群 `responsibility` 写入职责、设定和规范，必要时用插件 `config.responsibility` 作所列群默认。逐群字符串优先，`""` 明确清空；两处均省略则保留原群职责，新群用通用默认。不要用 `resident.groups` 替代 DWS 插件的监听列表。配置优先级、四角色消费和群隔离见 [渠道职责配置](../CHANNELS.md#渠道职责配置)。改配置先正常停止，再重启生效。

在安装根目录做不连接 DWS 的检查；配置检查仅加载并校验 JSON，不创建应用、启动监听或验证登录：

```powershell
Get-Command dws -CommandType Application | Select-Object Name,Source
$config = (Resolve-Path 'data/config/config.json').ProviderPath
node --input-type=module -e "import { loadConfig } from './src/config.js'; await loadConfig(process.argv[1]); console.log('CONFIG_OK');" $config
if ($LASTEXITCODE -ne 0) { throw '配置检查失败，不启动插件。' }
```

`Get-Command` 只定位可执行文件；若配置了 `config.executable`，核对该指定程序。`CONFIG_OK` 只证明配置可解析和通过现有校验，不证明模型密钥、DWS 版本、profile 登录或群成员权限有效。使用准备好的配置按本页“启动与停止”启动；保留 `listen:false` 与发送关闭，不注入真实业务来冒充监听。

### 授权后的真实闭环

仅在明确获得指定账号、指定群的连接和发送授权后执行；缺一项就停在准备阶段，不让其它会话代连或代发。

1. 由授权执行者核实当前 DWS/profile 实际登录身份和目标群；只记录成功/失败与脱敏证据，不转储账号配置。停机后将 `listen` 设为 `true`；确已获得交付授权时再设 `writesAuthorized:true`，随后按同一受管入口重启。监听会订阅所列群并补读历史，`ingressEpoch` 仍拦截旧历史，不能为让样例通过倒退 epoch。
2. 在指定群实际发送有限、明确授权的验收请求，注明需要群内说明和附件。验证来源确为订阅事件或真实历史补读，保留消息身份/版本与渠道、群、真实作者的对应证据；不能用 `acceptHistoryMessage`、SDK/HTTP 注入、fake 或仅启动 ready 替代。同账号在单成员群中的消息是否进入订阅/补读，必须单独实测；没有收到不能宣称已承接，也不改账号绕过。
3. 从本机 `GET /state/groups?summary=true` 找到内部 conversation ID，再按 `GET /state/groups/:groupId/messages`、`/outbox` 分页读原消息处理及通知状态；任务看 `GET /state/tasks/:taskId/detail`。外部 DWS 群 ID 与内部 conversation ID 不混用。受信 Host 可另读 `ctx.channels.plugins.get(channelId).health` 的监听与补读状态；当前没有对应通用 HTTP 明细接口，不能从 `/health` 的兼容布尔值推断它们。
4. 观察同任务唯一执行 session、正式 `task_result`、`completed` 且排空，以及实际冻结文件 descriptor/字节哈希。Router 必须选用本任务当前完成版本的 `taskDelivery`，说明父通知送达后再发文件子件；原请求明确要求原生引用时，可组合仅接受 `true` 的 `replyToSource`，由 Host 从本次 `sourceId` / `messageVersion` 绑定原消息/作者，且 `recipientActorIds` 须显式含原作者。省略该选项时默认行为不变；引用仅作用于父说明，文件子件不继承原生 quote/@。核对指定群内实际可见消息、附件原名/内容与持久 readback/receipt。`unknown` 只回读，不重授发送；检查回声命中本实例精确收据，不重新进入业务或造新任务。不能把同账号消息一律当回声过滤。
5. 独立核对带原完成事件引用的持久复盘报告及该群范围内的经验目的地；合法空经验可为 `skipped`，不能仅以已调度或任务完成代替报告。复盘无工具、保持原记忆范围，不能依据 `task.completed` 声称附件已送达。最后正常停止并冷恢复，核同一任务/会话/产物和发送收据没有重放；未核或阻断的环节逐项报告。

当前登记前回声 guard 仅覆盖 Router/任务队列通知：即使关闭 `operatorNotifications`，也用该插件自身 adapter 和原生/内部会话映射精确查身份，在消息事实/来源登记前过滤自身消息。同会话 `starting` / `unknown` 通知身份未决时，typed 入站以 `CHANNEL_NOTIFICATION_IDENTITY_PENDING` 暂缓，沿既有持久补读水位恢复；不把暂缓记为已接纳或已完成，也不靠绕过沙箱、注入或重发旧事项继续。原 native operation 的 send/status 尚未统一 typed 接线，不能外推 shell 原生发送的通用回声已修复或已验收；完整合同见 [CHANNELS](../CHANNELS.md)。

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
- 安装模式的模型子进程隐私 namespace 当前只有 Linux 实现。Windows 缺少该能力时，真实 shell、后台作业及仍调用受控 rg 子进程的内容检索 `grep` 继续失败关闭；`grep` 报 `SEARCH_FAILED` 并保留 `MEMORY_PROCESS_PRIVACY_UNAVAILABLE` 原因，这些成功路径仍未覆盖，不关闭 sandbox 迁就测试。文件名查找 `find` 在原文件授权边界内枚举普通文件，再用进程内 glob 匹配，不启动 rg、不依赖该子进程隐私能力；原路径/链接限制、结果上限及 Pi schema/render 保留。
- 目录 junction 可用于真实 reparse-point 边界验证；普通文件 symlink 在没有权限时不能声称已覆盖。
- POSIX `chmod` 位不能证明 Windows DACL 隐私。Linux `/proc/self/fd` 启动协议、POSIX 权限和内核隔离结果不移作 Windows 认证。
- DWS 是可选渠道，本机核心验收不加载它。真实渠道验收单独授权，钉钉仅使用约定测试群。
