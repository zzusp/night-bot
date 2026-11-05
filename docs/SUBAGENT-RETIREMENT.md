# 子代理产品架构退役

用户已取消子代理架构。默认 Host 不提供子代理服务或模型工具，不再重建
森林调度、跨代理消息、spawn/fork、冷子目录 catalog、子代理 provider、
委派 persona 或子代理结构化返回。这些功能已取消，**没有等价替代实现**。
Pi 官方示例扩展不作为默认 CLI 执行器安装；不会因此扫描用户 home、继承
ambient credentials 或绕过现有沙箱。

默认会话、历史、上下文和工具迭代仍由官方 AgentSession、SessionManager、
ModelRuntime 负责。Night 保留任务归属、输入授权、业务收据、工具权限、
资源排空、任务档案及渠道隔离；这些边界不依赖恢复子代理 Session ABI。

## 退役范围

移除子代理 control-wire、spawn/fork provider-wire、child-catalog 测试，
纯 provider/helper 用例，以及混合 control-tools-wire 中的子代理两例。
保留同文件 todo/working-directory 和通用时区断言。

移除无产品调用者的 native-tool-subagent、native-tool-subagent-control、
native-subagent-providers 模块。未接 Host、未提交的 pi-child-sessions
实验模块及测试一并移除；它不构成产品能力或安全替代证据。

`test/pi-retired-subagent-tools.test.js` 使用真实默认 Host 和官方 SDK，
检查服务、模型工具目录均无子代理架构；即使模型请求已退役工具，也得到
原生错误 toolResult，而不创建子会话、producer 或文件效果。

## 保留的安全契约与官方模型覆盖

| 必须保留的行为 | 独立覆盖入口 |
|---|---|
| 冷恢复不重放完成效果、未知效果不自动重启 | pi-official-agent-factory.test.js；pi-job-ledger-wire.test.js；pi-single-task-official.test.js |
| exact actor、外来身份拒绝、不可由参数扩大授权 | pi-official-memory-privacy.test.js；pi-official-permission-presets.test.js；pi-official-approval.test.js |
| 真实参数校验、错误反馈、结果合同、conclude | pi-native-tools.test.js；pi-official-tools.test.js |
| 取消后等待已启动工具体；并发容量、独占屏障 | pi-official-tools.test.js；pi-job-tools-wire.test.js；pi-single-task-official.test.js |
| 提交失败不伪称成功；先持久化再效果 | pi-official-durability.test.js；pi-official-agent-factory.test.js；pi-job-ledger-wire.test.js |
| Host / 调用 scope 关闭保留 ownership 直到真实排空 | pi-official-agent-factory.test.js；pi-single-task-official.test.js |
| Memory scope、只读权限、撤销和 source provenance | pi-official-memory-privacy.test.js；pi-memory-official-extraction.test.js；pi-official-tool-contexts.test.js |
| archive 门、历史 lineage 隔离、备份恢复不重跑 | pi-workspace-wire.test.js；pi-task-archive.test.js；pi-runtime-data.test.js |
| human review、同一任务续办和真实源证据 | pi-single-task-review.test.js；pi-single-task.test.js |
| todo、目录归属、通用规范时区 | pi-control-tools-wire.test.js；pi-native-control-tools.test.js；pi-native-subagent-helpers.test.js（仅通用时区） |

这张表映射共同的安全要求，不宣称取消的森林/跨代理功能已被替换。
NativeAgents.ownerOf、通用 scope 和 workspace 历史 archive 安全门继续保留。
共享 pi-subagent-fixture 虽保留历史文件名，仍被 jobs、filesystem、web、
skills、observation 等实际官方测试复用，不能随名称删除。

## 尚未清除的静态引用

本次没有宣称 DSH 派生源码或命名空间已全部清除：

- packages/dingtalk-core/runtime.js:8 仍静态导入 native-subagents.js 的
  snapshotSubagentDescriptor，并在旧 runtime 的 descriptor 写入路径使用。
  该 runtime 及其历史路径仍有测试导入，需要单独核定退役范围。
- packages/capability-compat/subagent/index.js 仍导出 native-subagents.js。
  workspace 中的历史 link 与相关审计元数据由根任务统一审核。
- native-subagents.js 仍依赖 native-subagent-errors.js 和
  runtime/child-catalog.js。因此这三个源文件暂留，不能先删除依赖。
- 通用 ownership/scope、archive 拒绝门与 agent preset revision 归属不是
  取消产品架构的同义词，不能通过关键词批量删除。

许可文件、来源清单、源统计及 guard 元数据不在此切片中自行删除或刷新。
