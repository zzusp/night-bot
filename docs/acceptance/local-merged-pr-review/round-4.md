# 第四轮：停机批次续办、无备份迁移及正式部署

## 结论与范围

本轮 **Router 故障修复、合并、本地部署及原群实质反馈送达已验证**。整体仍为 **DEPLOYED_WITH_ISSUES**，不写全绿 report.md。

正常停机时已接纳的 Router 批次能沿原会话续办；较新取消/延期先被真实接纳。首答独立送达后的回执变化不再被当作业务输入变化。实际原 4 项事件均 consumed，原中止调用未重放，延期发布约束保留；原群收到外部字段缺少目标选项的实质回复，已有后续。

初始04:20Z检查点未将Project状态修改作为完成项（其后完工/送达见最终回读）：Bot 当时查到共享字段缺少目标选项，未擅自扩充字段，并将阻断反馈送达。随后原群又有新的真实输入，Bot 继续正常处理。本验收不把新的群消息当作 CLI 助手跨仓修改、发布或代办授权，也不把首答/接纳/调度当作外部业务完成。

## 版本与 Git 状态

| 交付 | 实测或合并版本 | 真实状态 |
| --- | --- | --- |
| 停机续办及接入状态修复 | 原实现 `971da321ad2874a732136b9cd518452003a3e527`；PR #100 合并 `de3378b32c3b9f6447e4a2bfed11b7b3bbf9cde8` | MERGED，2026-11-13T03:08:42Z |
| 显式无备份迁移 | `e05820cfbddff8976b0ff5f19613bc1d731e2580`；PR #105 合并 `47ff4c10ca3240c9f717bb0ba8ee42eb42bbf5eb` | MERGED，03:43:35Z |
| 独立首答进度身份修复 | `086abdfa22d870fbab0cffe561d975bc3cf73ae1`；PR #106 合并 `0fa0c4f83bd8a3178e4ac13517a9d3b5fef9ae3c` | MERGED，04:02:34Z |
| 最终本地发行 | `0fa0c4f83bd8a3178e4ac13517a9d3b5fef9ae3c` | 正式运行；合并后部署及04:20Z fetch核验时为最新main |

每次合并后重新 fetch，以当时最新 main 建独立干净发行。已整合期间主线的技能 SQLite 退役等变更，没有恢复旧实现。最终证据归档使用新分支 worktree-local-router-evidence；没有向已合并 PR 的分支继续 push。

归档期间主线新增PR #107（e63510d）：仅AGENTS/README及通用工作日志技能，未改本轮运行代码。已fast-forward整合归档分支，不为无关文档更新重复停机；实际运行仍明确绑定0fa0c4f，不冒称包含后来的技能。

单测执行时含本轮未提交源码/测试增量，通过后提交。完整 109 项路由结果绑定 PR #100 原恢复实现，不覆盖后来首答并发修复；后者在最终源码上另跑 9 项身份及 9 项恢复/投递专项。PR #105 到最终发行之间，记忆迁移源码及测试没有增量。

最终源码 blob（不以文档提交替代已测源码）：

| 文件 | blob |
| --- | --- |
| src/channels/router-lifecycle.js | 34d37dbc108f32a8fb5c8432eaf4dafe4b61b72f |
| src/pi-official-agent-factory.js | 6208d38d9c8b5e8175dac5e4b57ab7a577115e99 |
| src/runtime/pi-official-session.js | 451dbc4fd442df951ec1354977cee73956faf8c4 |
| test/pi-resident-router-flow.test.js | 436fa2ad641253826a0aa67c38d932617e893066 |
| src/memory/layered-migration.js | 2a06fa46ac856945f42efc389e7e964750b8e632 |
| test/pi-memory-layered-migration.test.js | 6f649dae2a44202b94dede8546b0766a37b8077f |

## 根因、修复和反证

1. Pi 1.5.0 在 assistant 最终 stopReason 为 aborted/error 时先结束，不派发该条生成的 toolCalls。原合同只支持 error 且拒绝新 pending，无法处理正常停机后尚有取消/延期的批次。修复只豁免最终 aborted 生成中的未派发调用；保留早先失败/未知工具、owner、来源版本、一次 claim、15 条用户消息/30 事件及字节预算。先持久 claim，再由原 admission 接纳真实补充输入；不重新 enqueue 原 packet、不补造 toolResult。
2. 新版 Store 要求 layout4，安装仍为 layout3；真实初始化错误 MEMORY_LAYOUT_MIGRATION_REQUIRED，上层表现为 channels.plugins 不可用。正式离线 CLI 增加显式 --no-backup，仅支持 v3→v4 元数据升级；默认备份合同保持，日志保存源哈希和新元数据，scope 最后提交。不吞错、不直接改版本、不保证无损回退 v3。
3. 首答在原 packet 写入后独立送达，inbox 通知进度变为 delivered 并新增回执；正文/来源未变却被误报 ROUTER_PACKET_ID_CONFLICT，外层为 ROUTER_BATCH_UNSETTLED。只在比较副本排除 triage-reply 已知发送/回读生命周期字段；ID、kind、冻结载荷/摘要、来源版本、撤销及未知字段仍强校验。原 packet、历史和账本不改。

