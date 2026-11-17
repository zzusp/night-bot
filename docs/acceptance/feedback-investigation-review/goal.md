# 反馈调查审查修复

总目标：核实并处理 PR #174 两轮 23 条审查发现，修复成立的问题，记录被反证的判断，完成相关本地验证并更新原 PR；不合并、部署、调用真实模型或创建反馈 Issue。

| 子目标 | 状态 | 证据入口 |
| --- | --- | --- |
| 核对源码与 SDK 行为 | 完成 | ../../spec/feedback-investigation-safety.md |
| 文件/日志边界和分页 | 修复完成，专项通过 | src/feedback/local-evidence.js；test/feedback-local-evidence.test.js |
| Pi 鉴权/压缩/输出终态 | 修复完成，专项通过 | src/feedback/pi-session.js；test/pi-feedback-session.test.js |
| 报告和预览完整性 | 修复完成，专项通过 | src/feedback/pi-session.js、service.js；test/pi-feedback.test.js |
| 默认回归、验收和 PR 交付 | 本地验证已结束，待更新 PR | matrix.csv、round-1.md；完整默认回归未通过 |

## 当前检查点

- 隔离分支 `worktree-feedback-review-fixes` 基于原 PR `a0d2e58`。主工作区原有改动不参与任务。
- 已将最新核对的 main `98648cd` 无冲突合入，合并尚未提交；本轮实现及文档仍为未提交工作树。
- Pi 原生逐轮压缩已存在，原审查该项被源码和实际 Pi 测试反证，不另造压缩循环；OAuth 仅验证鉴权参数机制，不声称真实厂商集成通过。
- 最新反馈专项 42 项：40 通过、2 项 Windows 文件 symlink 权限不足跳过；目录 junction 父路径替换回归通过。并发工具复用同一构建中快照也已通过。
- 整合后的 Web 渲染 8/8、feedback HTTP 2/2 通过。README、手册和运维说明已同步。
- 最终反馈专项 55 项：53 通过、0 失败、2 跳过；pnpm check 和 diff 格式检查通过。完整 pnpm test 观察到 5 项失败后停滞于冷启动 Shell 超时后的清理，已停止本任务进程树，未取得最终总表；定向排查及未解决项见 round-1.md。
- 验证源码集合 SHA256：`b6fe5aedd9e00b2e77d701b7cd08ab6ce133e612f89e4ddcf0bb76b6888c57d2`，集合为 scripts/test-pi.mjs、按路径排序的 src/feedback/*.js 及四个反馈合同/本地/Pi 会话/服务测试；依次以路径、NUL、原文件字节、NUL 累积。Node 24.19.0，pnpm 11.25.0。

下一步：验收文档已集中保存；按用户“提交PR”要求，查原 PR 状态后正常 push 到其 head 分支并更新自包含正文，如实保留完整回归失败，不触发 CI。
