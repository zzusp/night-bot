> 当前重构进度见 [PI-NATIVE-REBUILD.md](PI-NATIVE-REBUILD.md)。DSH 历史数据导入、v0–v4 转换器和插件 ABI 豁免已移除。下文兼容保留记录是上一阶段的架构说明，不能据此认定本次已彻底移除 DSH 派生代码。

# Pi 非可视化迁移

本地实现已完成默认运行路径迁移；没有外部 DSH 生产依赖，包括传递依赖。
Pi agent-core1.5.0 负责推理/工具迭代，Pi SessionManager 负责当前历史和上下文。
所有默认服务、工具、恢复、权限和交付由本地实现接入，保留源码来源、许可和
历史接口；旧事件/格式兼容不再构成独立执行或上下文底座。

源固定于 HiQ-AI/dingtalk-dsh-assistant@93e431a，200 个模块保留、3 个 UI
模块排除、26 个适配记录原始/目标哈希。文件与路由守恒不是外部业务验收证明。

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
| 持久排期、触发、固定事项、协调退休兼容、审计/性能/告警 | native-schedule、native-session-controller、platform-schedule、coordination-* | pi-schedule-wire：真实默认 Host/CLI、原桥接、到期文件写入、重启/提交间隙、防重、取消/归档、权限/模型、周期合并/DST；外部渠道交付单独验收 |
| 业务工作流、Git/PR/UAT/发布、Bytebase/Postgres、源文件证据 | workflow-*、execution-*、task-*-workflow | 保留原实现和测试；本次没有接入真实业务系统、合并或部署 |
| Claude 可选执行后端 | claude-execution-session | 保留兼容实现；未安装/登录 Claude CLI，未验收 |
| CLI/后台配置、模型 provider、群职责、技能/插件扩展、HTTP 控制与人工答复 | config.js、host.js、resident/http、task-resident-runtime | pi-wire、pi-config、HTTP 路由守恒 |

完整源文件哈希清单为 `docs/source-manifest.json`。`pnpm check` 验证每个保留模块仍存在、改动有明确记录、相对导入闭合和每条源 HTTP 路由仍存在。该清单证明文件和接口守恒，不等于每个真实外部功能已验收。


## 明确保留的兼容与差异

- 本地 v4 audit/publication/inbox façade 暂时保留；v0–v4 编解码/导入已删除。当前历史写入、分支和模型上下文以 Pi 为权威。
- 旧包名和 RPC/type-symbol 字符串仍有内部调用；声明 DSH peer 的插件已禁止入场，旧 compatibility.json 豁免不再生效。命名空间公开指向本地
  owner/protocol，不增加活动服务替换计数，也不冒充原创算法。
- 原大型 verifier bundle 已替换为共享本地验证函数的隔离 ESM worker。
- Windows ACL 支撑代码保留来源和约束；重启恢复探针默认绑定 Native provider
  路径及固定哈希，旧部署入口必须显式选择。拒绝条件和不重放边界保留。
- 不提供可视化；HTTP 仅监听 loopback；未迁移生产数据。旧部署脚本仅作来源
  参考，不是 Night Bot 的部署入口。真实平台、DWS、厂商和可选插件需另行验收。

当前架构见 RUNTIME.md，结果与平台限制见 VALIDATION.md。分阶段记录保存在
MIGRATION-HISTORY.md；其中旧的未完成项/依赖计数仅代表当时状态。
