# 第一轮：原生作业结清与同会话恢复

## 范围与版本

2026-11-14。基于主线 `1351ad7a12376e5e15c9e130e1d50b224de8e74b` 的 `worktree-native-job-recovery` 工作树，包含本轮未提交源码及测试。主线并入的 #141 只改已有界面规范、CSS 和浏览器用例；本轮未修改其行为。验证绑定本轮源码，不以 HEAD 代替未提交修改。

## 结果

- `node --test --test-concurrency=1 test/pi-native-job-reconciliation.test.js test/pi-official-job-ledger.test.js test/pi-task-execution-context.test.js`：中间候选 39 PASS / 0 FAIL / 0 SKIP。已有 job ledger 和 execution context 合计 35 项；这两个被验实现此后未改。
- 最终 `node --test --test-concurrency=1 test/pi-native-job-reconciliation.test.js`：5 PASS / 0 FAIL / 0 SKIP，约 29.34 秒。包含后加的重复请求报告读回和当前 Pi 分支验证。
- 真实 CLI inspect / close --check / close / 重复 close 已执行；自检前后 journal 字节和原 SQL 文件不变，实际结清保留原 journal 完整前缀和原登记，未增加 settled 或 producerReported，冷读未决项清零，重复请求不追加。
- 安装锁活 owner、session writer 占用、证据摘要变化、陈旧提案、未提交日志尾、外来安装身份、保留 Windows 资源、错误 registrationDigest/noReplay、原登记脱离当前 Pi 分支均拒绝。
- 真实 Host 冷启动续办使用原 task/session：模型执行一轮，收到旧作业退出状态未知/noReplay 提示，提交实际新决定；drained 由正常 Host 恢复与排空链更新，故障清除、原输入正常 ACK，未调用 shell 或新增旧作业登记。测试使用本地脚本模型，无真实渠道或远端业务效果。
- `pnpm check`：source/hash/import 三项通过；190 retained / 10 retired，448 runtime JS，0 external registry DSH SDK imports。

首轮夹具发现的目录假设、锁错误码、Windows typed resource 字段及外部提供 store 的清理责任已按真实合同修正后复验；未改生产 guard、未降低断言。完整 `pnpm test`、`test:runtime`、`test:routing`、`test:containment` 未运行，不能据定向结果声称全仓全绿。

## 现场边界

仅只读 inspect 了真实任务：原 shell 是任务工作区里的 lint/build；lint 完整成功，build 无终态。OS 只读快照未发现原候选 PID 或相应生产者命令。退出状态仍未知，不宣称构建成功或没有部分产物。真实安装尚未结清/恢复，部署和现场新执行的证据记在后续轮次。

私有原命令、任务标识、业务路径和原始输出仅在安装数据中，不提交 Git。[目标与当前检查点](goal.md)；[决策快照](../../spec/native-job-recovery.md)。
