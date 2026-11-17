# PR 170 审查修复与本地部署

> 状态：BLOCKED
> Goal ID：background-compaction-review-fixes
> 最近维护：2026-11-17T03:45:04+00:00
> 权威目标：goal.md

## 总目标

修复 PR #170 的八项审查问题，保留原生 Pi 后台压缩方案及安全边界，完成验证与 PR 交付。2026-11-17 用户追加授权合并并部署本地；新版运行后核验核心、认证 Web、渠道及实际恢复状态。

## 完成条件

- 八项修复及关联小窗口回归经本地实跑验证，已提交并更新 PR。
- PR 已合并，独立本地发行运行已合并源码，依赖、Web 构建和来源守卫通过。
- 实际核心健康、认证 Web、配置渠道恢复均有独立回读；记忆/技能列表须刷新成功，不能将陈旧缓存计为通过。

## 范围与约束

- 保留安装 data，不创建备份，不删除既有备份，不复制凭据、业务数据或私有技能。
- 不发送人工测试消息、不手动触发 CI，不重放业务或修改历史 journal/账本来清警。
- 已合并后不再推原 PR 分支；只改当前工作树及经授权的本地安装配置，不覆盖主检出已有改动。
- 未验证的真实模型性能、Linux 路径及最终 head 全组检查明确保留；未知所有者的既有锁目录不擅自删除。

## sub goal matrix

| ID | 子目标 | 完成判据 | 状态 | 证据 |
| --- | --- | --- | --- | --- |
| SG1 | 图片请求错误后新输入恢复 | 旧错误不永久阻断新文本，pending 与原历史保持 | 已完成 | round-1.md |
| SG2 | steer、历史、系统/工具及小窗口容量 | 超限拒绝、原生压缩、合法近窗口接纳、配置恢复 | 已完成 | round-1.md |
| SG3 | Router supplements 领取前预检 | 累计容量失败不领取或接纳 | 已完成 | round-1.md |
| SG4 | 前台取消竞态及业务观测归属 | token 安装前取消排空，摘要不污染业务 runId | 已完成 | round-1.md |
| SG5 | 幂等投递不触发预压缩 | 重复、取消及 uncertain 命令不重复摘要/接纳 | 已完成 | round-1.md |
| SG6 | 验证、提交、更新 PR | 183 项集中回归、相关复验及来源守卫通过，真实边界入 PR | 已完成 | round-1.md、matrix.csv |
| SG7 | 合并 PR #170 | GitHub 独立回查 MERGED 与合并提交 | 已完成 | round-2.md |
| SG8 | 本地发行及恢复验收 | 运行版本、健康、Web、渠道通过，列表非陈旧且无错误 | 部分完成，列表刷新受阻 | round-2.md、matrix.csv |

## 当前检查点

- 当前子目标：SG8
- 唯一下一步：对经核实的既有空无 owner 记忆快照栅栏取得相应处置授权，或通过单独修复完善恢复合同；处理后重新做认证显式刷新，fresh 且无错误才关闭剩余验收。
- 未闭环项：记忆/技能列表 cache.stale=true / EVOLUTION_CACHE_REFRESH_FAILED；真实模型压缩/首答性能及第一轮明确的跳过未验证。
- PR [#170](https://github.com/zzusp/night-bot/pull/170) 已于 `2026-11-17T03:15:57Z` 合并，实际运行提交 `08a9324a29d1256bcb8f2bc4228a999cdc1f1e57`。源码与测试和最终验证提交 `803f60e` 零差异。
- 本地独立发行已运行；核心 status=ok、恢复异常 0、任务待处理 0，认证 Web 静态资源字节一致，两个已配置渠道 listening / receiving。接手时旧实例已关闭，没有冒称本轮执行过停机排空。
- 列表失败已只读定位到部署前 `evolution/.lock` 空无 owner 目录；未删除既有目录或放宽检查。新发行保留运行，完整部署验收不标全绿。
- 第一轮集中回归 183/183；routing/runtime 初跑失败与复验、12 项 Linux skip、定时报告初跑超时原因未收敛等边界仍见 round-1.md，不改写为最终 head 全组通过。
- 收口文档分支：`worktree-background-compaction-local-release`；不修改生产源码。

## 证据入口

方案：`../../spec/background-compaction-review-fixes.md`；代码结果：`round-1.md`；最新部署结果：`round-2.md`；跨轮状态：`matrix.csv`；证据：`round-1/final-test-evidence.txt`、`round-2/final-deployment-evidence.txt`。
