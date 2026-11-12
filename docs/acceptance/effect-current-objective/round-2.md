# 第二轮：最终本地复验

## 版本与范围

2026-11-12，main a691993 上的未提交隔离工作树；分支 `worktree-effect-current-objective`。本轮验证以下真实源码字节，后续提交若仅增加文档不改变受验代码：

| 文件 | SHA256 |
| --- | --- |
| packages/dingtalk-core/task-session-service.js | 707d6a43f7cf0d9fa7a50c6a978b4b1d2669a5e883f44d3e051016ebb9163e4e |
| packages/dingtalk-core/dynamic-task-store.js | 3fc0db8f15e4cb56edfe84b397ae54aa9b1c331b82a818d20a404591be70e122 |
| test/pi-task-effect-action-e2e.test.js | d7da29b94baac69fc3420d5d22c9fa09d9d61ffc597217eed0f20500925280bc |

## 实跑结果

```powershell
node --experimental-test-module-mocks --test --test-reporter=tap --test-concurrency=1 --test-name-pattern='active:' test/pi-task-effect-action-e2e.test.js
node --experimental-test-module-mocks --test --test-reporter=tap --test-concurrency=1 --test-name-pattern='closure: (normal|after-|before-)' test/pi-task-effect-action-e2e.test.js
pnpm check
```

- 活动态：4 PASS / 0 FAIL / 0 SKIP，自然 exit0，93345.6166ms。包括实际私密 HTTP/CLI 恢复、暂停后无来源中断、来源后中断、修订后中断及原会话冷恢复。
- 暂停态：5 PASS / 0 FAIL / 0 SKIP，自然 exit0。包括原流程、来源/修订/激活前中断、激活成功但响应丢失后的幂等恢复。
- 每条 action 场景读回真实 SQLite 与官方 Pi 日志：仅原效果一次加独立授权效果一次；session 不变；旧结清仍是 `closed-with-possible-partial-effects` / noReplay；同一操作者请求重试不新增版本或重做效果。
- 活动态无合法提案不改变控制态；无私密凭据 403、伪造 actor 400、模型 initiator 拒绝、陈旧版本/错误 closure 拒绝。暂停收据尚无 source 时，更换目标或直接登记更换说明的 source 均拒绝 `DYNAMIC_COMMAND_ID_CONFLICT`。
- `pnpm check`：190 retained / 10 retired / 3 excluded UI / 59 adapted，relativeImports closed；425 production imports 与 runtime JS，externalSdkImports 0，legacyOrchestratorDefinitions 0。`git diff --check` 通过。
- 第一轮的 52 条证明/完成反例保护逻辑未变；最终 store 的本次变动入口由九条 action 场景覆盖，未重复无关全量运行。矩阵明确记为 UNCHANGED-NOT-RERUN。

## 真实安装与未完成范围

只读回查实际任务仍为 active + drained，保持原 session、要求版本 3 / 控制版本 4，旧 intent committed / noReplay=true，仍等待新目标授权。没有向实际安装提交新的授权、修改其账本、停机或部署。当前安装仍运行原已合并发行，不能把本分支的代码修复表述为任务已经恢复。

平台补丁合并/安装升级需要本次明确授权；随后通过私密官方 new-action 续原任务，再观察业务代码修复及中英文 Excel 单元格。它们当前均 NOT-RUN。本轮不授权再次部署业务系统，不运行真实发送，也未跑全量 runtime/containment。
