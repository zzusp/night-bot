# 后台压缩审查修复：第 1 轮

## 范围与源码

修复 PR #170 审查的八项问题，保留 500K 目标、60%/80% 水位、独立无业务工具候选、原 journal 追加提交及 Pi 原生投影；不合并、不部署、不发真实消息、不触发 CI。

- 起点：`8757f182168a1a116f1dec99ac40975345205284`。
- 已整合并再次 fetch 核对 `main`：`a8377ee319589df3dd0f5fe40376bd0fb84436f8`。
- 最终生产源码及测试：`803f60ee7e09ef0a166de0cccf8916f6da9ec500`，包含 `2f18fe9` 的八项修复及 `5d84528` 的指标断言修订。该版本上 `git diff HEAD -- src test` 为空。
- 最终验证时工作树只有 README、Windows 运维说明及本验收目录文档待提交；后续文档提交不改变生产源码。完整初跑从已整合 main 的本轮修复工作树开始，不是最终源码全组验收，不能只用当时 HEAD 表示。
- Windows 11、Node 24.19.0、pnpm 11.25.0、Pi 1.5.0；独立 worktree 按锁文件安装，无主仓 node_modules 链接，无真实配置、账号或业务资料复用。

## 结论

八项修复及关联小窗口回归均有通过证据；最终集中回归 183/183，失败路径复验通过。完整 routing/runtime 初跑有失败，未改写为最终 head 全组通过。runtime 另有 12 项既有 Linux 专属跳过；真实厂商延迟、首答性能、全项目及跨平台验收不在本轮结论内。

## 用例与关键证据

| 审查项 | 修复与实际观察 |
| --- | --- |
| 图片错误恢复 | 请求先以 IMAGE_OFFLOAD_REQUIRED 拒绝且零 provider 调用；修正同一策略后，新纯文本 admitted。旧图片仍在原 journal，不删除历史绕过策略；永久持久化/权限栅栏保持。 |
| 活动 steer 容量 | 非 idle 时仍拒绝超大包且不手动 compact，普通 steer 接受，耐久 pending 未丢。 |
| 已越水位历史 | 历史已过前台水位仍调用原生 compact；复核仍放不下则拒绝，不截断或消费正文。 |
| 系统/工具预算 | 计入当前工具、合并后的系统增量和首次 Night sections/资源提示；首次超限正文未写入 Pi。真实长提示 + 合法近窗口输入 admitted，未重复计量系统提示。 |
| 取消与关闭 | 在 compact 尚未安装取消 token 的窗口取消/close，开始事件再次中断；零摘要 provider、无 compaction 写入、pending 保留，关闭能排空，owner reason 保持。 |
| 业务观测归属 | 原包 previous 后先压缩再投递 next；业务 runId 仅 next、model-started 仅一次且有 run-settled，摘要不锁定旧 runId。 |
| Router supplements | 超限补充在 beforeStart/claim 前拒绝：领取零次、无 claim、无新正文/补充 admission，原包不变。多包容量包括两条控制正文。 |
| 幂等与授权 | 授权/去重先于预检；失败无正文且 pending/current 不变；同 ID 并发预检一次。普通重复、已接纳命令、不确定冷命令均不预检；等待期间撤权或取消后零 SDK 正文。 |
| 关联小窗口 | 32K 窗口真实 SDK 压缩后能接纳 next，恢复 keepRecentTokens=7808；provider 失败也恢复原有效设置。重开任务及 32 条来源续办保持原会话与单次效果。 |

测试定位：`test/pi-official-session.test.js:106`、`test/pi-official-session.test.js:191`、`test/pi-background-compaction.test.js:118`、`test/pi-business-admission.test.js:116`、`test/pi-skill-command-input.test.js:36`。

## 实跑结果

