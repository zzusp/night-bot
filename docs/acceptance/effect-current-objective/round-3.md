# 第三轮：删除全任务新授权门槛与 Router 完整调度

## 版本与范围

2026-11-12，在隔离分支 `worktree-router-scheduling-authority` 的未提交工作树验证；HEAD 与本轮末次 fetch 的 `origin/main` 均为 `2e25d6657c1add403f544622866cf357f09d0a2e`。旧 PR #79 已合并，本轮不继续 push 其旧分支。

直接删除已结清效果之后的 `TASK_EFFECT_NEW_AUTHORIZATION_REQUIRED` 工具/完成门槛及服务验证回调，不以 Router grant、来源作者、自然语言前缀或另一种新目标许可替代。可信 Router 可以调度等待、暂停、取消、完成和本地归档任务，保持原 task/session。`new-action` 仅为可选人工运维入口。

### 最终源码字节

| 文件 | SHA256 |
| --- | --- |
| src/tasks/single-session.js | 52410191bfbb464b579f719e6bc6c918f45451bc55ead37b832d543a9e44b08e |
| src/channels/router-ledger.js | ff86235f24168d3325f4212136447ebfaff94c98ac2f2aa293a75dd6e5de67a8 |
| src/channels/resident-router-business.js | 83603fa2b91042aa464cfd5a820127b776178799bccc0feefe57a853de17a8ea |
| packages/dingtalk-core/task-session-service.js | c134984a8640804ba531d21dd40f9432aefad5bfecb5c50776aa4f6be48f1e03 |
| packages/dingtalk-core/dynamic-task-store.js | 77f4e245576cda2301ba410d1e748e09ddf3c5d0f8ec536ff7742b5597179d74 |
| packages/dingtalk-core/task-archive.js | 19b60f03536410acaf8d5e9f41c1b65b607491b637f32dbdd9646b4da37ce77c |
| test/pi-resident-router-flow.test.js | f278f263d9782b77dc916c0fe574047cce94c3922839c601dab623111b110a1b |
| test/pi-router-ledger.test.js | 01bbb62a329808050fe72205cd1889f07f96282780d96be4f665f17f7a452b50 |
| test/task-notification-retry-native.test.js | 56bc70a4e7be32a34907100df68dce694dfb54599886a4a507224161330a0242 |

各组按实际受验范围绑定：66 条效果和 12 条 Single/对账验证完成后，状态机仅追加 Router 专属终态重激活/归档审计修复；相关分支再由末次账本和原会话调度覆盖。最后仅修正结清结果中的旧“继续须另行明确请求”提示，随后两条原结清中断场景在最终源码上再通过。不声称所有组在以上最终字节上同时全量重跑。交付前另同步真实 Router 系统提示中的旧作者/强制答复限制；完整停启用例在实际模型请求中断言收到完整调度权且没有旧作者限制，再沿全链到终态。

## 实跑结果

| 检查 | 实际结果 | 证明范围 |
| --- | --- | --- |
| 效果证明、调用身份、完成权威、可选 CLI/HTTP | 66 PASS / 0 FAIL / 0 CANCEL / 0 SKIP；295363.2982ms | full 下结清后普通恢复，真实 Pi 文件写和独立同参调用无需 new-action；tool-free complete 不被旧门槛阻挡；原调用一次、旧 noReplay/closure 不变；未结时可读原证据并 wait，真实写仍拒绝；服务冷重开不重放；可选 CLI 私密认证及 crash cuts 幂等 |
| Single 与真实对账 E2E | 12 PASS / 0 FAIL / 0 CANCEL / 0 SKIP；181010.4808ms | 普通单任务终态、真实部分效果与 journal/SQL 中断恢复 |
| 完整路由组首次并行运行 | 96 tests：94 PASS / 1 FAIL / 1 CANCEL / 0 SKIP；1095116.107ms | 已跑全部 routing cohort；失败及修复见下一节，不能写成一次全组全绿 |
| 最终 Router 账本 | 26 PASS / 0 FAIL / 0 CANCEL / 0 SKIP；28038.3275ms | 跨作者调度、历史来源追溯、CAS/代际/跨会话/环反例；来源更新使旧依赖 pending；终态重启提升要求版本且旧验收失效；归档停止保留新来源审计、激活及再次归档不丢原收据 |
| 路由组失败项串行补验 | 2 PASS / 0 FAIL / 0 CANCEL / 0 SKIP；108831.874ms | 真实 Router→Host→原 Pi session 完整停启链，以及历史冻结通知终态；未延长原超时 |
| 最后结清提示调整后复验 | 2 PASS / 0 FAIL / 0 CANCEL / 0 SKIP；91277.5691ms | prepared-only 与 journal-committed 原结清事务由 Router 准入自动收齐，保控制版本和原 session，独立实际写入后完成，无额外新目标来源 |
| 实际 Router 系统提示与完整停启补验 | 1 PASS / 0 FAIL / 0 CANCEL / 0 SKIP；109757.0085ms | 实际模型请求确认完整调度权、无旧作者限制；再沿原 session 停启、冷重开、归档再激活至完成 |
| 来源/哈希/导入/原生运行时 | `pnpm check` PASS；`git diff --check` PASS | 190 retained / 10 retired / 3 excluded UI / 59 adapted；relativeImports closed；425 production/runtime JS，externalSdkImports 0，legacyOrchestratorDefinitions 0 |

