# 迁移范围

**迁移尚未完成。** 真正 Pi 原生部分、DSH 剩余功能/进程/协议/存储和下一步门槛见 [DSH-AUDIT](DSH-AUDIT.md)。

源：`HiQ-AI/dingtalk-dsh-assistant`，主干 `93e431a`（#341）。目标既有初始 README 与 MIT LICENSE；保留 LICENSE，更新 README。没有复制源仓库 `.git`、`.env`、个人 profile、凭据、数据库、真实消息或历史验收产物。

## 运行边界

`src/pi-loop.js` 使用 pi-agent-core 的 `runAgentLoop` 驱动迭代和工具调用。Agent/Session/Projection注册、默认模型、LLM和工具调度已由本地服务接管；持久inbox、AgentLoop适配及v4内存Session facade仍保留MIT兼容实现。原模型/工具step循环已替换。每一模型请求先持久化已准入事件，再从 Pi SessionManager 的权威分支读取实际内容；旧 DSH deriveMessages 不再为主循环提供模型上下文。任务权限和效果账本仍由应用维护。模型 wire adapter 已替换为本地 `native-pi-provider.js`，直接使用 Pi Models；保留多模态、provider replay、凭据、模型选择和错误分类。LLM middleware准入归本地NativeLlm；GenerateOptions/chunk兼容协议、通用消息及附件策略helpers仍保留。版本由 pnpm lock 固定；当前代理循环固定为发布包 `@earendil-works/pi-agent-core@1.5.0`，本轮已从已弃用的 @mariozechner 0.73.1 升级并完成对应回归；停止条件使用1.5.0公开的 finishTurn 合同。

应用 NativeTools 保持统一工具准入、业务/权限 guard 和调度入口；具体工具仍保留自己的参数校验/defaults。Pi 的操作性工具声明不重复执行更严格的 JSON Schema 校验，实际发给模型的仍是原始精确 schema；这样可保留 Zod 默认值、未知/隐藏工具尝试的拒绝和审计。Pi 1.5以parallel模式准备工具批次；操作性adapter共享一次应用调度，保留maxParallelToolCalls安全并发池、动态独占屏障、model顺序收据和取消排空。不同Task/Execution的并发、资源互斥与排队继续由应用控制；没有再强制整批串行。

`src/host.js` 组合无界面 Host，`bin/night-bot.js` 加载可信 JSON 配置并启动原 resident HTTP/DWS 服务。`packages/dingtalk-core/` 保留领域实现，`packages/dingtalk-dsh-assistant` 为供原测试保持导入路径的本地符号链接。未安装源 Web observer 应用，删除核心包的 `client.js`、`web-client.js`、前端 stub `index.js` 和 Cordis Web patch；保留 observer 命名的后台投影和 HTTP JSON 接口，因为任务、审计和交付依赖它们。没有启动遥测或原 DSH Web/桌面程序。

## 功能与迁移映射

