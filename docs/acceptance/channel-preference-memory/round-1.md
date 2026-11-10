# 渠道长期偏好写入：第一轮验收

## 结论

学习链路专项通过：明确的长期偏好经真实 Host/Pi、已认证假渠道和本地 HTTP 模型端点进入正式 Markdown 记忆，不是候选；事务回读后才确认，完整关闭并重新启动 Host 后，另一会话和另一已认证发送者仍能按需读回。当前运行安装未部署、未重启、未补记历史原消息，不能将隔离实跑等同于现用实例已生效。

最终源码专项 3 项通过，既有记忆、事务及官方隐私回归 41 项通过，`pnpm check` 通过。扩展的完整路由扫描为 61 PASS / 15 FAIL，整体没有全绿；三类失败的代表用例在移除本次学习修复的加载对照中同样失败，没有为求绿放宽策略或修改旁支模块。因此不生成全绿 `report.md`，不提交、推送、合并或部署。

## 源码与环境

- 日期：2026-11-10；Windows 11、Node v24.19.0、pnpm 11.25.0。
- 分支：`feature/public-marker-delivery-recovery`；HEAD：`b9a7bd2a61f0c31d0f8e03457431dace8c976617`。
- 工作树原有多项未提交改动，本次保留。受验版本不是单独 HEAD：四个变更源码/测试的差异 SHA-256 为 `2e04f343efe79119ec40c93854e0d37d9447777f117dcc4565f038b52a9a63a7`；逐文件指纹见 `round-1/validation.json` 的 `sourceSha256`。
- 使用隔离安装、真实应用 Host、官方 Pi AgentSession、真实 SQLite/Markdown、重启和文件哈希校验；模型响应和消息运输为本地脚本/假渠道，没有真实 DWS 发送。它证明接线、权限和持久化，不证明真实模型对所有自然语言都能正确选择工具。

## 修复范围

1. 分诊明确将长期行为要求交 Router，不以短确认代替记忆写入。
2. `resident_memory_remember` 只接受当前已接纳、未结清批次的原来源，回查同会话、当前版本、原作者、撤权/hold 与渠道消息事实，不能借引用、历史来源、任务结果或交接摘要取授权。
3. 复用既有记忆服务、明确同意、临时/秘密拒绝和事务；长期行为要求必须保留完整原话与条件。写入归因原发送者，不整体开放群 Router 的普通记忆写权限；`read-only` 仍拒绝。
4. 提交后独立回读核对内容、作者及消息，成功收据带 `persisted:true`；回读失败保留 `committed:true` 和未确认状态，不假称完全失败或成功。
5. 跨会话实跑发现旧 Router 查找可选读取工具时漏传 actor scope，导致实际 Pi 工具目录没有 `memory_search`；改为按当前 scope 查询，仅保留原 Skill/记忆读取白名单，不放开普通记忆写入、文件或进程工具。

## 最终实跑证据

### 长期记忆专项

```powershell
node --experimental-test-module-mocks --test --test-concurrency=1 --test-name-pattern='explicit channel preference|channel memory rejects|read-only Router reports' test/pi-resident-router-flow.test.js
```

结果：3 PASS / 0 FAIL / 0 SKIP，120555.2646 ms。实际诊断摘录：

```json
{"accepted":true,"candidate":false,"memoryRevision":1,"entryRevision":1,"quoteSha256":"d92fcd2495ac8a641ded0d05dedfbcd9ade5c799b317ce4de38da1ca3e10139f","diskHashVerified":true,"originalActorAndMessageBound":true,"groupRouterWriteGrantUnchanged":true,"writeBeforeAcknowledgement":true,"coldRestart":true,"crossConversationRecall":true,"replayWrites":0,"realVendorMessages":0}
```

测试通过真实渠道入口接收偏好，独立用 `decodeTopic` 解析落盘文件并核验正文哈希、原消息和原作者；候选数为 0，不创建空任务，Router inbox 已消费。关闭全部 Host/SQLite 后重开，重复输入不再次推理、写入或发送；另一个新会话只收到检索请求，不携带偏好原话或原会话交接摘要，仍通过实际 `memory_search` 结果读回。

