# 反馈调查审查修复

总目标：核实并处理 PR #174 两轮 23 条审查发现，修复成立的问题，记录被反证的判断，完成相关本地验证并更新原 PR；不合并、部署、调用真实模型或创建反馈 Issue。

| 子目标 | 状态 | 证据入口 |
| --- | --- | --- |
| 核对源码与 SDK 行为 | 完成 | ../../spec/feedback-investigation-safety.md |
| 文件/日志边界和分页 | 修复完成，专项通过 | src/feedback/local-evidence.js；test/feedback-local-evidence.test.js |
| Pi 鉴权/压缩/输出终态 | 修复完成，专项通过 | src/feedback/pi-session.js；test/pi-feedback-session.test.js |
| 报告和预览完整性 | 修复完成，专项通过 | src/feedback/pi-session.js、service.js；test/pi-feedback.test.js |
| 默认回归、验收和 PR 交付 | 已交付原 PR；全量验收未通过 | matrix.csv、round-1.md；PR #174 已回查 OPEN / MERGEABLE |

## 当前检查点

- 隔离分支 `worktree-feedback-review-fixes` 基于原 PR `a0d2e58`。主工作区原有改动不参与任务。
- 已将最新核对的 main `98648cd` 无冲突合入。修复与整合提交 `165738d22aa9980d160fa036a450796d3680f420` 已正常推送到原 PR head 分支；后续交付记录提交仅改文档。
- Pi 原生逐轮压缩已存在，原审查该项被源码和实际 Pi 测试反证，不另造压缩循环；OAuth 仅验证鉴权参数机制，不声称真实厂商集成通过。
- 最新反馈专项 42 项：40 通过、2 项 Windows 文件 symlink 权限不足跳过；目录 junction 父路径替换回归通过。并发工具复用同一构建中快照也已通过。
- 整合后的 Web 渲染 8/8、feedback HTTP 2/2 通过。README、手册和运维说明已同步。
- 最终反馈专项 55 项：53 通过、0 失败、2 跳过；pnpm check 和 diff 格式检查通过。完整 pnpm test 观察到 5 项失败后停滞于冷启动 Shell 超时后的清理，已停止本任务进程树，未取得最终总表；定向排查及未解决项见 round-1.md。
- 验证源码集合 SHA256：`b6fe5aedd9e00b2e77d701b7cd08ab6ce133e612f89e4ddcf0bb76b6888c57d2`，集合为 scripts/test-pi.mjs、按路径排序的 src/feedback/*.js 及四个反馈合同/本地/Pi 会话/服务测试；依次以路径、NUL、原文件字节、NUL 累积。Node 24.19.0，pnpm 11.25.0。

交付：原 PR https://github.com/zzusp/night-bot/pull/174 已更新，独立 gh 读回 number=174、state=OPEN、mergeable=MERGEABLE，main ← fix/feedback-evidence-investigation，修复 head=165738d。完整回归失败和未验边界已在 PR 自包含列明；未合并、未部署。当前请求范围交付结束；后续全量失败排查不在本轮擅自扩展。