| 功能 | 保留实现 | Pi 下的验证入口 |
|---|---|---|
| DWS 群接入、历史回填、引用、提及、附件/文档、用户身份与 profile | dws-adapter/bridge/runner、group-person-aliases | dws-*、native-dws-send、task-topic-routing-native |
| Topic 拆分/归并、复用、上下文分页、澄清/挂起、固定话题 | topic-runtime/model/facts、task-topic-coordinator、fixed-topics | task-topic-routing-native、topic-routing-clarification/hold-native、topic-runtime/facts |
| 唯一 Owner 统筹、委派/续办、成员消息与职责纠偏、并发与资源互斥 | task-session/service、execution-session、resource-catalog | task-session-service-native（包括 11 成员与容量队列） |
| 补充/重规划、取消/排空、恢复、租约/版本栅栏、未知效果对账 | dynamic-task-store、dynamic-operation-readback、task-session-persistence | service-native、provider/execution-provider/job-recovery-native、persistence-native |
| 技能发现/读取/刷新、模型与推理参数、文件、命令/作业、原生子代理 | session-skill-refresh、task-model-config、保留工具/沙箱 Host | skills/model/progress-native、pi-wire；完整子代理业务路径仍需环境验收 |
| 原件/授权等待的范围隔离、来源及有权答复、人工协调 | task-boundary/source-instructions、task-permits、group-coordinator | human-native、service-native、workflow-uat-build-authorization |
| 未知操作阻断、执行原生收据、进程输出与退出独立核对 | dynamic-process/filesystem-scope、native-job、operation-readback | job-recovery-native、service-native |
| 通知冻结、发送/回读/撤回、避免重复发送、通知与业务完成分离 | notification-delivery、native-dws-send、task-notification-readback | notification-retry-native、dws-*、service-native |
| 文件/截图产物、独占目录、跨轮保留、最终附件交付与部分发送恢复 | task-artifact-*、task-final-delivery、session-workspaces | artifact-*、final-delivery、service-native；shell 隔离验证见 VALIDATION |
| 持久排期、触发、固定事项、协调退休兼容、审计/性能/告警 | platform-schedule、coordination-*、performance、HTTP projections | coordination-schedule-revisions、现有领域测试；真实排期外部交付未验收 |
| 业务工作流、Git/PR/UAT/发布、Bytebase/Postgres、源文件证据 | workflow-*、execution-*、task-*-workflow | 保留原实现和测试；本次没有接入真实业务系统、合并或部署 |
| Claude 可选执行后端 | claude-execution-session | 保留兼容实现；未安装/登录 Claude CLI，未验收 |
| CLI/后台配置、模型 provider、群职责、技能/插件扩展、HTTP 控制与人工答复 | config.js、host.js、resident/http、task-resident-runtime | pi-wire、pi-config、HTTP 路由守恒 |

完整源文件哈希清单为 `docs/source-manifest.json`。`pnpm check` 验证每个保留模块仍存在、改动有明确记录、相对导入闭合和每条源 HTTP 路由仍存在。该清单证明文件和接口守恒，不等于每个真实外部功能已验收。

## 与源实现的有意差异

- 没有前端或桌面；CLI/config 和原 HTTP 接口作为运维入口。
- 代理循环由 Pi 驱动；新持久会话为 Pi v3；旧事件/Host 接口、导入及 provider 兼容层仍依赖 DSH，并非去除全部 DSH 的重写。
- 内部历史 backend 标签仍保留 `dsh`，实际运行是 PiLoopAgent；可选 `claude` 路径保留。
- 群决策指引将同义的“不唤醒任务”改为“不唤醒已有任务”，对齐源测试的明确措辞；“已有任务受到相关事实影响时回流原 Owner”的规则保持原样。
- 原生测试 Host 改挂 PiLoopAgent；人工协调恢复测试保留模拟的重试到期时钟，直到原执行实际恢复并排空，防止异步入场前将时钟倒退。原业务断言全部保留。
- API 只允许 loopback 启动；未加入远程鉴权系统或可视化。
- 未部署、未合并，未迁移任何生产数据；旧部署脚本仅为源实现参考和测试依赖，不能作为 Night Bot 部署入口。

## 后续替换记录

`src/native-domain.js` 与 `src/native-state.js` 替换 active DSH storage/storage-json/storage-domain/default-model 服务。核心 store 与旧 v8 schema 的声明 helper 改用本地实现，其余领域源码继续保留。新模型保存接口不依赖 DSH config editor，HTTP 保存与重启已测。兼容服务名保留，实际实现与不支持的额外布局明确见 DSH-AUDIT；此变化不意味着会话、工具、权限或 provider 已脱离 DSH。生产直接依赖已与 108 个开发/历史测试依赖分开，但仍有 56 个生产直接 DSH 依赖。

Pi 会话阶段同时修复旧服务在异步容量清理前提前移除跟踪 promise 的竞态；新 Pi lease 目录由 backend 自己管理，原安全目录扫描仍拒绝链接但不递归扫描这些会消失的临时目录。所有改动在 source-manifest 明确记录，目前五个核心模块存在有意差异。旧日志导入后保留 writer fence，并在下次租约核对旧历史指纹，发现旧软件改写时拒绝继续，防止分叉恢复。

