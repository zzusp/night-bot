# DSH 依赖审计与独立运行边界

## 结论与目标

**当前是迁移中实现，不是完整的 Pi 原生重写。** 它能由 `node bin/night-bot.js` 自行启动，不需要外部已安装的 DSH CLI、DSH 服务或桌面进程；但生产代码仍加载大量 DSH 库。独立进程不等于独立于 DSH。`pnpm audit:runtime` 的机器清单明确记录 `standaloneProcess: true` 与 `standaloneFromDshLibraries: false`，不会把开发依赖分组或本地复制源码算作完成迁移。

用户要求以 Pi 为底座重新实现且不漏功能。执行目标应当是：Pi 成为真实模型上下文与代理运行时，应用自己拥有任务、授权、效果账本和必要的平台能力；原 HTTP/DWS 行为及恢复/授权合同得到验证。不能仅把旧循环外包一层 Pi，或把 DSH 包移到 devDependencies、复制进仓库，就宣称已完成。当前只满足其中一部分。

## 真正由谁执行

| 范围 | 当前实际实现 | Pi 原生程度 / 待办 |
|---|---|---|
| 代理迭代及操作性工具调用 | `@mariozechner/pi-agent-core@0.73.1` 的 `runAgentLoop` | 真正使用 Pi 迭代；单会话工具串行，Host 仍执行工具调度 |
| 模型上下文 | Host `session.deriveMessages()`、请求 header/surface、上下文退休及附件引用 | **仍为 DSH**；Pi 接收的操作性 transcript 中有占位输入，不能称 Pi 会话是权威上下文 |
| 模型请求与流 | DSH `llm.prepareCall/GenerateOptions/StreamChunk` → `dsh-llm-pi-ai` → `@earendil-works/pi-ai@1.5.0`；再经本地桥转换成 Pi core 的事件流 | provider 内确实使用 pi-ai，但模型路由、凭据、多模态、replay 和错误处理仍依赖 DSH 适配器。与 core 使用两个 Pi 版本，必须单独验证跨版本边界 |
| Agent 工厂及生命周期 | 本地 `src/pi-loop.js` 中从 DSH MIT 实现保留的工厂、maintenance、注册、取消/排空及持久 inbox；DSH `agents/sessions/scope` | **兼容层**；不是 Pi SDK 的 `createAgentSession`/`SessionManager` |
| 会话历史与恢复 | DSH v4 JSONL、session projection、request surface、task/session route writer | **仍为 DSH**，文件路径包含 `.dsh/sessions`；原会话、租约、工具回执、上下文退休的合同尚未迁到 Pi 的持久格式 |
| 任务、操作、唤醒、资源、通知主账本 | 应用的 `dynamic-task-store.js` 等，使用 `node:sqlite` | 应用原生存储；其中恢复读取的会话与原生 job 收据仍依赖 DSH，不能因此称整个恢复原生 |
| 群与工作区 JSON 后端 | **本轮已替换为 `src/native-domain.js`** | Node 文件系统实现，兼容旧单文档 JSON；群业务模型及 workspace registry 本身仍有原业务/DSH 上层 |
| 默认模型选择及持久保存 | **本轮已替换为 `src/native-state.js`** | 应用原生，保存后重启读回，不依赖 DSH 配置编辑器 |
| 工具 schema、guard、角色隔离、审计、输出、调度 | DSH `tools` 及原业务注册逻辑 | **仍为 DSH**；Pi 工具 wrapper 最终调用原 Host scheduler；未重建独立工具权限引擎 |
| 文件与终端、作业与进程回执、沙箱、权限 preset | DSH fs/shell/subprocess/jobs/sandbox/policy | **仍为 DSH**；Pi core 不提供这些安全合同。不能用普通 `child_process` 或关闭沙箱直接替代 |
| 技能、工作目录、指引发现、子代理、工作区注册 | DSH skill/filesystem、workingDirectory、instructions、subagent/workspace | **仍为 DSH**；未迁到 Pi coding-agent 资源加载与扩展模型 |
| 凭据、授权与附件 | DSH credentials/authorization/attachments；宿主环境变量 | **仍为 DSH**；新增模型选择文件不包含密钥，不替代这些安全设施 |
| HTTP 与 DWS | 应用的 Node HTTP server、DWS CLI JSON bridge | 应用原生入口；路由调用的任务/会话能力仍可能依赖 DSH |
| 历史工作流与可选外部能力 | 保留旧源码和扩展入口 | **源码存在不等于当前已挂载或验收**。不能用 200 文件守恒证明所有工作流、浏览器/数据库插件或 Claude 都实际可用 |

完整生产直接依赖和实际 Host 插件行见 `runtime-audit.json`。本轮将开发/历史测试依赖与生产直接依赖区分，但仍有 **56 个 DSH 生产直接依赖**；传递依赖还会包含其他 DSH 包。它们没有因为不单独启动 DSH 进程而消失。

