# Router 原批次恢复

## 目标

恢复原消息的 Router 消费及两个原任务的处理，保持原 session、来源、效果和 no-replay。补齐后续可复用的操作者入口，按既有 PR/已合并发行流程交付；不修改业务系统或替代原任务。

## 当前检查点（2026-11-16）

用户要求先恢复任务，不再等待新 CLI 交付。已优先通过已部署、已合并代码 `0ff240a50e9c31a55b3a0214d2845e9f1cb772b0` 的既有 `application.tasks.resumeRouterBatch` 完成原批次续办，没有部署未合并代码。旧实例经 IPC 正常退出。临时受信启动器仅调用原 Host API，未改 SQLite、journal、工具结果或权限。

真实恢复结果：原 generation/session 保持，返回 `resumed:true,settled:true`；原查询消息事件为 `consumed`，当前会话 pending=0；两个原任务均在原执行 session 继续，technicalFailure=null。2026-11-16T07:35Z 只读严格 journal 解码确认两个原 session 均有新的 assistant/toolResult，`pwsh`、`edit`、`write` 等实际返回成功，完整物理日志已提交。健康接口 `status:ok,recoveryIssueCount:0,taskAttentionCount:1`，恢复明细为空。这证明处理恢复，不证明原业务事项已完成。

## 运行资源与恢复入口

安装数据及秘密不入库。当前进程由主检出 `docs/tmp/router-live-recovery.mjs` 管理（任务临时运行资源，尚在使用，不能删除），后台 task `brk9rcp9g`。运行代码仍在 `triage-batch-auth-recovery` 的上述已合并 SHA。私有 proposal、控制状态和恢复收据位于安装 `data/temp/`、`data/runtime/`，只在本机读取，不发布身份或业务正文。启动器支持 `--stop --check` 后 `--stop`，以私有 token 给自己启动的子进程发 IPC；不要强停或启动第二个 Host。

## 新入口代码状态

开发位于独立工作树 `router-batch-recovery`，分支 `worktree-router-batch-recovery`，基线 `fbe6d870ba06a9d4002395a7dd311d409fc71bd8`。尚未提交/PR/合并/部署。方案见 `docs/spec/router-batch-operator-recovery.md`。

已实现 inspect/check/resume，复用私有 capability；只读检查复用原 checkpoint/inbox 守卫，不 open/commit/claim。执行绑定 checkpointRevision、inboxDigest，保留原 Host 来源授权和防重放。应用关闭先停止接纳连接，再取消任务，避免等待续办 HTTP 返回后才尝试中断。

验证绑定本工作树本轮暂存源码（未提交），目标主干已重新 fetch，仍为基线 SHA，无待整合增量。原严格续办相关选择集首次 4 PASS/1 cancelled，取消来自测试端 fetch 忽略自定义 Host、误发了被夹具挂起的合法续办；已改用原生 HTTP 构造恶意 Host。修正后的完整原批次续办 1/1 PASS；随后改为真实独立 CLI 进程并与默认 application 入口联合复验，2/2 PASS。后续取消必须先入模、旧 inbox digest 拒绝、原 session/接纳唯一等场景通过。官方 factory/Host shutdown/effect operator 三文件回归为25 PASS/1 SKIP/0 FAIL；SKIP 为 Windows 不适用的 POSIX chmod 用例，不声称 Windows ACL 已认证。本轮 `pnpm check`、`git diff --check` 均通过，包含原生源码/hash/import 守卫；HTTP 文档 bullet 的静态检查冲突已修正。未重跑完整 routing 或 containment，不宣称它们全绿。

## 下一步

优先保持刚恢复的任务持续处理，不为新入口立即重启。完成新入口余下守卫/真实应用接线验证、源码清单检查及 PR；合并后在不扰动原任务的条件下按 Windows runbook 部署。最终集中保留本轮证据与结果，清理不再使用的临时资源。主检出已有其他会话的大量改动，不纳入本分支。
