# DSH 依赖审计与独立运行边界

## 结论与目标

**当前是迁移中实现，不是完整的 Pi 原生重写。** 它能由 `node bin/night-bot.js` 自行启动，不需要外部已安装的 DSH CLI、DSH 服务或桌面进程；但生产代码仍加载大量 DSH 库。独立进程不等于独立于 DSH。`pnpm audit:runtime` 的机器清单明确记录 `standaloneProcess: true` 与 `standaloneFromDshLibraries: false`，不会把开发依赖分组或本地复制源码算作完成迁移。

用户要求以 Pi 为底座重新实现且不漏功能。执行目标应当是：Pi 成为真实模型上下文与代理运行时，应用自己拥有任务、授权、效果账本和必要的平台能力；原 HTTP/DWS 行为及恢复/授权合同得到验证。不能仅把旧循环外包一层 Pi，或把 DSH 包移到 devDependencies、复制进仓库，就宣称已完成。当前只满足其中一部分。

## 真正由谁执行

| 范围 | 当前实际实现 | Pi 原生程度 / 待办 |
|---|---|---|
| 代理迭代及操作性工具调用 | `@earendil-works/pi-agent-core@1.5.0` 的 `runAgentLoop` | 真正使用 Pi 迭代；单会话工具串行，Host 仍执行工具调度 |
| 模型上下文 | Pi `SessionManager.buildSessionContext()` 的实际分支与消息内容；转回旧 provider 输入结构 | **本轮替换权威上下文**；请求强制 flush 后读取 Pi；禁止旧 deriveMessages 的真实 wire 测试通过。prompt 组装和 provider seam 仍待替换 |
| 模型请求与流 | 本地独立类 `NativePiProvider` → Pi Models.streamSimple 1.5.0；本地 catalog/auth/retry/login/discovery/context/events、原生事件捕获 | **本轮移除旧 DSH provider 插件**；NativeLlm拥有拓扑/调用准备和middleware准入；正常请求保留真实Pi事件，legacy/经修改/超出事件缓存上限的流明确回退兼容编码且不重发。旧消息、附件/工具历史投影helpers与请求格式仍在，尚非完全去DSH |
| Agent 工厂及生命周期 | 本地 `src/pi-loop.js` 中从 DSH MIT 实现保留的工厂、maintenance、注册、取消/排空及持久 inbox；NativeAgents live registry/ALS；NativeSessions/NativeProjections registries；DSH Session facade/scope兼容 | **兼容层**；不是 Pi SDK 的 `createAgentSession`；持久化另由真实 SessionManager 接管 |
| 会话历史与恢复 | Pi v3 原生树日志、night.commit 校验链、单写租约；旧 v4 仅导入/写锁保护 | **本轮替换新日志**；原逻辑事件仍保留在 Pi 审计记录供旧 factory/恢复策略使用；不是已经移除旧 Session 数据 facade/审计接口 |
| 任务、操作、唤醒、资源、通知主账本 | 应用的 `dynamic-task-store.js` 等，使用 `node:sqlite` | 应用原生存储；Pi会话恢复和本地NativeJobs已接管，DSH事件兼容面仍在，不能因此称整个恢复原生 |
| 群与工作区 JSON 后端 | **本轮已替换为 `src/native-domain.js`** | Node 文件系统实现，兼容旧单文档 JSON；群业务模型及 workspace registry 本身仍有原业务/DSH 上层 |
| 默认模型选择及持久保存 | **本轮已替换为 `src/native-state.js`** | 应用原生，保存后重启读回，不依赖 DSH 配置编辑器 |
| 工具 registry、guard、角色隔离、审计、输出、调度 | 应用 `NativeTools` + `native-code-transport`，Pi 驱动调用 | **本轮替换活动 tools 服务与执行管线**；scope carrier、schema/defineTool/codegen helpers、FS/shell 工具后端仍有 DSH，未声称所有权限与进程能力已迁移 |
| 文件与终端、作业与进程回执、沙箱、权限 preset | NativeJobs、本地源代码派生 managed-process后端、NativeSandbox；DSH fs/shell/policy及Windows ACL库 | 进程源代码fork明确保留来源与行为，不计为完全重写；通用工具/权限/平台依赖仍待替换，未用裸spawn降低隔离 |
| 技能、工作目录、指引发现、子代理、工作区注册 | NativeSkills/NativeSkillFilesystem、NativeWorkingDirectory；MIT派生watcher；DSH公开skill helper、instructions、subagent/workspace | Pi header解析与本地能力检查读取/失效；watcher非从零重写，指引、子代理/workspace与通用helpers仍待迁移 |
| 凭据、授权与附件 | NativeCredentials、NativeAuthorization、NativeAttachments及分层环境；旧授权错误/附件类型与投影helpers | 默认Pi登录有attempt-scoped提交，附件blob/codec本地实现且保持v1/请求变体协议；通用helpers仍保留 |
| HTTP 与 DWS | 应用的 Node HTTP server、DWS CLI JSON bridge | 应用原生入口；路由调用的任务/会话能力仍可能依赖 DSH |
| 历史工作流与可选外部能力 | 保留旧源码和扩展入口 | **源码存在不等于当前已挂载或验收**。不能用 200 文件守恒证明所有工作流、浏览器/数据库插件或 Claude 都实际可用 |

