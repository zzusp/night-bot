# 长期偏好补记与 PR 整合：第二轮验收

## 结论

本次明确授权的历史偏好已通过既有记忆事务 API 补入现用安装的 Bot 共享正式记忆，独立只读进程确认落盘：scope revision 5 → 6，新增条目 revision 1，原有 5 条记忆逐项不变。原消息证据通过严格 Pi journal 解码、完整提交与显式 portable 路径解码校验；本次操作者授权与历史来源分别留痕。没有重放原输入、补发消息、重启或部署代码，不能据此声称现用进程已应用新学习动作。

PR 源码基于最新 main 的隔离 worktree；学习链路 3 项通过（包含在完整路由扫描中），记忆/事务/官方隐私回归 41 项通过，`pnpm check` 通过。完整路由仍为 61 PASS / 15 FAIL / 0 SKIP，不声称全绿，不生成全绿 report.md，也不扩展修复旁支。

## 受验源码

- 日期：2026-11-10；Windows 11、Node v24.19.0、pnpm 11.25.0。
- 分支：`worktree-channel-preference-memory`；base：`1d976a2cd9d7b7f66ae83cf7ae44e2e12bfde115`。验证结束后再次 fetch，origin/main 未变化。
- 受验的是 base 加本任务 staged 源码增量；四个源码/测试的 staged diff SHA-256：`319369d71276f9701031469171f45c0853c8c455c7a51676d6f984125628e4ae`，逐文件指纹见 `round-2/validation.json`。
- 保留主分支新增的记忆私有文件边界和回复用途合同；未带入主工作区其他未提交功能。依赖在本 worktree 通过 `pnpm install --frozen-lockfile --prefer-offline` 独立安装，未链接主工作区 node_modules、复制凭据或私有技能。

## 实跑与反证

| 检查 | 实际终态 |
| --- | --- |
| 真实 Host/Pi 学习链路 | 3 PASS；原文正式落盘、引用哈希/作者/来源、先写后答、冷启动跨会话读取和零重放保持成立。12 组授权检查及独立 read-only 场景通过。 |
| 既有记忆/事务/隐私 | 41 PASS / 0 FAIL / 0 SKIP，137747.7258 ms；命令与第一轮六个测试文件相同。 |
| `pnpm check` | PASS；404 个运行 JS，0 外部 SDK 导入，生产导入与来源/原生边界守卫通过。 |
| `pnpm test:routing` | 76 项，61 PASS / 15 FAIL / 0 SKIP，719045.6707 ms；最终退出码 1。 |
| 现用正式记忆补记 | 零写入预检后调用带跨进程锁、expectedRevision 和 redo 的 `MarkdownMemoryStore.remember`；再由独立进程解析 Markdown 与私有审计收据，核对正文/哈希及正式条目身份。 |

完整路由失败仍为三类：`test/pi-router-ledger.test.js` 的 13 项 `TASK_WORKSPACE_NOT_READY`（公共 complete helper 未准备任务工作区）；receipt echo 用例的 `Missing expected rejection.`；历史通知用例实际 active 而期望 completed。第一轮已分别用去掉学习修复的代表对照复现；本轮不重复该对照，也不据此声称所有 15 项都逐一取得新基线。没有修改任务工作区门、安全策略或断言求绿。

## 现场补记与权限边界

这是操作者明确要求“补上”之后的受控补记，未将历史消息重新塞入 Router 当前批次。正式条目的 source 记录本次操作者动作，originSource 保留严格校验的历史消息与原作者；没有伪造历史工具成功、Pi journal 或渠道发送收据。私有审计留在忽略的 `data/logs/memory-maintenance/`，记忆留在 `data/memory/v2/bot/`；这些数据、原生身份和凭据均不进入 Git 或 PR。

新学习动作自动接收未来渠道偏好的效果仍须正常升级与排空重启后验收。未运行全仓 pnpm test、test:runtime、test:containment、真实模型语义选择或真实钉钉集成；本轮没有更改执行或 OS sandbox。

## 证据与清理

唯一矩阵为 `matrix.csv`；机器摘要为 `round-2/validation.json`。第一轮报告及摘要保留原轮次事实，当前结论以本轮为准。夹具的 HTTP/Host/SQLite/隔离目录由 t.after 清理；只保留去隐私文字和 JSON，不保留运行数据库。一次性补记脚本、移植 patch 和 PR 正文草稿在交付收尾时清理，保留最终私有补记审计收据，不收录记忆正文或私有技能。

归档补注（第三轮收尾）：本轮结论与文字证据保留；旧机器摘要 round-2/validation.json 已按最终证据保留规则清理。当前状态与机器证据见 round-3.md 和 round-3/validation.json，历史正文中的旧附件引用不再指向保留文件。
