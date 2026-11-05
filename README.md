# Night Bot

Night Bot 是基于 Pi 的无界面个人助理 Agent 初始化套件，任何人都可以初始化自己的助手。记忆、任务与技能为渠道无关的核心，钉钉只是可选接入渠道之一。Pi agent-core 负责模型/工具迭代，Pi SessionManager 负责当前会话历史与模型上下文；消息、Topic、单任务执行、恢复、权限、通知和交付继续由应用维护。保留 HTTP 接口，DWS CLI 通过独立可选渠道插件接入，不包含可视化界面。

生产依赖图已没有外部 `@deepseek-ai/dsh-*` 包。服务、工具、权限、进程、凭据、附件、技能和 workspace 均为仓库内实现。为保留数据和插件接口，明确保留本地 MIT 派生的事件 façade、历史 v0–v4 格式/导入以及 Windows ACL 支撑代码；这些兼容协议不承担推理或当前历史权威。旧包名兼容入口在 `packages/capability-compat` 和 workspace 配置中公开记录，不能只复制 `src` 部署。

源领域代码固定于 `HiQ-AI/dingtalk-dsh-assistant@93e431a`：200 个模块保留，3 个 UI 模块排除，所有适配均记录原始及目标哈希。历史数据库的 `executionBackend: dsh` 标签继续兼容，实际默认执行为 Pi。

## 运行

需要 Node.js 24+、pnpm。只有启用钉钉渠道才需要 DWS CLI；默认关闭渠道外发。需要受限 shell 执行时，宿主必须提供可用的 Linux bubblewrap/Landlock 等沙箱；不可用时拒绝执行，不自动切换权限模式。

```sh
pnpm install --frozen-lockfile
pnpm init:assistant --actor YOUR_OWN_ID --provider openai --model YOUR_MODEL --key-env OPENAI_API_KEY
# 初始化会生成唯一实例 ID、当前 ingressEpoch 和私有配置。
# 编辑 data/config/config.json 的模型配置；密钥通过引用的环境变量或凭据服务提供。
pnpm start data/config/config.json
curl http://127.0.0.1:18998/health
```

所有 Night Bot 运行数据位于安装目录的 `data/`，任务工作区与业务产物位于 `data/workspaces/`，备份位于 `backups/`；这些目录被 Git 忽略。代码升级须保留数据目录。初始化命令只创建配置和目录，不会替你验证真实模型、渠道身份或外发授权；再次初始化拒绝覆盖配置。本项目不需要导入原 DSH 插件历史数据。目录、权限、备份与异路径恢复详见 [DATA-LAYOUT](docs/DATA-LAYOUT.md)。

默认不加载 DWS 插件，也不探测 DWS 可执行文件。启用方式见 [渠道协议与插件](docs/CHANNELS.md)，外部渠道的目录发现、生命周期和能力接口见 [插件接口](docs/CHANNEL-PLUGINS.md)。钉钉使用 `channelPlugins` 的 `dingtalk-dws` 配置；Windows 默认直接使用当前用户受系统保护的 DWS 登录态，不复制凭据；多个实例可能共享账号存储，不能用 HOME/config 目录宣称独立账号；旧的 `resident.dws.enabled` 会明确报错。插件的外发开关不会替代任务自身的业务授权。保留原工具的权限 preset 与业务授权规则。HTTP 仅监听 loopback；需要远程访问时使用经过鉴权的运维通道。原 `/state/*`、任务、配置与人工答复 API 沿用，入口详见 [API 清单](docs/HTTP-ROUTES.md)。

`/config/agent` 保存的默认模型选择持久化于 `stateDir/storage/night_model_selection.json`，重启后优先于初始 JSON 配置中的默认选择；provider 声明仍由启动配置提供。

