# 原任务工具误锁恢复

## 目标与完成条件

查清文件写入拒绝被误记未知效果及旧任务排空切点过期的根因，修复最新主线并完成相关回归；通过可信 Host 对账恢复原 task/session，观察它实际继续执行。不得重放旧调用、直接修改 SQLite/journal，或借机处理业务项目代码。

## 当前检查点

- 修复 PR #117 已合并为 `71a708388c3df82e0a1032c92e302588683edb28`；合并后已 fetch 并同步最新主线。验收文档在 `worktree-file-effect-recovery-acceptance`；主检出原有改动保留。
- 两处责任层修复及相关 131 场景已完成验证（整组 130/131，唯一夹具文案断言修正后注册文件 14/14 通过）；源码/导入守卫通过。代码回归见 round-4.md。
- 已获本机升级及原任务恢复授权；独立已合并发行完成依赖、Web 构建、`pnpm check` 和监督器零副作用自检，正常排空旧服务后启动，原 data 保留且不创建备份。
- 原 task/session 实际只读回复并排空，正式 inspect 已通过；旧 write 已按可能部分效果、noReplay=true 正式结清，严格原生回执与 SQL 投影闭合校验通过。已通过正式任务上下文使旧技术等待判断失效，原 Router 恢复同一 task/session；新 PowerShell 完成两仓 Git 状态、分支和 HEAD 核对，并有成功 effect-result。实际恢复见 round-5.md。
- 云端部署及 Windows 部署会话均确认没有修复、解锁本任务，不重复它们的工作。
- 旧意图原始底层错误没有保存；保留可能部分效果，不把现场文件与原请求字节不同当作无效果证明。

## 必要工作项

| 项目 | 状态 | 证据入口 |
| --- | --- | --- |
| 原始故障与主线核对 | 完成 | 当前会话只读工具输出；后续汇总 round-4.md |
| 本地重现与文件系统边界修复 | 完成 | test/pi-file-tool-registration.test.js、test/pi-single-task.test.js |
| 旧 owner 与后续核验 owner 的真实排空证明组合 | 完成 | src/tasks/effect-reconciliation.js、src/tasks/single-session.js |
| 回归、提交与受控发布 | 完成 | round-4.md、round-5.md、matrix.csv；已合并版本本机运行 |
| 原任务可信结清及实际续办 | 完成 | round-5.md；新 pwsh 真实输出及成功收据，旧调用不重放 |

## 下一步

本次平台修复与原任务实际续办目标已完成。原执行会话继续原业务修复；本会话不代做其他业务仓库，不声称 LCIA 删除和分类树两项修复已完成、部署或验收。保留旧未知结果及 no-replay。