### 后台任务注册表阶段

Host 和任务恢复测试已挂载本地 NativeJobs，jobs-local 仅保留开发差分测试依赖，生产直接DSH包降至54。注册表拥有会话归属访问栅栏、按owner限额、作用域控制器及订阅、UTF-8有界输出环/独立游标、首次终态与wait通知、取消及owner/service关闭排空。它是进程内视图，持久任务/进程收据仍由业务账本维护；不自行重新启动producer或重放工作。

保留旧取消函数抛错时“记录强制失败、可能孤儿工作”的明确事实，不伪造进程已退出。真正process spawn/终端/进程树身份与范围观测、sandbox、后台工具表面仍依赖现有DSH后端，尚未迁移。Windows路径只保留兼容，未在本Linux环境真实验收。

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

## 原生工作区阶段

NativeWorkspace取代活动workspace注册表：v2全局顺序/账户、canonical目录与不可变Session cwd成员校验、header-only历史引导、默认目录首次初始化与删除tombstone、排序/标题/移除、归档/置顶、活动检查和stop事件保持。Pi SessionManager持久服务提供header，注册表不读取模型/事件正文；原workspace包仅保留五种公开错误身份供既有调用者兼容，没有构造旧注册表。

创建和删除采用明确pending marker，只有匹配标记的单行可恢复；未知孤儿或重复账户拒绝启动，不推测修复。持久提交后才发布实体/order，失败回滚；共享域关闭先排空已入场的复合变更。原调用者scope销毁不使长期workspace实体失效；显式合法重绑定会清理旧的失效原始账户，避免下次启动出现重复owner。

补回一个原先藏在UI session controller中的非可视化要求：agent/pre-step拒绝归档会话及其subagent祖先链，独立fork不继承归档。真实Pi wire证明归档父/子没有模型请求、fork仍可运行、取消归档后恢复；仅查询已live或已索引header，未知cold祖先保持原直接parent归档fallback，没有声称验证所有未加载谱系。归档先持久化再请求停止，不把发出cancel冒充进程已经退出，也不重放业务。

17个合同覆盖旧服务差分、故障恢复、header读取失败、异步观察一致性、owner关闭/自关闭和祖先判定，另有1个真实Pi wire。51个直接生产DSH依赖、21个活动服务替换仍是部分迁移：workspace错误身份、公共skill helpers、子代理provider、FS/shell/权限及v4 Session facade继续明确保留。远端403未重试。

## 无界面 operator 授权入口

`bin/night-bot-auth.js`只组合本地凭据/授权服务和真实Pi login flows，不启动resident、DWS或agent。支持list、login/provider/method、logout及describe/set/unset环境变量引用；状态仅metadata，密钥输入不经argv或输出。终端readline关闭恢复raw mode，空闲/secret阶段静音，管道答案有界队列可提前到达；EOF、select错误和取消明确失败，不挂住或保存未准入输入。SDK/vendor异常正文不直接输出。

补回默认credentials watcher，独立operator进程写入/删除在运行Host同步，真实Pi wire已验证下一次请求使用新值；显式credentialsWatch:false仍允许禁用。引用set/unset支持signal在真实writer锁前取消，已入场提交按原语义排空。该入口补齐运维设置的一部分；不宣称Pi vendor OAuth/所有旧Host编辑器或全部可视化控制功能已经验收。

## 原生提示注册与组装阶段

NativeSystemPrompt取代活动system-prompt服务，拥有scope层section/context/variable/tool注册、有限order检查、同名近层覆盖、确定性section/tool顺序、隐藏但已知tool名字与rest marker、schema副本和组装waterfall。complete section在middleware后保持权威；上下文抑制只作用于可选事实。请求准入refreshContext重采样已注册事实，补回被waterfall移除的required事实，不重新运行section/tool/variable provider或waterfall。

