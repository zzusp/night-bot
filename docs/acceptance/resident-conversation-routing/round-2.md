# 第 2 轮：合同迁接、失败定位与定向复验

日期：2026-11-06。此轮为修复阶段的分批证据，**不是当前版本完整回归通过**。第 1 轮报告和矩阵历史列保留。稳定组另记第 3 轮，不逐命令、重试或分组新增轮次。

## 实际源码与范围

- 分支 `worktree-resident-conversation-routing`；HEAD `eca0df5ed127d8b043ba087291bfb1426d0ca5d6`；团队共享未提交工作树。实现、fixture 和测试在本轮持续变更，不能以 HEAD 代表验证内容。
- 使用 Windows 11、Node 24.19.0、pnpm 11.25.0、官方 Pi 1.5.0、真实 Host/SQLite/native journal、本地脚本模型与假渠道。没有真实渠道、CI、合并或部署。
- S6 仅修改测试、分组脚本和本轮验收记录。产品修复由 Core/Platform/Lead 在各自范围实施；没有放宽版本、权限、manifest、JSON、沙箱或归档守卫。
- 本轮末 SHA-256 快照（只说明阶段末，不冒充各次执行均相同）：

| 文件 | SHA-256 |
| --- | --- |
| `src/channels/resident-router-business.js` | `82e3fa265a3f272891b7fcf9bd710c6f8589a47bd7d88c672ca8e7610598dbdf` |
| `src/channels/router-ledger.js` | `fd5b894db733c82b425fbd08aa11c2029ebb779e97eed8e0e7f0929d0fae06d8` |
| `src/channels/router-lifecycle.js` | `fb0f402967cc9e01840cda190830d51521d5122df508c53df8885fbe7f01bf40` |
| `packages/dingtalk-core/task-session-service.js` | `da4f819d7811ceca3642ea3ca5cb5cb8482ed4b2b5f340fee1758e67a973d4f4` |
| `packages/dingtalk-core/dynamic-task-store.js` | `cf6be603473f30680d6273061f9d62f6ba11d96b3b34073d2f38a73f624d5a8e` |
| `packages/dingtalk-core/group-notification.js` | `1f7cc8fab4d612becf62faf90e71fe7cfce73a1aaa3d73660bc43fbcdc492ed2` |
| `packages/dingtalk-core/platform-notification.js` | `9c662dfb7c26a269f43abcbb9221ab3dbf47b6ea7c21e35a6dbc6eed3ed4c9ce` |
| `packages/dingtalk-core/task-artifact-files.js` | `94610342bdbded5c44a3b15eb1f671ac19f8958ba24dc34ed4f0286a70a8d187` |
| `scripts/test-pi.mjs` | `1714b5b55a74c6fcd38aa775b237e2fe9dfcbdd016e6a84fb28564acc5742e56` |
| `test/fixtures/routing-official-host.js` | `c0d95d73e1736bf498ec32dc6ec039a14ff9cd48fa23884509f4199eb913878e` |
| `test/fixtures/routing-official-model.js` | `908d260d1e972c4b55d24f6a4d0d8b89274307f0c86aa831693a1d90eb915541` |
| `test/task-session-service-native.test.js` | `fc5d033898e1ac1f6ace4896e9f82bf2ca5867416cfec445ad5736e6fbf1f637` |
| `test/fixed-topics-native.test.js` | `4390c50d92fab8608930024ad147a8784f8c0ce77182019012fe7a2dcad64d14` |
| `test/topic-routing-clarification-native.test.js` | `299edf6d31a8fd21f4fd582835fb8acfba729a4d029d4ce52663ff46c278b023` |

## 实跑结果

下列组有重叠、运行版本不同，不能相加为唯一通过用例总数。