完整生产直接依赖和实际 Host 插件行见 `runtime-audit.json`。本轮将开发/历史测试依赖与生产直接依赖区分，但仍有 **51 个 DSH 生产直接依赖**；传递依赖还会包含其他 DSH 包。它们没有因为不单独启动 DSH 进程而消失。

## 进程与协议

- 常驻进程是本应用的 Node 进程，DSH/Cordis/Pi 都作为库运行其中，没有另起 DSH daemon。
- 应用会产生 Node SQLite/完整性检查 worker；执行时由本地managed-process/NativeJobs层创建并跟踪 bash/pwsh、业务命令或后台进程。DWS 开启时会调用配置的外部 DWS CLI；可选 Claude backend 使用其外部 CLI。未配置/未执行的外部浏览器和数据库能力不能列为已运行进程。
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

### 沙箱与进程阶段

NativeSandbox替换sandbox-local服务，拥有Linux bwrap/Landlock与macOS Seatbelt profile、平台链选择、受限探测缓存、错误归因元数据与调用前取消检查。Windows ACL能力库仍明确保留；standing workspace grant与每session随机temp能力的复用、失败清理/关闭回收契约经过模拟验证，未把Linux测试冒充Windows实机验收。新增真实内核测试分别验证read-only/workspace-write工作目录内外写入结果。

进程服务改挂本地`src/process/index.js`，操作系统后端是明确保留MIT来源的代码派生实现，非从零重写；见process-fork-manifest.json与THIRD_PARTY.md。原进程树/Windows Job、PTY、范围退出观测、输出尾部与spill、控制管道、取消/关闭行为保留；契约、lazy loading、runner定位与Windows FFI代码为本地模块。代理仍由Pi迭代，平台进程代码不伪装为Pi SDK功能。旧工具后端仍使用同名服务接口，generic proxy overlay及Windows ACL库等仍是DSH依赖。**复制源码本身不计为完成去DSH迁移**；后续仍需迁移通用LLM、工厂/registry、附件/凭据、skills/workspace与FS/shell/policy。

### 本地LLM与Agent运行时注册

NativeLlm拥有provider拓扑、目录/发现、精确模型元数据验证、默认值、绑定单代配置的一次性prepared call、middleware派发、文件/图片/工具历史投影准入与错误边界；保留现有RPC方法标记。NativePiProvider为独立类，不再继承旧LlmAdapter。正常模型响应保留Pi的真实api/responseId、thinking/text/tool签名和流事件；chunks仅作单向审计。原始与middleware准入审计流逐条快照并计算有界指纹，任何修改（包括只修改delta、终态文本不变）都回到兼容编码，绝不重发请求。多嵌套native调用或4096事件缓存上限也走明确兼容路径，最终内容和副作用不丢失；文本被修改后丢弃旧opaque replay签名。

NativeAgents拥有精确实例父子归属、同步入册/串行创建通知/幂等卸载、factory调用者上下文、ALS initiator原Promise身份、关闭拒绝新入场并排空原调用链、自发关闭排除自身等待。native-agent-context融合事件subject与scope，payload不能替换agent。保留旧类型标识/Agent helper依赖用于既有RPC及子代理兼容；不是为了降低计数而移除这些生产类型资源。当前直接DSH依赖55个、已替换11个活动服务。

仍有DSH session registry/projection服务、v4内存审计facade、scope/消息/附件投影helpers、Typert载体、权限/文件/shell wrapper、Windows ACL、凭据/附件、skills/workspace/子代理等。NativeProjections只有原型与5项单元测试，本阶段尚未挂载。不得因文件存在就把它列为已迁移。

### 本地Session/Projection与策略、启动环境

NativeProjections已挂载：增量水位、同版本引用计数、snapshot/checkpoint/cold restore/hydrate与日志末尾锚点均在本地实现；截断或缺口拒绝缓存冒充当前状态。checkpoint为分离副本；字典键不会继承伪造原型数据；订阅独立、观察者错误不阻止其他fold推进。

