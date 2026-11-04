# Night Bot

**当前为迁移中实现，尚未完成去 DSH 的 Pi 原生重写。** 详细边界见 [DSH 依赖审计](docs/DSH-AUDIT.md)。

基于 **pi-agent-core** 的无界面百部钉钉助手。Pi 驱动模型与工具迭代，保留原百部的消息、Topic、任务统筹/执行、恢复、权限、通知和交付账本。提供 HTTP API，不包含 Web 看板或设置页面。

领域实现取自 `HiQ-AI/dingtalk-dsh-assistant` 的 `93e431a`（含 #341）。群/workspace JSON 后端与默认模型选择已改为应用自有 Node 实现；新会话日志与上下文改由 Pi SessionManager v3 管理；模型 provider 已改由本地 NativePiProvider 调用 Pi Models；工具 registry 与执行管线已由 NativeTools 接管；通用模型注册/审计协议、工具后端、权限和生命周期等仍保留 DSH/Cordis 兼容能力；**尚未完全移除 DSH 依赖**。原生执行路径实际由 Pi 循环运行，内部 `executionBackend: dsh` 为兼容历史数据保留，不能据此判断当前推理引擎。

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

`providers` 由本地 NativePiProvider 处理，兼容原 `llm-pi-ai` profile 格式，可选择 pi-ai 支持的 provider，或声明兼容端点与模型。示例模型是占位配置，应按自己的服务修订。`skillDirs` 为额外技能目录。`plugins` 是可信部署配置的 Cordis 插件行，可挂载业务所需的额外浏览器、数据库或搜索等能力；不会从群消息自动加载代码。默认提供文件/检索、终端及作业、技能、工作目录、待办、HTTP 获取和原生子代理；Web 搜索提供者和外部业务系统需要单独配置，缺失会明确报错。

## 验证

```sh
pnpm audit:runtime       # DSH/Pi 依赖和服务边界审计（当前明确为部分迁移）
pnpm test                # 本地协议、CLI、配置与文件守恒检查
pnpm test:domain         # 消息、路由领域、通知、交付和排期逻辑
pnpm test:runtime        # Pi 下的原生会话/任务/恢复/权限/技能回归
pnpm test:routing        # Pi 下的 Topic、澄清、挂起与通知重试
pnpm test:containment    # 需要宿主真实 shell 沙箱的产物边界验证
```

功能覆盖与迁移边界见 [MIGRATION](docs/MIGRATION.md)，实际结果及未验证部分见 [VALIDATION](docs/VALIDATION.md)。所有验证均不向真实钉钉发送消息，不代表已部署或已完成真实模型语义验收。

后台任务注册表已由 NativeJobs 接管（会话归属、作用域控制器/订阅、输出环、wait/kill及关闭排空）；生产直接DSH依赖54个，进程与沙箱后端仍在迁移中。

NativeSandbox与本地managed-process后端已接管活动服务；进程后端为明确保留MIT来源的代码派生实现，Windows ACL等仍保留。完整边界与验证见docs/DSH-AUDIT.md、docs/VALIDATION.md；尚未完成去DSH。
