# 明确新交办的首轮派发：隔离验证

基于 main `1878f0dc752db92083bf032d9eb6297fafced0ab`。本次没有改调度、权限、回执或恢复运行时，只在现有 Router ingress 提示和 resident_task_plan 描述明确首轮短路径，并补真实 Host/Pi/SQLite 回归。

## 已有生命周期

`resident_task_plan` 经现有 source/version/generation 校验原子提交 `router.plan`。task-session-service 的 command 路径完成受管工作区准备，随后 `applyDirectTaskAction(kind=materialize)` 完成来源材料并通过现有 hostScheduler 调用 schedulePending。它不等 Router 的后续模型请求、用户回复复核或整轮结束；必要的工作区/材料、容量、租约、依赖与权限检查仍在。已有唯一任务沿用 #223 的精确 taskHandoffs，不因这条指引再建任务。

## 受控证据

测试不调用 whenIdle/recover 来触发首次执行。让 Router 首次提交计划，在接下来模型请求的收尾或已有正文复核中设置可控 barrier；执行会话发出真实模型请求，Pi 日志有已提交 task-input，再在 Router 尚未释放时实际 task.complete。其完成事件随后回同一 Router；普通场景重复同一入站及 Host 重启不多建任务、不多启动或发送。依赖场景只允许 A 启动，B 在 Router 未核验依赖前 leaseEpoch=0。

旧版对照实际归档运行上述 main，但由脚本选择“先查任务目录、再读记忆目录、再计划”的有界路径；它也能在 Router 收尾受阻时独立执行，证明这项生命周期原本就存在。新版脚本依据新指引首个 Router 请求直接 plan，动作前实际工具结果为空。这个对照验证请求机会和接线，不证明旧版真实模型必然多两轮，或新版真实模型必然遵循指引。

该次单独运行的毫秒值如下，只用于说明可复核边界，不作性能基准：

| 场景 | 持久 inbox.createdAt→Router 模型请求到达本地端点 | 该请求→router.plan 持久提交返回 | 提交→原执行会话首次模型请求 | 计划前工具 / 请求数 |
|---|---:|---:|---:|---|
| 旧提示有界目录路径 | 441 ms | 178 ms | 402 ms | task query、memory read / 3 |
| 新提示，Router 收尾受阻 | 260 ms | 14 ms | 321 ms | 无 / 1 |
| 新提示，正文复核受阻 | 225 ms | 10 ms | 513 ms | 无 / 1 |
| 新提示，B 的依赖未满足 | 255 ms | 12 ms | 360 ms | 无 / 1；B 不启动 |

所有正例均在 Router barrier 尚未释放且外发为零时确认执行已完成。正文复核场景保留一次真实工具链复核；仅使用本地脚本模型和合成渠道，不访问线上、生产或真实厂商模型。不改默认权限、受众、压缩/常驻策略，不新增第二路 Router 模型或自动回复。

## 结果及边界

- 组合 83/83：首轮新派发、#223 接续/完成、同会话任务范围、依赖、#218 与 #221 等。
- 旧 cold/#216 部分结清恢复 15/15。最后精确计时及完成回 Router 断言的专项 7/7。
- 状态查询先读真实索引并答复；闲聊静默；目标/范围歧义先具体澄清，均不建任务。这些语义选择由脚本给定，不是实际大模型语义验收；多匹配的 #223 投影回退继续由相关回归覆盖。
- pnpm check 的源/hash、生产 imports、原生运行时检查通过；全仓库与 Web 浏览器套件未跑。
- 额外尝试“未满足依赖的 B 跨 Host 重启后再 whenIdle”未收敛：restart/recover 已返回，账本显示 A 已完成、B active/drained 且 leaseEpoch=0，Router inbox 已消费，未观察到 B 被执行。尚未定位是既有产品问题还是夹具空闲收敛问题，不宣称该跨重启组合通过，也没有修改恢复/调度或用清除依赖来伪造通过。通过用例中依赖场景只验首轮、完成回 Router 与重复入站，其余正例单独覆盖重启。该额外探针已终止，仅涉及临时合成安装。

复跑：`node --experimental-test-module-mocks --test test/pi-router-first-dispatch.test.js`。旧版对照需要 Git 中保留基线 commit；无须真实配置。
