# 结清后的普通续办与可选人工入口

已结清的未知效果不再触发任务级“所有后续非只读工具都须专门操作者新目标授权”策略。`TASK_EFFECT_NEW_AUTHORIZATION_REQUIRED` 的调用与完成门槛、对应验证回调均已删除，不替换为 Router 授权来源、来源前缀或另一种新目标许可。

- 后续独立调用按现有权限模式、当前目标和实际工具边界执行；独立 native invocation 可以有相同参数。
- 原具体调用仍依据官方 call/input/intent 身份永久禁止重放；旧结清仍记录可能存在部分效果，不能改写为旧操作成功。
- Router 可创建、启动、停止、解除等待、重开或再次唤起原唯一 session，不要求原消息作者或安装操作者补调度批准。动作来源可省略并沿用原任务来源；历史消息只用于追溯。
- 尚未结清的效果/作业或恢复档案仍待业务核验时，原会话可被唤起读证据和汇报 wait/blocked，实际副作用和完成仍受对应效果边界约束。这不是新目标授权策略。
- 原结清事务若已 prepare 或 journal 已提交而 SQL 尚未投影，Router 调度先在原准入/原生 writer 边界完成已经核验的原结清，保持原控制版本供同一调度命令消费；不重放业务操作、不索要新授权。

## 可选人工运维

私密 HTTP `POST /tasks/:taskId/effects/new-action` 和 CLI 仍可供安装操作者主动记录说明、修订目标并激活，不是普通续办的必经步骤：

```powershell
node bin/night-bot-effects.js CONFIG new-action AUTHORIZATION.json --operator-text-file NOTE.txt
```

此入口的严格 JSON 仍包含 `taskId`、唯一 `requestId`、完整 `closedIntentEntryIds`、非空 `objective` 及当前 `expectedRequirementRevision` / `expectedControlRevision`。NOTE 是真实操作者说明。独立私密能力保护该运维入口，不进入模型文本或任务状态；模型不能伪造操作者身份调用它。

入口持任务准入与真实原生 writer，校 committed SQL closure、官方日志、原调用/输入/接纳、当前范围和实际排空。活动态先以完整提案/说明摘要绑定的确定性命令暂停，再保存操作者来源、修订、激活；暂停/来源/修订/激活各中断点仍按原稳定请求幂等重试。同 ID 换内容拒绝，已激活后重试不重复效果。这个可选入口自身的参数校验不会成为其他执行路径的许可条件。

## 验证入口

`test/pi-task-effect-completion-authority.test.js` 实跑普通恢复后的真实文件写入、独立同参调用、无需改要求版本的完成、冷服务恢复和未结效果核验；`test/pi-task-effect-call-identity.test.js` 保留精确调用与无重放反例；`test/pi-resident-router-flow.test.js` 贯通真实 Router/Host/SQLite/原 Pi session 的停启、取消排空、冷重开及结清事务中断恢复。可选 CLI/HTTP 认证和幂等场景仍在 `test/pi-task-effect-action-e2e.test.js`。本轮结果见[唯一目标](acceptance/effect-current-objective/goal.md)，不拿历史通过数替代当前版本。
