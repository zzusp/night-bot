# 文件纠错修复部署目标

## 总目标

按用户 2026-11-10 的授权合并 PR #33，将最新已合并代码部署到现有本地安装，保留配置、数据、认证并验证运行版本、原渠道恢复及文件纠错行为；按用户后续明确要求继续原事项，使用已有可信入口结清升级前误锁，沿该事项原执行会话完成并核验真实交付。不直接操作外部业务仓库或服务，不合并同一 Router 下不同事项的执行会话，不放宽真实未知效果保护。

## 工作项

| 子目标 | 状态 | 证据 |
| --- | --- | --- |
| 文件纠错实现与本地专项 | PASS | round-1.md、round-2.md、round-3.md；112 项专项通过，人工待答已知失败单列 |
| 合并 PR #33 | PASS | merge `1d976a2cd9d7b7f66ae83cf7ae44e2e12bfde115`，2026-11-10T08:48:37Z |
| 精确合并版本 Web 构建 | PASS | round-4.md；TypeScript/Vite 通过，296 modules，3 文件真实 HTTP 哈希一致 |
| 现有安装正常排空与升级 | PASS | round-4.md；精确 merge `1d976a2`，正常 IPC 完整部署重启 19.617 秒，原双渠道恢复 |
| 部署后真实状态和纠错验证 | PASS | round-4.md、round-4/deployment-proof.json；安装目录 3 项行为回归及源码守卫通过 |
| 原任务旧误锁结清及真实续办 | PASS | round-5.md、round-5/recovery-proof.json；原 task/session 完成并排空，旧调用无重放、未结清 0 |
| 原业务产物与实际送达 | PASS | round-5.md；实际 XLSX 独立读回、冻结报告身份/哈希通过，正文与报告均 delivered |

## 当前检查点

实现、合并、本机部署和原事项恢复验收已完成。实际运行源码仍为 `1d976a2cd9d7b7f66ae83cf7ae44e2e12bfde115`；`worktree-task-file-mutation-deployment` 仅补充文档及脱敏证据，不代表另一次部署。

第 4 轮当时保留旧未知状态的结论不改写。后续用户明确要求继续后，复用已有 Host inspect/close/new-action 结清单条旧 edit 尝试，保留可能有局部效果及 noReplay，原事项新增 62 条效果调用并最终 completed、drained=true。完成记录绑定 requirementRevision 2，正文与冻结报告均已实际送达；宿主观察任务 `bn4gbtl1l` 已自然结束。一个 Router 管理多个事项，各事项执行会话独立，本次未合并或重建执行会话。

人工待答独立失败仍以第 3 轮为最近实跑结论；完整 runtime、Linux containment 和全量 UI 浏览器没有在恢复阶段重跑。原业务两类 HTTP 下载及候选浏览器保存已核验，结果弹窗浏览器保存和完整业务生成流程未覆盖，不宣称全量业务验收。

既有外部凭据映射沿用，没有复制凭据或修改其它仓库。收尾只清理本任务无用恢复助手与中间产物；正式任务归档保留。忽略目录 `docs/tmp/task-file-mutation-deploy/` 中仍运行的 launcher 保留，其他会话的监督脚本和资料不动。最终证据集中在第 4、5 轮，各轮历史结果保留。