默认Host仍关闭可选harness identity；单独服务启用该项时文案改为Pi，其他排序常量及准入算法保留MIT来源。旧包公开renderPrompt/renderContextSnapshot等渲染helper和通用scope集合仍为明确依赖；没有构造/委托旧SystemPrompt服务，也不把共享helper称为Pi SDK能力。六项合同包括旧服务差分和完整prompt/required-context准入，实际Pi wire断言默认构造器为NativeSystemPrompt，技能正文刷新及工作目录重采样继续回归。

## 原生模型请求重试阶段

NativeLlmRetry替换活动llm-retry，拥有每provider/policy预算、durable retryId链、step/turn重置、normal/always语义、Retry-After上限、指数jitter退避、downstream重试优先和关闭取消/排空。本地安排的scheduled和started记录均经真实Session flush，并核对Pi authority已提交event水位，才允许返回retry；没有Pi writer或flush失败不能再次请求。取消中的已入场写入排空，不因authority随后卸载而声称可以继续；downstream回调关闭自身排除自等待。

真实Pi wire为工具执行成功→后续模型503→模型重试成功；第三次HTTP到达前从Pi持久reader读到两条retry记录，工具及收据仍仅一次。七项合同包括旧实现差分、两个flush栅栏、失败/cancel、自关闭、policy/provider独立预算和always/downstream优先。该变化不重放工具/业务，不把模型请求重试当未知业务操作恢复。always模式接受downstream自己的retry决定时，不伪造本地retry-chain记录；整体模型准入仍由PiLoop日志栅栏负责。

原timeout行经源码核对仅导出函数、没有apply/default插件，移除这条空挂载，不计活动服务替换；其与旧llm-retry直接依赖移至开发，仍可被其他旧wrapper作为传递helper使用。生产直接DSH依赖49/活动服务替换23，仍需迁移公共helpers、子代理、preset、FS/shell/权限和v4 Session facade；不是完整去DSH。

## 本地 spawn/fork 子代理 provider 阶段

默认Host改挂NativeSubagentProviders：本地创建能力声明、spawn不读父历史、fork只取最后turn/end及以前的平衡prefix由应用实现；保留参数覆盖、结构化输出、深度、工具过滤和persona能力声明。真正child创建/续办/排空及权限委派仍由明确保留的旧subagent manager负责，不把provider替换称为完整子代理迁移。

两个旧provider差分和一个借用事件身份/独立数组合同通过。实际Pi wire在父会话第二轮仍等待模型时启动spawn/fork：两child均为PiLoopAgent，各自Pi SessionManager日志且继承night-bot preset；spawn没有父内容，fork有已完成轮次但没有正在等待的轮次。该实验只证明实际构造/上下文边界，不冒充全部续办、冷恢复、工具限制和外部provider验收。

旧两provider根依赖移至开发差分；47直接生产DSH依赖、25活动服务替换仍为部分迁移。旧子代理continuation manager、preset、FS/shell/权限、公开helpers和v4 Session facade继续保留。远端403不重试。

## 工具批次并发行为补齐

核对锁定Pi 1.5安装包的toolExecution接口后，移除此前强制串行适配。Pi准备完整批次并触发操作性adapters；这些adapters共享唯一批次promise，由本地保留的MIT调度器执行一次，保持NativeTools准入/审计、maxParallelToolCalls上限、live isConcurrencySafe重分类、独占屏障与model顺序结果。每个SDK调用仅领取自己的已提交结果，不再次派发工具。当前协议路径中的异常重复call id保留无效果/ToolNotStarted可纠正收据基线，不宣称支持该无效provider输出；结果投影在释放adapter前按序完成，失败不留下未等待的兄弟工作。

配置新增可选正整数maxParallelToolCalls，默认4。五项真实Pi wire覆盖异常重复id无效果恢复基线、cap=2、乱序完成但model顺序持久结果、独占屏障/运行时重分类、拒绝与隐藏工具零效果、取消后禁止补位并排空已启动工作、一个concluding工具在全部兄弟收据完成后结束本轮。不是绕过SDK循环，也不让SDK无约束并发绕过应用guard；其权限/调度边界继续由应用拥有。