NativeSessions拥有入册/创建/卸载、精确Session实例flush、全部listener排空后抛首个失败、fork边界与声明周期。**仍使用锁定版本的DSH Session内存数据facade**及其publicationEntry/commit兼容钩子，未复制成“全新Pi Session”冒充独立。跨Native store/旧store已有owner拒绝，后加冲突owner在append前失败；卸载在创建或append发布结束后才发生，sealed facade仍安全释放所有权并可重新attach。持久上下文与提交链仍由真实Pi SessionManager拥有。

NativePolicy不再生成/加载旧策略补丁。站立mode、一次性批准优先级、不可变cwd、artifact owner/root绑定、每次resolve检查所有祖先/链接保持；核心execution-session的mode写入改走本地helper，成为第6个明确适配的核心模块。旧setter依赖仍为其他未迁移wrapper保留，没通过移除依赖声明伪装完成。

环境审查确认旧launch-environment包只有helper而不是可挂载插件，原先单独列row并未加载dotenv。现CLI在应用模块前验证/加载继承env > 项目.env > 用户home.env，并保留层来源；只补未设置值，仓库不能设置proxy/代码路径，home不能更改CA。CLI复用既有proxy transport工具并在关闭时恢复，嵌入式createHost只提供隔离snapshot、不修改process.env或全局transport。模型实际调用证明可写dotenv fallback后，下一请求采用managed credential；没有将file值误记为只读继承env。SDK bootstrap目录/更新入口与Native Bot保留名字同样只能来自继承层。

## 原生凭据服务阶段

NativeCredentials已取代活动credentials-local：严格v1 YAML refs/records解析、原flat格式受控迁移、注释保留、只读继承环境/托管存储/dotenv层级、metadata-only通知、watcher整份快照替换及损坏reload保持最后好版本。未知字段、重复键、非JSON grant和非owner-only文件拒绝；错误不回显凭据值。返回值和mutator输入隔离，回调返回undefined不修改缓存。显式相同值提交仍发布确认，兼容授权流程。

跨进程使用原PID-newline/hash takeover协议，真实旧进程与新进程并发grant更新通过。新实现保持open inode校验，拒绝丢失写锁后的提交/释放，未知或活PID锁不偷取；写temp0600并fsync、rename。关闭拒绝排队刷新、排空已开始的轮换，不自动重放回调。Pi CredentialStore的signal在入场和mutator前检查，已开始轮换保留排空语义。Watcher追踪真实原子替换与删除。Host增加credentials/authorization必需服务检查，损坏文件不能静默退回ambient auth。

旧credentials-local仅开发差分依赖；通用credential类型资源、授权会话、附件、skills/workspace和部分工具/权限等仍保留。测试数与证据见VALIDATION/validation-results.json；不以这次服务替换宣称完整迁移。远端403未重试。

## 原生授权会话阶段

NativeAuthorization替代活动authorization服务，拥有flow注册/独立metadata、单key尝试、取消/decline、入场与durable commit栅栏、flow退出封口、注销和关闭排空、contained通知。Pi仍负责具体provider登录；registerPiLoginFlows向每次Pi Models实例提供attempt-scoped凭据入口，等待存储锁时可取消，真正mutator入场后完成持久写入。经seam/attempt-scoped Pi入口的已取消/失败尝试不能晚写覆盖新登录，no-op mutate不算提交。实际Pi Models登录及相同凭据再次登录均经过真实本地YAML存储验证。

通过ALS归属检查，另一个请求对同key的写入不能冒充本次登录成功；可信旧flow直接写store仍保留同调用链提交观察。授权flow注销自身/关闭自身服务排除自等待，其他已开始提交仍排空。错误类型身份继续复用旧authorization helper以兼容既有interaction插件；未把此依赖移到dev伪装清零。生产直接DSH依赖仍54，活动服务替换16。附件、skills/workspace、子代理、FS/shell/permission wrappers及Session facade等仍待迁移。

兼容边界：可信自定义flow若绕过session.commit/session.credentials而直接使用全局store，其副作用仍由该插件负责遵守signal；本地注册表不宣称能撤销插件直接持有的全局写能力。默认Pi登录已全部使用attempt-scoped入口。

## 原生工作目录阶段

NativeWorkingDirectory同时替换root与agent preset中的working-directory服务。它通过已注入FS能力解析/检查目录，保留调用者归属，不直接读取宿主文件系统绕过wrapper； cwd变更不修改原始Session header或沙箱root。每Session串行、取消/owner关闭后禁止append、服务关闭排空、缺失当前目录回退原项目、默认cwd首次落日志、commit后通知错误不撤销状态均保留。模型context在downstream assembly之后重采样，防止沿用旧目录。

