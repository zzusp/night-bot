# Windows 本机隔离运行

## 范围

使用 Windows 11、PowerShell 7、Node.js 24+ 和 pnpm。这里的隔离实例用于本机验收，不替换已有安装，不注册开机服务；默认不监听或发送渠道消息。指定群接入按本页分阶段操作，真实连接和发送须分别得到明确授权。运行时使用源码 ESM 入口，项目没有独立的 `build` 脚本。

已有 `scripts/deploy-local.ps1` 属于历史 DSH 安装流程，不适用于当前 Night Bot。代码升级只更新代码与依赖，保留各安装自己的 `data/`；不搬运账号文件、业务数据或旧 DSH 历史。正常 IPC 停机仍须等待业务、复盘、投影和真实进程排空，但不为每个任务遍历文件并生成离线 seal。需要备份时，在进程退出后显式执行 [单任务离线备份](../TASK-ARCHIVE.md#offline-commands)；普通停机后的 live-projection 不能直接当作封存备份。

新建独立发行检出时，必须在首次 checkout 前设置 `core.autocrlf=false`；Windows 无符号链接权限的检出同时沿用 `core.symlinks=false`。例如 `git clone --config core.autocrlf=false --config core.symlinks=false --no-checkout <source> <release>`，再签出已合并提交。来源清单按文件原始字节校验，CRLF 转换会触发 `Unrecorded core change`；不要改清单哈希掩盖，也不要用归档解包覆盖 Git 检出来修复（链接可能被解为实体目录）。准备后核对提交、`git status --porcelain`、依赖、Web 构建及 `pnpm check`，正常排空旧实例后再由现有监督器自检和启动。

核心入口与可选插件目录必须一起核对：启动新版核心不会自动改写 `channelPluginDirs`。将旧发行的 `packages` 路径精确替换为新发行对应目录，并保留其他已配置插件与实例身份；不要同时保留新旧两份同类型插件，否则发现阶段会拒绝重复类型。先通过 `updateConfig(..., {checkOnly:true})` 与插件发现做零副作用检查，核对只有目录字段变化；正常排空、确认实际进程退出后，再经同一受控配置事务保存并重启。仅提供追加目录语义的 Web 配置命令不能代替路径替换。验收同时检查实际核心进程路径、插件发现入口及认证 Web 列表刷新；HTTP 200 若伴随 `cache.stale=true` 或 `error`，仍是旧快照，不能算成功。

本地更新可按操作者的明确选择不创建备份，仍须保留安装数据并完成正常排空与重启核验；该选择不扩展到远程/正式环境，不授权清理既有备份。没有匹配快照时，不宣称可以无损回滚已写入的新格式记忆。

新版启动前核对[记忆布局升级](../MEMORY-MIGRATION.md)：遇到 `MEMORY_LAYOUT_MIGRATION_REQUIRED` 时停止，不删除状态或给必需服务加静默兜底。正常排空且进程已退出后，先 `node scripts/migrate-memory.mjs --install-root <安装根> --check`，再显式 `--apply`。明确选择本地不备份、当前为v3时，检查和执行均附 `--no-backup`；核对收据 `backup: null`、数量与正文保持，再让监督器自检、启动，验收实际记忆列表和原业务终态。

常驻 Router 的[后台压缩](../BACKGROUND-COMPACTION.md)随代码正常更新和重启生效，无新增环境变量、配置开关或数据迁移。目标 472K 受模型真实窗口和输出额度限制；遇到 `PI_CONTEXT_INPUT_TOO_LARGE` 表示输入仍在耐久待办中，不可当作已消费，也不要手工重写 journal 以绕过校验。首次分诊增加一次接纳正文前的提示资源预检，创建期仍延迟加载；压缩阶段耗时与业务模型尝试分别观察。

分诊/Router 的[当前上下文与按需查询](../CHANNELS.md#当前上下文与按需查询)、[独立长期指令](../MEMORY.md#独立长期行为指令)及原生角色摘要也在正常排空、更新已合并代码与重启后生效，无新增环境变量或 SQLite schema。不要为启用功能重写旧消息、自动压缩现有 journal 或把旧偏好迁成指令。新指令带 scope 元数据，回滚须保证旧程序不改写不认识的新记忆记录；缺少匹配快照时不声称无损回滚。本功能的本地脚本模型验收不代表运行安装已更新或真实渠道已验收。

[任务角色摘要](../SINGLE-TASK.md#执行生命周期)随已合并代码更新并正常重启生效，原任务在下一次 Pi 原生压缩时使用，无需新配置、迁移或手工压缩原日志。

共享[回复规则](../CHANNELS.md#对外回复的信息取舍)随已合并代码更新并正常重启生效，无配置变更。验收应逐条读新产生的用户可见正文，检查是否先说结果、用白话解释必要术语、不重复已交代的范围，同时保留会改变判断的证据缺口；脚本模型只证明规则进入实际请求和正文按原路径交付。旧回复不重写、不补发。

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

## 内置技能

源码更新并正常重启后，`skill-creator` 与 `work-log-writing` 默认可发现，无需修改 `skillDirs`，也不覆盖 `data/config/skills` 中的同名技能。使用 `/skill:skill-creator` 创建或改进技能；其草稿和评估产物留在授权工作区，不改写内置代码目录。离线校验/打包需本机 Python 3 与 PyYAML；静态查看器仅需 Python 3。Claude CLI 不是默认依赖，不启动嵌套执行会话。日报技能不改变定时日报的独立生成提示。

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

## 未知效果结清后的新目标续办

任务级 `TASK_EFFECT_NEW_AUTHORIZATION_REQUIRED` 规则已删除：已结清效果不再让后续全部非只读调用或完成结果等待独立操作者授权。Router 可直接调度原执行会话，普通恢复/修订不需要 `new-action`。旧具体调用的 noReplay、当前工具权限及真实结果核验继续保留；不得改 SQLite、Pi 日志或旧收据清警。运行旧发行仍报该错误时，须按本 runbook 的已合并发行升级流程处理，不对账本打补丁。

旧 `new-action` CLI/HTTP 授权入口已退役。旧交接记录命中的历史来源或任务 ID 不再阻止普通调度，可唤起原会话核验；若任务本身仍有未决作业或效果，走现有 inspect/close，不重跑原调用。真实外发、工具权限和完成证明仍按原规则检查。无需迁移数据或清理旧任务、来源、日志。

### 排空故障状态

`TASK_SESSION_DRAIN_FAILED` 由 Host 按原会话和租约写入任务账本，列表/详情显示等待中，执行会话显示失败。真实排空故障只能通过实际排空和恢复事务清除，不改 SQL、不伪造终态。读取 API 不做 DDL。旧作业只有登记且无保留资源时，原会话仍可接收新输入、推理和只读回核；本轮释放不等于旧作业已经结束。若需要结清旧作业，依[原生作业核验流程](../EFFECT-RECONCILIATION.md#丢失终态的原生-shell-作业)核对进程和保留输出，再停机运行离线入口的 `--check` 与实际结清。任务级 effects close 不能替代作业核验。

### 已结束作业输出与真正未知效果

已提交 `job/settled` 且 `producerReported=true` 的新作业带有界输出快照。即使 owner 已排空或重启，原官方会话的 `job_output(job_id)` 仍回读相同终态与输出；不会重启命令，也不恢复活 producer。`job_kill` 对此返回 `already-finished`；`job_list` 只列当前 registry。快照与终态同次提交，不含 observer log，沿用 `settledRetainBytes`（默认 16 KiB）及作业输出预算；截断或旧记录缺快照会明示，完整文件须事先保存在工作区。它是私有 Pi 日志中的业务输出，不是备份、外部效果成功证明或新授权。

仅有注册、非 producer 终态、资源未排空或已标记不确定的作业，仍拒绝历史成功回读并维持 noReplay，按现有核验/结清流程处理。旧 journal 不补写输出或成功状态；新可选收据字段需要本版解码，不能用旧代码直接回滚读取。供应商 `session_expired` 需按实际提供方重新认证后使用正式续办入口；本改动不自动刷新凭据或重试副作用。

## Pi 会话提交与技能刷新

分诊、Router 和任务执行共用 Pi 写入器。活跃提交只处理新增记录；没有新记录且分支没变时，不读取日志正文。输入确认和新记录仍同步落盘。打开、恢复和离线证明保留完整校验。请勿在运行中编辑会话文件；文件身份、大小或时间戳异常会拒绝续写，应保留原日志排查。复测提交耗时看 `input-acknowledge`、`request-commit`，不要与父阶段重复相加。

会话启动、请求前和轮末仍刷新技能。学习技能按批读取共享状态和支持证据，现有私有文件仍进行内容、路径和发布前授权复核。此改动无需迁移或调整配置，更新并正常重启后生效。复测耗时请对比同会话 `skills` 分项，不要把它与父级 `resources-*` 相加。

新技能和正文更新必须通过本发行内置 `skill-creator` 生成，复盘自身仍无工具。`SKILL_CREATOR_UNAVAILABLE`、`SKILL_CREATOR_NOT_USED`、`SKILL_GENERATION_INCOMPLETE` 或 `SKILL_GENERATION_INVALID` 表示生成未完成，不是业务任务回滚。核对复盘报告或受管 `generationFailures` 的来源与错误，再检查发行内置资源和实际模型配置；不能手写 SKILL.md、补造 creator 收据或回退直接拼装求成功。若复盘报告是 `REFLECTION_MEMORY_KEY_INVALID` 或 `REFLECTION_SKILL_KEY_INVALID`，先查对应条目的机器标识；`REFLECTION_EVIDENCE_INVALID` 查本次事实引用。这些拒绝发生在 creator 和写入之前，均不影响已提交的业务结果。已存在技能仅按已提交状态重建，不自动批量重生成；历史没有 creator 证据的版本继续按历史显示。参见 [自进化](../SELF-EVOLUTION.md#内置-creator-生成阶段)。

复盘失败以原完成事件对应的持久报告为准。`REFLECTION_MODEL_INCOMPLETE` 查 Pi 模型输出；`REFLECTION_WRITE_PENDING` 查逐条写入状态及原回执，不能当作未写入。并发冲突仅在能证明旧计划未产生效果且未跨遗忘时重新查目录；沿用原恢复扫描、至少 30 秒间隔及每事件最多三次尝试。无需配置或数据迁移；升级不补跑已耗尽的报告，不要手改尝试次数或回执。见[失败与遗忘](../SELF-EVOLUTION.md#durability-failures-and-forgetting)。

## 启动与停止

```powershell
node bin/night-bot-run.js data/config/config.json
```

受管入口将服务日志追加到 `data/logs/service.log`，并把子进程临时目录和缓存指向安装内 `data/temp`、`data/cache`。在另一终端检查：

```powershell
Invoke-RestMethod http://127.0.0.1:19198/health | Select-Object status,transport,modelMode,recoveryIssueCount,taskAttentionCount,inboundConfigured,outboundAuthorized
```

`recoveryIssueCount` 是运行恢复异常数，`taskAttentionCount` 是任务待处理项数；后者可与 `status:ok` 同时出现。分别核对原始问题，不能通过清空账本或重试业务任务让健康变绿：

```powershell
Invoke-RestMethod http://127.0.0.1:19198/state/recovery-issues
Invoke-RestMethod 'http://127.0.0.1:19198/state/supervisor/alerts?limit=10&type=task'
```

完整分类和分页合同见 [HTTP 路由](../HTTP-ROUTES.md#健康与任务待处理)。任务技术等待应回查当前任务决策里的 `technicalFailure`：超时与输入超限不是供应方策略拒绝，正常返回但没提交 `task_result` 也不是供应方错误。诊断记录不会自动重试；明确拒绝须按供应方支持的方式处理，不要改路重送被拒请求。核对是否通知了原发起人时，区分 Router 事件已结清、回复已冻结和原通知已有送达回执。周期巡检用原结果事件 ID 检查隔离、超过 10 分钟未处理及结清未回报的当前结果，在既有运行告警或 `/state/recovery-issues` 查事件引用。已有冻结通知（包括发送未知）沿原通知回读。告警不授权补发、重试或重跑，不要用同一任务的别条回执销账。

标准入口的 `transport` 为 `channels`。当前兼容 `/health` 的 `inboundConfigured` 只识别旧 `dws` 模式，`outboundAuthorized` 只反映是否注册了 transport，不能据此判断插件监听状态或 `dingtalk_writes_authorized`。`status:ok` 也不证明 DWS 已登录、指定群已订阅或消息已送达。

前台停止使用 Ctrl+C，等待 launcher 正常退出。Node 父进程托管时，必须保留 IPC 通道并发送 `{type:'night-bot-shutdown'}`；launcher 会转发给服务，等现有关闭路径排空后退出。Windows 的 `Stop-Process` 或 `child.kill('SIGTERM')` 是强制终止，不能当成优雅排空证据。本机验收的临时监督器仅管理它自己启动的实例，不是正式 Windows 服务管理器。

启动工作区只枚举一次受信会话目录；每份 Pi 日志仍完整校验提交链、身份和上下文，路径及链接检查保留，小批并行读取失败会先排空本批再报错。共享 cwd 只在同次索引内复用解析，后续索引重新核验，不使用跨次启动缓存或只读 header 绕过日志校验。完整重启计时应从正常停机请求直到 Web、resident 和全部启用渠道实际就绪，分别记录停机与启动恢复，不能仅记录停机耗时。

不要清理仍被进程使用的数据、SQLite WAL、会话或临时文件。

### 分流准备耗时

启动时先本地导入当前所选模型（含分诊/Router/任务角色覆盖）对应的 Pi 协议，再发布官方会话工厂；这可能延长启动等待，但不发送模型探测请求。预加载导入失败会阻止工厂就绪；缺失/无效模型声明沿用原配置诊断，不以无效配置触发额外模块加载。更换到启动时未选中的协议后，其首次请求仍可能加载新模块。

既有只读 `/state/performance?sessionId=<分流会话ID>`（或 `groupId`）返回 `runtimeOwner: channel-triage`、原生模型/工具指标和 `phaseMs`。重点查看 `session-create` 及其存储/挂载/模型解析子项、`resources-create` / `resources-deliver` / `resources-before-run`、`instructions` / `skills` / `sdk-reload`、`input-enqueue` / `input-acknowledge`、`request-prepare` / `request-guards` / `request-commit`、`triage-commit` / `session-dispose`。每项有 `count/sum/max/p50/p95/failures`，单位为毫秒。总分流用 `triage-total`；父子项、并行读取和发送可能重叠，不相加。该投影异步落盘，分流结束不等于查询尾部已写完；正常关停沿用观测队列排空，冷恢复不重放消息。历史数据不会凭空补出分项。

分诊运行中追加来源后，若提交返回 `ok:false,code:TRIAGE_BATCH_INCOMPLETE`，以返回的完整 `messages` 补齐后再提交；该反馈没有保存处置，也未封存批次。完整提交后的旧 steer `TRIAGE_INACTIVE` 不阻塞后续溢出队列。排查时结合 `triage-commit` 和来源业务终态，不以模型调用次数或局部 idle 代替提交成功。

这仅提供定位依据，不证明真实渠道提速；应在另行授权部署后，用同口径消息测量首答可见时间。

若冷启动保留 `ROUTER_BATCH_UNSETTLED`，应核对任务服务 `recover()` 的 `degraded` 结果和现有恢复告警，不能把入口可用或已完成任务当作 Router 已消费。满足原生检查点校验的中止生成和已登记的渠道模型超时可沿原会话自动领取一次；其它模型错误、正常 stop 或已完整提交成功只读任务查询结果的未结批次使用下述操作者入口按[原批次续办合同](../CHANNELS.md#已接纳未结批次的安全续办)绑定原检查点；不直调 SDK、不重建任务、不改 journal、DB 或通知收据。其它恢复错误仍停止启动。若关闭报错，保留错误和原资源，独立核对实际排空；Host/application 异常关闭短路风险尚未修复，不能因正常路径曾退出就认定异常路径资源已释放。

### 既有事项进度追问

Router 会结合当前职责与原任务处理进度追问，不因提及操作者而直接结清。此规则更新没有 schema/config 迁移，也不改变渠道配置；安装升级仍按本页排空与正常重启流程执行。已经错误结清的历史来源不会自动重放或补发，模型错误续办入口也不适用于已消费事件；需要补报时由操作者明确发起新的进度查询。隔离真实模型场景验证见 [Router 进度追问验收](../acceptance/router-progress-followup/round-1.md)。

### Router 模型错误的显式续办

渠道 Router 的模型超时在 Pi 重试耗尽后登记在 SQLite 会话行的 `timeoutContinuation`，由原有恢复轮询或启动恢复唤醒原会话，无需配置或迁移。核对是否已补齐时，分别检查原事件是否结清、原通知是否 `delivered`。历史挂起消息由恢复后的 Router 复查；暂缓的消息在下次冷启动时带最新证据再交给 Router，不靠常驻轮询反复判断，也不重放未知副作用。检查点已领取但续轮仍未结清时，不要重复领取。普通模型错误仍使用下述显式续办入口。

`ROUTER_EVENT_DELIVERY_HELD` 表示 Host 已保留经核验的整批未结事件、移出自动投递并允许后续独立来源进入。检查原代际和效果证据；留置不算完成，不能直接修改账本、补写回执或重放。当前活跃代际的 `inspect` 不会把历史留置事件当作其可续办批次。查看原待办的 `heldReviews` 区分沿用任务/回执、放回原消息、证据不足和模型未作有效判断。这里没有配置或数据库格式迁移。

本入口也适用于最后 assistant 正常 `stop`，或末次调用全部为本会话只读 `resident_task_query` 且结果全部完整、匹配、成功提交，但原批次仍未结清的情况。普通恢复不会自动重试这两种情况。先核实原停止原因、修复认证/服务问题（若存在）并确认安装授权；未结工具结果、作业或效果必须先按原合同处理，不能靠续办跳过。以下命令连接已运行的本机 Host，不启动第二个实例。将 inspect 的 `proposal` 对象保存到本安装忽略的 `data/temp/router-resume.json`；不把运行身份或业务材料写入 Git。

```powershell
$result = node bin/night-bot-router.js data/config/config.json inspect CONVERSATION_ID | ConvertFrom-Json
$result.proposal | ConvertTo-Json -Depth 10 | Set-Content -Encoding utf8 data/temp/router-resume.json
node bin/night-bot-router.js data/config/config.json resume --proposal data/temp/router-resume.json --check
node bin/night-bot-router.js data/config/config.json resume --proposal data/temp/router-resume.json
```

`--check` 必须先运行：它检查原生失败点、完整 inbox 与 owner，不写 claim/journal，不调模型，不清错误，也不替代执行时来源授权。新输入或检查点变化会令 proposal 失效，须重新 inspect/check，不能手改 hash。无已打开 owner 时先核查正常恢复的失败原因，不为检查创建新 session。私有 capability 位于 `data/secrets/router-operator.credentials.json`，CLI 自行读取；不要打印、传到 URL/环境或手工复制到请求材料。

实际续办可能调用模型、由原 Router 调度原任务和履行原来源授权的效果。CLI 不自动重试；`ROUTER_OPERATOR_RESULT_UNKNOWN` 表示响应丢失或取消，服务端可能仍在执行，先 inspect 并查询 inbox/任务/告警。busy 时等待原轮；已消费的检查点不得再次领取。成功响应的 `settled:true` 表示联合批次已消费，任务最终交付与渠道回读仍要单独核验。控制消息会提供准确事件ID和结清工具要求，但不能保证模型一定调用；若仅文字停止或返回 `ROUTER_BATCH_UNSETTLED`，核查当前inbox及原生日志，不把任务completed当作完成事件已消费，不机械重复领取检查点。完成后删除本次 proposal 临时文件。

若 `PI_ROUTER_RESUME_EFFECT_UNRESOLVED` 涉及已配对的只读排期查询或只针对原包且没有巡检评审的结清失败，原批次部分结清且不存在其它未通过的安全条件时，Host 可在同一会话有独立新来源后按[旧批次隔离合同](../CHANNELS.md#已接纳未结批次的安全续办)换代；不重放旧调用，不解除历史来源保护。没有独立新来源时仍可能保留告警，其他会话可以正常处理。不为消除告警补发消息、改 journal 或手工清状态。

## 文件工具纠错与未知效果

Pi 编辑出现多处匹配、找不到匹配等错误，或底层文件系统在原子锁内、目录/暂存/发布前拒绝未观察覆盖和陈旧版本时，受信适配器在实际执行排空后提供未开始写入证明，Host 保留原始工具错误并提交 `isError: true, effect: not-started` 的失败收据。底层证明绑定实际文件系统及实际失败对象，不按错误码、错误文案或调用方字段放行。任务可重新读取、补足唯一上下文并发起独立修正调用，无需人工解除未知效果；唯一匹配、权限和版本检查保持不变，原调用不自动重放。

进入底层发布后报错、写后结果丢失、取消、未知后台作业及不能提供真实边界证明的工具，仍按原防重放流程等待核验。普通进程非零退出不证明无外部效果。旧任务只有通用未知错误时，新代码不补造未写入证明或自动解除：保留原任务/收据，经[操作者对账](../EFFECT-RECONCILIATION.md)核实可能部分效果后，Router 在原目标授权下安排后续独立调用；不直接编辑 SQLite、journal 或重新发布。

若原排空切点后已有只读核验，升级后可通过原任务对话安排一次只读核对，等待实际回复和该核验执行者排空，再重新 inspect。若原生产者证明因冷崩溃缺失，仅原生 shell 可按规程复用精确绑定的离线作业收据。核验轮已是 `completed` 仍可对账，结清不改完成结果或自动续办。作用域变化、活执行者、未决作业以及最新切点后的业务增量仍拒绝。

新失败终态仍使用原 journal 的严格解码与提交协议；旧版不认识新增的 `effect` 字段。产生该收据后，回滚须使用匹配代码与离线备份，不能删字段或改历史收据来让旧版读取。

## 正文拒发与待核实

重启前先用本页认证命令检查安装的凭据引用，确认当前启动环境或安装凭据能提供模型密钥；旧进程运行正常不代表密钥已持久保存。缺少引用时保持原服务运行，使用 `night-bot-auth ... set-ref NAME` 的隐藏输入补齐，不从其他账号或进程提取秘密。

任务完成与通知送达分开核对。正文包含私有内部任务编号时，Router 应在冻结交付前收到校验错误并订正；原用户已公开指定的同值业务标记和报告名可保留。发送通道的本地安全拒发落为“失败、已知未发送、不可自动重试”，不继续空回读。旧版留下的同类 unknown，在授权升级并正常排空重启后，由既有通知扫描按原错误、单次发送许可和无接纳回执的严格条件结清失败；有网络异常或接纳证据的不适用。

若根因为公开业务标记误拦，修复并正常重启后，须经当前安装操作者明确恢复原交付。复用 `POST /config/groups/:groupId/notifications/:notificationId/retry`，携带从当前通知恢复描述符取得的 `expectedToken`；仅 loopback 合法 Host/Origin 请求可用。Host 消费 CAS 并复核完整未发送证明、原来源授权/版本/作者、任务完成版本及原冻结文件，再校验正文；不改 payload/hash 或收据、不重新执行任务。后台扫描仍不重试本地拒发，未知结果只回读。验收必须核对父说明与所有文件 delivered、实际文件字节验证，以及 Web 原消息状态；仅 failed 结清或发送 ACK 均不代表业务完成。

结清不表示已经送达，不修改冻结正文、不重新执行任务、不自动补发说明或附件；文件仍须等待父说明确认送达。不要直接改 SQLite 或把状态手工置为 delivered。现场未运行修复版本前，不以源码回归通过宣称原通知已恢复。

排查结果漏报时，分别核对 `task_result`、Router 收件箱和通知回执。当前 `taskOutcomeReplies` 只提供事件对应的原来源和版本参数，不是发送动作或送达证明。新结果的 `outcomeDisposition.kind=not-reported` 表示结清时没有该结果的冻结回执；`notification-frozen` 仅表示有原通知，真正送达以通知的 `delivered` 为准。结清时原来源已失效或结果已被替代的，分别记录 `channel-source-unavailable` 或 `superseded`。Web 续办不替换原渠道收件人。升级不改旧账本、不自动补发已结清事件；无需改数据或配置。

## 渠道长期偏好

Router 直接决策并维护记忆及共享 learned Skill，不要求固定句首。Host 仍核对当前批次、认证作者、消息版本、generation、权限和秘密，事务及派生文件必须回读；普通任务记忆与候选规则不变。安装模板不在维护范围。说明见 [MEMORY](../MEMORY.md#渠道长期偏好) 与 [SELF-EVOLUTION](../SELF-EVOLUTION.md#router-直接维护-skill)。升级仍按本 runbook 的备份选择、排空与重启流程执行，无数据库 schema 或环境变量变更；不自动重放已消费的失败消息。回滚须同时恢复匹配旧代码的离线 `data/memory` 和 `data/state`，不能让旧代码丢弃 Router 来源或幂等回执后继续运行。

Router 新记忆使用 Summary、Why、How to apply 三段正文与 context.version=3，Host 绑定当前原话及同会话背景证据，检查结构/正文一致性；不再要求正文等于原消息。无需改 SQLite schema/config，旧格式和旧 context 仍原样可读，不自动重写或回填。个人偏好与项目场景分别召回；升级后按本 runbook 排空并重启才能生效。各安装的实际部署状态以对应验收记录为准，代码合并不代表安装已升级。产生 v3 新记录后，不支持该格式的旧版无法读取；回滚须恢复匹配代码的数据快照，不能删字段或改历史让旧版继续读取。历史精简须保留原身份、来源、previous 和任务/Skill 支持关系，不将旧推测改写为事实；可在现有条目上以新的操作者操作 ID、expectedRevision 及 scopeRevision 经 Store 事务补充 context；原话、条目身份、原来源与原提出者不变，先零副作用自检，提交后独立只读核验。不要复用旧写入 ID，避免被去重当作重放；私有审计仍放忽略的 data/logs，禁止提交原消息、身份或运行记忆。安装升级按本页排空与正常重启流程执行，保留 `data/`；修复不会自动重放已结清原消息或补发回复。历史漏存须由当前操作者授权经受控记忆入口补记，不直接编辑文件、SQLite 或 journal。隔离 Host/Pi 实跑采用本地模型端点与假渠道，须单独说明与当前运行安装、真实模型和真实渠道的区别。

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

### 暂停期间补投原暂缓消息

仅限已暂停的钉钉群，且本机驻留 Host 仍运行。先用 `night-bot-settings CONFIG channel-list --live` 核对渠道 ID、配置版本和运行状态，从该绑定的耐久 `ingress.json` 只读取本次实际 `pausedAt`（完整 UTC ISO 字符串），不要自行选取新截止。使用同一配置版本及暂停时刻运行：

```powershell
night-bot-settings CONFIG channel-recover-paused --channel-id CHANNEL --expected-version VERSION --paused-at PAUSED_AT --live --check
night-bot-settings CONFIG channel-recover-paused --channel-id CHANNEL --expected-version VERSION --paused-at PAUSED_AT --live --confirm
```

先确认自检的边界与数量，再执行。此操作只读原始厂商消息，通过 Host 原接纳链补投截止前的耐久暂缓项，不扫未登记历史，不重发旧通知，不启动监听或推进完整范围水位。待撤回和无法结清的身份及引用保留。`accepted` 是本次接纳回执计数；原来源、实际分诊提交和是否仍暂停需独立回查，不能从返回成功推断模型处理完毕。重复执行沿真实账本去重，不手改暂缓状态。

### 历史恢复失败

`recovering` 覆盖首次启动、断线重连、取消暂停后的历史补拉和 Host 持久接纳；实时监听已连接也不代表开始接收。补拉范围落盘后才排空实时缓存。缓存满会报告 `DWS_RECOVERY_LIVE_BUFFER_FULL` 并重新建立监听、重扫覆盖区间，不跳过缺口直接切到实时。普通增量拉取期间保持 `receiving`；若历史不完整或接纳失败，报告错误。卡片「历史恢复失败」按固定错误码说明：

- `CHANNEL_MESSAGE_ID_CONFLICT`：旧消息与同 ID、同版本的冻结输入不一致。核对来源及插件去重证据，不直接改 DB、清游标或反复重启。
- `CHANNEL_HISTORY_INCOMPLETE`：历史页不完整。核对原绑定账号的读取权限与查询完整性；范畴内返回 `complete` 不等于逐条待核对记录已经解除。
- `CHANNEL_HISTORY_RECOVERY_FAILED`：其他补拉/接纳错误。服务日志可能只有安全错误分类；当前 Web 不暴露任意原始异常、账号或消息 ID，不能用空错误码证明恢复成功。

已处理重复项只在原作者/会话/版本及资源稳定身份一致、冻结 payloadHash 能完整重建时消费，兼容已观察到的 DWS 标记富化、文件提示/字段顺序和引用作者省略；未处理来源仍走原接纳，真实修订经绑定账号精确详情回读后接纳为更高版本，身份不符或回读不完整仍失败关闭。恢复后分别核对接收状态、补拉水位、独立来源已完成分诊，以及 `deferredMessages` / `pendingRecalls` 是否仍有待核对项；收信恢复不等于这些项或原通知已结清。若更新修复代码，仍按正常停机、已合并版本发布及启动流程操作，不以手工注入旧消息代替验收。

升级编辑/撤回修复必须保留原 `data/state/channels/.../ingress.json`、绑定身份、来源账本和 Pi 历史。明确 recall 可解除对应已知缺项；未收到 recall 的空页不能据此清除接收记录。暂停、恢复和升级均不手动删除 `deferredMessages` / `pendingRecalls`。真实渠道验收与重启按授权范围执行，本地 fake DWS 回归不能替代实际恢复结果。

Windows 短暂共享占用导致的原子替换 `EPERM` / `EACCES` / `EBUSY` 在文件边界对同一临时文件最多重试 5 次，按 100 ms 递增等待；不删除旧文件或降级非原子写入。持续占用/权限错误仍原样报错，渠道保留旧恢复界；不能通过清进度或改账号目录绕过。

### 隔离准备

1. 默认保持 `channelPlugins:[]` 或实例 `enabled:false`。公开配置只接受 `dingtalk_*`：`dingtalk_listen:false` 关闭监听，`dingtalk_writes_authorized:false` 关闭发送，两者不能代替禁用实例。`enabled:true` 即会核对登录与目标，即使监听关闭也可能调用 DWS；未获连接授权不启用。额外 `dingtalk_operator_notifications` 默认关闭，不扩大到 operator 私聊。普通任务补问不依赖此配置：已授权发送且有真实 IM 来源时引用原消息；纯 Web 问题保留在 Web。升级不为历史未发送的私密问题新建通知，已生成的出箱仍沿原回执核对。
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
3. 从本机 `GET /state/groups?summary=true` 找到内部 conversation ID，再按 `GET /state/groups/:groupId/messages`、`/outbox` 分页读原消息处理及通知状态；任务看 `GET /state/tasks/:taskId/detail`。外部原生 ID 与内部 conversation ID 不混用。受信 Host 可读 `ctx.channels.plugins.get(channelId).health` 的监听与补拉状态；可选 Web 的认证 `/api/channels` 只给白名单阶段及真实健康布尔，不透原始错误、路径或登录资料。配置启用、`ready`、`listening`、`recovering`、健康正常和真正送达分别核实，不能从 `/health` 兼容布尔值推断。停用、恢复和重启沿该渠道耐久 ingress 水位补拉，检查原消息去重且停用消息未丢；不删除水位、重初始化或倒退业务 `ingressEpoch`。群聊与单对端私聊复用此机制。获准验收真实私聊时，分别核对对端和真人用登录账号发出的消息：进入同一内部会话，保留各自作者；原回执匹配的 Bot 发送不产生新来源。钉钉未实时推送的消息等历史补拉后再核对。
4. 观察同任务唯一执行 session、正式 `task_result`、`completed` 且排空，以及实际冻结文件 descriptor/字节哈希。Router 必须选用本任务当前完成版本的 `taskDelivery`，说明父通知送达后再发文件子件；Host 从本次 `sourceId` / `messageVersion` 默认绑定原消息与作者；若显式受众不含原作者，父说明不引用。仅父说明带引用，文件子件不继承原生 quote/@。验收需分别核对首答、进展和结果父说明的实际原生引用，以及受众和附件。核对指定群内实际可见消息、附件原名/内容与持久 readback/receipt。`unknown` 只回读，不重授发送；检查回声命中本实例精确收据，不重新进入业务或造新任务。不能把同账号消息一律当回声过滤。
5. 独立核对带原完成事件引用的持久复盘报告及该群范围内的经验目的地；合法空经验可为 `skipped`，不能仅以已调度或任务完成代替报告。复盘无工具、保持原记忆范围，不能依据 `task.completed` 声称附件已送达。最后正常停止并冷恢复，核同一任务/会话/产物和发送收据没有重放；未核或阻断的环节逐项报告。

已绑定私聊的双方都发过消息后，正常重启仍应沿用原 Router 和原对端的记忆身份，并结清已入库的待处理消息。遇到 `ROUTER_PRIVATE_IDENTITY_INVALID`，先核对原会话 ID 和持久对端绑定，不要删除参与者、换绑或重投历史来绕过。

登记前回声保护覆盖 Router/任务队列通知，与 `dingtalk_operator_notifications` 开关无关。若原发送身份未知，明确是其他发送者的消息照常入站；仅同账号或身份命名空间不明的候选及其已知直接引用单独暂缓。查看该渠道现有 `data/state/channels/.../ingress.json`：`backfillThroughAt` 是完整历史水位，`deferredMessages` 是未接纳的单条记录；精确读取失败会记录 `DINGTALK_DEFERRED_READ_FAILED`，不会清记录、推断未发送或触发重发。不要手工删记录、补写回执或注入旧消息。原生 shell 外发回声能力不在本次范围，见 [渠道合同](../CHANNELS.md)。

核查 Router 只读查询时，区分原来源已接纳、查询收据终态、内部结果已消费、以及用户答复已送达。全实例同时执行两条，其余后台等待；30 秒包含等待，超时或重启中断不代表业务任务失败。此变更无需迁移或配置，不手改账本或重放中断查询。见[只读查询契约](../CHANNELS.md#router-的临时任务只读查询)。

## 停机中断后的 Router 恢复

正常 IPC 退出只证明进程关闭，不证明每个 Router 批次已 settled。新版冷启动会对原生最后 aborted 生成领取一次原检查点；较新真实输入先进入同一官方会话，再触发续轮。仅最后 aborted 生成中的调用依据固定 Pi 的未派发语义处理，较早调用缺结果、失败或未决效果仍阻断。不删除 admission/inbox，不手改 stopReason，不重发原群消息。

异常退出留下的真实空 `contexts.json.lock` 由新版 Host 在独占安装租约内、通过 restore pending 检查且启动渠道写者前回收；仅处理固定真实目录；平台提供 UID 时须与当前进程一致，活跃/非空锁继续沿原 owner 检查。不要手删安装锁、会话锁或恢复中标记。

原已接纳 Router 仅有最后一个 `resident_router_settle` 缺结果时，新版自动使用原幂等键对账 SQLite，并把真实返回提交到原 Pi 会话后正常重开；不执行模型或重发回复/任务。原批次、来源版本、当前代际、活跃 owner 和渠道目标必须通过校验；已提交事务由原收据复核请求，尚未提交且来源已变化时仍拒绝。已结清但缺结果的空闲会话在下一事件打开时先对账。其它未配对工具、错误工具结果或未知效果继续阻断，不能把任意 `toolUse` 当作可自动重试。对账异常需核对真实错误及原事件，不清账或伪造工具结果。

部署后从认证会话消息/API 核对原消息的实际处理、Router inbox/告警和必要业务/送达收据，不能只看首答、服务端口或 HTTP 200。恢复联合批次超过15条用户消息/30事件、分页外还有事件、来源变化或未知效果时仍 degraded；单列阻断，不通过清账本或降低守卫消警。普通模型 error 仍沿原受信 Host 显式入口，不自动重试。真实渠道业务只按原授权与最新取消/延期处理，不发人工测试消息。

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

## 记忆与 Skill 周期维护

代码升级不授权自动清理历史，默认 reflection.maintenance.enabled 为 false。需要启用时，由安装操作者在私有 data/config/config.json 设置 {"reflection":{"maintenance":{"enabled":true,"intervalHours":168}}}，保留其他字段，按本页正常排空与重启流程操作；不新建业务 schedule，不覆盖记忆或用户正式 Skill。未设置 memory.model 时使用当前默认 Pi 模型，生成阶段仍须实际加载内置 skill-creator。

首次开启建立水位；后续普通完成回合、候选和任务经验落盘触发局部检查，默认每周集中检查，冷启动补查到期/水位变化。通过 memory_status.review 及 data/memory/v2/bot/evolution/maintenance.json 和 maintenance/<runId>.json 核对实际 status、code 和变化 hash；经验和随它失效的派生 Skill 分别列在 changes 中，可按 evidence 的经验条目 ID 对照。enabled 或 nextDueAt 不是已清理证明。failed 应查具体来源/版本冲突或模型错误：`MEMORY_MAINTENANCE_INDEX_INVALID` 和 `MEMORY_MAINTENANCE_PLAN_INVALID` 分别表示模型返回的索引或计划类型不对，没有应用动作；任务复盘的 `REFLECTION_MODEL_TIMEOUT` 表示收到原生超时。两种无工具推理都使用实际 Pi 模型路由的传输限制及流空闲超时，停机则取消并排空。uncertain 先由正常存储恢复处理，不删除 pending journal、不手工重放动作。关闭配置后正常重启停止自动维护；停机仍须排空，不能强删在用文件。完整行为与不支持范围见[自进化](../SELF-EVOLUTION.md#事件与周期维护)。本 PR 未改真实安装配置、未清理真实数据、未部署或做真实模型质量评估。