反证：真实正常关闭的本地 Host/Pi 用例先重现 2 pending 而非 0；身份单测和晚到首答并发先红后绿。失败工具、重复领取、分页外31项输入、无关会话错误、冻结回复/来源变更仍拒绝。不按群正文特判，不以 full 模式绕过隔离。

## 本地验证

| 检查 | 实跑结果与证明范围 |
| --- | --- |
| pnpm test:routing，PR #100 原恢复源码 | 109/109，0 fail/cancelled/skipped，1163745ms；非最终并发增量全量复跑 |
| node --test test/pi-official-agent-factory.test.js，整合主线后 | 13/13；资源准备/claim 已提交时正常关闭 |
| 原恢复过滤专项，整合主线后 | 7/7；取消先接纳、已送回复不重放、失败工具拒绝 |
| node --test test/pi-source-stage-timing.test.js，最终修复 | 9/9；进度可变，冻结身份仍强校验 |
| pi-resident-router-flow 恢复/未知首答/冷去重过滤专项，最终修复 | 9/9；含 late-triage-receipt；真实 Host/Pi 加 fake transport；0 fail/cancelled/skipped |
| node --test test/pi-memory-layered-migration.test.js | 33/33，76220.692ms；默认备份、只读CLI、三个子进程中断续写边界、五类篡改及锁/策略冲突 |
| memory-store / memory-progressive | 29/29；共享隔离、来源、忘记、事务及渐进读取 |
| 技能 Host 冷启动不写退役数据库 | 1/1；未恢复旧 SQLite 写入 |
| 技能链接盘点 | FAIL / ENVIRONMENT_BLOCKED：Windows fixture 建 symlink 报 EPERM，在产品调用前失败；31项组合30pass/1fail，不算skip或通过，不放宽沙箱 |
| pnpm check 与 git diff --check | PASS；190 retained、439 production/runtime JS、externalSdkImports 0、relativeImports closed |
| 最终独立发行 frozen install、来源/import 守卫、Web构建 | PASS；index-DdnV-4Vf.css、index-CjlLPQ2C.js；大于500kB chunk提示保留 |

普通排障/重试没有拆轮；链式命令曾因失败而未执行的工厂/恢复检查，之后独立补跑通过。未重复无相关变化的整套测试，不将平台不可用检查算作通过。

## 正式迁移、停机与启动

时间均为 UTC。按 Windows runbook，风险动作先 --check 零副作用预检；保留原 full 权限、渠道实例、账号及安装 data，仅精确修改发行插件目录。模型凭据通过原配置声明的 OS 用户引用加载，不输出值、不写源码/URL/参数、不复制其他账号。

- 03:46:34.398Z：已合并47ff4c1发行的官方迁移完成。version2、layoutVersion4、backup null、31 entries、0 candidates、revision42。离线独立回读：39份保留文件字节不变、无新增备份、pending journal删除。
- backups 原已有一项，未删除/新增，不能说备份目录不存在。后续部署只检查 already-layered，不重复 apply。
- 04:06:41.180Z 正常 IPC 停机中间47ff4c1；04:06:44.038Z 独立核实旧三进程退出、metadata由监督器清除、19198/3080释放；未强杀/删锁。
- 最终监督器先 --check 再 --run；04:11:24.215Z resident/Web均HTTP200。停机请求到HTTP就绪约283秒，包含严格恢复；不等于外部业务完成。
- 04:22Z 独立核实 metadata.release 和 supervisor/launcher/core 命令行均为最终发行；该时点 PID=131808/125748/7568，仅为本轮观测。
- 运行后回查：38/39文件仍与离线基线一致，唯一变化 installed-previous.json，mtime=03:46:59.056Z，发生于迁移后的启动阶段。现有 InstalledSkillPrevious.start()/scan()维护技能快照；不把运行更新归因于迁移，也不声称上线后39份永远不变。单条记忆、来源、旧topics及退役SQLite仍原字节，未新增备份。

## 最终真实页面与渠道

Edge 登录正式3080页面，无route mock、测试消息或额外模型探测。首次过早打开曾 ERR_CONNECTION_REFUSED；等待器确认就绪后重试成功，保留首次失败事实。

