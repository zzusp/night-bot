# 本机 HTTP 路由与历史只读入口

以下为 `packages/dingtalk-core/http.js` 的静态 pathname；动态任务、来源/效果及历史审计路径在同一文件。服务仅监听 loopback，此清单不增加权限；任务创建、上下文补充、取消/重开仍校验配置操作员、来源及任务版本。

## 当前任务入口

- 任务创建：`POST /tasks` 创建任务；`POST /tasks/:taskId/context`、`/cancel`、`/reopen` 通过已认证控制入口补充或调整原任务。`/cancel` 必须提供非空 `reason`（最多 2000 字符），并校验 `expectedControlRevision`。`/context` 的 `progressImpact: "preserve"` 请求可显式填 `suppressChannelOutcome: true`：当前补充版本的完成、阻断或技术停止不发渠道回报，结果及依赖评估仍保留。省略字段维持默认回报行为；文字里写「不发群」不能替代这个参数。
- 任务查询：`GET /state/tasks` 及任务 detail/执行历史查询保留。列表的 `state` 可取 `queued`、`running`、`interrupted`、`completed`、`cancelled`；完成和取消分别筛选。详情按记录返回 `cancellationReason`，旧记录可能没有该字段。活动任务直接关联来源，不用 `topicId` 取得执行或查询授权。
- 历史审计：`GET /state/topics`、`/state/topics/:topicId` 与其历史子查询，以及 `GET /state/fixed-topics` 仅保留旧审计读取；响应带 `x-night-bot-legacy-readonly: true`，不证明旧 Topic 仍在处理消息。
- 活动 `topics` / `fixed-topics` 写入口、`routing-hold` 与 `/runtime/task-topics/` 写操作返回 HTTP **410**、`TOPIC_ROUTING_RETIRED`。任务路径使用 `topicId` 查询参数也明确拒绝，不偷偷按 Topic 查任务或转成新业务。
- 配置、排期和查询的真实能力由受控 Router/平台工具承接；旧路径可读不表示旧写操作恢复。Router 的 `resident_*` / `platform_*` 是模型受控工具，不是本页新增的公开 HTTP API。

## 健康与任务待处理

- 健康接口 `GET /health` 的 `recoveryIssueCount` 只统计运行恢复异常；新增 `taskAttentionCount` 统计任务待处理项。等待登录身份、用户答复、明确授权或外部服务恢复不直接导致核心 `degraded`。
- 恢复明细 `GET /state/recovery-issues` 保留真实运行问题：会话/排空/技术失败、未结清作业或效果、未知通知等。已有执行存储与渠道健康判定不变；`ok` 不代表业务任务完成或渠道送达已验证。
- 告警列表 `GET /state/supervisor/alerts` 仍返回全部告警，每项新增 `type: "runtime" | "task"`；ID、fingerprint、原问题和任务状态不因分类改变。
- 分页使用 `GET /state/supervisor/alerts?limit=10&type=task` 或 `type=runtime`，默认 `type=all`。分类变化会使旧分页 revision 失效；历史过滤值仍保留。
- 分类由 Host 的持久故障、未知效果和任务决定字段投影，不从模型 summary 猜测严重性，不清除记录、自动重试或放宽 no-replay。相同任务可同时保留独立运行故障与待处理项。

## 直连消息重试

`POST /config/groups/:groupId/messages/:messageId/retry` 仅接受本机已认证管理请求，正文严格为：

```json
{"sourceId":"SOURCE_ID","messageVersion":1,"phase":"triage"}
```

`phase` 只能为 `triage` 或 `router`，不能夹带旧 token/decision 字段。Host 校验 sourceId、conversation、messageId 和当前版本；已分诊来源不能重走 `triage`。旧 `routing` / `decision` / `host` phase 明确返回 410 `TOPIC_ROUTING_RETIRED`，其它非法字段返回 400 `MESSAGE_RECOVERY_REQUEST_INVALID`。返回 `status: "attempted"` 只表示该次恢复尝试已调用入口，不证明 Router 已 settle、任务完成或通知送达。通知重试仍使用其独立 `expectedToken` 合同，不与消息重试混用。

## Router 操作者续办

`POST /operator/router` 由 application 接线，限 loopback、准确 Host/端口、无 Origin、唯一 Bearer capability，且在读取正文前鉴权；不复用 Web cookie 或普通渠道身份。私有 token 由 `operator-capability` 保管。仅接收 JSON，不提供任意 SDK、代码或模型工具入口。

- inspect：`{"command":"inspect","conversationId":"CONVERSATION_ID"}` 返回 `{proposal,eventIds,pendingCount}`，仅元数据，无业务正文。
- check：`{"command":"check","proposal":{...}}` 零写检查；proposal 精确包含 `conversationId,generation,sessionId,packetId,failedEntryId,checkpointRevision,inboxDigest`，不接受额外字段。
- resume：`{"command":"resume","proposal":{...}}` 按原 Host 合同重验并续办；保留来源授权、当前 owner、原输入唯一接纳、claim、效果及 15/30 限制。全部原/新增事件消费才返回 `settled:true`。

检查不创建 owner、不清错误、不调模型。执行不会因客户端断开自动回滚或重试；不确定时按 [runbook](ops/windows-local-runtime.md#router-模型错误的显式续办) 先读回。响应 `cache-control:no-store`，只输出安全错误码，不返回异常正文、token 或完整历史。

## 静态路径索引

- `/config/agent`
- `/config/groups`
- `/config/groups/search`
- `/config/message-ingress`
- `/health`
- `/runtime/maintenance`
- `/state/activities`
- `/state/activity-audit`
- `/state/agent-config`
- `/state/authorizations`
- `/state/dws-bridge`
- `/state/environment`
- `/state/fixed-topics`
- `/state/groups`
- `/state/performance`
- `/state/recovery-issues`
- `/state/supervisor/alerts`
- `/state/task-model-options`
- `/state/task-timings`
- `/state/tasks`
- `/state/topics`
- `/state/version`
- `/tasks`
- `/test/inbound`
- `/test/outbox/ack`
- `/test/subscriptions`
- `/test/supervisor/probe`

### 执行 trace（诊断只读）

`GET /state/execution-trace` 读取独立 native 诊断域性能分区的限量元数据。
必须指定 `sessionId`、`taskId`、`groupId` 或 `sourceId`；按来源查询须提供
`sourceVersion`。支持 `runId`、`offset`、`limit`（默认 100，最多 500）和
毫秒窗口 `startedAt`、`endedAt`。当前任务、渠道、来源范围沿 TaskService 校验。
模型、工具、阶段按并集扣重；未知耗时不等于空转，不返回正文、工具参数或凭据。
每分区保留最多 2048 条，成功新写批次施加全局 4096 条预算；淘汰最旧 trace
窗口时保留所有聚合指标、去重状态和淘汰范围。旧快照在下一次新写前可能超限，
只读或重复事件不触发迁移。`globalRetained`、`globalBudgetExceeded` 返回实际
保留量与超限状态，`globalBudgetPolicy` 为 `enforced-on-successful-write`。
旧 resident 性能分区只读回退，新同键分区整体覆盖，不双计数。诊断损坏或写入
失败时 `diagnostics.available` 为 false，不阻止业务恢复；关闭等待已接纳写入。
历史不补造、缺边界与被淘汰记录均不宣称完整，诊断不能用于业务重放或授权。
