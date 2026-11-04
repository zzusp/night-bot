# 迁移范围

**迁移尚未完成。** 真正 Pi 原生部分、DSH 剩余功能/进程/协议/存储和下一步门槛见 [DSH-AUDIT](DSH-AUDIT.md)。

源：`HiQ-AI/dingtalk-dsh-assistant`，主干 `93e431a`（#341）。目标既有初始 README 与 MIT LICENSE；保留 LICENSE，更新 README。没有复制源仓库 `.git`、`.env`、个人 profile、凭据、数据库、真实消息或历史验收产物。

## 运行边界

`src/pi-loop.js` 使用 pi-agent-core 的 `runAgentLoop` 驱动迭代和工具调用。原 DSH AgentLoop 的工厂、持久 inbox、生命周期和会话投影保留为 MIT 兼容实现；原模型/工具 step 循环已替换。每一模型请求先持久化已准入事件，再从 Pi SessionManager 的权威分支读取实际内容；旧 DSH deriveMessages 不再为主循环提供模型上下文。任务权限和效果账本仍由应用维护。模型 wire adapter 已替换为本地 `native-pi-provider.js`，直接使用 Pi Models；保留多模态、provider replay、凭据、模型选择和错误分类。通用 DSH LLM middleware/GenerateOptions/chunk 兼容桥及附件策略 helpers 仍待替换。版本由 pnpm lock 固定；当前代理循环固定为发布包 `@earendil-works/pi-agent-core@1.5.0`，本轮已从已弃用的 @mariozechner 0.73.1 升级并完成对应回归；停止条件使用1.5.0公开的 finishTurn 合同。

应用 NativeTools 保持统一工具准入、业务/权限 guard 和调度入口；具体工具仍保留自己的参数校验/defaults。Pi 的操作性工具声明不重复执行更严格的 JSON Schema 校验，实际发给模型的仍是原始精确 schema；这样可保留 Zod 默认值、未知/隐藏工具尝试的拒绝和审计。单会话内 Pi 工具调用串行进入应用执行管线；不同 Task/Execution 的并发、资源互斥与排队继续由原 Host 控制。这保留了工具能力与安全语义，但单次模型响应中多个并行安全工具的吞吐可能低于原循环。

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
