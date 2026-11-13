# 第三轮：本地恢复告警与接入状态

## 范围与版本

用户要求处理本地 `degraded` 的两项恢复告警及两路钉钉 `recovering`。本轮修复接入状态误报，并通过正式入口核验另外两项告警；整体仍为 **PARTIAL / BLOCKED**，不写全绿报告。

- 实际安装仍运行 `457585e5879a707c7be33d3e6737081934272f86`，没有重启、重复迁移或替换发行。
- 修复以最新已取回的 main `7f84c1fb91303b02b73a10b63de26ffb0ca1f560` 为基线；验证时 HEAD `c3e7f8c8c07c69aa7b605e1029e1fba35613ebec`，工作树含本轮源码、测试及文档增量，不能仅用 HEAD 表示已测代码。
- 已测 Git blob：`src/channels/plugins/dingtalk-dws.js` = `da490db3d6e0cf72f2f11ecf73b694cb696e8b9e`；`test/pi-channel-plugin.test.js` = `5414d83675bb252b2df722339c99e0bf14de7ad1`。
- 本轮未读取或修改其他仓库；旧任务正文仅作历史定位数据，不作为外部修复、更新 PR 或部署授权。

## 结果

| 场景 | 结果 | 关键证据与边界 |
| --- | --- | --- |
| 两路真实接入状态 | PARTIAL，排除持续回填卡死 | 认证 `/api/channels` 连续 15 次取样中，两路均多次到达 `receiving`，约每十秒的普通轮询期间又变为 `recovering`；不是始终处于恢复中 |
| 持久回填事实 | 已核实推进 | 两路游标均 `paused=false`，无已保存的 `recoveryFromAt`，未留 deferred/pendingRecalls；`backfillThroughAt` 已超过本次启动时刻 |
| 普通轮询状态修复 | PASS，本地 fake DWS | 真实 plugin/adapter/bridge 定时拉取挂起时，旧实现实际为 `recovering`、期望 `receiving`，1 项断言失败；去除仅由 `backfill.inProgress` 引起的恢复判定后通过 |
| 相关接入回归 | PASS | 6 tests、6 pass、0 fail、0 cancelled、0 skipped；覆盖群聊/私聊暂停重启去重、在途排空及旧监听拒绝、失败历史保留恢复界、认证等待与关闭禁用；新增用例也核实普通增量历史不完整仍进入 error |
| 项目守卫 | PASS | `pnpm check` exit 0：覆盖/来源清单、生产 import、native runtime 守卫均通过；无外部 DSH SDK import |
| 原任务效果核验 | BLOCKED | 现有 `night-bot-effects ... inspect` 正式返回 `TASK_EFFECT_DRAIN_CUT_CHANGED`，不是回执查询成功，也没有执行 close |
| 原 Router 批次 | BLOCKED | 原生最后 assistant 为 `aborted`，含未配对 action toolCall；原 packet 后还有 3 项较新 pending 输入。现有续办只接受 error checkpoint、未决工具效果为空且 pending 全集与原 packet 相同，当前现场不满足 |
| 实际健康 | 未恢复 | 本轮只读回查 `/health` 仍为 `degraded`、`recoveryIssueCount=2`；未过滤或删除告警 |
| 修复部署 | NOT_DEPLOYED | 本轮未获新修复 PR 的明确合并授权，且仍有恢复处置缺口；不把分支实跑写成正式安装已升级 |

## 原因与最小修复

`dingtalk-dws.js` 的 `getStatus()` 把所有 `backfill.inProgress` 都归到恢复中。bridge 完成首次补拉后保留 `backfill.state=ok`，定时增量读取只设置 `inProgress`，于是正常接收状态周期跳变。内部 `health.groups` 与公开 `health.conversations` 有显式转换，字段错配假设已排除。

只移除这一个误判条件。首次补拉的非 ok 状态、监听未 ready、`ingress.recovering`、`recoveryRequired` 和失败历史仍沿原判断；未改历史查询、消息接纳、持久化水位、暂停/排空、来源权限及 no-replay 守卫。README、渠道说明和 Windows runbook 同步解释该状态含义。

## 两项恢复阻断与未执行动作

严格 Pi journal 解码启用安装 portable codec 及 `requireComplete:true`；SQLite 仅以 `readOnly:true` 读取，未编辑任一运行文件或表。

旧任务问询中提及的后台作业，原 `job/settled` 收据已显示 producer 结束。真正缺少结算的是另一次文件写 intent，原工具结果为 `TASK_EFFECT_UNCERTAIN_NO_REPLAY`、无对应 effect-result。目标现有文件与原请求字节不相同，不能据此推断全部未生效或已成功。原排空证明绑定旧 lease，其后又有实际 business inputs、模型及工具消息；现有 inspect 正确拒绝过期排空切点。没有把工具报错文本当作未开始效果证明，也没有调用 close、重放作业、补写证明或标记任务完成。

Router 在先前正常停机期间已有 admitted 批次被中止；后续真实输入仍持久排队。现在直接调用 resume 既会触及新输入拒绝规则，也不满足 error checkpoint 和工具结果配对要求。未以更换 packet、改写 stopReason、删新消息、伪造结果或代理过滤 inbox 绕过保护；没有发起模型轮或真实测试消息。

比较的处置路径：

1. 清警或直接改任务完成：不能证明效果已结清，排除。
2. 自动重新投递原输入/原作业：可能重复外部副作用，且丢失原批次身份，排除。
3. 保留现场、经可信效果核验和 Host 维护处置：安全方向，但当前公开 Host 合同不能覆盖“旧 owner 排空后已有新轮次”和“aborted action 加新队列”这两个切点。继续闭环需要绑定原 owner/调用/后续增量的可信核验与明确处置，再经正式 Host 能力落账；不能通过放宽现有守卫解决。

因此本轮只对已确认的状态误报交付代码修复；两项恢复告警保留为真实阻断，不宣称整个用户目标已完成。历史界面回归及 usageCoverage 不在本轮修改范围。

## 证据与资源边界

- 修复前：`node --test --test-name-pattern='ordinary incremental history remains receiving' test/pi-channel-plugin.test.js`，1 fail，实际 recovering / 期望 receiving。前一次清理钩子顺序尚未修正的诊断试跑已中止，不计通过；随后取得上述明确断言失败。
- 修复后：`node --test --test-name-pattern='DWS ordinary incremental|DWS receive pause|DWS pause drains|DWS recovery failure|DWS waiting-auth' test/pi-channel-plugin.test.js`，6/6，通过实际 fake CLI 范围读取和持久化，不是单独 mock getStatus。
- `pnpm check` exit 0；未跑全量测试、Linux 或真实供应商回放，不用本轮结果替代这些结论。
- 现场取样时间 `2026-11-13T01:59:25.134Z` 至 `02:00:15.212Z`。两路同时 receiving 的观测包括 `01:59:29.863Z`、`01:59:48.320Z`、`02:00:15.212Z`；轮询中的 recovering 包括 `01:59:35.065Z`、`01:59:57.237Z`。
- 当前任务 10 项，9 completed、1 waiting；未发起新任务/消息、未 close/resume、未修改部署配置。真实适配器持续运行，不能宣称所有运行文件字节冻结。
- 主仓状态指纹仍为 `f2c1a6b06ed3af29ae9916a7d2674680c2f01288`；原正式监督器、发行及 data 保留。本轮没有临时业务副本、凭据副本或本地备份。公开记录只保留聚合状态和错误码，不收录原消息、任务正文、原调用参数或身份。
