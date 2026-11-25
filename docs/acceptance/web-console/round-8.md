# 第八轮：合并前在最新主线上复验

2026-11-25，Windows 11、Node 24、Chromium。基线 `29793070f08031fe0f22afe2f7af0f20f68c2a68`，分支 `worktree-task-execution-duplicate-messages`。本轮先快进并保留 #285 的任务查询、调度卡片，再复跑受影响用例；第七轮的源码及原始性能对照见 [第七轮](round-7.md)。

- Web 构建通过；`execution-live-output.spec.ts`、`execution-scroll.spec.ts`、`transcript-first-paint.spec.ts`、`resident-activity-polish.spec.ts` 共 24 项通过。实际 EventSource 的双入口推送、健康连接不读历史、断线补齐、滚轮不重复、受保护正文撤权和新工具卡片均通过。
- 串行实跑真实任务、真实 Router、旧轻查询、正文撤权、零新增单锁和批量授权 6 项通过。零新增样本四次均只取一个记忆锁，耗时约 0.87–1.08 秒；同环境无正文凭证的四次约 44–105 毫秒且不取该锁。不是 UAT 性能数据。
- `pnpm check` 与 `git diff --check` 通过。未运行所有测试；此前在 `e0c4f256` 基线复现的 Windows 并发写锁和复盘请求次数失败未改变断言或保护规则。

本报告仅记录合并前本地复验；实际合并、镜像摘要及 UAT 读回以 PR 交付记录为准。