## 原生审批与权限预设阶段

NativeApproval替代user-approval。保留readonly同进程request/agent/signal身份、actor scope、ask/never、单次allowed-once与完整失败词汇、policy override/模型通知、open-turn前置条件。asked刷入Pi日志后才调用answerer，decided刷盘后才返回；无writer/flush失败拒绝产生未记录grant。等待中策略改never不能采用迟到allow，服务关闭封口未决定请求，已准入decision提交排空。只有审批服务owner卸载时仍借用存活的原Session store完成取消审计，不通过已销毁的调用scope访问服务。可信answerer未响应取消时，其迟到结果被封口；不声称能撤销插件自己持有的副作用能力。

NativePermissionPresets替代permission-presets，保留canonical knob事件、同bundle选择优先、custom派生、动态未来默认值、fresh/seeded/partial pin、固定且仅当前会话的Auto、commands/RPC/catalog及无veto通知。没有confined executor时拒绝。Auto admission必须同步且registration在回调后仍有效，防止回调撤销自身后写宽权限；原型继承名字不能当配置条目。外部Auto reviewer不是默认Host的一部分，未把Math/API合同冒充真实reviewer验收。

真实Pi两轮工具调用证明asked在答复前、allowed decided在body前持久化，grant不延续到后续操作，缺少answerer零效果；取消中的审计先于turn/end关闭。该测试发现此前driver只在下次request/handle.close才刷新最终step/turn边界：现idle前等待最终flush并核对Pi committed event水位。失败发agent/error并fence该实例的后续消息入场/自动wake，不能沿不确定终态继续模型或工具；owner重新建立实例仍需通过既有日志校验与业务收据栅栏。idle是活动完成状态，flush失败通过错误通道报告，不能把它当成功持久化。

## 原生 shell 环境事实注册表阶段

NativeShellEnvironment替换preset内shell-env服务。DSH_HOME/SHELL/SESSION_ID/PROFILE/PROFILE_DIR及DSH_*扩展键作为现行脚本协议保留，不用改名掩盖兼容面。每次collect重新解析trusted contributors，保持同进程execution/method receiver身份、caller profile scope、确定性顺序和冻结快照；list只返回声明，不执行resolver。home取显式配置/继承launch snapshot/旧默认目录，不修改process.env。

声明/name/key owner在注册时固定，metadata原对象后来变更不能增加保留字段、借改名遗留旧注册或冲掉新owner；异常/未声明/非字符串/async resolver明确失败，不返回部分env，拒绝的原生Promise也被接管避免未处理拒绝。生命周期关闭清空registry并拒绝后续收集/注册。合法动态值仍由原resolver按execution计算。

六项合同含旧实现差分和权限元数据反冒充。新增真实Pi→bash→应用内核沙箱wire，用临时假ambient DSH_SESSION_ID/EXTRA/UNDECLARED证明真实命令只收到可信session/home/扩展值，未声明ambient项被剥离；此测试在AGENTS允许的外层executor之外运行，未关闭应用sandbox，且不打印真实env或token。原shell executor及命令工具仍是DSH依赖，未把本注册表称为整个shell迁移。

## Native instruction context stage

`native-agent-instructions.js` now owns the active preset instruction controller. Discovery, candidate ordering/deduplication, bounded provider reads, UTF-8 rendering budgets, excluded scopes and version reconciliation are explicitly MIT source-derived algorithms. The controller reads only `piAuthority.context(id).hostMessages` plus the currently claimed messages to decide visible baseline/change/removal state; no legacy Session surface fallback remains. Native launch snapshots determine the inherited `.dsh`/shared roots, while all runtime file reads retain the preset capability provider. Successful nested tool touches are keyed by execution tokens, deferred across open steps and reconciled serially. Disposal aborts and drains admitted work without late inbox publication.

Six contracts include old loader/renderer differential, legacy-surface poison, updates/removals, nested tokens, capability denial and shutdown drain. A real Pi wire covers both global roots, project baseline, real nested read, external updates, deletion and cwd replacement. Generic FS/shell capability services, preset registry, subagent continuation manager and Session facade remain; this stage alone does not complete their migration.

