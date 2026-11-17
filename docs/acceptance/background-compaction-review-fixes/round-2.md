# 本地合并部署验收第 2 轮

## 范围与结论

2026-11-17 用户明确授权合并 PR #170 并部署本地。**PR 已合并，新版核心、Web 和两个已配置钉钉渠道已运行；完整部署验收仍有一项阻断：记忆/技能列表刷新失败，只能读到旧缓存。** 不将 HTTP 200 或核心健康冒充该列表刷新成功。

本轮只执行部署、配置路径切换和安全 smoke，没有修改生产源码、重放业务或发送人工测试消息。原代码验证、初跑失败及跳过仍见 [第 1 轮](round-1.md)，不改写为最终 head 的全项目通过。

## 源码与安装

- PR [#170](https://github.com/zzusp/night-bot/pull/170)：独立 GitHub 回查 `MERGED`，`mergedAt=2026-11-17T03:15:57Z`。
- 已合并并实际运行的源码：`08a9324a29d1256bcb8f2bc4228a999cdc1f1e57`。独立发行初次 checkout 前设置 `core.autocrlf=false`、`core.symlinks=false`，依赖分别安装，不复用其他检出的整个 node_modules。
- 发行工作树干净；`src` / `test` 与最终代码验证提交 `803f60e` 零差异。当前文档记录位于独立收口分支，不继续 push 已合并 PR 分支。
- 现有安装 data 原地保留；未复制凭据、业务数据或私有技能，不创建备份，不删除已有备份。
- 本轮接手时旧实例已关闭：相关旧 PID 不存在，resident 无监听。因此没有执行停机，也不声称取得本轮优雅排空证据。

## 结果

| 检查 | 结果 | 关键证据 |
| --- | --- | --- |
| 合并与版本绑定 | PASS | GitHub MERGED；实际核心和 launcher 指向合并提交独立发行 |
| frozen install、Web build、来源守卫 | PASS | 两处 frozen install；341 modules；retained 190 / production 453 / external SDK 0 |
| 配置切换 | PASS | `checkOnly` 与发现先通过；Host 离线锁内保存；只改 channelPluginDirs，独立读回 |
| 核心健康与恢复 | PASS | status=ok；recoveryIssueCount=0；taskAttentionCount=0；原问题列表为空，task alerts total=0 |
| Web 登录与静态资源 | PASS | 认证 session 有效；HTML、JS、CSS 均 HTTP 200 且等于本地发行字节 |
| 两个真实钉钉渠道 | PASS | 均 listening、connected/liveApplied=true、receiving、无错误，无待重启 |
| 记忆/技能显式刷新 | FAIL | status=ready 但 cache.stale=true、EVOLUTION_CACHE_REFRESH_FAILED；不是新快照 |
| 人工新消息、真实模型压缩和交付性能 | NOT_RUN | 没有这类验收授权；modelMode=real 不证明已调用模型或已改善首答 |

启动监督器时间 `2026-11-17T03:32:46.061Z`；最终状态采集时间 `2026-11-17T03:41:57.573Z`。后者包括排查时间，不作为启动耗时或压缩性能数据。

## 刷新阻断与处理边界

真实采集调用 `readEvolutionInventory` 返回 `EVOLUTION_BUSY`，原因是既有 `data/memory/v2/bot/evolution/.lock` 目录仍在。目录为空、无 owner、非链接，修改时间早于本轮部署；同作用域不存在待提交或布局迁移 marker。生产只读采集在 `packages/web-console/server/evolution-inventory.js:37` 对该目录存在即拒绝读取，不做事务恢复。

已排查相邻解释：渠道启动瞬态结束后仍失败；不存在待提交 marker；错误为 busy 而非路径/权限异常。现有证据定位到该历史目录栅栏，不能据“为空”推出可擅自删除未知所有者的锁。没有删除既有目录、清理账本或放宽守卫。**继续条件是经适当授权、核验并处理该既有栅栏，或通过单独修复完善其兼容/恢复合同，然后重新做显式刷新验收。** 当前仅该列表新鲜度未通过；不宣称本轮全绿。

## 证据与清理

最终脱敏证据：[round-2/final-deployment-evidence.txt](round-2/final-deployment-evidence.txt)；历史状态保留在 `matrix.csv`。已无用途的本轮检查脚本、中间状态和构建日志在集中归档并读回后清理。运行发行、现有安装资料和仍被监督器使用的输出不删除。没有生成 `report.md`。
