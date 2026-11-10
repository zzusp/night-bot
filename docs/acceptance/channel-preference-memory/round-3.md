# 长期偏好上下文与主体：第三轮验收

## 结论

本次“补缺口”已补齐原话之外的来源背景、原提出者、场景与边界，覆盖写入、持久化、字面检索和召回；解释明确标为 inference，不冒充用户逐字原话或新的授权。现用正式条目也已通过受控事务更新，独立只读核验 scope revision 6→7、条目 revision 1→2，原话、身份、创建时间、原来源及其他 5 条记忆未被本操作改变。没有部署、重启、重放历史消息或真实渠道发送。

最终受影响路径：存储 14 PASS，真实 Host/Pi 专项 4 PASS，含 15 组授权/上下文检查。扩展回归先执行 55 项：54 PASS / 1 FAIL，其中记忆/官方隐私 30 PASS，完整 Router 流程 24 PASS / 1 FAIL。唯一失败是既有回声用例 `Missing expected rejection.`；用最新 main 原实现加载对照仍在同名同断言失败。不扩展修复旁支，不宣称全仓/完整路由全绿，不生成全绿 report.md。

## 源码与验证阶段

- 日期：2026-11-10；Windows 11、Node v24.19.0、pnpm 11.25.0。
- base：`e13b057723faf7fe984a46242d7f7e15fbe74abf`；分支：`worktree-channel-preference-context`。PR #39 已合并，后续改动不能再推送其 head。
- 受验的是最新 main 加工作树增量，不是单独 HEAD；测试时尚有未提交的 main 整合。最终源码/测试逐文件 SHA-256 见 `round-3/validation.json` 的 `sourceSnapshots.final`；最终源码差异 SHA-256 为 `4ebb99a1ce914fe936c5105dec40cf04b2ce74134813a5f60d4ac3c1fe635fea`。
- 55 项扩展回归结束后，只补充了背景消息 ID 的秘密拒绝，以及原生 memory_remember 从当前已接纳消息读取引用的接线，并修改相应测试；随后最终版本重跑全部 14 个存储用例及 4 个 Host/Pi 专项。旧扩展回归的独立指纹保留为 `regressionBeforeFinalBoundaryFix`，不冒称 55 项都在最后两行变更后重复执行。
- `pnpm check` 在最终边界修复后通过：414 个运行 JS、414 个生产导入文件、0 外部 SDK 导入；来源哈希、生产导入与原生运行边界守卫通过。

## 实现与可观察证据

1. 原话 text 不改写。背景仅保存 Host 在直接原文/引用中逐字匹配的最小片段，附来源消息及哈希；片段存在不证明引用所述业务事实真实。未提供背景时为 unavailable，未指定解释的历史/普通显式偏好不补造场景。
2. 场景和边界明确为 inference，主体从已认证原提出者绑定；不能由模型传入主体。所有上下文文本及背景消息 ID 继续检查秘密。Context 纳入内容哈希、版本更新、字面场景检索及遗忘清理。
3. 共享可读与个人适用分开：同作者的新会话返回 matching-subject；另一作者仍能检索，但返回 reference-only。真实测试在第一作者的召回尚未结清时持久排入第二作者，确保二者在同一物理 Router 中连续处理；第二作者看到的历史工具结果也重新标为参考，记忆 revision 未改变。
4. 当前明确要求文档的消息保留在实际模型请求中，系统规则明确当前要求优先；旧偏好边界明确保留所需成果文件、其他附件和内部证据。本地脚本模型验证请求与元数据接线，不声称真实模型语义选择或真实文件交付已经验收。
5. Router 结清后会进入无工具 handoff。调查实证当时 id/generation 相符而 phase 为 handoff；召回不再有可适用人类来源时返回参考，不应复用写入 active 守卫中止交接。写入的当前批次、版本、撤权、read-only 等守卫没有放宽。

最终 Host/Pi 诊断摘要：

```json
{"contextVerified":true,"scenarioSearch":true,"subjectApplicability":["matching-subject","reference-only","matching-subject"],"historicalResultRebound":true,"currentDocumentRequestPreserved":true,"coldRestart":true,"replayWrites":0,"realVendorMessages":0}
```

