# 第一轮：状态缺口与来源消费方修正

## 受验版本

2026-11-12，main a691993 的隔离工作树。先新增 active + drained 的真实 Host 场景，再修改服务入口；未提交源码，不以 HEAD 冒充修改后的版本。

## 结果与失败

1. 新增活动态场景在旧入口命中 `TASK_EFFECT_TASK_NOT_QUIESCENT`，旧代码先要求 paused，连当前版本/旧版本的提案校验都无法进入；首次断言失败位于旧版本反例，未跑到后面的成功 CLI 步骤。这份记录不声称当时成功路径已完整跑完。
2. 服务加入持久暂停后，整文件实际运行 9 条：5 PASS / 4 FAIL。原暂停态五条全部通过；活动态四条被 SQLite 来源登记的 `TASK_EFFECT_AUTHORIZATION_STALE` 拒绝，原因是暂停使 controlRevision 增加，而消费方仍机械要求暂停前版本。失败没有新效果执行，没有取消原 noReplay。
3. 修正关联消费方：只允许当前同 requestId、完整提案和操作者说明摘要匹配的暂停命令收据解释该一次版本变化；不通用放宽版本校验。
4. 结清/未授权完成反例两文件共 52 PASS / 0 FAIL / 0 SKIP，耗时 56619.4594ms；证明旧效果、官方调用/输入、排空、证据篡改与未获授权不得完成等守卫保留。

## 命令与证据摘要

```powershell
node --experimental-test-module-mocks --test --test-reporter=tap --test-name-pattern='active: normal' test/pi-task-effect-action-e2e.test.js
node --experimental-test-module-mocks --test --test-reporter=tap --test-concurrency=1 test/pi-task-effect-action-e2e.test.js
node --experimental-test-module-mocks --test --test-reporter=tap --test-concurrency=1 test/pi-task-effect-reconciliation.test.js test/pi-task-effect-completion-authority.test.js
```

首轮 action 汇总：`tests 9; pass 5; fail 4; cancelled 0; skipped 0`，自然 exit1。52 条反例汇总：`tests 52; pass 52; fail 0; cancelled 0; skipped 0`，自然 exit0。

52 条反例运行时 service SHA256 为 `707d6a43f7cf0d9fa7a50c6a978b4b1d2669a5e883f44d3e051016ebb9163e4e`，与最终一致；当时 store SHA256 为 `2b6660594878cd6501aa65ad38471d4afa3f620a1c538c89f952917f696e82d6`。之后 store 只修改本次新目标来源登记的暂停收据校验，该受影响入口在第二轮九条 action 场景复验；未声称 52 条在最终 store 字节上重新运行。

## 边界

本轮没有操作真实安装恢复、业务代码、发布或导出。原始失败输出保留在宿主任务历史，报告自包含必要结论和错误；不另复制含本机路径的日志到 Git。
