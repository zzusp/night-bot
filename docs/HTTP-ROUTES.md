# 本机 HTTP 路由与历史只读入口

以下为 `packages/dingtalk-core/http.js` 的静态 pathname；动态任务、来源/效果及历史审计路径在同一文件。服务仅监听 loopback，此清单不增加权限；任务创建、上下文补充、取消/重开仍校验配置操作员、来源及任务版本。

## 当前任务入口

- 任务创建：`POST /tasks` 创建任务；`POST /tasks/:taskId/context`、`/cancel`、`/reopen` 通过已认证控制入口补充或调整原任务。
- 任务查询：`GET /state/tasks` 及任务 detail/执行历史查询保留。活动任务直接关联来源，不用 `topicId` 取得执行或查询授权。
- 历史审计：`GET /state/topics`、`/state/topics/:topicId` 与其历史子查询，以及 `GET /state/fixed-topics` 仅保留旧审计读取；响应带 `x-night-bot-legacy-readonly: true`，不证明旧 Topic 仍在处理消息。
- 活动 `topics` / `fixed-topics` 写入口、`routing-hold` 与 `/runtime/task-topics/` 写操作返回 HTTP **410**、`TOPIC_ROUTING_RETIRED`。任务路径使用 `topicId` 查询参数也明确拒绝，不偷偷按 Topic 查任务或转成新业务。
- 配置、排期和查询的真实能力由受控 Router/平台工具承接；旧路径可读不表示旧写操作恢复。Router 的 `resident_*` / `platform_*` 是模型受控工具，不是本页新增的公开 HTTP API。

## 直连消息重试

`POST /config/groups/:groupId/messages/:messageId/retry` 仅接受本机已认证管理请求，正文严格为：

```json
{"sourceId":"SOURCE_ID","messageVersion":1,"phase":"triage"}
```

`phase` 只能为 `triage` 或 `router`，不能夹带旧 token/decision 字段。Host 校验 sourceId、conversation、messageId 和当前版本；已分诊来源不能重走 `triage`。旧 `routing` / `decision` / `host` phase 明确返回 410 `TOPIC_ROUTING_RETIRED`，其它非法字段返回 400 `MESSAGE_RECOVERY_REQUEST_INVALID`。返回 `status: "attempted"` 只表示该次恢复尝试已调用入口，不证明 Router 已 settle、任务完成或通知送达。通知重试仍使用其独立 `expectedToken` 合同，不与消息重试混用。

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
