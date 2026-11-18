# 入站隔离与后续回复引用复验

验证基线为最新主线 `54fb9599c4c7025583303745238fd6713b97eb0c`，实际受验版本为该基线加本 PR 的工作树差异。第一轮结果不回填；本轮新增 Router 进展和结果引用及显式引用回归修复。测试使用默认 Host、SQLite、Pi、脚本模型和假渠道。

- 原显式引用失败曾在未改动基线同一断言复现；本轮排查看到脚本停在完成批次，还未到预期本地拒发。固定脚本模型的上下文容量（沿用现有 Router 夹具做法），并在断言失败前走完 Host 的本地工作排空，直接检查持久 `failed`。未修改生产模型或等待预算。原本的零外发、本地拒发证明、人工 CAS 恢复、原冻结正文和任务不变、父件送达后才释放文件、冷恢复禁重放均通过。
- 三种结果路径定向实跑通过：显式引用及恢复；省略引用字段和受众时默认引用原作者；明确只通知其他成员时不引用。每种均核对真实持久父子件 delivered、冻结文件字节和原生发送方法；附件子件不继承引用。文本进展用例还核对已冻结普通回复在启用引用后重试不改 payload/digest，新引用的稳定动作键不重复发送。分诊首答和原正文安全保护仍通过。
- 十文件相关套件 `node --test test/dws-bridge.test.js test/native-dws-send.test.js test/pi-channel-edit.test.js test/pi-channel-observer-lifecycle.test.js test/pi-channel-plugin.test.js test/pi-resident-router.test.js test/group-notification.test.js test/dws-adapter.test.js test/task-notification-delivery.test.js test/task-notification-retry-native.test.js` 实跑 230 过、1 失败、0 跳过。唯一失败是观察器停机测试曾假定 1ms 入站预算一定已启动探针。将该用例改为等待原探针开始事件，保留同一失败的排空拒绝、禁止替代查询和无回声投影断言；`node --test test/native-dws-send.test.js` 复验 11 项全过。最后修改仅该测试文件，其余九文件未重跑。
- `pnpm check` 和 `git diff --check` 通过。未跑项目全量测试，未触发 CI、部署或发送真实钉钉消息；未验收平台实际引用呈现或 UAT 接收状态。

逐项状态见 [matrix.csv](matrix.csv)。
