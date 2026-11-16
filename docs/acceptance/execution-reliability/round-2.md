# 第二轮：修正关联夹具后的集中复验

## 结论与版本

- 记录时间：2026-11-16T23:11:37+08:00。
- 实施与适用隔离验证完成：完整 runtime 150 pass / 0 fail / 0 cancelled / 12 skipped。没有把跳过或真实业务未验项算作通过。
- Windows 11、Node v24.19.0、pnpm 11.25.0、Pi 1.5.0；隔离 Host/Pi、本地脚本模型及假渠道。
- 运行时复验基于 `008a4e25f62ab7b073cab1771b1038b371f32ac0` 加未提交源码/测试修改。测试期间没有修改这 16 个文件；启动前与结束后集合指纹一致。
- 交付前 fetch 发现主线到 `2f35cf4d40abd87568529e0a9a49d6d572163730`，仅新增 Web 设置入口、UI 测试/截图及 DESIGN 文字，无本次文件重叠。已 fast-forward 整合；16 文件字节与指纹仍一致，随后 `pnpm check` 通过。没有重复跑无变化的长组，也不声称新增 UI 在本轮受验。
- 最终代码提交与 PR 状态在 [goal.md](goal.md) 回查登记；本报告绑定实际受验工作树，不以事后文档提交冒充重新运行。

## 实跑结果

| 检查 | 实际结果 | 证明范围 |
| --- | --- | --- |
| `pnpm test:runtime` | 162 tests，150 pass / 0 fail / 0 cancelled / 12 skipped，1754367.6381 ms，exit 0 | 所有未跳过运行时场景通过；人工答复、修订、提供方恢复、效果结清、技能与真实持久化。 |
| 12 项关联输入夹具目标复验 | 12 pass / 0 fail / 0 skipped | 三种 Router 答复、技术答复、既有工具结果、原群/缺原件答复与增量续办。 |
| Router-confirmed group answer 目标复验 | 1 pass | provider failure 后保存原来源，时间推进与冷恢复不自启；新真实来源在原 session 完成且无新增效果。完整 runtime 又覆盖一次。 |
| 未知效果与正式结清目标复验 | 修正后各目标通过，最终由完整 runtime 统一复验 | 仍只有一次真实效果、精确无成功/结清收据、补充来源仅只读 wait、无完成、恢复不重放；原 live-preserve 结清与零写 inspect 保留。 |
| 整合后 `pnpm check` | 全部通过；190 retained / 10 retired / 60 adapted，生产导入451，runtimeJsFiles451，externalSdkImports0，legacyOrchestratorDefinitions0 | 来源、hash、生产导入闭包与原生运行时守卫。 |
| 第一轮路由、作业和单会话专项 | 复用 152/152、54/54、22/22；没有重跑、集合不相加 | 对应代码未变，详见第一轮。 |

## 首轮失败如何闭环

- 人工答复模型读取实际新增 `input.sources`；任务/问题的 answered 状态仍从 Host 账本断言。不把退休的 `humanRequests` 重新塞回模型输入。
- 原来源保留在 Pi 历史；续办只补新增/版本变化来源。测试同时核对原 packet 和当前增量，不把旧正文重发当作恢复标准。
- 当前 conversation 的答复由 Router 核实，替换旧 execution-side humanReview 场景为真实 Router/provider failure/cold restore；旧非 Router 只读 review 仍有原专项覆盖。
- 两个超时的诊断显示 producer calls=1、工具已持续返回 `TASK_EFFECT_UNCERTAIN_NO_REPLAY`，脚本却再次调用。修正实际错误识别，不改生产守卫、不增 timeout；新的只读输入允许核验，不代表新效果或完成许可。
- 工作区低层夹具复用正式创建事务；身份、来源/版本、同一 task/session、原调用 noReplay、实际排空断言保留。
- 第一轮原始失败计数保留于 [round-1.md](round-1.md)，不抹除或改写为通过。

## 受验源码集合

