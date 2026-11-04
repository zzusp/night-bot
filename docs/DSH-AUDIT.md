# DSH 依赖审计与独立运行边界

## 结论与目标

**当前是迁移中实现，不是完整的 Pi 原生重写。** 它能由 `node bin/night-bot.js` 自行启动，不需要外部已安装的 DSH CLI、DSH 服务或桌面进程；但生产代码仍加载大量 DSH 库。独立进程不等于独立于 DSH。`pnpm audit:runtime` 的机器清单明确记录 `standaloneProcess: true` 与 `standaloneFromDshLibraries: false`，不会把开发依赖分组或本地复制源码算作完成迁移。

用户要求以 Pi 为底座重新实现且不漏功能。执行目标应当是：Pi 成为真实模型上下文与代理运行时，应用自己拥有任务、授权、效果账本和必要的平台能力；原 HTTP/DWS 行为及恢复/授权合同得到验证。不能仅把旧循环外包一层 Pi，或把 DSH 包移到 devDependencies、复制进仓库，就宣称已完成。当前只满足其中一部分。

## 真正由谁执行

| 范围 | 当前实际实现 | Pi 原生程度 / 待办 |
|---|---|---|
| 代理迭代及操作性工具调用 | `@earendil-works/pi-agent-core@1.5.0` 的 `runAgentLoop` | 真正使用 Pi 迭代；单会话工具串行，Host 仍执行工具调度 |
| 模型上下文 | Pi `SessionManager.buildSessionContext()` 的实际分支与消息内容；转回旧 provider 输入结构 | **本轮替换权威上下文**；请求强制 flush 后读取 Pi；禁止旧 deriveMessages 的真实 wire 测试通过。prompt 组装和 provider seam 仍待替换 |
| 模型请求与流 | 本地 `NativePiProvider` → Pi Models.streamSimple 1.5.0；本地 catalog/auth/retry/login/discovery/context/events | **本轮移除旧 DSH provider 插件**；通用 DSH LLM registry/middleware、共享附件/工具历史投影 helpers 和 request/chunk 兼容桥仍在，尚非完全原生直连 |
| Agent 工厂及生命周期 | 本地 `src/pi-loop.js` 中从 DSH MIT 实现保留的工厂、maintenance、注册、取消/排空及持久 inbox；DSH `agents/sessions/scope` | **兼容层**；不是 Pi SDK 的 `createAgentSession`/`SessionManager` |
| 会话历史与恢复 | Pi v3 原生树日志、night.commit 校验链、单写租约；旧 v4 仅导入/写锁保护 | **本轮替换新日志**；原逻辑事件仍保留在 Pi 审计记录供旧 factory/恢复策略使用；不是已经移除 DSH 会话接口 |
| 任务、操作、唤醒、资源、通知主账本 | 应用的 `dynamic-task-store.js` 等，使用 `node:sqlite` | 应用原生存储；其中恢复读取的会话与原生 job 收据仍依赖 DSH，不能因此称整个恢复原生 |
| 群与工作区 JSON 后端 | **本轮已替换为 `src/native-domain.js`** | Node 文件系统实现，兼容旧单文档 JSON；群业务模型及 workspace registry 本身仍有原业务/DSH 上层 |
| 默认模型选择及持久保存 | **本轮已替换为 `src/native-state.js`** | 应用原生，保存后重启读回，不依赖 DSH 配置编辑器 |
| 工具 registry、guard、角色隔离、审计、输出、调度 | 应用 `NativeTools` + `native-code-transport`，Pi 驱动调用 | **本轮替换活动 tools 服务与执行管线**；scope carrier、schema/defineTool/codegen helpers、FS/shell 工具后端仍有 DSH，未声称所有权限与进程能力已迁移 |
| 文件与终端、作业与进程回执、沙箱、权限 preset | DSH fs/shell/subprocess/jobs/sandbox/policy | **仍为 DSH**；Pi core 不提供这些安全合同。不能用普通 `child_process` 或关闭沙箱直接替代 |
| 技能、工作目录、指引发现、子代理、工作区注册 | DSH skill/filesystem、workingDirectory、instructions、subagent/workspace | **仍为 DSH**；未迁到 Pi coding-agent 资源加载与扩展模型 |
| 凭据、授权与附件 | DSH credentials/authorization/attachments；宿主环境变量 | **仍为 DSH**；新增模型选择文件不包含密钥，不替代这些安全设施 |
| HTTP 与 DWS | 应用的 Node HTTP server、DWS CLI JSON bridge | 应用原生入口；路由调用的任务/会话能力仍可能依赖 DSH |
| 历史工作流与可选外部能力 | 保留旧源码和扩展入口 | **源码存在不等于当前已挂载或验收**。不能用 200 文件守恒证明所有工作流、浏览器/数据库插件或 Claude 都实际可用 |

