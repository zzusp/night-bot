# Router 记忆与 Skill 维护目标

> 状态：本轮合并部署与验证完成
> Goal ID：router-learning-mutations
> 最近维护：2026-11-11T08:03:07+00:00
> 权威目标：goal.md

## 总目标

由 Router 决策并直接完成记忆、学习 Skill 的增改删，移除 Router 路径的话术授权门槛，保留 Host 的认证、来源/版本、权限、秘密、范围、事务与 no-replay。用户强调 Router 是整个 Bot 的大脑。上一轮已按授权合并、部署并验证记忆与 Skill 增改删；用户现追加授权合并部署 PR #58 并验证两项 Web 修复；不包含历史失败消息重放。

## 完成条件

Router维护合同、对应本地回归与独立PR完成；已授权的上一轮合并部署与真实CRUD据实记录。本次Web修复需通过真实本地Web/Pi业务终态与拒绝反例；本轮需完成正式镜像发布、生产排空备份、部署和真实业务验收；旧unknown不改写或重发。

## 范围与约束

当前授权包括 PR #58 合并、同一既有生产实例正式发布和验证。保留认证会话、冻结收据、群聊受众、权限和只读盘点；仅操纵本次验收对象，旧unknown只回读，不重发或篡改，不做无关重构。

## sub goal matrix

| ID | 子目标 | 完成判据 | 状态 | 证据 |
| --- | --- | --- | --- | --- |
| SG1 | 明确职责、复用与安全边界 | 明确 Router 和 Host 职责 | 完成 | ../../spec/router-learning-mutations.md |
| SG2 | 实现 Router 记忆与 Skill CRUD | 实现来源绑定增改删 | 完成 | src/channels/resident-router-business.js；src/memory/service.js、reflection.js、evolution.js |
| SG3 | 完成真实 Host/Pi 回归与源码守卫 | 真实本地回归及守卫通过，基线失败单列 | 完成，完整套件既有失败保留 | [round-1.md](round-1.md)、[matrix.csv](matrix.csv) |
| SG4 | 同步合同、审阅差异、独立 PR | 合同同步且 PR 可审阅 | 完成，PR #57 已合并 | [PR #57](https://github.com/zzusp/night-bot/pull/57)，合同与运维说明已同步 |
| SG5 | 正式镜像发布与生产部署 | 已合并产物按 digest 部署并回读 | 完成 | [round-2.md](round-2.md) |
| SG6 | 真实 Router 记忆与 Skill 增改删及测试数据清理 | 六项真实持久化、测试数据清理且缺口单列 | 6项持久化通过；Web送达/展示另有失败 | [round-2.md](round-2.md)、[matrix.csv](matrix.csv) |
| SG7 | Web来源身份映射与Skill支持判定续修 | 两项 Web 修复、本地终态验证及独立 PR | 完成，PR #58 MERGED | [round-3.md](round-3.md)、[PR #58](https://github.com/zzusp/night-bot/pull/58) |

| SG8 | Web修复正式发布与真实业务验收 | 合并产物、离线一致备份、部署核对、真实CRUD及两项Web终态通过 | 完成 | [round-4.md](round-4.md)、[round-4-evidence.json](round-4-evidence.json) |

## 当前检查点

- 当前子目标：SG8
- 唯一下一步：无继续执行项；本轮合并、部署和验收均已完成，新增生产动作须另有授权。
- 未闭环项：旧unknown按约保持、没有重发或结清；备份恢复和真实钉钉消息未验，第1/3轮完整套件失败仍保留；均不冒充本轮已解决。
- 2026-11-11：PR #58已合并为46a64f5a1c41448018c603552db52a4140b5b7a1，正式镜像digest 3d7c79f07765ba57751f60ed3fd18643f52e15c7f1146b100b6e601930042573已发布部署；独立imageID、两处源码hash、Ready/restart0、安全配置、认证401/403、token和接纳receiving核验通过。
- 真实模型记忆与Skill增改删6项全部persisted，6条空受众最终Router回复各发送1次且可靠送达/HTTP可见；Skill新增更新为applied、活动数2→3→3→2且正文匹配。测试数据删除、其他记录哈希保持、新任务0，旧unknown状态/digest/发送1次保持。
- 正常停机和严格离线检查通过；62份Pi历史、158文件默认备份逐项回读。临时Job和本地验证容器/卷已独立检查清理，备份保留。详细事实仅见第4轮，不以部署成功代替业务终态。
- 当前分支worktree-router-web-release-20261111；应用源码为合并46a64f5，后续仅运维/验收文档增量。权威goal为本文件；第1/2/3/4轮和matrix历史保留。
- PR #58正文已按真实部署和6项终态集中回填，独立逐字回读通过。40份本轮私有中间文件已统一清理并确认目录不存在，既有安装pointer更新为当前镜像且仍受忽略；发布记录将仅提交脱敏文档。