按路径排序，对每行 `path<TAB>sha256<LF>` 的 UTF-8 文本再次 SHA256：
`0f9a4ff15ad69bb3f94f48533553d173e980eca57d499c8ea93ee01d29f15468`。

| 文件 | SHA256 |
| --- | --- |
| `src/channels/resident-router-business.js` | `334753f6c0e4d923a41e5010add206102e07cf72e69f455e5e264c440e447256` |
| `src/native-jobs.js` | `476513dccee57be037aa7850088f7e5cdbd85e329db2131bb93c9e64a31d1caf` |
| `src/native-tool-jobs.js` | `368b5dd718f18c008fb6be1a78890effe9c9a7e4b40cfeedf852d168d7bb4340` |
| `src/runtime/job-ledger.js` | `67abdde31520d837b9d6bf584c253a1d120c8796080caf6b8d753472c784ce07` |
| `src/runtime/job-output.js` | `e7e39a9e1a085ca35be5f44e990287a838035007d3b39631f9d937c513fb0829` |
| `src/tasks/single-session.js` | `7ef81dc3ae3baf6a88b1cb02728c6c0266d3874ea29c59e590cca876216e095f` |
| `test/pi-official-job-ledger.test.js` | `da4ce919e8cbddd06e183ad4531b5832c9f01d81844282f035c3f75de1593080` |
| `test/pi-resident-router.test.js` | `5abd984b2c3a9b15131f056315050c4a55a5e1cb6007522f117fc335ec1f8c2b` |
| `test/pi-router-task-e2e.test.js` | `3bba7478bb9bb740ca6e2e9af29cb50dee9c5a26a641ff7e66b84c87bad768b6` |
| `test/pi-single-task-review.test.js` | `b406c77035d4b8785d3d53265c0b087e8a920974a34799ca2152f3336827961a` |
| `test/pi-task-live-supplement-state.test.js` | `eee31fa8c853b9cc46faae958572cf080a1c5e4c83f57cbdf884a5ea46e44436` |
| `test/task-session-execution-provider-recovery-native.test.js` | `cc547511100d8b7dc050e6417269b0e9c123be38f743efbefb061902e91da8f3` |
| `test/task-session-human-native.test.js` | `640c5e02b446c89dc9f3f940beda5bbc31160a72b74f1cbd6cca4cac59eb02eb` |
| `test/task-session-job-recovery-native.test.js` | `82b1ec93d64d6c7fe535c4f224d90413d7015d8b45cecadb2d23ae1c74b5f605` |
| `test/task-session-live-supplement-native.test.js` | `dba368a23796fffabea3166746f72bec9829c912e5e1d31f09fda700ecdfe217` |
| `test/task-session-service-native.test.js` | `fc8e7adafe91574f285a4e2b8c2ec19f29ddfec33bf42ece8628a6bcd8bfc341` |

## 跳过与边界

12 项全部是既有 Linux portable model-process privacy namespace 场景：串行原生进程、前后台晋升、完成/取消 producer、HTTP 常驻服务、任务取消、冷重开保留作业、live preserve 进程及 service cancellation。Windows 保持失败关闭；没有用 full 模式抵扣，也没有增加 skip。

默认 `pnpm test` 全集未跑，只跑相关专项。未执行：真实模型对任意分诊/范围措辞的语义保证、供应商 session_expired 认证/真实渠道集成、Windows OS containment 全量、生产合并/部署和端到端性能测量。性能改动限于提示短前台/长通知等待，以及历史回读少一次重复严格解码，不声称提速比例。

新终态快照默认16 KiB并遵守作业更小上限，observer log 不入输出；旧无快照、未知效果、外来 owner 与资源绑定继续拒绝或明确不可恢复。新字段需要本版解码，不能以旧代码回滚读取新日志。运行安装、凭据及真实业务数据均未修改。

## 重跑入口与证据保留

```sh
pnpm test:runtime
pnpm check
```

第一轮包含其余专项完整命令。宿主临时输出只用于采集，本报告保留结果和必要文字证据，不依赖临时目录附件。唯一任务状态与交付回查在 goal.md；矩阵保留两轮历史。
