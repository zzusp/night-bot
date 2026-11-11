# Router 记忆与 Skill 维护目标

> 状态：完成，PR #64 已合并；本地七条记忆与三个学习 Skill 更新、回读通过
> Goal ID：router-learning-mutations
> 最近维护：2026-11-11T12:45:34Z
> 权威目标：goal.md

## 总目标

由 Router 决策并直接完成记忆、学习 Skill 的增改删，移除 Router 路径的话术授权门槛，保留 Host 的认证、来源/版本、权限、秘密、范围、事务与 no-replay。用户强调 Router 是整个 Bot 的大脑。此前已按授权合并、部署并验证记忆与 Skill 增改删，两项 Web 续修已进入主线。上下文记忆先经 PR #59 交付和本地两条维护；最新按用户要求经 PR #64 改为 Summary/Why/How to apply 三段无推测，已更新本地七条记忆和三个学习 Skill。禁止扩大为历史失败消息重放。

## 完成条件

Router维护合同、对应本地回归与独立PR完成；已授权的上一轮合并部署与真实CRUD据实记录。上下文与轻量记忆需通过真实本地Host/Pi持久化、冷恢复、来源拒绝反例、详情与差异回读；最新三段无推测、七条本地维护和 Skill 描述/正文需有独立回读；完整套件既有失败单列。代码完成不等于上线，旧unknown不改写或重发。

## 范围与约束

当前追加授权为 Router 与任务沉淀记忆改用三段必填、不写推测；更新本地已有七条记忆，并精简学习 Skill 正文、将适用条件接入 description。按本地约定不创建备份，保留 data、凭据及其他工作；不发真实渠道消息，不处理旧 unknown，不部署远程环境。用户先后明确授权合并 PR #59 和 PR #64 并完成相应本地更新，均已执行；不扩展为其他 PR 合并或远程发布授权。

## sub goal matrix

| ID | 子目标 | 完成判据 | 状态 | 证据 |
| --- | --- | --- | --- | --- |
| SG1 | 明确职责、复用与安全边界 | 明确 Router 和 Host 职责 | 完成 | ../../spec/router-learning-mutations.md |
| SG2 | 实现 Router 记忆与 Skill CRUD | 实现来源绑定增改删 | 完成 | src/channels/resident-router-business.js；src/memory/service.js、reflection.js、evolution.js |
| SG3 | 完成真实 Host/Pi 回归与源码守卫 | 真实本地回归及守卫通过，基线失败单列 | 完成，完整套件既有失败保留 | [round-1.md](round-1.md)、[matrix.csv](matrix.csv) |
| SG4 | 同步合同、审阅差异、独立 PR | 合同同步且 PR 可审阅 | 完成，PR #57 已合并 | [PR #57](https://github.com/zzusp/night-bot/pull/57)，合同与运维说明已同步 |
| SG5 | 正式镜像发布与生产部署 | 已合并产物按 digest 部署并回读 | 完成 | [round-2.md](round-2.md) |
| SG6 | 真实 Router 记忆与 Skill 增改删及测试数据清理 | 六项真实持久化、测试数据清理且缺口单列 | 6项持久化通过；Web送达/展示另有失败 | [round-2.md](round-2.md)、[matrix.csv](matrix.csv) |
| SG7 | Web来源身份映射与Skill支持判定续修 | 两项 Web 修复、本地终态验证及独立 PR | 完成，PR #58 已进入本轮主线基线 | [round-3.md](round-3.md)、基线 46a64f5 |
| SG8 | Router 上下文提炼式四维记忆 | 提炼内容、逐项证据、适用范围及隔离回归通过，独立 PR 交付 | 完成，PR #59 MERGED；完整路由基线失败保留 | [round-4.md](round-4.md)、[matrix.csv](matrix.csv)、[PR #59](https://github.com/zzusp/night-bot/pull/59) |
| SG9 | 本地部署并更新两条旧记忆 | 已合并版本正常排空重启；两条记忆内容、来源、身份、版本及详情回读正确 | 完成 | [round-5.md](round-5.md)、[matrix.csv](matrix.csv) |
| SG10 | 轻量三段记忆与本地七条维护 | 三段必填无推测，Skill 描述用于发现且正文精简；回归通过；本地七条受控更新与回读 | 完成，PR #64 MERGED，本地七条和三个 Skill 回读通过 | [round-6.md](round-6.md)、[round-7.md](round-7.md)、[matrix.csv](matrix.csv) |

## 当前检查点

- 当前子目标：SG10
- SG10 已完成。PR #64 已获明确授权合并，合并提交 `76c6f75072a6a60ce06a6d5329223d08cdd7f442`；本地核心、插件目录及实际进程均使用该版本。发行构建、来源守卫及正常排空重启通过，健康 ok/recovery0、Web200。
- 本地七条全部改为 Summary、Why、How to apply，不保存新推测。scope10→17；两条来源型记忆为 context3，五条任务经验为三段正文。原身份、创建时间、来源和上一正文保持；原 review 及 Skill 支持状态哈希保持。
- 三个已有学习 Skill 已由新 Host 重建，适用条件进入 description，正文移除任务编号、通用声明、版本行与 Applicability。真实 Web 列表不陈旧，七条正文/差异和三个 Skill 回读一致。详细证据仅在 [round-7.md](round-7.md) 维护。
- 第6轮最终相关回归为52 PASS；发行代码与受验实现一致。本轮未重跑完整套件，历史完整routing的15个同基线失败仍保留。未额外验收真实模型的普遍提炼质量或Skill识别率。
- 按本地选择未创建备份，未主动发送真实渠道消息、重放旧unknown、部署远程或触发CI。原主检出与其他会话工作未动，私有数据和证据未进入Git。
- 未闭环项：当前用户授权范围无；完整套件历史失败与真实模型泛化能力是明确保留边界，不冒充已通过。
- 唯一下一步：当前目标已完成，等待新需求；不自动扩展部署、重发或模型验收。

## 上一轮检查点（保留当时状态）

- 当时子目标：SG7
- 当时下一步：本轮授权范围已完成；等待用户是否另行授权合并和部署，本会话不自动执行生产步骤。
- 当时未闭环项：PR #58 尚未合并、未部署生产、未处置旧 unknown；扩展 DWS Windows 文件竞争未收敛，保留第3轮失败和串行复验事实。

- 2026-11-11：用户授权修复第2轮两项Web问题。当前分支worktree-router-learning-web-fixes-20261111，基于origin/main 8c90fc1及上一轮验收文档提交4889013；工作树起点干净。
- 第2轮现场事实保留于round-2.md，不覆写旧结果；第1轮DWS基线失败保留。
- 方案：仅chat缺显式actorId时从Host冻结sourceRef映射认证sender，仍查participants；Skill清单复用核心支持判定。冻结payload/digest及群聊受众不改，unknown不重发。
- 两项修复前回归均复现故障；最终源码16项定向回归及守卫通过。扩展批次47 PASS/1 FAIL后进程未退出，基线和清理后的串行复验通过；不宣称完整扩展套件全绿。详细命令、源码hash和结论集中于round-3.md。
- 修复提交1706e7d；PR #58独立回查为OPEN/MERGEABLE，base main，head worktree-router-learning-web-fixes-20261111。自己的临时驱动、PR草稿和两处未退出测试目录已统一清理，独立检查不存在；此前release-pointer保留。
- 权威goal.md为本文件；详细证据见同目录round-1/2/3与matrix.csv。
