# 第 1 轮：确定性默认接线与持久边界

日期：2026-11-06。范围为真实 Host/官方 Pi、本地 HTTP 脚本模型、假渠道、隔离 SQLite、离线任务归档/升级。没有调用真实模型、真实渠道、CI、部署或合并。

## 源码与工作树

- 分支：`worktree-resident-conversation-routing`；HEAD：`eca0df5ed127d8b043ba087291bfb1426d0ca5d6`。
- 本轮运行在团队共享的**未提交工作树**；实现和测试在定位失败后持续变化。以下为分批真实结果，不能用 HEAD 代表实际代码，也不能推导为最终版本整组通过。最终统一回归另起轮次。
- 阶段末只读 `git hash-object` 快照：`src/channels/router-ledger.js`=`3db29af7b0be6f983272615f4bb8373db0aef799`；`src/channels/router-lifecycle.js`=`07f6b4320c4db683c23595118706bdb46ec9d8f1`；`packages/dingtalk-core/task-session-service.js`=`d75b954b6caa61e220f4dea070a974eaab611477`；`src/tasks/ledger-archive.js`=`9c689b0ae21245cf613116ebda1ea3f52b08afd7`；`src/runtime/resident-router-upgrade.js`=`b567e99066675ddd6d626f1d89f25447385546d3`。该快照记录阶段末状态，不冒充各分批执行时相同版本。

## 实跑与结论

| 命令/范围 | 实际结果 | 必要证据 |
| --- | --- | --- |
| `node --test test/pi-resident-triage.test.js` | 3 PASS | 四处置独立、禁止任务规划字段、缺项/重复/旧版/越界、15 接受/16 拒绝 |
| `node --test --test-concurrency=1 test/pi-resident-router.test.js` | 3 PASS，36.9s；后台 `bunoztawk` exit 0 | 默认 attachIngress 实际调用分诊；静默/仅短回复不唤醒 Router 或建任务；不完整输出由官方 schema 拒绝且来源待处理；群共享和私聊/渠道隔离 |
| `test/pi-resident-router-flow.test.js` 四处置与溢出两例 | 2 PASS，后台 `b2ee6acf7` 的前两例 | 原文/引用/作者保留；unknown 回复仍转交，冷启动不重发；15 条 steer，第 16 条来源先持久排队，业务批次不超过 15 |
| 同文件迟到输入/候选提交故障/发布故障/四轮上下文四例 | 4 PASS，72.1s；后台 `bgmvh21et` exit 0 | 摘要时新消息只进入下一代；持久故障到关闭后再冷启动，从真实 native seed/commit 发布唯一 g2，无业务模型重放；四轮不重载旧原文、不无限自触发 |
| `node --test test/pi-router-ledger.test.js` | 18 场景中 17 PASS；同目标一例按更新后的合同修正夹具后定向 1 PASS | A 完成不等于依赖满足；wait/continue/空或虚构证据不放行；旧版/取消/撤回来源/多前置/环；跨物理 session 去重；重复 settle 游标一次；v2 B 单任务恢复 held；v1 只读历史；A 先归档仍能用原完成事件评估 B |
| `node --test test/pi-resident-router-upgrade.test.js` | 2 PASS，10.6s | 同夹具先 check，state 文件集合与 SHA 全同，无 WAL/SHM；缺备份零写拒绝；原生 backupData 后升级到 v4/marker1；可靠 pending 才入队，模糊/无来源 held；身份不变、再次执行不重放；漂移/unknown 效果拒绝 |

账本的同目标夹具原先在 `sameGoal=true` 时改写 objective；新 Host 明确拒绝该组合。现保留原 objective=`Verify A`，以 `node --test --test-name-pattern="same-goal rework" test/pi-router-ledger.test.js` 实跑 1 PASS；新版 requirementRevision=2 再完成并评估后，B 只释放一次。没有放宽业务断言或修改产品源码。

## 发现、修复与复验

- **分诊/Router 工具可见性**：首次真实 Host 在请求前因 own-scope 工具误放入 inherited restrict 而失败；修复后又观测到 Pi 后注册的文件工具泄露。责任人修复角色接线后，默认 Host 3 例通过；测试仍严格要求分诊只暴露提交工具。
- **摘要挡住迟到分诊**：真实摘要 gate 期间晚到来源无法进入 Router inbox。核心层取消 `inflightGroups` 对 Router 摘要完成的等待；迟到消息合同复验通过，旧代无投递，新代 cursor=2/generation=3。
- **重复 settle**：同 event 换 operationId 令 cursor 从 1 错增到 2。平台改为已消费事件不重复推进，集中账本复验通过。
- **故障注入夹具**：最初 Proxy 覆盖冻结 store.command 违反原生 Proxy invariant，未到产品故障窗口；改为普通委托包装。随后一次性故障被正常重调度恢复，改为持续故障直到关闭后解除，才验证冷恢复边界。两次均不计产品失败。
- **普通完成夹具排空**：最初直接 task.complete 后评估因 actor 未 drain 被正确拒绝。补真实 wake.ack/task.drained；另保留未排空不可 reopen 的独立断言。

## 独立审查补充证据

审查成员报告并给出执行标识，纳入矩阵，不重复专项：

1. `btq9bxb11`，15.2s，真实默认 Host 持续故障到关闭，无新消息冷启动：g1/cursor1/last0/inbox0 → g2/last1/rotation=published；只新增一次模型交接，requiredSourceIds 包含原消息。
2. `b6ocrqtc6`，12.5s，真实官方 actor/native 中只有精确内部 handoff enqueued 而未 admitted：冷启动恰好取消旧 packet 一次（reason=`router-handoff-recovery`），旧 packet admitted=0；一次新交接，旧 rotation aborted、新 rotation published，无新增任务。

审查成员说明四个核心文件实验起止 SHA 一致：lifecycle 前缀 `0cfa6c05`、ledger `406806bf`、factory `9d556d6f`、admission `0b37ff49`；这些为其 SHA 证据，不与本报告 Git blob hash 混同。最初失败及其修复脉络保留在审查记录。

## 未完成边界与下一轮

- `pnpm test:runtime` 已启动，后台 `b9wondzb5`；当前为诊断回归，尚未接收终态，不能计通过。
- 需要迁移退休 Topic 测试/脚本模型，并完成 `pnpm test`、`pnpm test:routing` 及受影响 domain/containment、严格 journal/native guards。
- Router 默认工具创建 A/B、结果不达标返工、新版本认可后自动释放 B 的全链路尚未验证；当前相应证据来自真实 store 合同，不冒充默认模型全链路。
- 空白/超限/缺来源摘要的 Host 拒绝及原代保留，产品刚增加预算，需要纳入后续定向验证。
- 真实大模型语义效果、真实 DWS、部署、CI 与合并未验证；后四项未授权。
- 本轮临时目录由测试钩子清理；无额外截图/日志附件需要保留，必要终端文字证据已集中于本报告。
