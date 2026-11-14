# 原生作业核验与恢复

## 总目标

核实原任务未知 shell 作业的现状，在不伪造生产者终态、不重放原调用、不丢待处理输入的条件下恢复原任务执行。保护原主检出及安装数据，不创建备份。

## 当前检查点

**本次核验与原任务恢复执行已完成**。PR [#142](https://github.com/zzusp/night-bot/pull/142) 已合并，本机实际运行 `1d7c76b48a334fc1370066fea4a21d141691e75a`，核心/插件同发行。实际证据集中在 [第二轮](round-2.md)。

- 旧 shell 的 lint 成功、构建退出未知；OS 核验未发现原生产者，按操作者证据追加独立 job/reconciled，保留 partial-effects/unknown/noReplay，不伪造 settled。
- 原 journal 完整前缀、task body 和三条未 ACK wake 在结清时不变；随后由正常 Host 在原 task/session 从 lease 17 进入 18。
- 实际会话完成四次新 PowerShell、一次 write 及 job_list，Web 状态与发行产物匹配；原 call 仍仅一次，原未知 job 已不再阻断。业务任务仍在执行，不声称原业务修复已完成。
- 最终新增回归 5 PASS；既有 job/context 35 PASS；source/hash/import guard 通过。完整 test/runtime/routing/containment 未跑，见 [第一轮](round-1.md)。
- health 仍 degraded，剩余一个既有业务等待未变；未创建备份或触碰原主检出的既有修改。原命令、业务身份/路径、输出、凭据与私有核验报告仅留本机安装数据，不进 Git。

## 决策与证据入口

[前置快照](../../spec/native-job-recovery.md)；[第一轮](round-1.md)；[最终第二轮](round-2.md)；[历史矩阵](matrix.csv)。运行源码版本与后续纯文档归档提交分开记录。
