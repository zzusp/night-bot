# Night Bot

[官网与文档](https://zzusp.github.io/night-bot/) · [快速开始](https://zzusp.github.io/night-bot/guide/getting-started.html) · [使用教程](https://zzusp.github.io/night-bot/guide/usage.html)

基于 [Pi](https://github.com/earendil-works/pi) 的个人助理 Agent 初始化套件。

把任务交给自己的 Bot，通过可选的 Web 控制台或消息渠道持续协作。Night Bot 将任务执行、长期记忆、技能学习和定时工作放在同一个运行环境中；渠道负责接入，核心可以独立、无界面运行。

Pi 负责模型与工具迭代、会话历史和模型上下文。Night Bot 在此基础上管理消息路由、任务生命周期、权限、恢复与交付。当前使用锁定的 Pi 1.5.0 SDK，不是 Pi CLI 的封装，也不要求先安装 Pi CLI。

## 能做什么

- **持续处理任务**：轻量分诊判断是否介入，每个对话由常驻 Router 安排工作，每个事项只有一个执行会话。支持补充输入、等待、依赖和恢复，任务完成不会自动授权后续动作。见 [任务模型](docs/SINGLE-TASK.md)。
- **记住上下文**：Bot 共享 Markdown 长期记忆，支持记住、纠正、忘记和关键词检索，同时保留来源与读取权限。见 [长期记忆](docs/MEMORY.md)。
- **沉淀可复用技能**：Router 可直接维护学习 Skill；任务结束后另行复盘，依据证据提炼经验。学习只更新受管内容，不改写用户安装的正式技能或扩大执行权限。见 [自进化](docs/SELF-EVOLUTION.md)。
- **安排定时工作**：支持单次、固定间隔、每日、每周和五字段 cron，排期持久化，停机后恢复到期事项；周期事项合并漏过的轮次。见 [运行时说明](docs/RUNTIME.md)。
- **使用文件与工具**：提供文件读写、编辑、检索、Bash/PowerShell、后台作业、工作目录、待办及 HTTP 获取。Web 搜索和额外业务系统需单独配置，不随核心安装自动可用。
- **选择渠道与模型**：Web 与钉钉均为可选渠道。可在同一 API 路由下管理多个模型，并分别为分诊、Router 和任务执行选择模型。见 [渠道](docs/CHANNELS.md)与[模型配置](docs/ops/shared-settings.md)。

## 快速开始

需要 **Node.js 24+**、**pnpm 11.25.0**，以及可用的模型服务和凭据。核心安装不需要 DWS CLI，也不默认启用 Web 或钉钉外发。

**新安装默认使用 `full`（完全访问）模式**：工具按启动 Bot 的操作系统账号权限执行，不提供工作区或进程隔离。先阅读下方[权限与运行边界](#权限与运行边界)，不要把未信任的任务或插件交给高权限账号运行。

```sh
git clone https://github.com/zzusp/night-bot.git
cd night-bot
pnpm install --frozen-lockfile
pnpm init:assistant --actor YOUR_OWN_ID --provider openai --model YOUR_MODEL --key-env OPENAI_API_KEY
```

- `YOUR_OWN_ID` 是你为本安装选择的稳定操作者标识；`YOUR_MODEL` 替换为服务商实际可用的模型 ID。
- 初始化生成独立实例标识与私有配置 `data/config/config.json`，再次运行会拒绝覆盖已有配置。
- 通过启动进程的 `OPENAI_API_KEY` 环境变量，或[凭据管理命令](docs/ops/shared-settings.md)，提供模型密钥。`--key-env` 只接收环境变量名称，不接收密钥正文。
- 自定义 API 可使用初始化参数 `--base-url` 和 `--api`；已有安装使用[统一配置命令](docs/ops/shared-settings.md)。初始化只创建配置与目录，不验证真实模型调用或渠道身份。

准备好凭据后启动核心服务：

```sh
pnpm start data/config/config.json
```

在另一终端检查健康状态：

```sh
curl http://127.0.0.1:18998/health
```

健康接口可达只表示服务可响应，不证明模型、任务或渠道已经验证通过。无界面集成可使用[本机 HTTP 接口](docs/HTTP-ROUTES.md)；需要聊天界面时，按下一节启用 Web。

### 启用 Web 控制台

Web 提供中文对话、Router 与任务执行记录、渠道管理、模型设置、权限审批和自进化记录。它面向本安装的单个操作者，不是面向公网的多用户服务。执行记录保留全部工具名称、获权业务路径及常用执行工具的输入和文字结果；模型实际保存的可读思考可折叠查看，真实待办按事项及状态展示卡片。凭据继续脱敏，记忆/技能正文仍独立授权，不要求模型额外生成进展文字。 自进化列表按页读取元数据缓存，支持 Windows 上连续强制刷新；刷新失败保留可核验的旧快照并明确提示，正文不进入该缓存。

在首次启动前执行以下命令。已有运行实例请先按[对应平台的运维流程](#部署与文档)正常停机，并沿用原 Web 渠道 ID 与操作者标识。

```sh
pnpm --dir packages/web-console install --frozen-lockfile
pnpm --dir packages/web-console build
node bin/night-bot-config.js data/config/config.json web --enabled true --host 127.0.0.1 --port 3080 --channel-id local-web --sender-id YOUR_OWN_ID --check
node bin/night-bot-config.js data/config/config.json web --enabled true --host 127.0.0.1 --port 3080 --channel-id local-web --sender-id YOUR_OWN_ID
pnpm start data/config/config.json
```

打开 `http://127.0.0.1:3080`，从启动日志指向的本机令牌文件读取访问令牌并登录。不要将令牌放入 URL、截图、聊天或源码。`--check` 只校验配置，不保存；实际保存后按返回的 `restartRequired` 正常重启。

Web 有独立依赖与构建，关闭浏览器不停止 Bot，禁用 Web 也不影响其他核心能力。详见 [Web 安装与排障](docs/ops/web-console-local.md)和[使用说明](docs/manual/web-console.md)。

### 接入钉钉

安装并登录 DWS CLI 后，可通过 Web「渠道」或[统一配置 CLI](docs/ops/shared-settings.md)添加群聊或私聊。每个渠道实例只绑定一个会话，多个实例以不同 `channelId` 共存；每个实例可配置名称、职责和工作规范。

- 钉钉是可选插件，默认核心不会探测或启动 DWS。
- 新建渠道默认关闭外发，需要操作者明确授权；渠道开关不能替代任务本身的业务授权。
- 已发消息编辑经同账号精确回读后形成新来源版本；明确撤回生成墓碑并撤销旧来源授权，保留原接收进度与历史，不自动回滚已执行的操作。
- 保存配置、实际连接、消息发送与独立回读是不同状态，不能用“保存成功”代替接入验收。历史恢复完成后的普通增量拉取保持接收中；首次补拉、重连/恢复缺口及历史读取失败仍分别显示恢复中或错误。
- PDF、Word 等附件可作为只读原件交给任务；原件可达不代表已安装对应解析器，单个材料上限为 8 MiB。

字段、身份绑定、附件和交付规则见 [渠道协议](docs/CHANNELS.md)；Windows 接入步骤见 [Windows 本机运行](docs/ops/windows-local-runtime.md)。

## 配置与扩展

Web 设置与 `night-bot-settings` 共用 Host 配置服务。模型目录支持同一路由下的多个模型，并保护仍被默认配置或角色引用的条目。API、模型目录等变更需正常重启，不会热切换已有执行会话。

```sh
# 查看运行中实例的设置和模型目录，不输出密钥。
node bin/night-bot-settings.js data/config/config.json show --live
node bin/night-bot-settings.js data/config/config.json model-list --live
```

- **模型与凭据**：配置 API 协议、地址、模型目录和角色模型，使用环境引用或凭据服务管理密钥。见 [统一配置命令](docs/ops/shared-settings.md)。
- **技能**：通过 `skillDirs` 或安装内的私有技能目录加载可复用 Skill。仓库提供通用的[工作日志写作技能](skills/work-log-writing/SKILL.md)及脱敏示例；源码检出安装可将 `skills` 加入 `skillDirs` 后正常重启，再通过 `/skill:work-log-writing` 使用。这不会改变独立定时日报的生成提示。私有技能正文、脚本和素材仍属于运行数据，不提交到代码仓库。
- **渠道插件**：通过 `channelPluginDirs` 与 `channelPlugins` 接入其他消息渠道。插件须遵循认证身份、生命周期和能力合同。见 [插件接口](docs/CHANNEL-PLUGINS.md)。
- **工具插件**：可信部署配置可挂载额外浏览器、搜索、数据库等能力。插件与 Host 同进程运行，不是沙箱；不会从普通群消息自动加载代码。

官方会话工厂发布前，会按耐久默认选择、显式运行时/记忆模型选择及当前角色模型选择预加载所需 Pi 协议模块，只做本地导入，不读模型凭据、不发探测或推理请求。首次模块加载成本移到启动阶段；无效模型配置仍保留现有延迟诊断。分流性能使用现有 `/state/performance` 查询，按真实 `sessionId` / `groupId` 返回 `runtimeOwner: channel-triage` 及 `phaseMs`（次数、总量、最大值、p50/p95、失败次数），无需创建任务。阶段覆盖会话准备、资源读取/SDK reload、输入接纳、请求准备、提交和收尾；只记录元数据。嵌套及并行阶段不可相加，SDK 模型尝试次数不代表 HTTP 请求数；旧记录缺少分项时返回空集合，不回填推测耗时。

## 权限与运行边界

权限模式由可信安装操作者通过 CLI 或认证 Web 设置，模型和普通渠道成员不能自行升级权限。

正常停机中止的 Router 生成沿原 Pi 历史安全续轮，较新取消/延期输入先耐久接纳再推理；原输入及已完成效果不重放。未知效果、来源/owner 变化或恢复批次超限仍保留告警；模型 error 不自动循环重试。分诊首答不代表后续任务已完成，恢复合同见 [CHANNELS](docs/CHANNELS.md#已接纳未结批次的安全续办)。

Router 对所属会话的执行 session 拥有完整调度权，创建、启动、停止、解除等待及取消/完成后的重新唤起不要求原消息作者或安装操作者补调度许可；来源保留真实追溯，停止仍实际排空原 owner。已结清的旧未知效果只永久禁止原具体调用重放，不再要求后续独立调用或完成结果匹配专门的新目标授权。尚未结清时也能唤起原会话核验，但不能重放旧效果或宣称成功。工具本身继续遵循当前权限模式、秘密和业务效果边界。[原 new-action 入口](docs/EFFECT-ACTION-AUTHORIZATION.md)保留为可选人工运维方式，不是续办前置。

| 模式 | 行为与当前范围 |
| --- | --- |
| `full` 完全访问 | **新安装默认值，也是当前交付重点。** 按启动进程的 OS 账号权限执行，不提权，不隔离同账号可访问的文件、凭据或进程。Host 的来源绑定、授权、审计、取消和防重放仍保留。 |
| `ask` 请求批准 | 需要扩大范围的动作进入单次人工审批。合同与配置入口保留，受限执行尚未完成交付验收。 |
| `auto` 帮我批准 | 需要批准的动作由无工具模型审查，无法确定或技术失败转人工。受限执行同样尚未完成交付验收。 |

已有配置显式保存的 `ask` / `auto` 保持不变，不会因默认值变化而改成 `full`。受限后端不可用时拒绝执行，不自动降级为完全访问。

- Pi SDK 本身不提供 Night Bot 的权限系统；应用校验和操作系统隔离是不同边界。`full` 的任意 shell 可访问同账号可读的 Host 私有文件，不能把应用接口校验当作进程隔离。
- 核心管理 HTTP 只监听 loopback。Web 的容器监听也要求固定 Origin、令牌、会话及 CSRF 校验，宿主端口仅发布到 loopback，不应直接暴露公网。
- Linux 受限 shell/模型进程需要可用的 bubblewrap 等隔离能力；Windows 受限执行与撤权仍有未完成项。macOS 已验证安装、服务和部分无命令任务，命令执行及长轮次续办仍有未通过项。平台验收不能互相替代。
- 发送或执行结果未知时保留现场并核对原回执，不自动重发或重放。真实模型、厂商账号与渠道交付需在目标运行环境单独验收。

当前权限范围和平台限制见[运行验收入口](docs/acceptance/resident-conversation-routing/goal.md)及各平台运维文档。

## 数据与备份

应用自有数据保存在安装目录的 `data/`，业务工作区与产物默认在 `data/workspaces/`，备份在 `backups/`。这些目录均被 Git 忽略；升级代码必须保留数据，不复制他人的凭据或私有技能。

每个任务的材料、工作文件、冻结产物、Pi 会话和复盘集中在 `data/workspaces/tasks/<taskId>/`。共享 SQLite 仍是运行时权威，不能把任务 JSON 快照当作可重放命令。

普通停机目录不等于已校验的可迁移备份。跨路径迁移须显式离线封存和核验，恢复默认暂停并保留交付防重门禁。详见 [数据布局](docs/DATA-LAYOUT.md)和[任务备份与恢复](docs/TASK-ARCHIVE.md)。本项目不提供原 DSH 插件历史数据导入。

## 仓库结构

| 路径 | 内容 |
| --- | --- |
| [`src/`](src) | Host、Pi 接线、工具、权限、记忆、排期与配置服务 |
| [`bin/`](bin) | 初始化、运行、配置、凭据和维护命令 |
| [`packages/dingtalk-core/`](packages/dingtalk-core) | 消息路由、常驻 Router、任务与交付实现；目录名保留历史来源，不表示核心启动需要钉钉 |
| [`packages/dingtalk-dsh-assistant/`](packages/dingtalk-dsh-assistant) | 可选钉钉 DWS 渠道插件 |
| [`packages/web-console/`](packages/web-console) | 可选 Web 渠道、服务端与前端 |
| [`test/`](test) / [`docs/`](docs) | 测试、操作手册、架构与按版本记录的验收证据 |

生产依赖图不包含外部 `@deepseek-ai/dsh-*` 包；部分带来源许可的本地适配实现仍保留。完整代码、锁文件及 workspace 构建策略是部署输入，不能只复制 `src/`。

## 部署与文档

| 主题 | 文档 |
| --- | --- |
| 本机运行 | [Windows](docs/ops/windows-local-runtime.md) · [macOS](docs/ops/mac-local-runtime.md) · [Linux 隔离前置](docs/ops/linux-contained-runtime.md) |
| 容器部署 | [Docker](docs/ops/docker-deployment.md) · [Kubernetes](docs/ops/kubernetes-deployment.md) · [云端准备验收](docs/acceptance/docker-cloud-readiness/goal.md) |
| 使用与设置 | [Web 使用说明](docs/manual/web-console.md) · [Web 运维](docs/ops/web-console-local.md) · [统一配置 CLI](docs/ops/shared-settings.md) |
| 核心能力 | [运行时](docs/RUNTIME.md) · [任务](docs/SINGLE-TASK.md) · [记忆](docs/MEMORY.md) · [自进化](docs/SELF-EVOLUTION.md) |
| 集成接口 | [HTTP API](docs/HTTP-ROUTES.md) · [渠道协议](docs/CHANNELS.md) · [渠道插件](docs/CHANNEL-PLUGINS.md) |
| 验收与迁移 | [验证说明](docs/VALIDATION.md) · [当前验收范围](docs/acceptance/resident-conversation-routing/goal.md) · [功能映射](docs/MIGRATION.md) |

Docker 镜像包含固定版本的 DWS，以及 Git、GitHub CLI 和 Chromium headless shell，默认仍不启用钉钉。镜像构建、容器隔离、真实任务、生产部署和厂商接入分别验收，不能从镜像定义推断全部可用。

## 开发

先阅读 [AGENTS.md](AGENTS.md)。涉及运行边界时同时阅读 [MIGRATION](docs/MIGRATION.md) 与 [VALIDATION](docs/VALIDATION.md)；界面设计和交互以 [DESIGN.md](DESIGN.md) 为唯一指导文档。

```sh
pnpm install --frozen-lockfile
pnpm check              # 源码、HTTP 路由、生产导入与本地适配来源守卫
pnpm test               # 默认测试组，随后运行 pnpm check
pnpm test:domain
pnpm test:runtime
pnpm test:routing
pnpm test:containment
```

Web 独立安装依赖后，可运行：

```sh
pnpm --dir packages/web-console test
pnpm --dir packages/web-console build
pnpm --dir packages/web-console test:browser
```

测试通常使用隔离目录、本地脚本模型和 fake 渠道，不代表真实厂商集成通过。隔离测试需要对应宿主内核能力，不能通过关闭应用沙箱使测试通过；Web 浏览器测试的本机浏览器要求见 [Web 运维](docs/ops/web-console-local.md#开发与隔离验收)。

`pnpm audit:runtime` 将审计结果输出到 `docs/tmp/runtime-audit.json`，不覆盖历史检查点。提交时请区分通过、失败、跳过和未执行的验证，不将分组测试当作全量验收。

官网与文档站独立位于 [`website/`](website)，本地构建和 GitHub Pages 发布说明见 [网站维护说明](website/README.md)。网站依赖不会进入 Bot 的运行时依赖图。

## 来源与许可

Night Bot 使用 Pi SDK，早期移植来源为 `HiQ-AI/dingtalk-dsh-assistant@93e431a`，Web 设计参考 [BoardUI](https://github.com/BoardUI/boardui)。具体来源、版本、保留实现及许可见 [THIRD_PARTY.md](THIRD_PARTY.md) 和 [`licenses/`](licenses)。

仓库保留原 [MIT LICENSE](LICENSE)，但移植模块并未因此自动改授 MIT。当前根包标记为 `private: true`、`UNLICENSED`，不作为 npm 发布包；请按来源清单核对使用与再分发条件。