## 实跑结果

| 检查 | 结果与范围 |
| --- | --- |
| 扩展记忆/官方来源、抽取及隐私回归 | 30 PASS；使用本地 HTTP 脚本模型、真实默认 Host/Pi、事务和隔离目录。 |
| 完整 pi-resident-router-flow | 25 项：24 PASS / 1 FAIL；包含本任务 3 个 Router 专项。与前项同一进程执行 55 项，547313.3583 ms。 |
| 最终 pi-memory-store | 14 PASS / 0 FAIL / 0 SKIP，6009.9936 ms；含背景消息 ID 秘密拒绝、内容篡改、场景检索、纠正和遗忘。 |
| 最终 Host/Pi 专项 | 4 PASS / 0 FAIL / 0 SKIP，179746.162 ms；3 个 Router 用例及 1 个原生工具用例。15 组授权反例、当前原生引用、read-only、主体切换及冷启动均通过。 |
| 最新 main 回声对照 | 1 FAIL，19041.1388 ms；同名用例及同一 Missing expected rejection.。这是失败的复现证据，不记作产品测试通过。 |
| 最终 pnpm check | PASS；414 个运行 JS、0 外部 SDK 导入。 |

命令：

```powershell
node --experimental-test-module-mocks --test --test-concurrency=1 --test-reporter=tap test/pi-memory-wire.test.js test/pi-memory-official-source.test.js test/pi-memory-official-extraction.test.js test/pi-evolution.test.js test/pi-official-memory-privacy.test.js test/pi-resident-router-flow.test.js
node --test test/pi-memory-store.test.js
node --experimental-test-module-mocks --test --test-concurrency=1 --test-name-pattern='explicit channel preference|channel memory rejects|read-only Router reports|native memory tool accepts context' test/pi-resident-router-flow.test.js test/pi-memory-wire.test.js
pnpm check
```

回声反证使用测试进程专用 Node load hook，将 format/store/service/tools 与 Router 五个生产文件从上述 main 提交读取，不覆盖工作树；同一假渠道用例再次在 `test/pi-resident-router-flow.test.js:264` 失败。加载器最初的路径分隔符转义错误已修正，解析失败不作为产品反证。首次上下文 schema 也曾不符合现有工具 DSL，已改用既有编译器；没有新增 schema 适配平台或降低断言。

## 现用条目与边界

补充操作先逐字核对原来源与引用，再以 requireComplete 和显式 portable codec 严格解码 Pi journal。--check 未创建锁或目录；独立比较记忆与维护审计目录全部文件字节不变后，才通过 MarkdownMemoryStore.remember、新操作 ID、expectedRevision 与 scopeRevision 提交。独立只读进程再次核验上下文哈希、原话、条目身份、原来源和其他 5 条记录；最终新校验下仍可完整读取。

原例是结果汇报已说明完成情况又额外附了报告。保存的边界是：面向原提出者的后续工作汇报，未明确要求时不额外附报告；明确要求的文档、文档本身是约定成果的文件仍须交付；不禁止全部附件或内部证据，不推广给所有用户，当前明确要求优先。这些归纳标为解释，背景只保留最小逐字来源片段。

私有数据与维护回执留在忽略的 data/memory、data/logs，未提交原消息、身份、完整引用或运行数据库。没有触碰其他会话的业务数据、技能或未提交源码。当前进程尚未部署新代码，不能将条目已补齐等同于新召回/写入逻辑已经在现用进程启用。

本轮未运行全仓 pnpm test、test:runtime、test:containment 或完整 test:routing，未做真实模型语义、真实钉钉、部署/重启验收。上轮完整路由 61 PASS / 15 FAIL 的历史事实仍见 round-2.md，不当作最终版本全量扫描结果。

## 归档

唯一矩阵为 matrix.csv，最终机器摘要为 round-3/validation.json。轮 1/2 的报告与矩阵结果保留，旧轮机器附件按收尾规则清理并在原报告注明；最终只保留本轮支撑结论所需证据。临时加载器、补记脚本、原始测试日志和文档补丁在本轮收尾清理；私有操作回执保留，不复制进 Git。
