# 平台排期修改与取消

Router 通过 `platform_schedule_list` 取得当前会话的排期 ID，再调用
`platform_schedule_update` 或 `platform_schedule_delete`。这些操作复用现有
Router 身份、generation 和来源校验，不要求用户重复给普通任务授权。
不允许通过其他会话的 ID 管理排期；任务执行会话不获得跨会话调度权限。

修改只替换给出的字段。`at` 必须包含明确时区偏移；`every_seconds` 是真正的
周期，不转换为链式单次提醒。周期的 `stopWhen` 保持同会话任务约束。

平台排期拥有独立 Pi 会话和冻结指令，因此修改采用可恢复的替换操作，而不是
修改旧会话上下文：先保存新绑定，持久化旧排期的终止栅栏，删除原生定时记录，
最后创建替代排期。返回新 `scheduleId` 和 `replacesScheduleId`。只有工具返回
`scheduled` 才可确认修改成功；仅在任务正文中标记“被取代”不构成取消。
相同 operationId/参数重试复用结果，不重复建定时。不同修改竞争同一旧排期时
只接受第一项，后续应重新查询新 ID。

重启会继续已提交的管理操作，不恢复旧定时。一次性替代排期若因停机错过目标，
保留原约定时间，在恢复后尽快交给 Pi 判断补报或静默结清，不擅自改排到次日。
未提交终止栅栏前崩溃，只保留未激活的新绑定，可用相同操作重试。

删除会物理撤销定时记录；旧 Pi 入站已排队或已接纳时，终止栅栏也会拦截后续
平台回复。持久化通知的自动重试及手动恢复共用最终发送栅栏，文件同样适用。
已开始的不可逆外发不能撤回；结果未知的发送只继续回读，不会重发。
Web 的定时任务菜单仍是只读列表，本次不新增 Web 编辑器。

验证使用隔离目录、真实 Host/Pi/SQLite 和脚本模型，不操作现有业务排期、不向
真实渠道发送消息。核心回归见 `coordination-schedule-revisions.test.js`、
`pi-platform-recurring.test.js` 与 `platform-schedule-notification-fence.test.js`。