## Native preset generation registry

`NativeAgentPresets` owns detached definitions, eager audited Loader trees, retained revision leases, scoped service lookup and exact parent-generation inheritance. Retired revisions remain available until the last Agent/cold-read lease releases them; new registrations with the same id do not silently move existing Agents. Inventory, read-document, default selection and RPC method identities remain. The local preflight preserves manifest peer/version/exemption checks and nested patched Include denial without loading app-boot or evaluating plugin code. Compatibility ABI `0.2.1-alpha.2` names the explicitly retained v4 helpers, not the application or Pi version; it must change only with an audited ABI migration.

Preset selection rechecks blank/live identity after async lookup, flushes `agent-preset/selected` through the Pi committed watermark before returning, and blocks concurrent model pre-step admission until selection settles. Failed commit fences only the exact live Agent object; reopening a new Pi-backed instance can recover after valid persistence. A session starting during lookup keeps its previous composition. Definitions are detached from caller mutation. Source-derived scope/Loader/document/compatibility algorithms are MIT-attributed rather than counted as invented replacements.

## Native subagent manager and restored cold discovery

The active `subagent` service is replaced by `NativeSubagents`: provider registry, activation slots/lineage, per-child delivery locks, startup rollback, cold descriptor reconstruction, model/human messaging, catalog/recursive discovery, interruption, structured-result capture and scoped/whole-Host drain now have application ownership. Every local child uses Pi journal authority. Fresh/cold message admission runs in child maintenance and flushes parent catalog plus child inbox before model wake; failed admission cancels the child before releasing maintenance. Natural/explicit terminal capture requires a Pi committed watermark and reports `error` on uncertainty instead of best-effort success. Completed tools are not replayed on cold continuation and providers are not redispatched.

The old default Host omitted `sessionQuery`, making cold reconstruction/discovery unavailable despite successful fresh spawn/fork tests. `NativeSessionQuery` restores that seam: live-preferred observations, revision-bound read-only cold preparations, retained leases, corpus/event/title/search/trace presentation and owner cancellation/drain. Read handles close on failure; queries never acquire writer authority or make children live. Legacy Session event/presentation helpers remain explicit; they do not supply Pi model context. Historical error identities/control-tool helpers remain supported.

Actual local Pi wires cover tool-once cold continuation and parent completion notices, exact lineage/cancellation, structured correction, human text and valid/invalid image admission with durable request/time-zone attribution, independent activation pools, interrupt acknowledgement versus body drain, scoped forests, startup/terminal commit failures, unknown/unavailable discovery branches, external-provider capability refusal/removal and actual Host shutdown drain. External backend completion in tests is a fake run, not a real vendor/backend acceptance. Static/root dependency count rises 42→43 because the restored read-only query needs an explicitly declared event-format/catalog helper; only the formerly active subagent service earns a replacement credit (31 total). The absent query is a repaired missing feature, not a removed-service credit.

## Native session title metadata

`NativeSessionTitle` now owns deterministic control-stripped/UTF-8-bounded fallback, explicit user pins, deliberate refresh, automatic first/all-prompt cadence, immutable provider declaration/input snapshots, revision supersession and provider/owner cancellation/drain. Main-request route tracking remains exact even when a later Pi turn does not append another request/header. Nested operation ancestry prevents provider self-unregister and owner self-close from waiting on their own work; aborted/late results never append titles. Normalization/fold/cadence algorithms are MIT source-derived; the canonical public SessionTitleInvalidError identity remains a production helper, and NativeSessionQuery uses the local fold. Existing sync rename semantics append metadata; durability remains the NativeSessions/Pi journal flush boundary.

Seven contracts cover legacy normalizer/lifecycle differential, pinned rename races, immutable declarations/reference validation, provider replacement drain and both self-disposal paths. An actual Pi wire proves two-turn automatic cadence with only one request header, pinned suppression, explicit refresh and cold read from native persistence. The task fixture also uses the native service.