完整生产直接依赖和实际 Host 插件行见 `runtime-audit.json`。本轮将开发/历史测试依赖与生产直接依赖区分，但仍有 **55 个 DSH 生产直接依赖**；传递依赖还会包含其他 DSH 包。它们没有因为不单独启动 DSH 进程而消失。

## 进程与协议

- 常驻进程是本应用的 Node 进程，DSH/Cordis/Pi 都作为库运行其中，没有另起 DSH daemon。
- 应用会产生 Node SQLite/完整性检查 worker；执行时由 DSH subprocess/jobs 层创建并跟踪 bash/pwsh、业务命令或后台进程。DWS 开启时会调用配置的外部 DWS CLI；可选 Claude backend 使用其外部 CLI。未配置/未执行的外部浏览器和数据库能力不能列为已运行进程。
- 对外沿用应用 HTTP JSON 与 DWS CLI JSON 合同。对内仍使用 Cordis service/events、DSH Agent/Session 审计兼容接口、Pi v3 日志及仅供导入的旧 v4、LLM 请求/chunk、工具结果及 job receipts。
- 本轮去掉的 JSON storage 与 model selection 使用 Node 文件操作及应用自己的 schema/持久文件；`storageDomain`、`agentDefaultModel` 服务名称暂为兼容调用者保留，不表示仍调用同名 DSH 插件。`storage` 仅提供历史 cutover 检查所需的 backend-root 元数据。

## 本轮实际替换与行为验证

1. 停止挂载 DSH `storage`、`storage-json`、`storage-domain` 三个运行时插件。原 JSON 格式、单写入链、持久化后更新内存、事件顺序、schema 读入校验及 close/drain 改由本地 Node 实现。业务库和旧 v8 schema 的声明 helper 也改为本地实现。工作区注册上层仍是 DSH。
2. 停止挂载 DSH `agent-default-model` 插件。原无界面 Host 没有 config editor，原插件的 `saveSelection` 因此是 no-op，HTTP 保存会在读回时失败；新服务持久写入 `storage/night_model_selection.json`。真实 CLI/HTTP 测试执行 PUT `/config/agent`，关闭并重启同一实例，再 GET `/state/agent-config` 核对保存值。
3. 新存储保留失败的确定性：rename 前失败不改变内存和文件；rename 后失败标记 `NATIVE_DOMAIN_COMMIT_UNCERTAIN`、阻止继续读取旧快照或写入，须关闭并从磁盘证据重开。observer 失败不反向拒绝已提交写入。覆盖原 JSON 导入、并发更新、重复 handle、版本/损坏拒绝、close/drain、符号链接拒绝和重启读回。
4. 当前本地后端明确只实现现有群/workspace/settings 使用的 authoritative single-document 布局；不声称是所有 DSH storage 插件的通用替代。额外插件若需要 per-record/backup-and-skip 布局会明确报错，不能悄悄降级或丢记录。这类未提供的外部插件配置需要逐个盘点。

本轮没有更改既有 `b16ac53` 归档，也没有重试被拒绝的远端写入。替换后的验证结果另见 VALIDATION 的后续记录，不能沿用旧提交的 590 通过数充作新代码证据。

## 完整迁移尚需完成的验收门槛

- Pi 权威上下文/新持久格式已替换；继续移除旧 factory/Session 注册表、v4 事件校验依赖与 inbox 兼容接口。旧 v4 导入保留原事件与旧 writer fence；仅在隔离测试数据上验证，未迁移生产数据。不能同时让两个运行时成为权威写入者。
- provider wire/config/auth/login/discovery 已由本地模块替代旧插件；继续移除通用 DSH LLM registry、request/chunk 桥与共享附件/工具历史 helpers。真实厂商 OAuth、AWS/Vertex/Azure、WebSocket 等外部环境尚未验收，不能把静态模型/协议回归当作所有真实后端验收。
- 建立独立工具 registry、参数验证、角色 guard、效果账与原命令/job 的不可重放收据。用应用管理的实际进程/输出/取消/排空取代 DSH jobs，同时保证超时不冒充退出、正常关闭不冒充业务成功、未知效果不自动重试。
- 实现并在真实可用的 OS 沙箱上验证文件/进程约束、跨任务产物 root、权限 preset、授权修正及重启隔离。嵌套执行器会使 UID map 只读；获准在外层包装之外运行测试后，云机自身 bubblewrap 可用，containment 5通过/1 Windows跳过。不能降低应用隔离通过测试。
- 将技能/指引发现、子代理和 workspace 行为迁入 Pi/应用自有实现；迁移既有持久数据并核对所有当前实际配置的扩展能力。
- 最终以生产依赖闭包中无 DSH、Pi 上下文真实承载业务输入、全部现行功能回归及目标环境验收为完成条件。仅 package.json 不含 DSH、源码复制、接口守恒或 mock 回归均不足。