真实停启链：首次写 proof → operator 问题等待 → 另一作者触发 Router 暂停 → 无问题 ID/无新授权来源直接唤起并读原 proof → 模型在途时取消且 join 原 owner → 从取消态原 session 再启动并完成 → 关闭 Host 并冷重开后同目标 reopen → 本地归档后再唤起完成。原 proof 只写一次，唯一 task/session，旧 completion event ID 保留，未发外部消息。等待被 superseded，不伪造人已回答。

### 可复跑命令

```powershell
node --experimental-test-module-mocks --test --test-reporter=tap --test-concurrency=1 test/pi-task-effect-reconciliation.test.js test/pi-task-effect-call-identity.test.js test/pi-task-effect-completion-authority.test.js test/pi-task-effect-action-e2e.test.js
node --experimental-test-module-mocks --test --test-reporter=tap --test-concurrency=1 test/pi-task-effect-reconciliation-e2e.test.js test/pi-single-task.test.js
pnpm test:routing
node --experimental-test-module-mocks --test --test-reporter=tap test/pi-router-ledger.test.js
node --experimental-test-module-mocks --test --test-reporter=tap --test-concurrency=1 --test-name-pattern='Router schedules the same|a historical frozen start confirmation' test/pi-resident-router-flow.test.js test/task-notification-retry-native.test.js
node --experimental-test-module-mocks --test --test-reporter=tap --test-concurrency=1 --test-name-pattern='Router resumes through an interrupted effect closure' test/pi-resident-router-flow.test.js
pnpm check
git diff --check
```

首次全组使用进程环境 `$env:NIGHT_BOT_TEST_CONCURRENCY='2'`；默认值为 1。最后只复验失败项与末次影响范围，未再次重复全部 routing cohort；保留首次全组非零退出和并行长链耗时风险，不推断未实跑的最终全组结果。

## 本轮失败与修复

1. 新 Router 调度脚本最初漏调用 `resident_router_settle`，出现 `ROUTER_BATCH_UNSETTLED`（另两条人工答复续接通过）。补齐脚本的真实批次结清，保留生产守卫；后续真实链多次通过，最后含归档再激活。
2. 旧未知效果夹具永远重复提议写工具，在新“允许会话起来核验”合同下不结束，导致效果组 65 PASS / 1 CANCEL。修正脚本：第二次提议仍被实际执行前拒绝，随后报告 wait；原效果/intent 仍 1，无伪造成功或结清。完整 66 条随后通过。
3. 全路由组中新长链在并行运行时超过原 200 秒而被取消；同一断言和超时串行补验，业务用例 85918.7676ms 通过。未证明并行超时的唯一根因，未延长超时来盖过问题。
4. 历史冻结通知用例稳定复现 `TASK_WORKSPACE_NOT_READY`，模型请求数 0：夹具直接创建原始账本任务，未兑现 Windows 原生目录初始化事务。复用 `initializeMemoryTaskWorkspace`，真实执行 begin/目录创建/finish；保留原通知及任务完成断言，补验通过。生产工作区检查未放宽。
5. 交付前核对实际 Router 系统提示，发现其仍有旧作者与必须绑定人工问题的指令；已与工具合同同步。完整调度用例新增实际 provider 请求断言后，沿同一会话全链再通过，未仅检查静态字符串。
6. 自查终态激活路径发现可能复用旧依赖验收；修复为要求版本递增并经 same-goal reopen 的依赖重绑定，补反例通过。归档停止来源纳入任务 sourceRefs，真实导出验证及再次归档通过。均不新增调度授权。

## 边界与实际安装

- 保留当前可信 Router 身份/代际、所属会话、CAS、持久幂等、单业务 owner、真实 drain、精确旧调用 noReplay。依赖由 Router 重安排/评估，不变成人工授权。
- 未结效果、未结作业或离线恢复待审不拒绝会话起来读证据；真实新副作用和 complete 继续受各自结果边界保护。核验会话不为旧租约伪造 owner-drained 证明。
- 冷重开为真实 Host/服务关闭再 boot，并非重新启动 Windows。CLI/HTTP 为隔离测试的真实进程/端口，模型为本地脚本，DingTalk 为 fake；未执行真实厂商集成。
- 未跑全量默认、runtime、containment 或 Web UI 组；本轮未改沙箱、权限模式默认值或 UI，不借 full 绕开 containment。
- 未合并本轮补丁、升级实际安装、修改运行 SQLite/Pi journal/旧收据、向真实渠道发消息或触发 CI。
- 原业务任务尚未续跑；未改业务仓库、发布业务系统、生成或读回中英文 Excel。本轮平台代码与本地证据不等于业务验收完成。后续按唯一 [goal](goal.md) 跟踪。
- 第一、二轮报告保留历史；最终证据以此自包含文字、受验源码及可复跑用例为准，未向仓库复制完整临时日志、凭据、业务数据或私密 Skills。