源working-directory已移为开发差分依赖；FS/shell/permission能力后端、skills及workspace/subagent等仍未迁移。基础验证为8项合同（含旧服务差分、调用者归属与prompt重采样）、真实CLI/wire、完整任务及真实内核隔离回归，具体结果见VALIDATION和机器证据。生产直接DSH依赖53，已替换17个活动服务；这些计数不代表完整功能迁移。

## 原生附件后端阶段

NativeAttachments默认替换attachment-local。内容寻址v1路径、引用字段、跨平台清理文件名/UTF-8字节上限、原件流式写入与backpressure、0600 staging/fsync/hard-link publication/0400对象、去重时校验、读取时摘要/byte-count验证均由本地实现拥有。取消和失败清理暂存，不返回部分批次引用；内容对象已发布但后续失败时可以保留无引用对象，绝不把这种结果自动重做业务交付。内部目录链接在创建子项前拒绝。

Sharp 0.35.5延续原已锁定codec版本，原型/metadata解析、完整decode准入、8-bit sRGB单帧归一化、透明WebP/不透明JPEG质量阶梯与字节fallback、朝向/metadata清理、图像像素/尺寸/字节限额均保留。request-image-v6 descriptor和衍生图缓存/readonly原件句柄不变；共享请求最后waiter取消、transform并发限额、cache损坏重建与服务关闭排空由本地生命周期管理。流式read iterator在调用者暂停消费时仍可由关闭驱动底层return，防止悬挂文件句柄。

图像/文件协议与算法保留MIT来源署名，见THIRD_PARTY/许可文件；不是Pi SDK实现的图像codec，也不把兼容协议字段复制当成功能证明。现有文件和所有支持图像格式、16位、透明、orientation、清洁pass-through、请求衍生字节及variant ID均与旧实现差分。实际Pi模型wire使用新后端，验证像素预算内衍生图发送且原件不变。旧backend仅开发差分依赖；通用附件type/admission及LLM projection helpers仍明确保留。

## 原生技能注册表阶段

NativeSkills拥有scope/provider/runtime注册、同层rank与注册顺序、近层完全覆盖、完整/不完整catalog、revision两次有界重试、cwd+scope identity有界cache、callback隔离和取消等待。options、候选对象、opaque locator和加载后的definition均保留readonly借用身份；不会为适配Pi而破坏provider按原候选定位资源的约定。注册失败/卸载会撤销原provider生命周期，名称被修改也不能泄漏原注册；卸载期间返回的迟到body不再准入。

默认Host与原生任务fixture已挂载NativeSkills；10项合同含旧服务差分、rank/作用域、borrowed identity、partial/failure不cache、并发失效、cache容量、cancel、通知隔离与撤销竞态。生产仍保留dsh-skill的公开render/invocation helpers，以及原filesystem发现/watch/provider；本阶段不把注册表替换说成技能文件读取已经迁到Pi，也不通过移走helpers依赖伪装清零。

## 原生技能文件 provider 与默认监听阶段

NativeSkillFilesystem取代活动skill-filesystem。项目.dsh/.agents、自定义、用户与bundled根的优先级、平面文件与目录bundle、metadata/whenToUse/调用开关、正文CRLF与已有version hash语义保留。目录列举与正文读取经ctx.fs能力，只有原先明确trustedHost的bundled根保持宿主读取；权限错误不回退，不把I/O失败当空catalog。普通header由Pi coding-agent.parseFrontmatter解析，合法`---prefix`映射key引发SDK提前截断的少见情况走明确YAML兼容分支。

OS watcher保留明确MIT源码派生后端，见skill-watcher-fork-manifest及许可；局部imports/总诊断、反复路径转换最多8次为显式适配。缺失根只监听下一层入口，完整根depth1，项目owner有界、失败返回incomplete可读catalog、重开与关闭排空保留；这不宣称watcher从零重写。

修正此前headless固定watch:false导致外部编辑不触发正文复核的缺口：默认skillWatch:true，允许显式false。真实Host外部更新metadata可见；实际Pi SDK四次wire请求证明只改正文也在下步得到提示、不会自动注入新正文，显式重读才采用新版本且保留旧审计。注册表单独卸载会撤销外部owner注册的provider lifecycle，避免遗留watcher。11文件provider合同、1实际刷新wire及11注册表合同覆盖读取/失效/撤销边界。

原skill-filesystem仅开发差分依赖。公开skill render/invocation helpers、FS/shell/permission wrappers、workspace/子代理、Session facade等仍在；51直接DSH依赖/20活动服务替换是部分迁移记录。后续还需核对无可视化的operator auth/config入口，不能因内部service可调用就把所有原Host设置功能视作已交付。