不需要让用户重新批准这些已授权的实现步骤。真正缺少的信息是生产实际启用的扩展/工具清单和脱敏配置；源仓库不足以确定工作区自定义技能、浏览器/数据库 provider 或任意 Cordis 插件是否属于必须保留的实际功能。不要索取密钥，也不要在没有清单时宣称“不漏全部生产扩展”。

## Pi 权威会话阶段（进行中）

- `src/pi-session-persistence.js` 使用实际 SDK SessionManager，落盘头是 Pi version 3。标准消息记录存真实 text/thinking/toolCall/image 内容，非模型审计事件使用 custom entry。退役上下文以 native branch/resetLeaf 表达；旧审计事件仍可追溯。模型输入读取 Pi 分支，旧 deriveMessages 被置为抛错的真实 wire 测试仍完成工具往返。
- 每批 night.commit 记录事件数量、前一提交及内容校验；只接受完整提交，读检查不修复尾部，持写锁者可截掉未提交尾部。完整记录篡改拒绝且不改证据。首次日志先临时文件 fsync 再 no-clobber link，写/清理结果不确定则拒绝继续执行。
- 只允许单写；Linux 租约核对 PID、boot ID、进程起始时间与 token，死进程可回收。未知 owner 元数据拒绝自动恢复。symlink/hardlink 日志和 symlink 祖先路径拒绝。恢复不执行工具，也不把未知效果判成功。
- 原 `.dsh/sessions` 路径暂为业务路由边界保留，内部新文件是 `<sha256(id)>.pi.jsonl`。旧 v4 日志仅由兼容 importer 读取并保持旧 writer fence；不镜像新事件到 v4。原 v4 逻辑审计/validator 依赖仍在，Pi provider 原生签名与旧 replay 转换尚待后续替换。
- SDK/core/provider 的 Pi 包现已统一为官方 @earendil-works 1.5.0。完整迁移仍需原生 provider、工具/权限/进程与技能等工作，不能以本阶段替代全部完成。

## 统一 Pi 版本检查点 01b033a（历史）

core、coding-agent SDK 和 pi-ai 现均直接固定为 `@earendil-works` 1.5.0，provider 内部也是相同发布版本；pnpm 可因 peer 解析保留同版本的不同依赖实例，不声称单一模块实例。升级适配公开 finishTurn API，36项本地、142项运行时、47项路由及7项定向服务用例通过。

`src/pi-provider-catalog.js` 是下一步独立 provider 的纯配置/模型模块，直接使用 Pi 公开 Models/provider APIs；13项测试核对所有已安装 chat catalog 的模型元数据、内置 auth 实现保留、端点、模型覆盖、推理映射、compat和错误。**该检查点尚未接管 Host provider 请求**，当时实际请求仍由 DSH llm-pi-ai 处理，不能把模块存在说成 provider 已迁移。接下来须完成凭据/OAuth、request projection、图像预算/卸载、错误与流、发现/配置接口，逐个替换后再移除旧适配器。

## 本地 Pi provider 阶段（当前）

Host 已挂载 `src/native-pi-provider.js`，不再挂载旧 `dsh-llm-pi-ai`；旧包仅为历史/差分测试保留在 devDependencies。新增本地模块负责 catalog 与 profile（全部内置 chat provider 保留自身协议/auth 实现）、模型覆盖、推理等级、compat、策略默认值、凭据引用/OAuth record 映射、登录通知/问题、发现、实际请求和原生事件处理。旧 credential namespace `llm-pi-ai/<provider>` 只是持久兼容地址，并非仍运行旧插件。

公开接口差分验证 41 个 provider/1592 个模型的目录、模型控制/推理/更新元数据及 prepared call 默认值，与原实现一致；不访问外部厂商。真实本地 HTTP/SSE 验证 Completions、Responses、Anthropic 三种显式协议，以及原 PiLoop 的完整工具往返和 CLI 重启。附件测试保留只读文件路径、不声称已读、请求图像尺寸/字节预算、逐出现次数卸载、模型 text-only 降级及禁止不支持角色；不静默丢图或扩大文件访问。凭据测试覆盖旧记录、OAuth refresh modify 排他、缺失/非法 key、写失败不冒充登录成功；没有使用真实密钥或登录真实账号。