| 实际点击刷新 | cache.updatedAt | stale / refreshing / error | 独立 Store计数 |
| --- | --- | --- | --- |
| 1 | 2026-11-13T04:13:03.924Z | false / false / null | 31已应用，0候选 |
| 2 | 2026-11-13T04:13:13.715Z | false / false / null | 31已应用，0候选 |

两次均ready；截图已打开查看，页面、卡片和列表正常。12/12目录技能可用，inventoryComplete=true。usageCoverage仍partial：68 sessions discovered、63 read、8007 entries，原因为 SESSION_BYTE_LIMIT / SESSION_UNAVAILABLE，不宣称调用统计完整。私有截图不提交/发布。

04:22:17Z 认证 /api/channels 只读回查：两路真实钉钉均 connected/listening、ingress receiving、errorCode null、liveApplied true、restartRequired false；Web connected。原普通增量误报修复有6/6 fake DWS回归，最终实际接入正常；单次取样不证明未来永不掉线。

## 原群业务终态与 no-replay

最终只读验证使用 SQLite readOnly 和正式发行 decodePiJournal，显式 portablePaths、requireComplete=true。没有编辑运行账本、journal、通知或来源。

04:20:18Z 独立断言通过：

- 原23条Pi entries前缀hash与部署前相同，generation42原会话保留。
- 原packet/business-input唯一；resume claim恰好一次，准确绑定原failed entry。
- 原packet与紧随claim的补充packet精确覆盖原4事件，3项较新来源/版本真实入历史；每个原事件只 admitted 一次。之后4个合法业务输入为任务事件/新真实群输入，不当作原批次重复。
- 原4事件均consumed；当时cursor90、pending0、最后assistant stop。这些仅作状态旁证，不替代业务送达。
- 原aborted toolCall没有新toolResult；稳定operation在actions/operations/task-events均无执行记录。原生产发布任务仍completed、requirementRevision6、controlRevision5，与部署前一致，未重放过期发布。
- 第四项最新版来源精确关联回原任务。04:12:11.025Z substantive Router回复为delivered，存在厂商回读的真实messageId、conversationId及sentAt/observedAt，不止发送受理openTaskId。内容说明“字段缺少目标选项，尚未修改，生产继续暂缓”，请求共享字段变更许可。
- 随后真实群追加输入的首答在04:14:32.009Z也delivered；对应任务revision4仍active。新需求独立处理，不声称其外部工作完成。

“首答后没有后续”的恢复故障已闭环；Project状态更新本身截至检查点没有完成证据。未发送人工真实测试消息，CLI助手未直接操作外部业务仓库代办。

## 归档结束前的最终业务回读（04:34Z）

新的真实群输入由 Bot 正常继续执行，04:29:40.904Z 原关联任务以 requirementRevision4 / controlRevision3 完成，drained=true、recovering=false，先前字段缺失问询已 superseded。Host 完工记录保留字段及目标值独立回读证据；04:30:47.970Z 最终结果回复 delivered，另有真实厂商 messageId 和 observedAt，明确目标条目已设为待发布，生产继续暂缓。CLI 助手只读既有 Host 完工/送达账本，没有直接调用外部业务 API；外部看板本身未由 CLI 再独立复核。

该真实业务终态补齐了前述04:20检查点尚在进行的部分，不删除当时等待/未完成的历史。04:33:59Z 正式版本与三个进程仍存活，Web200；resident恢复告警已从2降为1，只剩独立旧未知写任务，无ROUTER_BATCH_UNSETTLED。原“首答后无后续”链路及关联任务最终结果均已真实送达，不用早期starting状态作最终结论。

## 保留问题与收尾

- 最终resident仍degraded、recoveryIssueCount1，仅独立旧未知写效果保留；前轮正式inspect为TASK_EFFECT_DRAIN_CUT_CHANGED，未close/重放。不宣称整机全健康，外部业务证据级别见最终回读。
- 第2轮的1024px横向溢出和深色待办对比度问题，本轮未修改或复验；历史FAIL保留。usageCoverage partial保留。
- 主仓已有改动指纹仍与开工基线相同。只提交通用源码/文档，不提交运行数据、群正文、凭据、私有技能或安装截图。
- 最终证据为本报告自包含文字摘要及matrix.csv；历史轮报告保留。收尾统一清理本任务不用的临时脚本、私有截图及中间发行，保留现用发行、监督器、安装data和其他会话文件。私有基线/截图不作为仓库附件引用。

独立旧任务后续需取得符合当前owner/增量切点的正式效果证明，不能以本次Router恢复成功代替未知写结清。长期目标保留遗留项，本次停机恢复修复不因无关问题重新扩大范围。