| 检查 | 结果与版本边界 |
| --- | --- |
| 最终集中回归（16 个文件） | 183 pass / 0 fail / 0 skipped，76.77 秒；最终源码 803f60e。覆盖候选/Host 接管、分诊冷恢复、Router 原生压缩、admission、会话、图片、观测、权限、持久化和冷效果恢复。 |
| pnpm test:routing 初跑 | 179 pass / 1 fail / 0 skipped，988.12 秒；cold one-turn triage 资源计数仍要求 2，实际 3。不是最终源码全组重跑通过。 |
| 冷分诊失败场景复验（5d84528） | 1 pass / 0 fail / 0 skipped。精确检查首次预检、before-run、turn-end 共三次 instructions/skills，创建期不加载、后两阶段各一次；冷重启指标相等且无新 provider 请求。 |
| Router 技能热刷新专项（2f18fe9） | 1 pass / 0 fail / 0 skipped；同一批次及四条后续输入结清。 |
| pnpm test:runtime 初跑 | 147 pass / 3 fail / 12 skipped，1125.10 秒；两项容量失败、一项定时报告超时。不是最终源码全组重跑通过。 |
| 容量失败场景复验 | 2 pass / 0 fail / 0 skipped，351.36 秒；最终源码 803f60e。普通消息重开沿原 session；32 轮实测 leases=32、businessCalls=33、officialSummaryCalls=23、nativeCompactionEntries=11。原 write、effect-intent、effect-result 各一次，文件 exactly-once，32 个 lease/source 及原 journal 物理证据保留。 |
| 定时报告隔离复验 | 1 pass / 0 fail / 0 skipped，28.26 秒。真实 Host/SDK + fake DWS：原排期、确认、正文和双附件 ACK/回读跨冷重启恢复，不重复发送，自回声过滤保持；无调度源码修改。 |
| pnpm check | 最终源码通过：190 retainedModules；453 productionImportFiles；relativeImports=closed；externalSdkImports=0；legacyOrchestratorDefinitions=0；来源/hash/native guard 保持。 |
| git diff --check | 通过；未跳过 hooks、放松沙箱或修改真实模型窗口来通过测试。 |

集中回归命令：

```sh
node --experimental-test-module-mocks --test test/pi-background-compaction.test.js test/pi-background-candidate.test.js test/pi-background-host.test.js test/pi-persistent-triage.test.js test/pi-router-native-compaction.test.js test/pi-business-admission.test.js test/pi-skill-command-input.test.js test/pi-official-session.test.js test/pi-agent-observation.test.js test/pi-official-context-hooks.test.js test/pi-official-agent-factory.test.js test/pi-official-durability.test.js test/pi-request-image-budget.test.js test/pi-official-context.test.js test/pi-native-job-reconciliation.test.js test/pi-task-effect-reconciliation.test.js
```

失败路径分别用 `node --test --test-name-pattern=...` 复验 `test/pi-resident-router-flow.test.js` 的 taskless persistent triage、`test/task-session-service-native.test.js` 的 Router reopens / 32 source-authorized、`test/fixed-topics-native.test.js` 的 native due members report；冷分诊另带 `--experimental-test-module-mocks`。未重新执行无相关变化的其余初跑通过场景，最终集中回归覆盖实际受影响的压缩链。

## 本轮失败与修复

1. 首次提示估算需提供空 content；修正后真实会话通过。新增 await 暴露并发预检窗口，通过二次等待共享 preflight 恢复单次压缩/提交屏障。
2. 新预检更早拒绝首次分诊撤权，memory.beforeRun 应为零；保留创建期 lazy 合同，增加 pending 与零正文断言。首次资源计数由两次变三次的旧断言同步更新，没有放宽权限检查。
3. 原生 AbortError 曾覆盖 owner reason；该分支回读原信号原因。合并系统增量替代重复累加，真实合法近窗口输入通过。
4. 小窗口反证：available=15616、fixed=8277、history=7683、incoming=149、keepRecentTokens=7808。原生认为历史过小而不能切分，但固定提示 + 历史已满。通过官方 SettingsManager.applyOverrides 临时将近期保留量限制为扣除固定提示/新输入后剩余的一半，另一半留摘要；finally 恢复原有效配置，压缩后仍严格复核。重开夹具此前未提供摘要响应，现显式提供脚本化原生摘要；业务和 no-replay 断言未删，没有放大窗口或删除历史。
5. 定时报告初跑未在期限内看到 due prepared，诊断 tools/errors 为空；同一场景隔离复验通过。最初并发运行时超时的具体原因未收敛，不声称修复了调度时延。

## 跳过、未执行与遗留

- runtime 12 项跳过均要求 Linux portable model-process privacy namespace：串行进程结果、提升前台/后台进程、两种终态收据、两种后台 HTTP 服务、前/后台取消、冷重启原终态、活跃 preserve、服务取消实际进程。Windows 保持既有 fail-closed，未记为 PASS。
- 未完整重跑最终 head 的 routing/runtime 全组，未跑全项目 pnpm test、containment 或真实厂商/渠道验收；未改变 OS 执行边界，不用本轮结果替代这些结论。
- 500K 扩预算与后台执行收益分开评估，脚本模型不证明真实首答/压缩延迟或成本。不可切分大轮次/过长摘要仍可能明确超限，pending 保留。
- 无新增依赖、环境变量或数据迁移；未复制私有 Skill/凭据/业务资料，未改主检出或运行实例。
- 原始中间日志在本报告和最终摘要核对后清理；保留本报告、matrix 历史及 `round-1/final-test-evidence.txt`，不保留逐命令流水。
