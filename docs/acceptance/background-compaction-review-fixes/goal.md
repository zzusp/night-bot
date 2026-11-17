# PR 170 审查修复

## 目标与完成条件

修复审查报告的八项问题，保留原方案与安全边界，完成本地相关验证，提交并更新原 PR #170；不合并、不部署、不操作真实消息。

## 当前检查点

- 隔离工作树：`worktree-background-compaction-review-fixes`，起点 `8757f182168a1a116f1dec99ac40975345205284`。
- 最终生产源码及测试：`803f60ee7e09ef0a166de0cccf8916f6da9ec500`；已整合 `main` 的 `a8377ee319589df3dd0f5fe40376bd0fb84436f8`，已推送原 PR 分支。
- 原 PR [#170](https://github.com/zzusp/night-bot/pull/170) 已更新正文；实查 OPEN、Draft、MERGEABLE，`main ← feat/background-compaction`，未合并、未部署、无真实消息。
- 最终集中回归 183/183；routing 初跑 179/180、runtime 初跑 147/162（3 fail、12 Linux 专属 skip），失败路径均已复验通过，未宣称最终 head 全组重跑通过。32 轮续办保留原会话、唯一写入和原效果收据。
- 遗留：定时报告初跑超时原因未收敛，隔离复验通过；平台专属及全项目/真实厂商验证未执行。详细边界见 round-1.md。
- 后续仅说明/证据归档，不改变上述生产源码；文档提交号由最终 PR head 回查，不为填写自身 SHA 循环提交。

## 子目标

| 子目标 | 状态 |
| --- | --- |
| 图片请求错误允许新输入恢复 | 已修复，集中回归通过 |
| 活动 steer、大历史、系统/工具开销容量校验 | 已修复，集中回归通过 |
| Router supplements 领取前预检 | 已修复，集中回归通过 |
| 前台取消竞态与业务观测归属 | 已修复，集中回归通过 |
| 幂等投递不触发预压缩 | 已修复，集中回归通过 |
| 验证、提交、更新原 PR | 已完成，保留明确的跳过与未验边界 |

## 证据入口

方案：`../../spec/background-compaction-review-fixes.md`；结果：`round-1.md`、`matrix.csv`；最终文字证据：`round-1/final-test-evidence.txt`。