| 范围 / 执行标识 | 实际终态与证据 |
| --- | --- |
| 默认 Router A/B `basenhbuj` | 1 PASS，exit 0，62.5s。A 首次完成后按实际证据评估 continue，同目标同 session 返工到 req2，再认可 satisfied；B 仅在当前认可后执行一次。A/B 都 completed、drained，无 split execution。 |
| 账本与升级集中 `bjts3ra5y` | 25/25 PASS。含 22 条 ledger 和 3 条升级：Web 变更/依赖重绑定、arrange 全集/CAS、跨 generation 动作幂等、任务归档来源、junction 外部父链拒绝及零写 check。 |
| 非法交接摘要 | `pi-resident-router-flow` 的空 intent、缺来源引用、UTF-8 总预算三例 PASS；旧代、指针、已消费游标保留，不发布非法 candidate。 |
| 人工事实追问与精确新补充 `bs97hs2f7` | 6/6 PASS，exit 0，143.1s。各追问只发给各自真实来源作者，第三条无关来源不外发；历史/自回声不能成为授权，新补充保留原待答问题、唯一 session 与版本，冷启不重发。 |
| Web 原生回归 `bpy8hqayd` + `b5asux0to` | 前者 8 PASS/1 FAIL；失败是测试复用 requestId 改 body，Host 正确返回 409。改为独立 stale requestId 后，HTTP reopen 定向 PASS。claim 前后 fencing、串行修订/跨任务独立、old drain、材料失败冷恢复、排空后 admission、CAS 均有原生断言；本阶段不冒充同一版本完整 9 例终态。 |
| 当前澄清与职责/完成通知 `buzgp13u3` | 该次共 4 PASS/2 FAIL，exit 1。通过含 delivered/unknown 两澄清冷恢复、配置职责/签名、当前 task.completed 真实查询后结果解释。另两失败为 schema 回执计数夹具和媒体读取，后续分别修复。 |
| 人工 provider 复核、schema 纠错、关闭故障 `btutoq472` | 共 3 PASS/1 FAIL，exit 1。真实 provider 失败来源保持/冷恢复/新真实答复 PASS；同一 Pi journal 内非法分诊 schema 拒绝后纠正 PASS；早期 reflection detach 抛错后仍排空任务/observer/SQLite，最后 AggregateError 含原 fault，PASS。失败为通知冷却时钟夹具。 |
| 默认三旧夹具及通知冷却 `bgv9ii7jd` | 3 PASS/2 FAIL。cold actual native writer、durable channel uncertain-no-replay、固定 Date 的 unknown 通知冷却 PASS。fixture 把常驻 Router 当泄漏及媒体超时失败，后续定向处理。 |
| 历史未发确认与模型选择 `bpy3812ch` | 3 PASS/2 FAIL，exit 1。历史冻结 confirmation 随真实任务完成退休，不回读/重发/重派；默认与显式模型各恰好一次 task 执行，PASS。另两新增版本测试误读外发 envelope 的 payload，改为 deliveryKey 查真实通知后复验见下一行。 |
| 新版来源发送门闩 `bsvyygqeq` | 3/3 PASS，exit 0，65.8s。prepared v1 在 start 前保持，认证同 messageId v2 后旧 transport send=0，直接 store.start 精确拒绝 STALE；unknown v1 仍只回读原收据，不授新 send。另例验证存活 actor 只能是账本当前 activeSessionId Router，任务 actor 已退出。Review 独立回读接受 C1。 |
| Windows 原超时路径 `baqhwg2nj` | 7/7 PASS，exit 0，193.6s。四次显式冷恢复复核、真实 task journal/并行 cwd、崩溃子进程 exit73 后 compaction 冷恢复、原 provider signed failure、两 retry budget 和 cold providerRecovery 保持。使用既有 Windows nativeTestTimeout；复合用例按其实际多次冷启/两个子进程给总预算，断言未删。 |
| 最后附件/媒体原链路 `birot2hzc` | TAP 5 PASS/0 FAIL/0 SKIP，123.1s。平台 all/members 从排期到多次冷启，父说明/两文件最终全 delivered，唯一发送且不重调模型；普通任务真实生成/冻结/查询 IDs 后显式 taskDelivery，双成员父子受众、无隐式 quote、归档后续送、unknown 只回读；图片失败后富化新版、重复复用；唯一 Router actor。**store 起点 2658c752，终点 cf6be603，R12 守卫期间增量，group-notification 未记起点；不当统一版本验收。包装尾命令是 SHA 读取，判定以完整 TAP 计数为准。** |
| domain，Platform 执行 `bmrd4n2hd` | 391/391 PASS，exit 0，无 skip，192.8s；Lead 独立回读。关键五源起止一致。之后受影响通知/文件由 Lead 补验 11/11 PASS，3.93s，和原 391 重叠不相加；后续 R12 修改由原真实 Host 用例及稳定组承接。 |
| containment，Lead 执行 `b01kn7b2n` | exit 0，5 PASS/17 SKIP/0 FAIL，27.2s。Windows 缺 Linux 内核能力；不能写 22/22 或称 Linux containment 已验证。七项源码起止一致。 |
| R12 独立专项 | Core `bjasj8uxo` 1 PASS/17.7s：伪 ID 拒绝、合法 Alice+Bob 唯一送达、同 ID 重试不重发、改受众冲突。Platform 的真实 descriptor/store smoke 另核父子同受众及 recipient/atAll/删除数组漂移在 start 拒绝；S6 不重复该专项。 |
| 来源/import/native guard | Lead 集中更新四项 manifest 后完整 `pnpm check` PASS：53 adapted、404 production modules、0 external SDK/旧编排定义。前一次并发 hash 漂移拒绝保留，不算 guard 豁免。 |

