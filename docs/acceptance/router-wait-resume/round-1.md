# 第1轮：Router 原会话等待续接

## 范围与版本

2026-11-11，本地 Windows 11、Node 24.19.0、pnpm 11.25.0。base 为 `789a7877c270c103c0a8a2b2eeb51ac0d77b4585`；实跑对象是本分支未提交修复工作树，不以 HEAD 冒充修改后的源码。执行最后一次 `git fetch origin` 后，HEAD 与 origin/main 为 `0 0`。

运行时源码摘要：

- `packages/dingtalk-core/dynamic-task-store.js`：`0ee45666b28cc87970b3dba937eb9caf63a59b27c48cea2692cb1f7b26d6e7a1`。
- `packages/dingtalk-core/task-session-service.js`：`a0517d766fae67a017f84433e85b20b7639dc45a43ca7aa02b5cc6f5c564b74d`。
- 另含 `src/channels/router-ledger.js` 和 `src/channels/resident-router-business.js` 的本轮 resume 增量；对应 PR 固定完整差异。

测试使用真实 Host、官方 Pi、本地脚本模型 HTTP 端点、临时目录及假渠道；没有连接生产模型或发送真实群消息。最后实跑后仅删除测试文件中未使用的旧 requestSystemText 函数，不改变测试执行路径或运行时源码。

## 结果

| 检查 | 实际结果 | 证明范围 |
| --- | --- | --- |
| 修复前 operator 回归 | FAIL：actual active，expected completed | 补充落账不等于等待解除；旧行为可重现 |
| 修复后 operator/requester 两项 | 2 PASS，0 FAIL | Router 通过正式工具续接；原 session 写前保留、续接后实际 read 并完成 |
| 两项中的事务反例 | 19 项拒绝且任务/wake 不变 | 错问题、req/control/context 版本、过早/internal/跨会话/旧编辑来源、空理由、技术等待非操作者 |
| 重启与业务幂等 | 包含在上述两项，PASS | 未答冷启动仍等待；跨代同动作重试、已完成后重启不重放 write 或执行 |
| 人工答复整文件最终复验 | 19 PASS，0 FAIL，0 cancelled，0 skipped | 业务成员答复、事实追问、Web/operator 正式答复、原件和原会话恢复、通知及权限边界 |
| pnpm check | PASS | 424 运行时文件、0 externalSdkImports，来源/hash/import/native 守卫通过 |
| 唯一执行会话/live supplement | 11 PASS，1 平台 SKIP | 单会话取消/排空、效果收据与未知结果不重放；Linux namespace 专项在 Windows 跳过 |
| 完整 pnpm test:routing | 86 项：71 PASS、15 FAIL、0 SKIP | 新增两项通过；15 项在干净同版 base 全部同名失败 |
| 底层 dynamic-task-store | 163 项：12 PASS、151 FAIL | 干净同版 base 也是 12 PASS、151 FAIL，逐项名称和错误码集合相同 |

相关命令：

```powershell
node --experimental-test-module-mocks --test --test-name-pattern='Router resumes a waiting task' test/pi-resident-router-flow.test.js
node --experimental-test-module-mocks --test test/task-session-human-native.test.js
pnpm check
node --experimental-test-module-mocks --test test/dynamic-task-store.test.js test/pi-single-task.test.js test/task-session-live-supplement-native.test.js
pnpm test:routing
```

底层与单会话组合共 175 项：23 PASS、151 FAIL、1 SKIP。不把底层既有通过项重复计入单会话结果。人工答复首轮曾为 17 PASS、2 FAIL、1 timeout；本轮修正非法/重复 audience、分诊输入分流、旧原件夹具的真实 Host 初始化及内部来源拒发断言后，整文件最终为上述 19 PASS，未放宽生产守卫或跳过失败断言。

## 既有失败与反证

独立快照由 `git archive 789a7877c270c103c0a8a2b2eeb51ac0d77b4585` 提取，独立执行 `pnpm install --frozen-lockfile`，未链接其他检出的 node_modules。在其中运行同样的 163 项底层测试及 routing 的 15 个失败用例，失败名称与稳定错误码集合均与当前工作树完全一致。因此本轮没有观察到新增失败，不能据此声称完整套件通过。

Routing 的 15 项为：

- `pi-router-ledger.test.js` 的 13 项依赖/修订/归档/动作幂等/安排用例：旧夹具未完成 Host 工作区初始化，`TASK_WORKSPACE_NOT_READY`。
- `pi-resident-router-flow.test.js`：`durable receipt echoes tolerate later DWS flags without replacing existing message facts`，`ERR_ASSERTION`，Missing expected rejection。
- `task-notification-retry-native.test.js`：`a historical frozen start confirmation retires after its real native task completes without re-dispatch`，`ERR_ASSERTION`，actual active / expected completed。

额外底层 151 项既有失败同样与工作区初始化守卫/旧夹具有关；部分错误包装为 ERR_ASSERTION。此次未修改这些旧用例，也未放宽 TASK_WORKSPACE_NOT_READY、权限、未知效果或依赖检查。非 Router 历史任务仍保留旧人工复核路径；普通 supplement 不自动解除等待，业务答复不增加实施授权。

## 证据与边界

本轮原始输出由执行宿主管理；关键文字结果已集中保留在本报告，不依赖私有本机绝对路径。中间源码快照和测试文本位于被忽略的 `docs/tmp/router-wait-resume/`，任务收尾清理；不提交生产配置、原话、凭据、运行数据或私有 Skill。

本轮结论为代码和相关本地行为验证完成。尚未合并、构建本次正式镜像、更新生产或继续真实测试群；后续授权与状态统一见 [goal.md](goal.md)。本报告保留，不追认后续源码和生产版本。
