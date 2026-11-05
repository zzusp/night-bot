# Night Bot

基于 Pi 的无界面百部钉钉助手。Pi agent-core 负责模型/工具迭代，Pi SessionManager 负责当前会话历史与模型上下文；消息、Topic、任务统筹/执行、恢复、权限、通知和交付继续由应用维护。提供原 HTTP/DWS 接口，不包含可视化界面。

生产依赖图已没有外部 `@deepseek-ai/dsh-*` 包。服务、工具、权限、进程、凭据、附件、技能和 workspace 均为仓库内实现。为保留数据和插件接口，明确保留本地 MIT 派生的事件 façade、历史 v0–v4 格式/导入以及 Windows ACL 支撑代码；这些兼容协议不承担推理或当前历史权威。旧包名兼容入口在 `packages/capability-compat` 和 workspace 配置中公开记录，不能只复制 `src` 部署。

源领域代码固定于 `HiQ-AI/dingtalk-dsh-assistant@93e431a`：200 个模块保留，3 个 UI 模块排除，所有适配均记录原始及目标哈希。历史数据库的 `executionBackend: dsh` 标签继续兼容，实际默认执行为 Pi。

## 运行

需要 Node.js 24+、pnpm，以及业务机器上已安装且登录的 DWS CLI。离线开发可以关闭 DWS。需要受限 shell 执行时，宿主必须提供可用的 Linux bubblewrap/Landlock 等沙箱；不可用时拒绝执行，不自动切换权限模式。

```sh
pnpm install --frozen-lockfile
cp config.example.json /tmp/night-bot-config.json
# 编辑绝对 stateDir/workspaceDir、模型、真实负责人身份、群和 ingressEpoch。
# 模型密钥通过 apiKeyEnv 引用的环境变量或 Host 凭据服务提供。
pnpm start /tmp/night-bot-config.json
curl http://127.0.0.1:18998/health
```

`stateDir` 存放数据库、会话和附件；`workspaceDir` 存放任务工作区。二者必须分离，不能指向现有生产数据目录。首次全新数据库设置 `taskSessions.initialize: true`，后续可关闭；旧数据库迁移需先核对原仓库迁移 runbook，不能把全新库初始化当成迁移。`ingressEpoch` 明确历史入站边界，不要用示例时间替代真实启用时刻。模型、工具技能、群职责、别名和并发等原接口仍然保留。

默认 DWS 关闭且外发未授权。实际启用需同时配置 `resident.dws.enabled`、`writesAuthorized`、`profile` 和 `groups`，以及真实 `ownerActorId`、`webActorId`；这些开关不会替代任务自身的业务授权。保留原工具的权限 preset 与业务授权规则。HTTP 仅监听 loopback；需要远程访问时使用经过鉴权的运维通道。原 `/state/*`、任务、配置与人工答复 API 沿用，入口详见 [API 清单](docs/HTTP-ROUTES.md)。

`/config/agent` 保存的默认模型选择持久化于 `stateDir/storage/night_model_selection.json`，重启后优先于初始 JSON 配置中的默认选择；provider 声明仍由启动配置提供。

`providers` 由本地 NativePiProvider 处理，兼容原 `llm-pi-ai` profile 格式，可选择 pi-ai 支持的 provider，或声明兼容端点与模型。示例模型是占位配置，应按自己的服务修订。`skillDirs` 为额外技能目录。技能文件默认开启监听，外部编辑后会在下次模型步骤提醒重读；`skillWatch: false` 可显式关闭后台监听，原生写入/编辑仍会使技能目录失效刷新。`plugins` 是可信部署配置的 Cordis 插件行，可挂载业务所需的额外浏览器、数据库或搜索等能力；不会从群消息自动加载代码。默认提供文件/检索、终端及作业、技能、工作目录、待办、HTTP 获取和原生子代理；Web 搜索提供者和外部业务系统需要单独配置，缺失会明确报错。

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
