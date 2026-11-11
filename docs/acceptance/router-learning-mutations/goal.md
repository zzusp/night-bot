# Router 记忆与 Skill 维护目标

## 总目标

由 Router 决策并直接完成记忆、学习 Skill 的增改删，移除 Router 路径的话术授权门槛，保留 Host 的认证、来源/版本、权限、秘密、范围、事务与 no-replay。用户强调 Router 是整个 Bot 的大脑。授权范围：实现、隔离验证与独立 PR；没有本次生产发布/重放授权。

## Sub Goal Matrix

| 子目标 | 状态 | 证据入口 |
| --- | --- | --- |
| 明确职责、复用与安全边界 | 完成 | ../../spec/router-learning-mutations.md |
| 实现 Router 记忆与 Skill CRUD | 完成 | src/channels/resident-router-business.js；src/memory/service.js、reflection.js、evolution.js |
| 完成真实 Host/Pi 回归与源码守卫 | 完成，完整套件既有失败保留 | [round-1.md](round-1.md)、[matrix.csv](matrix.csv) |
| 同步合同、审阅差异、独立 PR | 合同已同步，PR 待验证完成 | AGENTS、README、MEMORY、SELF-EVOLUTION、CHANNELS 与 Windows 运维 |

## 当前检查点

- 2026-11-11；工作区 D:/project/night-bot/.claude/worktrees/router-learning-mutations-20261111，分支 worktree-router-learning-mutations-20261111，base 23a470bd7c31b71c81e61aa0499f1c525e243a33。
- 已快进整合最新 main 6a2bcc9b1571c64e1f102d0bea63c080d3e5770d，只增加部署文档；README 保留双方增量。未复制凭据、环境文件、真实业务数据或私有 Skill。
- Router 维护端口已实现；Host 移除话术判断，保留当前来源/作者/版本/批次/generation、权限、秘密、范围、提交回读及不重放。
- 记忆来源 15 场景和记忆/Skill 生命周期 16 场景通过；共享 Skill 冷启、旧正文撤销、删除目录、单调版本及持久收据故障恢复均有证据。
- 完整 Router 文件 27 PASS / 1 FAIL，唯一 DWS receipt flags 断言在干净 main 原样复现，未改无关实现或断言，不宣称全绿。关联批次中的 48 项已通过；复盘夹具修正真实工作区初始化与资源关闭顺序后，集中复验 13 PASS / 0 FAIL。详见本轮报告。
- 整合后 pnpm check 与 git diff --check 通过；本轮无真实消息、CI 或部署。没有自动补写、重放历史漏存来源。
- 本地实现与验证已完成，下一步为提交、push 与独立 PR 回查；PR 状态核实后在本目标回填交付事实。生产发布和历史补写仍需本次明确授权。
- 不改主检出、此前已合并修复分支或其它会话资源；本会话唯一整合暂存已按确切 SHA 恢复并移除。