**剩余兼容边界明确保留：** provider 仍通过通用 DSH `LlmAdapter/llm` registry 接入，原有 middleware 继续执行；应用审计使用旧 chunk 类型，主循环的反向 chunk bridge 尚在；文件/图像/工具历史的一部分策略调用通用 DSH helpers。原生事件模块保留真实 Pi event，同时为既有审计生成单向观察记录，但当前 Host 路径依然经过兼容桥。凭据记录后端、授权服务及附件后端也仍是 DSH。这些不计作已去除，完整迁移仍未完成。

## 沙箱验证更正

只读 namespace probe 经执行器的批准路径在外层包装之外执行，退出0；随后原 containment 6项原样运行，5通过、1 Windows专属跳过。此前4项失败的原因是执行器包装使嵌套 uid_map 只读，并非云机内核不支持沙箱。没有修改应用权限 preset、沙箱实现、测试断言或真实业务授权。普通包装内运行仍应在沙箱不可用时拒绝执行；启动实际服务需要宿主提供真实可用的隔离运行条件。远端403仍未重试。

## 应用工具执行管线阶段（当前）

Host 和原生任务回归夹具均改为 `src/native-tools.js`，没有实例化旧 DSH ToolRuntime。应用拥有分层 registry、继承限制交集、自己的提交工具豁免、单调 guard、审批 gate、caller/wrapper 取消融合、准备/分发/有序后处理、输出验证与内容投影、最终只读审计。PiLoop 仍驱动调用，模型端保留原精确 schema 与工具自身参数 parser/defaults。

`native-code-transport.js` 保留 TypeScript/Python runtime 协议、保留名 run_code、代码模式下直接调用其他能力的拒绝、SDK 声明、嵌套能力过滤、安全并发/独占屏障、按提交顺序的结果审计、图片/上下文转交、独立目录/超时/沙箱参数与一轮审批。实际代码 worker 后端仍是可选的 DSH PTC runtime；本轮不把它或 OS/process 服务算作已替换。模型/任务工具的具体 FS/bash/job/skill 等定义仍由现存后端提供。

执行前增加 Pi 日志意图提交屏障，提交失败或等待屏障时取消都不进入 wrapper/body；调用结果在转交下一步前提交，代码子调用开始与结果也提交。审计失败会停止新准入、排空已开始的效果和审计任务后返回失败，不把超时/未知效果当成功，不自动重放。二次审查覆盖重复 guard 的独立 disposer、隐藏工具拒绝不调用其 finalizer、无效政策决定失败关闭、原始 caller signal 不被 wrapper 替换、最终值身份与冻结、异常 getter 和代码审计失败排空。

保留的 DSH 边界：通用 scope/event carrier 与部分 schema/工具定义/codegen helpers；FS/shell/skill/子代理工具实现；权限 preset、真实 sandbox、job/subprocess/worker provider；原 Agent/Session façade/factory/inbox 及 LLM/chunk 兼容协议。生产直接 DSH 依赖仍55，不以服务替换宣称清零。

### 后台任务注册表阶段

Host 和任务恢复测试已挂载本地 NativeJobs，jobs-local 仅保留开发差分测试依赖，生产直接DSH包降至54。注册表拥有会话归属访问栅栏、按owner限额、作用域控制器及订阅、UTF-8有界输出环/独立游标、首次终态与wait通知、取消及owner/service关闭排空。它是进程内视图，持久任务/进程收据仍由业务账本维护；不自行重新启动producer或重放工作。

保留旧取消函数抛错时“记录强制失败、可能孤儿工作”的明确事实，不伪造进程已退出。真正process spawn/终端/进程树身份与范围观测、sandbox、后台工具表面仍依赖现有DSH后端，尚未迁移。Windows路径只保留兼容，未在本Linux环境真实验收。

后续进程替换的实际边界（已核对当前包接口）：`resolveExecutable`、普通 `spawn`、`spawnTerminal`、`terminalEnvironment`；原后端维护 executable/environment 校验、凭据环境清理、control pipe、stdout/stderr有界收集及spill、Linux用户systemd scope/private bootstrap、Windows Job及PTY、进程身份/范围退出观测、正常关闭和同步host-exit收尾。`done`不是整个managed range静默的替代物，`terminate`后须等待`waitForExit`。未以普通`child_process.spawn`或Pi bash工具直接替代这些约束。当前真实进程恢复回归因此仍验证旧后端；不能算作新进程后端验收。