## 保留的失败与修复依据

1. **附件消费者断链**：`b3evsctmt` 普通任务完成、artifactFiles=1，但找不到父说明/子文件。退休 Topic 后 Router 只接受 text。新增 taskDelivery 只选择 query 返回的冻结 artifact IDs；Host 取可信 descriptor/原 caption，校当前来源/需求版本/manifest。平台 artifact 的逻辑 requestId 与物理 session ID 分开；不把冻结当发送。
2. **平台直接附件严格 JSON**：先有 `TASK_ARTIFACT_INPUT_INVALID`，修正逻辑 requestId 后暴露 `fact:undefined` 引起 `DYNAMIC_ARGUMENT_INVALID`。只省略不存在的 fact，不放宽 JSON 守卫。`blu3z63gi` 进一步暴露说明缺文件名/caption；统一复用 prepareGroupNotification。后半恢复由末次 5 例执行。
3. **父子通知扫描未收敛**：`bw3qrnnb8` 0/5；`bn2gdn7bq` 0/3；`bn1b120jm` 两原例仍失败。普通任务初次 whenIdle 时父 starting/unknown、child prepared；平台冷恢复后确认/报告/第一文件已 delivered，第二文件仍 prepared，无 error/alerts。直接来源 gate 提前 return 绕过 afterNotificationId，导致不能 dispatch 的 child 反复占扫描。将持久父 delivered 检查前移为所有通知共用；末次 5 例终态通过。
4. **图片富化旧快照循环**：最初 ingest 漏 readResource/onPhase，重复 source、imageRefs=0。恢复读取和 projected.messageVersion 后，`bn2gdn7bq` 60s 内仍有 104 次真实 channel_triage_submit，全部 ROUTER_SOURCE_STALE。Host 对同 messageId 新版取消并排空旧分诊，用持久最新 pending 重起；普通追加仍≤15，满批时也检查实际新 source。末次媒体用例通过；不是再加预算或让旧版提交。
5. **受众能力回归**：新增 reply schema 的显式受众，按同会话真实成员校验，普通回复不开放 atAll；父子复制冻结受众，store 校精确一致；不默认 quote 或把来源作者附加到显式受众。最终普通附件原用例保留多人父子及冷恢复断言。
6. **测试事实修正**：新人工答复沿用旧时间戳被时间守卫正确拒绝，改用当前真实入站时间；schema 层拒绝不会生成 application tools/result，改读实际 Pi journal 的两次调用与 error toolResult；冷启动真实耗时越过通知 cooldown，改冻结 Date 后显式推进 retryAt；新 durable channel key 包含 messageVersion；只按 task_result 工具集统计执行请求，Router 查询/交接不是第二执行任务。
7. **纯夹具失败**：无效模块名、字符串换行造成的 fixture 语法错误，以及 `bds154i80` shell 解析 exit2 均未到产品验证，不能算产品 FAIL 或 PASS。已修并以实际终态区分。临时媒体诊断钩子曾在 store 关闭后查询而产生附加 cleanup 错误，改用关闭前 onCancel；不归为新的产品 close 失败。

## 旧用例到当前合同的对应

