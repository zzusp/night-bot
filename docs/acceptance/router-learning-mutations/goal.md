# Router 记忆与 Skill 维护目标

> 状态：上下文提炼式记忆已实现并完成本地验证，待独立 PR 交付
> Goal ID：router-learning-mutations
> 最近维护：2026-11-11T10:25:24.557Z
> 权威目标：goal.md

## 总目标

由 Router 决策并直接完成记忆、学习 Skill 的增改删，移除 Router 路径的话术授权门槛，保留 Host 的认证、来源/版本、权限、秘密、范围、事务与 no-replay。用户强调 Router 是整个 Bot 的大脑。此前已按授权合并、部署并验证记忆与 Skill 增改删，两项 Web 续修已进入主线。本轮按用户要求将 Router 记忆改为上下文提炼内容与独立证据，不包含再次部署、旧业务记忆回填或历史失败消息重放。

## 完成条件

Router维护合同、对应本地回归与独立PR完成；已授权的上一轮合并部署与真实CRUD据实记录。本次上下文记忆需通过真实本地Host/Pi持久化、冷恢复、来源拒绝反例、详情与差异回读；完整套件既有失败单列。代码完成不等于上线，旧unknown不改写或重发。

## 范围与约束

当前追加授权修改 Router 上下文提炼式四维记忆写入，补相关回归并交付独立PR。保留认证会话、冻结收据、群聊受众、权限与只读盘点；不再次合并/部署、不操作生产旧unknown、不做无关重构。

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
| SG8 | Router 上下文提炼式四维记忆 | 提炼内容、逐项证据、适用范围及隔离回归通过，独立 PR 交付 | 代码与相关验证完成，完整路由基线失败保留；待 PR | [round-4.md](round-4.md)、[matrix.csv](matrix.csv) |

## 当前检查点

- 2026-11-11 新授权：按四维方案修改 Router 记忆写入；基于 origin/main 46a64f5，新工作树 worktree-router-context-memory，起点干净。PR #58 已在当前主线合并。
- SG8 实现与相关验证完成：记忆/复盘/迁移 61 PASS；完整路由 73 PASS/15 FAIL，15 项在同基线复现。提炼内容、证据、适用范围、冷启动与详情/差异回读通过。受验工作树与源码指纹集中于 round-4.md。
- 唯一下一步：核对最终差异并提交独立 PR；不合并、不部署、不回填生产记录。

## 上一轮检查点（保留当时状态）

- 当前子目标：SG7
- 唯一下一步：本轮授权范围已完成；等待用户是否另行授权合并和部署，本会话不自动执行生产步骤。
- 未闭环项：PR #58 尚未合并、未部署生产、未处置旧 unknown；扩展 DWS Windows 文件竞争未收敛，保留第3轮失败和串行复验事实。

- 2026-11-11：用户授权修复第2轮两项Web问题。当前分支worktree-router-learning-web-fixes-20261111，基于origin/main 8c90fc1及上一轮验收文档提交4889013；工作树起点干净。
- 第2轮现场事实保留于round-2.md，不覆写旧结果；第1轮DWS基线失败保留。
- 方案：仅chat缺显式actorId时从Host冻结sourceRef映射认证sender，仍查participants；Skill清单复用核心支持判定。冻结payload/digest及群聊受众不改，unknown不重发。
- 两项修复前回归均复现故障；最终源码16项定向回归及守卫通过。扩展批次47 PASS/1 FAIL后进程未退出，基线和清理后的串行复验通过；不宣称完整扩展套件全绿。详细命令、源码hash和结论集中于round-3.md。
- 修复提交1706e7d；PR #58独立回查为OPEN/MERGEABLE，base main，head worktree-router-learning-web-fixes-20261111。自己的临时驱动、PR草稿和两处未退出测试目录已统一清理，独立检查不存在；此前release-pointer保留。
- 权威goal.md为本文件；详细证据见同目录round-1/2/3与matrix.csv。
