# Night Bot

Night Bot 是基于 Pi 的个人助理 Agent 初始化套件，任何人都可以初始化自己的助手。记忆、任务与技能为渠道无关的核心，钉钉只是可选接入渠道之一。Pi agent-core 负责模型/工具迭代，Pi SessionManager 负责当前会话历史与模型上下文；消息、常驻 Router、单任务执行、恢复、权限、通知和交付继续由应用维护。核心支持无界面运行，保留 HTTP 接口；DWS CLI 与 Web 控制台均通过独立可选渠道插件接入。

同一 API 路由可配置多个模型：Web「设置 → 模型列表」与无 Web 的 `night-bot-settings model-list/model-entry` 共用模型目录、版本校验和引用保护，新增/编辑/删除后可分别为分诊、Router、任务执行选择。配置保存后正常重启生效，不修改凭据或自动调用模型。见 [设置说明](docs/manual/web-console.md#设置助手模型与凭据) 和 [统一配置命令](docs/ops/shared-settings.md#同一路由的多个模型)。

生产依赖图已没有外部 `@deepseek-ai/dsh-*` 包。文件读写、编辑、find 以及 Bash/PowerShell 工具复用官方 Pi 实现，通过 Night Bot 的受控文件与命令能力执行；权限、进程隔离、凭据、附件、技能和 workspace 等应用边界由仓库内实现接入。仍保留需署源的本地权限、平台进程、Windows ACL、技能 watcher 等实现。旧可变 Session、消息投影/查询服务、子代理产品和历史 v0–v4 数据导入均已退休；当前会话、消息和模型上下文由官方 Pi 维护。历史包名、namespace 和本地兼容 facade 按实际消费者逐项退休，不再作为永久公共 ABI；当前清理与未验项见[唯一验收入口](docs/acceptance/resident-conversation-routing/goal.md)。部署仍须完整代码、锁文件和 workspace 构建策略，不能只复制 `src`。

早期移植源为 `HiQ-AI/dingtalk-dsh-assistant@93e431a`；该阶段记录 194 个保留模块、6 个退休旧驱动和 3 个排除 UI 模块。当前保留、适配及退休状态以实际来源 manifest/guard 为准，不把历史计数当成本轮清理结果。历史数据库的 `executionBackend: dsh` 标签继续兼容，实际默认执行为 Pi。

## 运行

需要 Node.js 24+、pnpm。只有启用钉钉渠道才需要 DWS CLI；默认关闭渠道外发。Linux 上需要受限 shell 或模型进程工具时，宿主必须提供可用的 bubblewrap；Native sandbox 再按平台能力选择 bwrap/Landlock 等实现，隐私能力不可用时拒绝执行，不自动切换权限模式。

macOS 的安装、Web 构建、启动命令和当前实测限制见 [Mac 本机运行](docs/ops/mac-local-runtime.md)。本机已验证服务与无命令任务可运行，但默认命令执行及 32 轮续办尚未通过，不能据此宣称 Mac 完整可用。分组测试入口在 macOS 自动使用物理临时路径，生产安装的目录安全检查不变。

```sh
pnpm install --frozen-lockfile
pnpm init:assistant --actor YOUR_OWN_ID --provider openai --model YOUR_MODEL --key-env OPENAI_API_KEY
# 初始化会生成唯一实例 ID、当前 ingressEpoch 和私有配置。
# 密钥通过引用的环境变量或凭据服务提供；普通配置可用下方 CLI 修改。
pnpm start data/config/config.json
curl http://127.0.0.1:18998/health
```

Night Bot 自有运行数据位于安装目录的 `data/`，任务工作区与业务产物默认位于 `data/workspaces/`，备份位于 `backups/`；这些目录被 Git 忽略。显式批准的外部业务目标或完全访问模式不意味着将外部文件迁入安装目录。代码升级须保留数据目录。正常停机等待业务与投影排空，不遍历全部任务工作文件做离线封存；可迁移备份须显式运行 [任务备份命令](docs/TASK-ARCHIVE.md#offline-commands)，不能直接将普通停机目录视为已校验备份。同一 Host 的共享文件事务按路径排队，再取得磁盘租约；活 owner 不因超时被驱逐，权限拒绝不作普通重试。初始化命令只创建配置和目录，不会替你验证真实模型、渠道身份或外发授权；再次初始化拒绝覆盖配置。本项目不需要导入原 DSH 插件历史数据。目录、权限、备份与异路径恢复详见 [DATA-LAYOUT](docs/DATA-LAYOUT.md)。

启动工作区通过应用会话目录取得一次受校验的元数据快照；Pi 日志每份只读一次，以小批并行完成完整提交与上下文校验，同批共享目录只解析一次。不持久缓存未经重新核验的会话清单，不跳过损坏日志，也不将端口开放视为渠道恢复完成。

默认不加载 DWS 插件，也不探测 DWS 可执行文件。启用方式见 [渠道协议与插件](docs/CHANNELS.md)，外部渠道的目录发现、生命周期和能力接口见 [插件接口](docs/CHANNEL-PLUGINS.md)；Linux 隔离前置和实际探针见 [Linux 隔离运行](docs/ops/linux-contained-runtime.md)。钉钉使用 `channelPlugins` 的 `dingtalk-dws` 配置；Windows 默认直接使用当前用户受系统保护的 DWS 登录态，不复制凭据；多个实例可能共享账号存储，不能用 HOME/config 目录宣称独立账号；旧的 `resident.dws.enabled` 会明确报错。插件的外发开关不会替代任务自身的业务授权。工具权限使用下述应用自有三档；渠道外发与任务业务授权仍分别校验。核心管理 HTTP 仅监听 loopback；可选 Web 的显式容器监听仍要求固定公开 Origin、令牌登录、会话和 CSRF，端口只映射到宿主 loopback，不能据此开放核心管理接口。原 `/state/*`、任务、配置与人工答复 API 沿用，入口详见 [API 清单](docs/HTTP-ROUTES.md)。

钉钉每个 `channelPlugins` 实例只绑定一个群聊或私聊，多个 `dingtalk-dws` 实例以不同 `channelId` 共存。公开插件配置使用 `dingtalk_` 前缀：`dingtalk_name` 是渠道名称，`dingtalk_prompt` 传入职责、助手设定和规范，目标由 `dingtalk_conversation_type` 及群名/群 ID 或姓名/userId 指定。认证账号、组织与目标须实际解析并耐久绑定，多候选拒绝任选；配置贯通一级分诊、常驻 Router、事项执行与无工具复盘，不改变原消息授权或跨会话隔离。未获真实连接/发送授权时保持实例禁用，或明确设 `dingtalk_listen:false`、`dingtalk_writes_authorized:false`。停用/恢复沿该渠道耐久水位补拉并去重，不以重新初始化起点丢弃停用期间消息。具体字段和 CLI 用法见 [渠道职责](docs/CHANNELS.md#渠道职责配置)，Windows 账号与实际终态核对见 [接入流程](docs/ops/windows-local-runtime.md#指定钉钉群接入)。

历史补拉只将已处理、身份/版本/资源一致且能重建冻结输入指纹的厂商展示差异识别为重复；不会重跑模型、任务或发送，也不改写旧来源。正文、作者、提及或资源身份冲突继续停止恢复。Web 渠道卡片区分正在恢复与历史恢复失败，只显示安全原因；排查见 [Windows 接入流程](docs/ops/windows-local-runtime.md#历史恢复失败)。

通用配置与钉钉配置分开处理，密钥只保存环境变量名称引用，不在 CLI 参数中传密钥正文：

```sh
node bin/night-bot-config.js data/config/config.json show
node bin/night-bot-config.js data/config/config.json model --provider openai --model YOUR_MODEL --check
node bin/night-bot-config.js data/config/config.json web --enabled true --port 3080 --channel-id local-web --sender-id YOUR_OWN_ID --check
node bin/night-bot-dingtalk.js data/config/config.json list
```

`--check` 只校验拟改配置、不创建锁或写盘；去掉该参数才保存。配置 CLI 不能把磁盘保存宣称为在线生效，按返回的 `restartRequired` 正常停机重启。钉钉专用 CLI 另提供 `add/set/enable/disable`，名称和 Prompt 通过 `--json` 内的 `dingtalk_name/dingtalk_prompt` 设置；显式 `env` 导入仅消费 `DINGTALK_*`，不与普通函数参数混用，详细命令见渠道文档。

直接部署沿平台运维流程；Docker 的构建、受控持久卷、模型/渠道环境变量、容器内 DWS 登录和沙箱前置见 [Docker 运维](docs/ops/docker-deployment.md)。镜像包含固定版本 DWS，默认核心仍不加载钉钉；容器不能使用 privileged 或 Docker socket，受限档不得关闭应用沙箱求通过，显式 `full` 的应用与容器边界见下文。当前实际 build/run 与平台未验项统一见[本轮目标](docs/acceptance/resident-conversation-routing/goal.md)，不能仅凭镜像定义宣称 Docker 已可用。

Docker 镜像仅预装 Chromium headless shell，保留默认无头浏览器 API 和截图 CLI，不包含完整 Chromium/有头浏览器。挂载目录、容器环境变量清单与云端 SSH 访问准备见 [Docker 运维](docs/ops/docker-deployment.md)；最新版镜像本地构建、实际启动与同卷持久化结果见 [Docker 云端准备验收](docs/acceptance/docker-cloud-readiness/goal.md)。本地验证不代表镜像已推送或云端已运行。

镜像默认提供 `git`、GitHub CLI（`gh`）和 Playwright/Chromium 基础无头工具；工具、分版浏览器访问及最终镜像真实默认 task 的 bash/token、作业与任务排空结果见[第45轮](docs/acceptance/resident-conversation-routing/round-45.md)。这不代表默认 `run` 全链或所有 `full` 场景通过。GitHub 认证按运行时显式注入 `GITHUB_TOKEN`，不嵌入镜像或应用配置；token 的临时传输、输出留存风险，以及 Chromium 默认未启用自身 sandbox 的边界，均见上述规程。

### 工具权限

文件工具的可修正错误保留原始反馈：精确注册的 Pi `write` / `edit` 在实际执行排空且未进入文件写入时，将失败结清为“未开始写入”，模型可读取后发起独立修正调用，重启不会重放旧调用。已经开始写入、取消或结果未知的操作继续阻断并要求核验；不凭错误文案判断无效果，也不自动解除旧版遗留的未知状态。

配置使用单一 `permissionMode`，取值为 `ask | auto | full`，默认 `full`；已有配置显式保存的 `ask` / `auto` 保持不变。只有可信安装操作者通过初始化/配置 CLI 或认证 Web 的「权限与审批」入口选择模式，任务模型和普通渠道成员不能通过消息升级权限。

本次实施与验收范围为 `full`；`ask` / `auto` 合同保留，但受限执行尚未完成，本次不交付。产品缺省值为 `full`，不会重写已有实例显式保存的模式，也不代表已部署。

| 模式 | 行为与边界 |
|---|---|
| `ask` 请求批准 | 工作目录外的业务写入与需要更宽范围的命令进入人工单次审批；批准绑定当前调用、参数、目录及目标，不能扩大为整个父目录授权。凭据、会话及任务归档私有区继续受限。 |
| `auto` 帮我批准 | 对需要批准的动作使用当前配置的通用 Pi 模型作无工具审查；不确定或模型/路由/凭据/解析等技术失败转人工，不改变动作的实际权限范围。 |
| `full` 完全访问 | 缺省或操作者选择后按当前运行环境的 OS 账号权限执行，不是管理员提权；直接进程不再保留工作区隔离，也不保证隔离同账号可访问的 Host 私有文件。Host API 授权、审计、取消与防重放仍保留。 |

以下示例仅用于可信安装操作者明确选择 `full`；先执行零副作用检查：

```sh
node bin/night-bot-config.js data/config/config.json permissions --permission-mode full --check
```

检查无副作用，去掉 `--check` 后离线保存并按 `restartRequired` 重启；Web 的在线模式变更以 Host 回读为准。批准只表示本次授权，不表示工具已执行；拒绝、取消和失效不执行，重启不自动重放旧调用。受限模式缺少可用隔离后端时明确失败，不自动切到完全访问，也不能用完全访问抵扣受限模式验收。实际接线和各平台尚未通过的检查见[唯一验收入口](docs/acceptance/resident-conversation-routing/goal.md)。

Windows `full` 已分阶段实跑外部文件写入、配置持久化与冷启动、任务 actor 不能改档、旧批准不重放、前后台 PowerShell、超时转后台后的单次执行与增量输出，以及准备期取消/超时不产生外部写入。本轮补齐 `grep` 授权投影后，真实工作区/外部目录命中、正常无匹配、82 文件分两批完整检索及切回非 `full` 后保留拒绝均通过，同一候选的前台 PowerShell 关联复验通过。各批绑定的源码及结果见[唯一验收入口](docs/acceptance/resident-conversation-routing/goal.md)；未重跑无关场景，不宣称全部工具、运行中子进程取消或三平台全量通过。

Pi 的 Project Trust 仅控制项目配置、扩展、技能等项目资源的加载信任，不限制代码执行后的 OS 访问；它不是 OS 沙箱，也不表示 Night Bot 已新增该信任入口。

命令工具的 `run_in_background` 在完成执行准备并提交启动后返回作业 ID，不等待进程结束，也不设置命令超时；准备期间的取消仍绑定原调用，启动后通过 `job_output` 查看输出、`job_kill` 停止原作业。返回 ID 不代表业务完成，应核对作业终态和实际产物。

标准 `data/config/config.json` 安装以配置文件中的 `model` 为全局默认来源，Web、CLI 和 `/config/agent` 共用保存入口；旧 `night_model_selection.json` 保留但不再覆盖该配置。升级前核对全局默认。历史非受控启动配置仍只读，并保留旧选型存储，不放宽配置文件路径限制。

一级分诊、Router、任务执行的独立模型与推理深度，支持 Web、CLI 和环境变量，见[分角色模型配置](docs/ROLE-MODELS.md)。其他设置也可通过[同一配置服务与 headless CLI](docs/ops/shared-settings.md)管理，无需开启 Web。

`providers` 由本地 NativePiProvider 处理，兼容原 `llm-pi-ai` profile 格式，可选择 pi-ai 支持的 provider，或声明兼容端点与模型。示例模型是占位配置，应按自己的服务修订。`skillDirs` 为安装目录内的额外技能目录；默认加载 `data/config/skills` 和受控指令目录。技能与指令发现不通过 `DSH_*` 环境变量选择目录，技能也不隐式读取外部 `.dsh/skills`；显式绝对 state/workspace 模式使用 state 内受控的 `runtime/configured-agents`、`runtime/configured-harness`，不扫描操作系统用户 home。技能文件默认开启监听，外部编辑后会在下次模型步骤提醒重读；`skillWatch: false` 可显式关闭后台监听，原生写入/编辑仍会使技能目录失效刷新。个人业务技能正文及同目录 `scripts`、`references`、`assets` 只存于本机 `data/config/skills` 或经 `git check-ignore` 确认的插件私有技能目录，不进入代码或 npm 包；迁移应从本次已授权复用范围内的既有安装指针取源；若需清理或移动，只处理本轮引入材料，不覆盖或移动他人既有技能；不盲拷 `node_modules` 或旧 worktree。`plugins` 是可信部署配置的 Cordis 插件行，可挂载业务所需的额外浏览器、数据库或搜索等能力；不会从群消息自动加载代码。凭据与附件不会回退到外部 DSH 目录；旧扁平凭据会拒绝并保留原文件。终端默认只提供 `NIGHT_BOT_SHELL` 和 `NIGHT_BOT_SESSION_ID` 执行事实，不提供 DSH home/profile；安装目录模式继续过滤非标准扩展环境值。默认提供文件/检索、终端及作业、技能、工作目录、待办、HTTP 获取和单会话任务执行；Web 搜索提供者和外部业务系统需要单独配置，缺失会明确报错。

Web 服务的默认 provider 选择以显式 `searchProvider` / `fetchProvider` 配置优先；未指定时，仅从可信启动进程快照读取 `NIGHT_BOT_WEB_SEARCH_PROVIDER` / `NIGHT_BOT_WEB_FETCH_PROVIDER`，不回退旧 DSH 环境变量。它们只选择已注册的 provider，不自动安装插件或授予外部访问权限。

默认 Host 还提供持久定时服务和 `schedule_create/list/update/delete` 工具，支持单次、固定间隔、每日、每周及五字段 cron。记录保存在 `stateDir/storage/schedule.json`，到时通过原 Pi 会话执行；停机后恢复到期事项，周期事项合并漏过的轮次。同一消息的入账与排期回执用稳定身份对齐，恢复不重复投递已入账的事项。取消已排期事项不会撤回已入队消息；显式取消 Agent 仍会清空其待办输入。子代理不能创建提醒，冷恢复保留原权限与模型。可通过 `schedule.deliveryHistoryDays`（默认 30）和 `schedule.deliveryHistoryRecords`（默认 200）配置历史保留。

默认 Host 还提供 Bot 共享的 Markdown 长期记忆，保留渠道、发送者和任务来源，支持明确记住、纠正、忘记、候选提取及字面关键词检索。任务终态触发独立复盘，经验带证据引用和推测标签；模型结合证据、复用价值和适用范围决定是否创建或更新受限学习技能；单次充分证据也可沉淀，不以重复次数代替判断。自动学习不会改写正式技能模板，也不增加业务权限。接线、自动保证和模型判断的区别详见 [MEMORY](docs/MEMORY.md) 与 [SELF-EVOLUTION](docs/SELF-EVOLUTION.md)。

已认证渠道用户明确要求长期调整行为时，分诊转交 Router，经原消息作者、版本及当前批次校验后逐字保存到长期记忆，回读确认后才答复已保存；不靠交接摘要充当长期记忆，也不为偏好创建空任务或强制生成 Skill。普通陈述仍不等于写入同意，临时要求不持久化，只读权限和秘密拒绝继续生效。长期行为记忆保留最小来源背景及标为推断的场景/边界，由 Host 绑定原提出者；共享可读不等于对所有人适用，当前明确要求优先。见 [渠道偏好写入](docs/MEMORY.md#渠道长期偏好)。

这些核心能力可以通过本机 HTTP、隔离文件和本地模型协议测试验收，不依赖安装 DWS CLI。钉钉、其他消息渠道及业务系统分别做集成验收。

`chat` 与 `chat-room` 采用“轻量一级分诊 → 每 conversation 一个常驻 Router → 每事项一个执行会话”。一级分诊逐消息决定是否转交和是否简短回复：对职责范围内明确交办且需要继续处理的请求，在分诊完成时先简短承接，不静默等待执行结果；无需介入的消息保持静默。分诊不拆分或创建事项；Router 理解原消息、关联和安排事项、评估结果，并避免重复承接。来源、权限、版本与任务依赖由 Host/SQLite 校验，任务自报完成不等于后续事项已获准执行。任务等待后，由 Router 核对补充与原问题并明确续接，Host 落账后唤醒原执行会话；普通补充不自动解除等待，也不新增执行侧答复复核。Router 的逻辑身份持久，空闲时以无工具交接安全更换 Pi generation，保留旧 journal。原请求明确要求引用当前来源时，Router 可用 `replyToSource:true`，由 Host 绑定原消息/作者且显式受众须含原作者；默认回复与文件子件能力不变。15 条批次、可靠转交和回复回读规则见 [CHANNELS](docs/CHANNELS.md)；每任务一个执行会话的生命周期见 [SINGLE-TASK](docs/SINGLE-TASK.md)。

钉钉渠道的未解析附件（包括 PDF、Word）由可选插件按绑定账号下载，Host 校验并冻结为任务 `materials/` 中的原始文件，模型获得受控路径、文件名、MIME、大小和 SHA-256；不需要自行调用 DWS 下载。现有图片、UTF-8 文本和 XLSX 的解析路径保持不变。原件交付不等于所有格式都有解析器；文件只读，不自动执行，仍受权限与 8 MiB 材料上限约束。详见 [渠道资源合同](docs/CHANNELS.md) 和 [本地验收操作](docs/ops/web-console-local.md)。

渠道交付正文在冻结前校验内部任务编号；用户原始请求已公开指定的同值业务标记与文件名可保留，其他内部身份及机制格式仍受保护。本地安全拒发记录为已知未发送，不空回读或自动补发。严格核实的本地拒发可由安装操作者显式恢复，重新核对原来源、任务版本、产物和正文后沿同一冻结交付发送；未知网络结果仍只回读，不能改成已送达。见 [渠道交付合同](docs/CHANNELS.md#router-最终文件交付)。

## 验证

可选 Web 控制台位于 `packages/web-console`，提供 BoardUI 风格的中文对话、任务执行信息和只读渠道消息，并为认证安装操作者提供权限模式、单调用审批及钉钉群聊/私聊配置新增与编辑入口。新增渠道使用 Bot 运行环境唯一当前登录账号，未登录或账号歧义拒绝保存；编辑固定渠道标识并继承已保存账号，无需填写 profile，可修改名称、职责、会话类型及 ID/名称目标。编辑使用期望版本防覆盖，冲突保留草稿并要求显式重新加载；旧目标有未决依赖时拒绝身份切换，同一实际目标保留绑定和水位。配置在本安装保存，正常重启后应用；页面分开显示保存版本与当前插件健康，已加载不代表已激活。新增默认关闭外发，可在新增或编辑表单显式授权/撤销，正常重启后生效；修改目标先保存，再重新编辑授权，不继承旧目标外发权限。授权包括正常回复、通知、附件及已排队未发送通知。不提供删除或热加载；结果未知只读按准确字段/版本核对，不自动重发。它有独立依赖及构建，默认不加载；不增加 Bot 展示字段或修改核心 schema，禁用后 Bot 仍能独立工作。消息首答按本条消息及版本的第一条可靠送达回执计时，包含任务结果，不要求模型标注回复用途；明确覆盖来源的共同任务回复按各消息的接收时间分别计时；仅明确无需处理及回复时显示无需回复，其余显示等待或投递状态，不按同批消息猜测关联。生产插件用 Node 内置服务托管静态页面，聊天复用现有渠道入口，执行记录读取 Pi 已提交上下文，Chat 与任务共用真实工具调用/结果历史，长正文按版本有界续读；任务复盘页只展示实际记忆/Skill 更新及来源，正文仍按当前阅读作用域授权。启用、认证和数据边界见 [Web 运维](docs/ops/web-console-local.md)，操作见 [使用说明](docs/manual/web-console.md)，验证见 [Web 验收](docs/acceptance/web-console/goal.md)。参考设计取自 [BoardUI 官方 MIT 源码](https://github.com/BoardUI/boardui)，许可保留在该包 `licenses/`。

UI/UE 的唯一指导性文档是仓库根目录的 [DESIGN.md](DESIGN.md)，集中维护视觉、组件、导航、交互状态、恢复、文案与可访问性。界面修改先读该文档；手册与验收记录分别用于操作说明和版本证据，不另立设计规则。

```sh
pnpm install --frozen-lockfile
pnpm test
pnpm test:domain
pnpm test:runtime
pnpm test:routing
pnpm test:containment
pnpm audit:runtime
```

`pnpm audit:runtime`（`scripts/audit-runtime.mjs`）输出到 `docs/tmp/runtime-audit.json`，不覆盖 `docs/runtime-audit.json` 的历史检查点；该临时输出不替代正式轮次验收证据。

`pnpm check` 检查源文件/HTTP 路由守恒、生产依赖声明、本地兼容源码哈希，以及没有外部 SDK 导入或旧模型/工具/SessionStore 编排器。默认和分组测试均复用同一调度器，默认单文件并发；`NIGHT_BOT_TEST_CONCURRENCY=2` 可并行隔离文件，不改变测试内部并发和安全断言。真实隔离测试需要宿主内核支持，不能通过关闭应用沙箱使测试通过。

常驻 Router 重构的当前范围与验收状态见 [验收入口](docs/acceptance/resident-conversation-routing/goal.md)；此前 Topic/Owner 验收记录仅作历史证据。验证与证据见 [VALIDATION](docs/VALIDATION.md)，功能映射见 [MIGRATION](docs/MIGRATION.md)，当前架构见 [RUNTIME](docs/RUNTIME.md)，来源与许可见 [THIRD_PARTY](THIRD_PARTY.md)。

早期 Windows 验证与阻断见 [本机验收目标](docs/acceptance/pi-native-retirement-local/goal.md)；SG10 的默认无插件 CLI、渠道中立/附件、本地 operator/requester 分流、私有 Skill 读取和 Router 恢复结果按 [第八轮报告](docs/acceptance/resident-conversation-routing/round-8.md) 的各组受验版本成立，不是新版全量或广义开发运维替代证明。SG9 指定群真实交付保留 [第七轮证据](docs/acceptance/resident-conversation-routing/round-7.md)；[第九轮](docs/acceptance/resident-conversation-routing/round-9.md)在其所列版本完成旧文字/附件的真实回读及同安装正常 IPC 关闭，冷启动也实际调用模型并发送一次文字答复，但自身回声进入来源/分诊为 FAIL。该轮尚未收到新文件/原生 quote/@ 请求；本次 `replyToSource` 和登记前回声 guard 不被这些历史结果追认为新版现场通过。保留数据的启动/停止流程见 [Windows 本机运维](docs/ops/windows-local-runtime.md)。现有 `undici` 与固定 Pi SDK 对齐为 8.12.3，避免 SDK 导入覆盖旧版全局代理；HTTP 代理继续使用 CONNECT 隧道。真实 DWS/业务系统及 Windows/macOS 内核仍需在对应部署环境验收；可选 Claude CLI 和额外浏览器、数据库、搜索插件需要实际安装与授权。原部署和验收脚本保留为源实现参考，不能直接作为 Night Bot 的部署入口。第八轮仅用 loopback 脚本模型/fake 渠道，没有新增真实模型/厂商调用；其零调用结论不适用于第九轮。上述验收不代表生产数据迁移、CI、合并或部署；Linux 规程未在本机实跑，Windows 进程隐私与异常关闭风险仍保留。

Windows LPAC 候选仅对 `read-only` 策略下 Host 本次新建、空且未发布的私有临时根，在创建时请求固定 Low/NW 标签；实际 SACL 必须逐字等请求，完整控制位只允许请求值或仅缺 DACL 自动继承位。缺该位时，仅对同 FileID 空根执行一次同 DACL 初始化，保留创建期描述符并单独建立初始化后业务基线。出生 Low 与 DACL 授权/撤销组件已取得局部 Native 证据，包括最终三对象完整原 SD 逐字恢复；Profile 接线尚未通过完整 Native 验收。此私有 temp 路径不用于改变已有任务目录或外部业务树的标签，也不改变 ConPTY pipe 初态；新任务 work/tmp 的创建期候选另见下段，尚不构成 `workspace-write` 验收，已有读根仍须独立满足原资格。当前 LABEL-only setter 对真实受影响对象或继承后代的 NULL SACL 变化，在首个业务 Set 前失败关闭，完整控制位恢复仍未证，`scopeReady=false` 及生产准入门保持。初始化后的业务恢复不代表恢复创建期 SD，也不代表完整撤权、ConPTY 或三平台隔离通过；当前状态以[唯一验收入口](docs/acceptance/resident-conversation-routing/goal.md)为准。

Windows 新默认任务的 work/tmp 创建期候选已接入 Web 与 Router 两个真实创建入口：SQLite 事务先登记 Host 初始化未就绪，提交后才独占创建普通继承 SD 的 task 根，以及出生 Low/NW 的 work、tmp。仅这两个本次新建、空且未发布的目录允许按原精确资格各做至多一次同 DACL 初始化；实际资源闭合、其余用途目录准备完成后才提交 ready。初始化失败或归属未知时阻止任务领取和普通 ensure 发布工作区，保留原错误与现场，不自动重打 Low 或删除目录。EEXIST、已有任务、旧收据重放及 restore/adopt 不触发重新初始化；materials、outputs、sessions、reviews 的用途及 Linux/macOS 路径不变。ready 只表示该次 Host 初始化已核回，不是永久 SD 资格或进程授权。该候选已完成静态审查、[第38轮](docs/acceptance/resident-conversation-routing/round-38.md)13项非 Native 合同回归，以及[第39轮](docs/acceptance/resident-conversation-routing/round-39.md)一个真实新任务的初始化观察：work/tmp 均由9814经允许的一次同 DACL 初始化成为9c14，原初始化资源全部关闭。同轮 SDK seal 组件在准备 NUL 句柄时失败，尚未进入挂起子进程/seal；不据初始化成功宣称完整 Native 验收通过。已有 NULL 标签业务树、获准外部写树的精确恢复与完整 LPAC 执行仍未解决，不以新任务候选关闭这些目标。

Windows LPAC 启动环境从同一 Profile 创建期已核验的 `SHGetKnownFolderPath(FOLDERID_LocalAppData)` 保留 `LOCALAPPDATA`，大小写无关覆盖调用方同名键；HOME、USERPROFILE 与 temp 继续绑定原批准目录。该值用于 Windows 启动机制，不增加目录读写授权，也不透传宿主环境。[第40轮](docs/acceptance/resident-conversation-routing/round-40.md)已通过三个 NUL 端点，但原挂起创建仍记录203、未创建 child/seal；后续准确新组件已实测可信环境覆盖、挂起 child 创建/Job 绑定、SDK seal、受控终止与 released/实时/严格冷读通过，详见[第41轮组件验收](docs/acceptance/resident-conversation-routing/round-41.md)。该组件全程未 Resume、业务 scopeEffects 为0。[第42轮](docs/acceptance/resident-conversation-routing/round-42.md)的业务 scope 准备被 Host 维护权校验拒绝，未形成 scope 冻结或授予；原无 plan 清理最终 released0/0，但 Job 失败、task 保持 blocked/no-replay，不能当有 plan mandatory 恢复通过。该轮尚未定位具体失败对象及原态/候选阶段，不能据此扩大 ACL 或放宽校验。

[第43轮](docs/acceptance/resident-conversation-routing/round-43.md)已正式 FAIL 审闭，定位为 materials 只读根的候选 SD 缺少 Host `WRITE_DAC`：`OW`（OWNER RIGHTS）ACE 抑制 owner 隐式维护权，候选没有独立 Host ACE 补足，在 scope 冻结前即被拒绝，没有实际 scope 授予。R43 后的维护权候选在每份直接 grant 中增加可信 Host SID 的独立 `READ_CONTROL|WRITE_DAC`（`0x60000`）维护 ACE，不增加 `WRITE_OWNER` 或 Host 业务写/删除；第三类 ACE 的历史来源与共享撤权同批处理，不补造旧来源或撤掉原生/其他活跃 Profile 的权限。[第44轮](docs/acceptance/resident-conversation-routing/round-44.md)真实验收仍为 FAIL，首错为 `Native scope inheritance changed Host maintenance ownership`，未到 scope 冻结、scopeEffects 为0；原无 plan 的 released 不代表有 plan 恢复。当前新增仅为继承诊断，不是修复，不增加 Native 调用，尚无新 Native 通过；`scopeReady`、有 plan mandatory 完整恢复、runner ACK/Resume/ConPTY 及完整 Windows 验收仍未通过，原资格门保持关闭。

Windows 重启恢复探针默认固定本仓库进程/ACL 代码的已审阅哈希；迁移部署位置时可由受信任宿主设置 `NIGHT_BOT_RUNTIME_ROOT`，不会将未知 provider 代码视为已验证。现有存活进程、写入者、端口、时间和完整证据检查继续保留。

每个任务的材料、工作文件、冻结交付物、Pi 执行会话、复盘和数据库快照现集中在
`data/workspaces/tasks/<taskId>/`。共享数据库仍是运行时权威；离线封存后可单任务
备份、跨路径恢复或重建任务索引，恢复默认暂停并保留通知防重门禁。操作和限制见
[任务档案](docs/TASK-ARCHIVE.md)，不通过复制整个记忆/技能集合实现迁移。
