# 文件纠错修复部署目标

## 总目标

按用户 2026-11-10 的授权合并 PR #33，将最新已合并代码部署到现有本地安装，保留配置、数据、认证及原任务未知状态；正常排空重启后验证真实运行版本、原渠道恢复、静态资源与文件纠错行为。不重新发布外部业务，不通过渠道发送测试消息。

## 工作项

| 子目标 | 状态 | 证据 |
| --- | --- | --- |
| 文件纠错实现与本地专项 | PASS | round-1.md、round-2.md、round-3.md；112 项专项通过，人工待答已知失败单列 |
| 合并 PR #33 | PASS | merge `1d976a2cd9d7b7f66ae83cf7ae44e2e12bfde115`，2026-11-10T08:48:37Z |
| 精确合并版本 Web 构建 | PASS | round-4.md；TypeScript/Vite 通过，296 modules，3 文件真实 HTTP 哈希一致 |
| 现有安装正常排空与升级 | PASS | round-4.md；精确 merge `1d976a2`，正常 IPC 完整部署重启 19.617 秒，原双渠道恢复 |
| 部署后真实状态和纠错验证 | PASS | round-4.md、round-4/deployment-proof.json、matrix.csv；安装目录 3 项行为回归及源码守卫通过 |

## 当前检查点

授权范围全部完成：PR 已合并、本地精确版本已部署、正常恢复和安装目录纠错反例已验证。当前运行源码是 `1d976a2cd9d7b7f66ae83cf7ae44e2e12bfde115`；部署证据分支为 `worktree-task-file-mutation-deployment`，后续仅提交验收文档，不代表另一次运行版本。

原 `degraded/recoveryIssueCount=1` 与外部效果待核实状态保留，原任务不自动继续。人工待答独立失败仍按第 3 轮结论，未纳入此次修复；完整 runtime、Linux containment 和全量 UI 浏览器没有在本轮重跑。

既有外部凭据映射沿用，没有复制凭据或修改其它仓库。临时部署目录 `docs/tmp/task-file-mutation-deploy/` 中仍运行的 launcher 保留，其余本任务中间产物在最终证据核对后清理。上一任务的监督脚本未修改、未清理。没有新的实施待办。