`providers` 由本地 NativePiProvider 处理，兼容原 `llm-pi-ai` profile 格式，可选择 pi-ai 支持的 provider，或声明兼容端点与模型。示例模型是占位配置，应按自己的服务修订。`skillDirs` 为安装目录内的额外技能目录；默认加载 `data/config/skills` 和受控指令目录。技能与指令发现不通过 `DSH_*` 环境变量选择目录，技能也不隐式读取外部 `.dsh/skills`；非安装目录模式保留标准 `.agents/skills` 和显式配置的技能目录。技能文件默认开启监听，外部编辑后会在下次模型步骤提醒重读；`skillWatch: false` 可显式关闭后台监听，原生写入/编辑仍会使技能目录失效刷新。`plugins` 是可信部署配置的 Cordis 插件行，可挂载业务所需的额外浏览器、数据库或搜索等能力；不会从群消息自动加载代码。凭据与附件不会回退到外部 DSH 目录；旧扁平凭据会拒绝并保留原文件。终端默认只提供 `NIGHT_BOT_SHELL` 和 `NIGHT_BOT_SESSION_ID` 执行事实，不提供 DSH home/profile；安装目录模式继续过滤非标准扩展环境值。默认提供文件/检索、终端及作业、技能、工作目录、待办、HTTP 获取和单会话任务执行；Web 搜索提供者和外部业务系统需要单独配置，缺失会明确报错。

默认 Host 还提供持久定时服务和 `schedule_create/list/update/delete` 工具，支持单次、固定间隔、每日、每周及五字段 cron。记录保存在 `stateDir/storage/schedule.json`，到时通过原 Pi 会话执行；停机后恢复到期事项，周期事项合并漏过的轮次。同一消息的入账与排期回执用稳定身份对齐，恢复不重复投递已入账的事项。取消已排期事项不会撤回已入队消息；显式取消 Agent 仍会清空其待办输入。子代理不能创建提醒，冷恢复保留原权限与模型。可通过 `schedule.deliveryHistoryDays`（默认 30）和 `schedule.deliveryHistoryRecords`（默认 200）配置历史保留。

默认 Host 还提供按个人、群组和项目隔离的 Markdown 记忆，支持明确记住、纠正、忘记、候选提取及字面关键词检索。任务终态触发独立复盘，经验带证据引用和推测标签；模型结合证据、复用价值和适用范围决定是否创建或更新受限学习技能；单次充分证据也可沉淀，不以重复次数代替判断。自动学习不会改写正式技能模板，也不增加业务权限。接线、自动保证和模型判断的区别详见 [MEMORY](docs/MEMORY.md) 与 [SELF-EVOLUTION](docs/SELF-EVOLUTION.md)。

这些核心能力可以通过本机 HTTP、隔离文件和本地模型协议测试验收，不依赖安装 DWS CLI。钉钉、其他消息渠道及业务系统分别做集成验收。

`chat` 与 `chat-room` 的统一接入、一级初步反馈和 15 条批次规则见 [CHANNELS](docs/CHANNELS.md)；每任务一个执行会话的生命周期见 [SINGLE-TASK](docs/SINGLE-TASK.md)。

## 验证

```sh
pnpm install --frozen-lockfile
pnpm test
pnpm test:domain
pnpm test:runtime
pnpm test:routing
pnpm test:containment
pnpm audit:runtime
```

`pnpm check` 检查源文件/HTTP 路由守恒、生产依赖声明、本地兼容源码哈希，以及没有外部 SDK 导入或旧模型/工具/SessionStore 编排器。真实隔离测试需要宿主内核支持，不能通过关闭应用沙箱使测试通过。

验证与证据见 [VALIDATION](docs/VALIDATION.md)，功能映射见 [MIGRATION](docs/MIGRATION.md)，当前架构见 [RUNTIME](docs/RUNTIME.md)，来源与许可见 [THIRD_PARTY](THIRD_PARTY.md)。

真实 DWS/模型厂商/业务系统及 Windows/macOS 内核仍需在对应部署环境验收；可选 Claude CLI 和额外浏览器、数据库、搜索插件需要实际安装与授权。原部署和验收脚本保留为源实现参考，不能直接作为 Night Bot 的部署入口。没有迁移生产数据或执行真实外发、合并、部署。

Windows 重启恢复探针默认固定本仓库进程/ACL 代码的已审阅哈希；迁移部署位置时可由受信任宿主设置 `NIGHT_BOT_RUNTIME_ROOT`，不会将未知 provider 代码视为已验证。现有存活进程、写入者、端口、时间和完整证据检查继续保留。

每个任务的材料、工作文件、冻结交付物、Pi 执行会话、复盘和数据库快照现集中在
`data/workspaces/tasks/<taskId>/`。共享数据库仍是运行时权威；离线封存后可单任务
备份、跨路径恢复或重建任务索引，恢复默认暂停并保留通知防重门禁。操作和限制见
[任务档案](docs/TASK-ARCHIVE.md)，不通过复制整个记忆/技能集合实现迁移。
