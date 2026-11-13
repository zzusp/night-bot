> 当前 Windows 安全执行、DSH 清理、全量基线与最终受验状态统一见 [SG11 目标](acceptance/resident-conversation-routing/goal.md)。`7416964` 及[此前本机目标](acceptance/pi-native-retirement-local/goal.md)属于先前退休阶段。以下旧架构映射保留迁移历史，多执行成员、旧子代理和历史导入均不是当前能力。

> [PI-NATIVE-DEFAULT-STATUS.md](PI-NATIVE-DEFAULT-STATUS.md)和 [PI-NATIVE-REBUILD.md](PI-NATIVE-REBUILD.md)记录各自源码 checkpoint，不能代替 SG11 当前工作树验证。DSH 历史数据导入、v0–v4 转换器和插件 ABI 豁免已移除；零外部 registry 包不代表派生源码、旧 namespace 或发行残留都已清完。

# Pi 非可视化迁移

本地实现已完成默认运行路径迁移；没有外部 DSH 生产依赖，包括传递依赖。
Pi agent-core1.5.0 负责推理/工具迭代，Pi SessionManager 负责当前历史和上下文。
所有默认服务、工具、恢复、权限和交付由本地实现接入，保留源码来源、许可和
历史接口；旧事件/格式兼容不再构成独立执行或上下文底座。

早期移植源为 HiQ-AI/dingtalk-dsh-assistant@93e431a；当时的 200 个保留模块、3 个 UI
排除模块及 26 个适配属于历史计数，当前来源与处置以实际 manifest/guard 为准。来源记录和路由检查不等于外部业务验收。

## 当前常驻 Router 边界

渠道认证消息先进入轻量一级分诊；一级分诊只输出是否处理及可选短回复，原消息按需转入该 conversation 的常驻 Router。Router 拆分/关联和安排任务、评估执行结果，每个任务仍只有一个执行会话，不恢复任务 Owner、协调团队或子代理产品。活动路由不再依赖 Topic。

直接来源保存消息身份、版本、作者和准确引用；任务动作、依赖满足与结果认可仍经 Host/SQLite 的当前权限、版本和效果校验。Router 的 Pi 会话在空闲后继续复用，上下文缩减由 Pi 原生压缩负责。仅恢复旧部署尚未完成的交接，不再发起正常空闲换代；旧 journal 保留，摘要不成为权限或状态权威。职责与恢复边界见 [CHANNELS](CHANNELS.md)。

已有 Night Bot 数据需停机排空、离线备份、显式 `--check` 检查和升级；旧 Topic 只读留作审计，未处理/不确定来源不能丢弃或整体重放。新 schema 回退必须恢复匹配的旧代码与离线数据，不能让旧代码读取新账本。具体命令见 [Windows 运维](ops/windows-local-runtime.md)，单任务档案版本与恢复边界见 [TASK-ARCHIVE](TASK-ARCHIVE.md)。这不是 DSH 数据导入或外部路径转换。

本轮实际交付与未验范围以 [常驻 Router 验收入口](acceptance/resident-conversation-routing/goal.md) 为准，历史结果不表示本次工作树通过。

## 历史功能与迁移映射（非当前能力清单）

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
| 持久排期、触发、固定事项、协调退休兼容、审计/性能/告警 | native-schedule、native-session-controller、platform-schedule、coordination-* | pi-schedule-wire：真实默认 Host/CLI、原桥接、到期文件写入、重启/提交间隙、防重、取消/归档、权限/模型、周期合并/DST；外部渠道交付单独验收 |
| 业务工作流、Git/PR/UAT/发布、Bytebase/Postgres、源文件证据 | workflow-*、execution-*、task-*-workflow | 保留原实现和测试；本次没有接入真实业务系统、合并或部署 |
| Claude 可选执行后端 | claude-execution-session | 保留兼容实现；未安装/登录 Claude CLI，未验收 |
| CLI/后台配置、模型 provider、群职责、技能/插件扩展、HTTP 控制与人工答复 | config.js、host.js、resident/http、task-resident-runtime | pi-wire、pi-config、HTTP 路由守恒 |

完整源文件哈希清单为 `docs/source-manifest.json`。`pnpm check` 验证每个保留模块仍存在、改动有明确记录、相对导入闭合和每条源 HTTP 路由仍存在。该清单证明文件和接口守恒，不等于每个真实外部功能已验收。


## 当前边界与清理状态

- 当前会话历史、分支和模型上下文以官方 Pi 为权威。旧 Session/projection façade 及 v4 publication/inbox ABI 不构成当前产品合同；Host 的业务审计、严格提交与授权收据仍须保留，不能为清除旧名字删掉这些边界。
- 历史 namespace、包 facade 和 workspace overrides 按真实消费者清理，不永久保留旧 ABI，也不能只改字符串宣称退休。中间状态仍有本地兼容映射时如实登记；具体处置与未验项见[唯一清理台账](acceptance/resident-conversation-routing/dsh-cleanup-inventory.csv)。`pnpm-workspace.yaml` 的 `allowBuilds` 策略不因移除 overrides 而删除。
- `test/fixtures/native-profile` 是纯官方 Pi 测试配置；`scripts/verify-native-test-profile.mjs` 的 `verifyOfficialPi()` 和 `collectSourceEvidence()` 是有效核验职责，不因目录沿用旧名称而移除。旧三包 publisher 另行处置。
- Windows ACL 与 runner 已迁接到 `src/process/windows-acl.js`、`src/process/windows-acl-runner.js`；派生实现继续保留 MIT 归属，迁接不等于独立重写。重启恢复探针的路径/哈希、拒绝条件、drain 和 no-replay 约束仍须核对；当前 Windows 安全执行仅为部分实现与诊断，不据此宣称可生产隔离或本轮全绿。
- 核心无可视化依赖；独立可选 Web 渠道插件见 [Web 运维](ops/web-console-local.md)，不改变核心 schema 或默认组合。HTTP 仅监听 loopback；未迁移生产数据。旧部署脚本仅作来源
  参考，不是 Night Bot 的部署入口。真实平台、DWS、厂商和可选插件需另行验收。

当前架构见 RUNTIME.md，结果与平台限制见 VALIDATION.md。分阶段记录保存在
MIGRATION-HISTORY.md；其中旧的未完成项/依赖计数仅代表当时状态。