授权检查共 12 组，含 1 个直接来源正例及历史来源、跨会话、旧版本、引用冒用、普通将来陈述、假设、第三人陈述、疑问、截短条件、临时要求和秘密反例。独立只读场景返回 `MEMORY_READ_ONLY`、正式记忆为空，实际假渠道回复说明没有保存。

### 既有回归与守卫

```powershell
node --experimental-test-module-mocks --test --test-concurrency=1 test/pi-memory-wire.test.js test/pi-memory-official-source.test.js test/pi-memory-official-extraction.test.js test/pi-evolution.test.js test/pi-official-memory-privacy.test.js test/pi-memory-store.test.js
pnpm check
```

结果：41 PASS / 0 FAIL / 0 SKIP，114759.2729 ms。涵盖候选不自动接受、纠正/忘记、抽取竞争防复活、源消息防伪、同 ID 冒充拒绝、跨进程事务、redo/哈希损坏拒绝、默认文件和进程隐私。守卫核验 400 个运行 JS 文件、0 外部 SDK 导入，并通过生产导入与派生来源哈希清单。

## 扩展扫描失败与反证

`pnpm test:routing`：76 项，61 PASS / 15 FAIL / 0 SKIP，657626.3085 ms。该扫描在最后的授权收紧与新增反例之前启动，不算最终源码完整通过证据；最终源码另有上述 44 项及 guard 结果。

| 类别 | 数量 | 实际失败 |
| --- | ---: | --- |
| `test/pi-router-ledger.test.js` | 13 | 公共完成 helper 未建立可用任务工作区，`task.complete` 被 `TASK_WORKSPACE_NOT_READY` 拒绝；调用经过 `session-workspaces.js` 与 SQLite reducer，未进入本次渠道记忆链路。 |
| `test/pi-resident-router-flow.test.js` 的 receipt echo 用例 | 1 | `Missing expected rejection.`，DWS flags/冲突断言不成立。 |
| `test/task-notification-retry-native.test.js` | 1 | 历史通知任务实际 `active`，断言要求 `completed`。 |

为避免仅凭路径判定“既有问题”，使用测试进程专用 Node load hook：`commands.js`/`service.js` 从 HEAD 读取；Router 只移除本次新增动作/提示并恢复修复前的 scoped lookup，保留本轮开始就存在的 Router 改动。没有覆盖工作树源码，没有关闭 sandbox/工作区就绪门，也没有触碰现用数据。对照仅选每类一个代表：

```powershell
node --import ./docs/tmp/channel-preference-memory-baseline.mjs --experimental-test-module-mocks --test --test-concurrency=1 --test-name-pattern='durable receipt echoes|A completion is not dependency acceptance|a historical frozen start confirmation' test/pi-resident-router-flow.test.js test/pi-router-ledger.test.js test/task-notification-retry-native.test.js
```

结果：3 FAIL，分别仍为同一 `Missing expected rejection.`、`TASK_WORKSPACE_NOT_READY` 和 `active`/`completed` 不符。13 个 ledger 失败共享同一完成 helper，其余 12 个未重复执行基线对照。结论仅为这些失败无需本次学习修复也可出现；本任务不扩大为修复任务工作区、渠道回声或历史通知问题。

本轮过程中，专项最初因缺失 `memory_search` 暴露同链路缺陷并修复；测试自身的无效版本 0 改为合法但不匹配的版本 2，工具事件断言按既有 `result.value` 结构读取。最终专项按同一业务断言完整复验，没有降低断言或跳过反例。

## 边界与清理

- 当前安装记忆仍为 revision 5、5 条 experience、3 个学习 Skill；此次没有回填原历史偏好。现用进程仍需另行授权应用修复并正常重启；不会自动重放已结清消息或补发回复。
- 未运行全仓 `pnpm test`、`test:runtime`、`test:containment`，未做真实模型语义选择、真实钉钉或当前安装部署验收。此次未修改任务执行或 OS sandbox。
- 夹具通过 `t.after` 关闭 Host、HTTP、SQLite 并清理其隔离目录；保留必要文字/JSON 证据，不保留用户数据、凭据、技能正文或整份运行数据库。临时 baseline loader 在证据核对后清理，不作为生产接线或兼容层保留。
- 唯一结果矩阵为 `matrix.csv`，机器可核对摘要为 `round-1/validation.json`。本轮没有历史轮次附件需要清理。
