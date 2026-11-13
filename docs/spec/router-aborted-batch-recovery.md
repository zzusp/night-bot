# Router 中止批次恢复

## 目标与证据

正常停机中止 Router 推理后，原已接纳批次不结清；后续真实输入仍能获得分诊首答，却被原批次堵住。当前现场同时有较新取消/延期输入，不能单独恢复旧发布请求。原动作在 Host 的绑定 operation 账本中未落账，不据此推断所有外部世界状态。

固定 Pi agent-core 1.5.0 的 `dist/agent-loop.js` 在 error/aborted 分支先结束回合，再到 executeToolCalls；所以最后 aborted assistant 中的 toolCall 是未派发生成，不等同于此前 toolUse 后缺结果的未知调用。应用不修改历史、不补造 toolResult。

## 方案比较与决定

1. 停机一直等 Router 结清：只能预防部分新中断，不能修复当前历史，而且模型/外部效果可能无限等待。保留现有可取消关闭，不选。
2. 重新 enqueue 原事件或清理 pending：破坏耐久输入唯一性、重放保护与来源约束，不选。
3. 扩展现有 Host checkpoint 续轮：仅明确 aborted 的普通冷恢复可领取一次；原生 error 仍需显式 Host 续办。检查原会话/代际、严格完整 journal、原 packet 和事件前缀及工具结果；仅排除最终 aborted assistant 的未派发调用，其前工具结果错误/缺失、未决 job/effect 仍阻断。选此方案。

## 输入与执行边界

- 原业务 packet 不再 enqueue/admit；非业务 claim 持久化后再行动，同一失败 checkpoint 只领取一次。
- 新增的真实 pending 来源经原 authorize/admission enqueue，在官方 Session 中以 triggerTurn=false 写入真实 business-input，耐久接纳后再触发原生续轮。非业务控制消息不承载新来源或授权。
- 续轮的 current 来源是原 packet 加新增真实 packet；模型同时看见所有新取消/延期，不把旧生成动作当指令。推理前再次检查 owner、完整 pending 数量、顺序和来源版本；新变化拒绝本轮，不绕过授权。
- 恢复联合批次仍至多15条人类消息/30事件和现有编码预算。分页外有事件或超限时失败关闭，不能为了恢复忽略后面的取消消息。普通队列上限与 overflow 行为不改。
- 自动恢复只尝试最后 aborted checkpoint，已领取后再次失败不循环重试；原生 error、未知工具效果保留现有告警。只有联合批次真实 settled 才清警并继续正常排空/无工具交接。
- 不新增 HTTP/CLI/模型维护工具，不直接改 SQLite/Pi 历史；不处理另一个任务的未知 write 效果，不直接操作业务仓库或生产。

## 验证与交付

复用真实 Host、官方 Pi、隔离 SQLite、脚本化本地模型及 fake 渠道，先复现流式生成被正常 close 中止。覆盖新取消输入先可见、原输入唯一、已完成效果不重复、失败工具/未决效果仍拒绝、分页外较新来源拒绝和重启幂等。相关回归和 pnpm check 后合并 PR #100，独立干净发行部署；原 data 原位且不备份。真实群终态与仍保留的旧任务告警分别回读，不发送测试消息。
