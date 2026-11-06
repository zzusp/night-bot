# Windows 本机隔离运行

## 范围

使用 Windows 11、PowerShell 7、Node.js 24+ 和 pnpm。这里的隔离部署用于本机验收，不替换已有安装，不注册开机服务，不发送渠道消息。运行时使用源码 ESM 入口，项目没有独立的 `build` 脚本。

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
Invoke-RestMethod http://127.0.0.1:19198/health | Select-Object status,modelMode,recoveryIssueCount,inboundConfigured,outboundAuthorized
```

前台停止使用 Ctrl+C，等待 launcher 正常退出。Node 父进程托管时，必须保留 IPC 通道并发送 `{type:'night-bot-shutdown'}`；launcher 会转发给服务，等现有关闭路径排空后退出。Windows 的 `Stop-Process` 或 `child.kill('SIGTERM')` 是强制终止，不能当成优雅排空证据。本机验收的临时监督器仅管理它自己启动的实例，不是正式 Windows 服务管理器。

不要清理仍被进程使用的数据、SQLite WAL、会话或临时文件。

## 真实验收

通过本机 HTTP 创建明确授权的有限任务，例如仅在任务 `work/` 中写入标记、读回并提交完成。必须观察任务 `completed`、正式 `task_result`、实际文件和官方 Pi journal；健康响应或模型的一句成功说明不足以证明任务完成。

本轮可复用核验入口：

```powershell
node docs/acceptance/pi-native-retirement-local/scripts/verify-live-task.mjs . TASK_ID http://127.0.0.1:19198
```

该脚本只适用于约定的标记文件验收任务。冷重启后比较同一任务、文件 SHA-256、journal SHA-256 和工具调用次数；不得重新创建任务代替持久性检查。

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
- 安装模式的模型子进程隐私 namespace 当前只有 Linux 实现。Windows 缺少该能力时继续 `MEMORY_PROCESS_PRIVACY_UNAVAILABLE` 失败关闭；依赖它的真实 shell、后台作业和打包检索成功路径单独列为未覆盖，不关闭 sandbox 迁就测试。
- 目录 junction 可用于真实 reparse-point 边界验证；普通文件 symlink 在没有权限时不能声称已覆盖。
- POSIX `chmod` 位不能证明 Windows DACL 隐私。Linux `/proc/self/fd` 启动协议、POSIX 权限和内核隔离结果不移作 Windows 认证。
- DWS 是可选渠道，本机核心验收不加载它。真实渠道验收单独授权，钉钉仅使用约定测试群。