## 进程与协议

- 常驻进程是本应用的 Node 进程，DSH/Cordis/Pi 都作为库运行其中，没有另起 DSH daemon。
- 应用会产生 Node SQLite/完整性检查 worker；执行时由 DSH subprocess/jobs 层创建并跟踪 bash/pwsh、业务命令或后台进程。DWS 开启时会调用配置的外部 DWS CLI；可选 Claude backend 使用其外部 CLI。未配置/未执行的外部浏览器和数据库能力不能列为已运行进程。
- 对外沿用应用 HTTP JSON 与 DWS CLI JSON 合同。对内仍使用 Cordis service/events、DSH Agent/Session、v4 JSONL、LLM 请求/chunk、工具结果及 job receipts。
- 本轮去掉的 JSON storage 与 model selection 使用 Node 文件操作及应用自己的 schema/持久文件；`storageDomain`、`agentDefaultModel` 服务名称暂为兼容调用者保留，不表示仍调用同名 DSH 插件。`storage` 仅提供历史 cutover 检查所需的 backend-root 元数据。

## 本轮实际替换与行为验证

1. 停止挂载 DSH `storage`、`storage-json`、`storage-domain` 三个运行时插件。原 JSON 格式、单写入链、持久化后更新内存、事件顺序、schema 读入校验及 close/drain 改由本地 Node 实现。业务库和旧 v8 schema 的声明 helper 也改为本地实现。工作区注册上层仍是 DSH。
2. 停止挂载 DSH `agent-default-model` 插件。原无界面 Host 没有 config editor，原插件的 `saveSelection` 因此是 no-op，HTTP 保存会在读回时失败；新服务持久写入 `storage/night_model_selection.json`。真实 CLI/HTTP 测试执行 PUT `/config/agent`，关闭并重启同一实例，再 GET `/state/agent-config` 核对保存值。
3. 新存储保留失败的确定性：rename 前失败不改变内存和文件；rename 后失败标记 `NATIVE_DOMAIN_COMMIT_UNCERTAIN`、阻止继续读取旧快照或写入，须关闭并从磁盘证据重开。observer 失败不反向拒绝已提交写入。覆盖原 JSON 导入、并发更新、重复 handle、版本/损坏拒绝、close/drain、符号链接拒绝和重启读回。
4. 当前本地后端明确只实现现有群/workspace/settings 使用的 authoritative single-document 布局；不声称是所有 DSH storage 插件的通用替代。额外插件若需要 per-record/backup-and-skip 布局会明确报错，不能悄悄降级或丢记录。这类未提供的外部插件配置需要逐个盘点。

本轮没有更改既有 `b16ac53` 归档，也没有重试被拒绝的远端写入。替换后的验证结果另见 VALIDATION 的后续记录，不能沿用旧提交的 590 通过数充作新代码证据。

## 完整迁移尚需完成的验收门槛

- 用 Pi 的真实会话上下文/持久机制替换当前 Host surface 与工厂；为旧 v4 日志提供明确的只读导入/恢复方案，保留原身份、租约、待消费反馈、授权来源、退役上下文和未知效果证据。不能同时让两个运行时成为权威写入者。
- 直接建立 Pi provider/config/auth 与附件投影，移除 DSH LLM seam、反向 chunk 桥和两个 Pi 版本的并存。保持原 provider profile、reasoning、模型失败分类与多模态/replay 的合同；不能只支持一个 mock OpenAI 端点便宣称 provider 功能完整。
- 建立独立工具 registry、参数验证、角色 guard、效果账与原命令/job 的不可重放收据。用应用管理的实际进程/输出/取消/排空取代 DSH jobs，同时保证超时不冒充退出、正常关闭不冒充业务成功、未知效果不自动重试。
- 实现并在真实可用的 OS 沙箱上验证文件/进程约束、跨任务产物 root、权限 preset、授权修正及重启隔离。当前云机 `SANDBOX_UNAVAILABLE` 是实际验收阻塞，不能降低隔离通过测试。
- 将技能/指引发现、子代理和 workspace 行为迁入 Pi/应用自有实现；迁移既有持久数据并核对所有当前实际配置的扩展能力。
- 最终以生产依赖闭包中无 DSH、Pi 上下文真实承载业务输入、全部现行功能回归及目标环境验收为完成条件。仅 package.json 不含 DSH、源码复制、接口守恒或 mock 回归均不足。

不需要让用户重新批准这些已授权的实现步骤。真正缺少的信息是生产实际启用的扩展/工具清单和脱敏配置；源仓库不足以确定工作区自定义技能、浏览器/数据库 provider 或任意 Cordis 插件是否属于必须保留的实际功能。不要索取密钥，也不要在没有清单时宣称“不漏全部生产扩展”。
