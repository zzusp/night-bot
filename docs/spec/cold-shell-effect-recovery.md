# 冷 shell 效果恢复

## 问题与目标

冷崩溃可能只留下 shell 的 effect-intent 与 job/registered，没有原执行者的 owner-drained。既有离线 jobs close 已能核验原生产者不再执行并记录 unknown/noReplay；但后续真实只读会话排空后，effects inspect 仍因原证明缺失无法进入操作者对账。

本次仅打通这两条既有受控路径。保留原调用、历史与永久禁重放，不把操作者声明转换为原生产者 join，也不把未知效果解释为成功。

## 方案取舍

1. 直接接受后续 owner-drained：拒绝，无法绑定原生产者，不足以排除原作业仍在运行。
2. 新增独立离线 effect 写入器：不采用，会重复安装锁、Pi writer、操作者证据和 SQL/native 事务。
3. 复用已提交 job/reconciled，加上真实最新 owner-drained，再走现有 effects inspect/close：采用。没有原证明时只允许唯一、精确匹配的 bash/pwsh 原生作业；其他工具保持原要求。

## 合同

- 原 intent、已接纳 input、assistant call 与作业登记必须在同一选中分支；作业必须在 intent 之后登记，且没有跨越同 ID 的另一调用。
- 只支持直接 shell 调用，登记的 owner/callId/rootCallId/toolName/kind 均精确匹配；多候选拒绝。
- 原生作业账本必须完整且无未决/保留资源；引用唯一合法 job/reconciled 与原 registered，校验登记摘要及分支顺序。
- 最新核验执行者必须有真实的 owner-drained；仍核对 admitted input、scope、当前分支及切点后没有新增业务内容。该证明只描述核验执行者。
- inspect 和 effect-reconciled 可选携带冷作业收据的 entryId/digest；在线与离线校验使用同一规则，不接受与当前证明不一致的可选引用。旧正常证明路径与旧回执保持可读。
- 仍由已有能力凭据与 webActorId 记录操作者读回；SQL prepare / native commit / SQL projection 及重启恢复不变。
- 结论固定 possible-partial-effects / noReplay。只解除精确旧效果的挂起，不调度、不发消息、不新增独立调用的授权门。

## 验证

扩展既有严格 Pi 测试验证精确绑定及错误调用、摘要、分支、资源和切点反例；扩展真实原生作业 CLI/Host 测试，离线 check 零写、关闭作业、冷恢复真实核验排空、关闭效果、离线闭包校验与后续独立 shell 成功。运行相关效果/作业恢复回归及原生源码/导入/hash 守卫。部署仅使用已合并正式发行，现场与本地结论分开记录。
