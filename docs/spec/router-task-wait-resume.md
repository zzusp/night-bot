# Router 判断后的原会话续接

## 目标与证据

任务已经提交带问题的 wait；后续补充保存为新 contextRevision，但 operator 等待没有可用的群补充复核入口，调度在 taskHumanWait 前停止。requester 等待则会启动执行侧只读复核，语义 owner 与常驻 Router 重叠。目标是让 Router 判断信息是否充分，通过任务动作可靠交给原唯一执行会话。

## 选择

1. 所有 supplement 自动解除等待：拒绝，普通补充不代表条件已满足，其他参与人也不能借此取得任务控制权限。
2. 给 operator 增加执行侧 humanReview：拒绝，仍由执行角色重复作语义判断，不能兑现 Router 的决定。
3. 在既有 resident_task_action 增加 resume：采用。Router 先查询任务和原文；明确继续时提交 humanRequestId、expectedContextRevision、reason 及来源版本。普通 supplement 只保存信息并维持等待。conversation 任务不再自动进入执行侧 humanReview；非 Router 历史路径不变。

## 事务与边界

- resume 复用任务动作的业务幂等回执、conversation/generation、最新来源版本、作者权限以及 requirement/control 版本校验；技术等待仅原任务提出人或已配置操作者可控制续接；业务答复沿用受信会话成员供给信息、由 Router 核对角色和既有授权的边界。
- 原任务须 active、已排空、未恢复中，待答请求 ID 和版本须当前有效；来源须是问题提出后同会话的认证人类消息。拒绝内部事件、引用借权、旧来源、跨任务及旧请求。
- 在同一 SQLite 事务保存补充、原请求 answered 和 Router 判断依据。保留原 sessionId，既有持久 wake 驱动普通执行；执行输入含全部待接纳补充和已回答请求。
- 不改权限模式、单调用批准、未知效果对账、依赖、取消/排空或重放规则；技术问题的 answered 不是外部副作用的授权。
- 不新增 schema、外部依赖、重试调度或第二执行会话。已有等待不会仅因升级而解除，需 Router 的明确动作。回退代码不自动重放已消费来源。

## 验证

真实 Host、官方 Pi、本地 HTTP 脚本模型和假渠道：等待后先收到不足补充，保持原等待且不进入执行侧复核；再由 Router 作明确续接，经冷重启在原会话实际读回业务文件并完成。核对权限/来源/版本拒绝、动作重试、同会话数量和无重复副作用。相关路由、唯一执行会话与原人工等待测试按影响实跑，最后运行 pnpm check。

本轮只交付代码、测试和 PR；不合并、部署、发送真实群消息或操作既有云端任务。
