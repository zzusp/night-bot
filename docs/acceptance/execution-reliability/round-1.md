# 第一轮：首次整组与关联专项

## 版本与范围

- 日期：2026-11-16；Windows 11、Node v24.19.0、pnpm 11.25.0、Pi 1.5.0。
- 分支 `worktree-execution-reliability`，基线 `008a4e25f62ab7b073cab1771b1038b371f32ac0`。验证时为未提交工作树，不以 HEAD 冒充所测代码。
- 本轮覆盖作业终态、原会话人工答复、路由和完整运行时。测试使用隔离安装、本地脚本模型、假渠道，无真实消息或运行安装修改。
- routing/runtime 启动后曾完善作业快照的输出预算；路由相关代码未再变动，最终作业源码另经 54 项专项复验。不能据此宣称所有组在单一静态工作树全量通过。
- 首次 runtime 的五个后续待修夹具（`task-session-human-native`、`task-session-execution-provider-recovery-native`、`task-session-service-native`、`task-session-job-recovery-native`、`task-session-live-supplement-native`）当时仍为基线版本；修正后的集中复验另记第二轮。

## 实跑结果

| 命令/范围 | 实际结果 | 结论 |
| --- | --- | --- |
| `pnpm test:routing` | 152 pass / 0 fail / 0 skipped，672354.7198 ms | PASS；分诊/执行提示在真实 Host/Pi 挂载、路由/来源隔离与原会话续办通过。 |
| 作业六文件专项（命令见下文） | 54 pass / 0 fail / 0 skipped，最终作业源码 | PASS；完成、失败、真实取消、释放 registry、冷重开和历史输出回读通过。 |
| 单会话四文件专项（命令见下文） | 初次 18 pass / 4 fail；修夹具后 22 pass / 0 fail / 0 skipped | PASS；没有放宽工作区初始化守卫。 |
| `pnpm check` | 来源/hash、生产导入和原生运行时守卫均通过 | PASS；productionImportFiles=451，runtimeJsFiles=451，externalSdkImports=0。 |
| `pnpm test:runtime` | 162 tests：135 pass / 13 fail / 2 cancelled / 12 skipped，874986.8911 ms，exit 1 | FAIL；不能用已通过专项替代整组失败。 |

这些集合有重叠，不相加为独立总用例数。早期 66 项受影响专项也通过，但最终作业预算以本轮 54 项复验为准。

## 失败、根因与处理

1. 原人工答复专项曾出现 answered 之后再次提问。真实 Host 已续办，脚本模型读取已退出模型投影的 `task.humanRequests`；改为读取实际新答复 source 后，默认/显式操作者与原请求人均 completed/drained，CAS 和重复答复防重放保持。
2. 单会话关联组的四项 `TASK_WORKSPACE_NOT_READY`：低层 `task.create` 夹具未走正式工作区 begin/finish。复用现有 `initializeMemoryTaskWorkspace` 后 22/22 通过，不放宽生产检查。
3. runtime 的 13 项断言失败：多项读取退休 `humanRequests` 投影；另有旧 execution-side group humanReview 合同，以及续办重发旧来源正文的断言。当前合同为 Router 判断答复、Pi 保留旧历史、新轮只传增量。修正夹具并用当前 Router 的 provider failure/cold restore 替代旧入口，身份、实际业务终态与 noReplay 断言继续保留；最终结果见第二轮。
4. runtime 的两项取消是 20s/25s 超时。串行复验仍超时，诊断时 producer calls 均为 1，工具已返回 `TASK_EFFECT_UNCERTAIN_NO_REPLAY`，脚本模型却重复调用。另有“补充新来源也不许开启只读模型”的旧断言与当前可核验原证据合同冲突。修正脚本模型的实际错误识别，并检查无 effect-result/reconciled、无完成、原效果只一次；不提高超时、不改生产保护。集中复验见第二轮。

## 最终作业专项对应的生产源指纹

以下指纹绑定 54 项最终作业专项和当时的生产修改；不代表首次 runtime 已通过。

| 文件 | SHA256 |
| --- | --- |
| `src/native-jobs.js` | `476513dccee57be037aa7850088f7e5cdbd85e329db2131bb93c9e64a31d1caf` |
| `src/native-tool-jobs.js` | `368b5dd718f18c008fb6be1a78890effe9c9a7e4b40cfeedf852d168d7bb4340` |
| `src/runtime/job-ledger.js` | `67abdde31520d837b9d6bf584c253a1d120c8796080caf6b8d753472c784ce07` |
| `src/runtime/job-output.js` | `e7e39a9e1a085ca35be5f44e990287a838035007d3b39631f9d937c513fb0829` |
| `src/channels/resident-router-business.js` | `334753f6c0e4d923a41e5010add206102e07cf72e69f455e5e264c440e447256` |
| `src/tasks/single-session.js` | `7ef81dc3ae3baf6a88b1cb02728c6c0266d3874ea29c59e590cca876216e095f` |

## 可复跑命令

```sh
node --experimental-test-module-mocks --test test/pi-native-jobs.test.js test/pi-native-tool-jobs.test.js test/pi-official-job-ledger.test.js test/pi-job-ledger.test.js test/pi-job-ledger-wire.test.js test/pi-native-job-reconciliation.test.js
node --experimental-test-module-mocks --test test/pi-single-task-official.test.js test/pi-single-task-initial-input.test.js test/pi-single-task-review.test.js test/pi-task-live-supplement-state.test.js
pnpm test:routing
pnpm test:runtime
pnpm check
```

## 跳过与未验边界

- runtime 的 12 项为 Linux portable model-process privacy namespace 场景，Windows 按既有合同跳过、保持失败关闭；不能标作通过。
- 未做真实模型语义、供应商认证/消息集成、Windows OS containment、生产部署或端到端性能实测。
- 分诊和范围修改只有提示挂载与现有版本/来源链回归，不保证任意真实模型措辞。`session_expired` 仍需真实提供方认证流程。
- 作业快照有界，旧无快照收据不能补造输出；真正未知效果仍严格 noReplay。
- 本报告自包含关键结果，临时宿主输出不作为可移植附件；失败历史保留，后续结论以第二轮为准。
