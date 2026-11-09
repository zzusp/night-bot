# 真实执行、消息首答与交付核对

2026-11-09。PR #11 指向最新 main a6299b7，包含尚未合并的 #10 和未进入 main 的 #9 设置功能；main 是本分支祖先。完整需求矩阵见 request-coverage.md。没有合并或部署，未访问用户生产现场。

## 已完成的真实链路

使用真实 createHost、官方 Pi、SQLite、落盘会话、本地 HTTP 模型端点及可选 Web 服务。仅模型回应和外部运输／回读由测试控制，不用真实密钥或厂商网络；不是拿静态页面夹具宣称生产接通。

- Router 输入完成后从第 1 代切到第 2 代：旧代 33 个投影条目，新代只含私有交接。修复前页面 0 条，修复后 5 条公开记录。当前代完整提交但为空时，只回退同 conversation 最近 published rotation 的已提交旧代；验证 owner、conversation、generation、完整提交和 revision。历史代次明确标记，不展示私有交接／系统／思考，不是全代次归档浏览器。
- 任务在真实模型请求处暂停，HTTP taskDetail 与 session 均核对执行中；释放后实际调用 memory_status 并读取正式工具回执；完成后 HTTP 返回 completed、idle、结果和无阻塞。另一任务实际调用 task_result blocked，HTTP 返回 waiting 与“请选择待核对的文件”。读取不新增模型请求。
- 外部渠道会话经 HTTP 读取 Router 安排、关联任务列表、执行中的会话级 taskDetail／session，再读完成后的结果和工具记录；跨会话或非关联任务 404。
- 真实复盘生成同 Web 身份的记忆与学习技能；HTTP evolution 显示 1/1。官方绑定 agent 调用 memory.read/search、学习 Skill provider 后，usage.json 与 HTTP 各计数同步增加；重复 GET 不增加。其他身份为 0／未记录，不跨范围读取。

## 首答定义与证据

单条消息的起点是任务服务入站的 Host receivedAt，不是外部发送时间；终点是可靠运输回读后账本记录的 deliveredAt，即确认可见时间，包含确认延迟，不声称等于外部客户端首次看到的精确时刻。

- 按 conversation、sourceId、messageId、version 同时关联通知；分诊承接及平台直接答复可核实。Router 新增可选 replyPurpose，持久化到冻结请求及通知；只有 acknowledgement/direct-answer 进入首答，task-update、taskId 或 taskDelivery 不进入。历史缺用途不猜测。
- 发送开始、prepared、unknown、failed 都不当成功；更早回复可见性未知时，即使后续回复确认，也不报确定首答时长。缺 receivedAt、来源不唯一或时间倒置留空。
- 展示接收／入库、已提交分诊／安排、真实采集阶段、回复准备、发送尝试与可见确认。批次共享阶段明确标记，不按消息均分；无阶段记录不补造。当前生产链路没有每个推理内部步骤的完整跨度，不展示隐藏思考。
- 真实运行覆盖两条并发消息、不同事项、无任务承接、Router 无任务直接答复、无回复、未知回读，以及 Web HTTP 投入到本地适配器回读。每条消息独立计时，实际结果见 first-reply-runtime.test.js。单元回归覆盖旧版本、其他来源、后续任务交付、重复回复、历史缺失、负时间及未知较早回复。
- 端点按消息页先 LIMIT（最多 50）再查该页来源／通知。Web 仅覆盖 ledger 当前保留消息窗口；渠道消息支持分页。未对全部历史或全渠道做跨权限扫描。

## 面向用户的展示

执行页先按消息显示首答与可核实过程。关联任务展开后先显示真实标题、领域状态、处理结果、需要补充的问题、阻塞和可展开的结果限制，再显示正式工具记录。未知当前动作不推测，不生成完成百分比。摘要沿用会话归属与脱敏，撤权期间旧缓存隐藏。

Web／所有渠道共用左右气泡、等圆角、无复制图标；渠道输入仍隐藏。任务头保留标题、当前状态、更新时间，目标与创建信息可展开。移除用户红框中可见的输入框底部两项说明，快捷键、发送状态仍供屏幕阅读器使用。用户已撤销重命名需求：相关未提交代码全部撤销，本 PR 不含重命名。

## 验证与已知限制

- Web 测试 54/54；与真实 Router 领域回归合并复跑 58/58；真实专项见上述各 test 文件。
- 设置／凭据 20/20，通过；三十项浏览器设置、渠道、会话、布局、自进化回归通过；后续任务／首答／会话恢复／设置专项 11/11，通过；最后渠道与首答布局专项 3/3 通过。桌面及 390px、键盘、axe、错误与撤权均验证。浏览器数据夹具只验证 UI，不能代替真实运行专项。
- 构建、类型、strict UI audit、production import/native source 守卫、pnpm check、git diff --check 通过；保留源码来源，更新两处 core 改动 hash 与 adaptation 说明。
- 额外 observer/notification 回归 53/54；旧 observer UI 对照测试读取已删除 packages/dingtalk-dsh-observer/web-client.js 失败。插件／凭据合并回归 48/49；SG12 默认登录文件监听绑定超时，单独重跑仍失败。两项均在独立干净 main a6299b7 worktree 复现；没有恢复已删除旧实现或放宽约束。
- 未运行全部根测试、真实厂商／真实模型或 Windows；无法断言用户部署版本和生产数据。designmd 命令不可用。尚无全历史代次选择；未获得其他身份／群组 memory 读取授权，明确显示覆盖限制。
