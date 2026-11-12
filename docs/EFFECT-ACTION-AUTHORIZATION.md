# 结清后的普通续办

已结清的未知效果不再触发任务级“所有后续非只读工具都须专门操作者新目标授权”策略。`TASK_EFFECT_NEW_AUTHORIZATION_REQUIRED` 的调用与完成门槛、对应验证回调均已删除，不替换为 Router 授权来源、来源前缀或另一种新目标许可。

- 后续独立调用按现有权限模式、当前目标和实际工具边界执行；独立 native invocation 可以有相同参数。
- 原具体调用仍依据官方 call/input/intent 身份永久禁止重放；旧结清仍记录可能存在部分效果，不能改写为旧操作成功。
- Router 可创建、启动、停止、解除等待、重开或再次唤起原唯一 session，不要求原消息作者或安装操作者补调度批准。动作来源可省略并沿用原任务来源；历史消息只用于追溯。
- 尚未结清的效果/作业或恢复档案仍待业务核验时，原会话可被唤起读证据和汇报 wait/blocked，实际副作用和完成仍受对应效果边界约束。这不是新目标授权策略。
- 原结清事务若已 prepare 或 journal 已提交而 SQL 尚未投影，Router 调度先在原准入/原生 writer 边界完成已经核验的原结清，保持原控制版本供同一调度命令消费；不重放业务操作、不索要新授权。

## 旧入口已退役

`authorizeTaskEffectAction`、HTTP `POST /tasks/:taskId/effects/new-action` 和 CLI
`new-action` 不再提供任务执行授权。不要为继续任务构造授权提案或改写旧账本。
未知效果仍通过 inspect/close 核验结清；结清后由 Router 根据正常消息调度原会话。

## 验证入口

`test/pi-task-effect-completion-authority.test.js` 验证结清后独立调用和完成不需新授权；
`test/pi-resident-router-flow.test.js` 验证普通消息到 Router、原任务会话和真实文件写入，
包括结清事务中断恢复；`test/pi-task-effect-action-e2e.test.js` 验证旧入口不可再用。
