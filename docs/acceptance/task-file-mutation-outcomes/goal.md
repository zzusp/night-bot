# 原任务工具误锁恢复

## 目标与完成条件

查清文件写入拒绝被误记未知效果及旧任务排空切点过期的根因，修复最新主线并完成相关回归；通过可信 Host 对账恢复原 task/session，观察它实际继续执行。不得重放旧调用、直接修改 SQLite/journal，或借机处理业务项目代码。

## 当前检查点

- 独立分支 `worktree-file-effect-recovery`，已整合最新主线 `315e1a6`；主检出原有改动保留。
- 两处责任层修复及相关 131 场景已完成验证（整组 130/131，唯一夹具文案断言修正后注册文件 14/14 通过）；源码/导入守卫通过。真实安装尚未升级，旧 inspect 仍失败；结果见 round-4.md。
- 云端部署及 Windows 部署会话均确认没有修复、解锁本任务，不重复它们的工作。
- 旧意图原始底层错误没有保存；保留可能部分效果，不把现场文件与原请求字节不同当作无效果证明。

## 必要工作项

| 项目 | 状态 | 证据入口 |
| --- | --- | --- |
| 原始故障与主线核对 | 完成 | 当前会话只读工具输出；后续汇总 round-4.md |
| 本地重现与文件系统边界修复 | 完成 | test/pi-file-tool-registration.test.js、test/pi-single-task.test.js |
| 旧 owner 与后续核验 owner 的真实排空证明组合 | 完成 | src/tasks/effect-reconciliation.js、src/tasks/single-session.js |
| 回归、提交与受控发布 | 回归完成，待 PR/合并授权 | round-4.md、matrix.csv；发布必须基于已合并代码 |
| 原任务可信结清及实际续办 | 待处理 | 只用正式操作者 API；同一 task/session |

## 下一步

提交修复并创建自包含 PR；合并及本机平滑升级须得到明确授权。之后用原任务只读对话刷新真实切点，再经可信 inspect/close 结清并让 Router 续办；保留旧原始未知结果，不补造 not-started。
