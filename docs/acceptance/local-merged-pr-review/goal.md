# 本地合并批次复查与刷新修复

> 状态：ACTIVE_WITH_BLOCKERS
> Goal ID：local-merged-pr-review
> 最近维护：2026-11-13T04:34:00Z
> 权威目标：goal.md

## 总目标

修复记忆页强刷失败；复查已合并PR并修复确认问题，部署本地真实验收。追加处理degraded告警、钉钉接入及正常停机后群内首答无后续。保护主仓和安装数据，验证后合并，部署时重新拉取最新main。

## 完成条件

- 连续强刷与冷启动得到新缓存；失败保留可验证快照，鉴权/文件安全仍失败关闭。
- 确认缺陷完成最小修复、本地实跑及Git交付，区分失败、跳过、未验证。
- 最新已合并发行实际运行，记忆页fresh且计数与Store一致；Router原四项结清，实质反馈送达，取消/延期生效、旧操作不重放。
- 不复制凭据/业务数据、不发送真实测试消息、不创建本地备份、不修改主仓其他会话工作，不清账本伪装未知效果结清。

## 范围与约束

- 原复查14个PR：#76、#77、#78、#79、#80、#81、#84、#85、#87、#88、#89、#90、#92、#93；原修复#96已合并，见前轮报告。
- 本轮#100/#105/#106均MERGED；实际发行0fa0c4f83bd8a3178e4ac13517a9d3b5fef9ae3c，合并后部署及04:20Z核验时为最新main。归档期间主线新增#107文档/通用技能，已整合归档分支，未改本轮运行代码；未为无关文档更新重复重启。
- 证据归档分支worktree-local-router-evidence，不向已合并分支继续push；不切换、提交或改写主仓。
- 按Windows runbook预检、正常IPC停机和独立发行；原data原位复用，保持原full权限与渠道实例，不手动触发CI。
- v3→v4官方显式无备份迁移已完成，仅限本地例外，默认备份不变；不保证无损回退v3。决策见[迁移快照](../../spec/offline-memory-without-backup.md)。
- 真实群后续消息由Bot按既有权限处理，不构成CLI助手跨仓修改或发布授权。

## sub goal matrix

| ID | 子目标 | 完成判据 | 状态 | 证据 |
| --- | --- | --- | --- | --- |
| SG1 | 刷新定位修复 | Windows/Linux缓存回归通过 | 已验证 | round-1.md |
| SG2 | 14个PR复查 | 确认问题及失败组复验 | 已完成复查 | round-1.md；552项初轮失败不覆盖 |
| SG3 | 相关修复验证 | 本地实跑且跳过单列 | 已验证，附平台限制 | round-1.md、round-4.md |
| SG4 | Git交付 | 验证后合并 | 已合并 | PR #96、#100、#105、#106 |
| SG5 | 最新本地部署 | 正式发行、真实页fresh | 已部署，附遗留项 | round-4.md；0fa0c4f、两次Edge强刷31/0 |
| SG6 | 恢复告警与接入 | Router结清且反馈送达，未知效果独立核验 | Router及接入已验证，旧任务仍阻断 | round-4.md；4consumed、1claim、0旧调用重放、实质回复有回读、两路receiving |

## 当前检查点

- 当前子目标：SG6
- 本次停机恢复修复、合并和本地部署已完成；长期目标保留旧任务和既有界面问题，不标全系统全绿。
- 实际发行0fa0c4f83bd8a3178e4ac13517a9d3b5fef9ae3c。04:11:24Z resident/Web就绪，04:22Z独立核实实际进程版本；两路钉钉listening/receiving。
- 原4事件consumed，23条历史前缀不变、原packet唯一、claim一次，较新取消/延期先接纳。旧发布任务状态/revision不变，原调用/operation无重放。
- 原群实质回复04:12:11Z delivered，有厂商真实messageId/回读；字段缺少目标选项、未修改、生产暂缓。随后真实群输入由Bot继续处理，关联任务revision4于04:29Z completed且drained；最终结果04:30:47Z delivered并有厂商回读。CLI只核实Host记录，未直接调用外部业务API。
- 离线迁移后39份保留文件不变、31条/0候选、revision42、backup null、无新增备份。运行后仅既有机制更新技能快照，其余38份不变，区分迁移与运行写入。
- 最终Edge两次刷新ready、无stale/refreshing/error，31/0与Store一致；12/12技能可用。usageCoverage仍partial。
- 最终04:33:59Z degraded1项，只剩独立旧未知写；无ROUTER_BATCH_UNSETTLED，字段缺失问询已superseded。未人工清警、close或重放。
- 唯一下一步：独立旧任务须先通过正式Host取得符合当前owner/增量切点的效果证明；当前不足以结清，保留阻断，不凭Router恢复重放原写。新的群业务由Bot按授权继续，不由CLI越界代办。

- 未闭环项：独立旧任务未知写效果、usageCoverage partial及第2轮两个界面问题；本次恢复修复不扩展代办或清警。

## 证据入口

- [第4轮](round-4.md)：三个根因、精确源码/合并版本、迁移/启动/UI、原群实质反馈送达和无重放；详细证据仅此处维护。
- [matrix.csv](matrix.csv)：保留历史并新增本轮PASS/FAIL/BLOCKED，不覆盖旧失败。
- round-1.md / round-2.md / round-3.md：历史复查、部署和恢复阻断，追溯时读取。第2轮两个界面失败本轮未修改或复验。
- [Router决策](../../spec/router-aborted-batch-recovery.md)：一次claim、来源及no-replay。原109项结果与最终并发增量9+9分开绑定版本。