| 原用例/合同 | 当前处理与覆盖 |
| --- | --- |
| 活动 Topic 拆分、Coordinator/Owner、routingHold epoch 写入/重评估 | 明确退役，不保留为可执行能力，不使用 skip 冒充通过；退役 HTTP 三路径 410 且 runtime 零调用。历史 topic-runtime/facts 审计仍留 domain。 |
| Topic 路由中的 claim/replan/material/drain/reopen/CAS | 保留在 task-topic-routing-native 的 9 条真实 Web 回归；不创建活动 Topic。 |
| Topic clarification/source epoch 发送前失效 | 原 hold epoch 退役；直接来源 v1 prepared→认证 v2 的发送门闩、unknown 原回读在当前默认 Router 场景承接。 |
| Topic facts 人工追问与多来源回复 | 改核 task/sourceId/sourceRef/真实作者、每来源独立通知；原待答问题和唯一 session 不变，冷恢复不重复。 |
| 旧分诊重试与错误恢复 | 一级完整 dispositions；非法完整覆盖由官方 schema 拒绝，同 Pi journal 纠正；冷恢复只处理未提交来源，旧来源换版由 Host 排空。 |
| 旧普通回复多接收人/格式化/最终产物 | 当前 resident_router_reply 显式受众及 taskDelivery；原冻结 descriptor/说明、父子顺序、归档后剩余发送、unknown 回读均保留。 |
| 旧 task-associated confirmation 完成后退休 | 显式种历史冻结 outbox/operation 收据，再由真实唯一 task 完成触发退休；不恢复活动 Topic 推理，不把无 task 的 Router 回复当 confirmation。 |
| 旧固定平台问询/到期汇报 | 当前 platform_task_query/platform_schedule_submit 与直接来源通知；两种旧冻结 outbox 恢复独立保留，不重生成；即时查询、不提前发送、到期 fresh query、all/members 与附件冷续均有当前入口断言。 |
| 旧运行请求/actor 总数为一 | 只约束 task 执行一次、无 split execution；同时核 live actor 只能为账本当前常驻 Router，不能删除泄漏断言或把合法 Router 算作任务重跑。 |

`scripts/test-pi.mjs routing` 现在指向实际 resident/triage/ledger/E2E/upgrade，加保留 Web、直接澄清、退役 HTTP 和历史可靠通知组；未用 skip 保留活动 Topic 推理。

## 诊断组和在途状态

- 第 1 轮的 `b9wondzb5` 旧完整 runtime 已停止，非 PASS；旧 E2E/close 诊断 `b62vpps2r`、`bf3i6zb7l`、`b5dmxmomh`、`b1y0dd6tc`、`brxvnyg7b`、`bvi9rjfs9` 均已停止，不再 RUNNING。
- `bumfcvk7m` 旧 `pnpm test` 已停止，出现 cold writer、durable channel、shared fixture 三失败；无最终 suite 统计，不能报默认组通过。随后相关三夹具均有定向修正/复验证据。
- `bp0zh7dn7` 九文件 runtime 部分组自然 exit1：84 tests，64 PASS/3 FAIL/6 CANCEL/11 SKIP。两 FAIL 是把合法 Router 轮次算进 task 请求；另一 FAIL 是崩溃子进程 15s 限时；6 CANCEL 为旧裸超时。修正后定向 7 例与模型选择两例通过，但不是完整 runtime 终态；skip 保留为实际平台条件，不补造通过数。
- 稳定组 `bui9nxa82` 已启动，顺序为 `NIGHT_BOT_TEST_CONCURRENCY=2 pnpm test:routing` → `pnpm test:runtime` → `pnpm test`；每组打印全源码集合聚合 SHA、关键源 SHA 和实际 GROUP_EXIT。本轮不提前计通过，第 3 轮接回完整终态。其输出目录为本会话宿主 tasks，ID 为检索入口；本报告已保留本阶段必要文字证据，不将大型循环日志复制入 Git。
- 真实模型尚未调用。已按 goal 的既有授权由程序只读配置结构；只输出字段名/类型，没有配置标量、地址、模型 ID 或密钥输出，秘密文件未写。真实模型结果须独立记录，不能由脚本模型外推。
- 没有 commit/push/PR/CI/merge/deploy。未建立 report.md。自然结束的测试按真实 cleanup 钩子关闭 Host/数据库并清理工作目录；已停止诊断的旧资源不据此推定全已清理，后续仅凭准确归属核对，不清全局 Temp。本轮无须保留截图或旧 binary 附件，原轮次报告不删除。
