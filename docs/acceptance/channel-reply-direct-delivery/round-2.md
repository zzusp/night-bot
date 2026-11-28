# 结单答复与原生引用验收

## 范围与版本

基线为 `ea5f4edd0b5e365935e811ee9a5f282b39f4606b`（主线 #335），候选为该基线加本轮未提交工作树。Windows 使用 Node.js 24.19.0、pnpm 11.25.0；隔离 Linux 复用同基线的正式镜像作为运行底座，只读挂载候选源码和测试，不部署。测试使用合成数据、真实 Host/Pi、脚本模型和假渠道。

受验生产 Git blob：`packages/dingtalk-core/task-session-service.js` 为 `f39681001c891f22373409f8980b3fad74303491`，`src/channels/message-safety.js` 为 `fe03617c34b0fa72974e616e0b5e9103e7954479`，`src/channels/resident-router-business.js` 为 `2e1b62112f14e121e5bd56833db86a2a48d95a13`。最终工作树含本轮测试和文档调整。

## 复现与修后结果

- 原 UAT 通知在冻结时已是已绑定完成事件的 `task-update` 独立 Markdown，未带原生引用字段；来源、版本、同会话作者和受众匹配，未走 `unquoted` 回退。冻结正文与 Router 提交正文一致，完整内部报告另存。回执不能证明 Router 当时传了哪个历史绑定参数，也不能反推模型为何取舍那些细节。
- 修改前定向实跑完成和阻塞两项：实际发送信封的 `replyToMessageId` 均缺失。修改后 `test/pi-execution-final-only.test.js` 的 10 项终态矩阵在 Windows 与隔离 Linux 通过。实际发送信封的原消息、作者、受众、正文均正确；账本显示送达，仅发送一次。投影中按事件、原来源和版本提供原问题，完整内部证据和限制仍可读。统一 Router 的独立终态用例在隔离 Linux 通过，验证协作后仅最终回报送达且引用原问题。
- 直接渠道用例 15 项通过，覆盖普通进展、原作者非受众、渠道能力、旧冻结与重启不重发。Windows 的假 DWS、群通知和原生发送 59 项通过。Windows `test/pi-router-fast-handoff.test.js` 补齐现行协议所需交接后 4 项通过，含历史对照、跨作者与三项冻结事务竞态。
- `pnpm check` 和 `git diff --check` 在最终源码与测试变更上通过。源码守卫检查 190 个 retained modules、485 个运行 JS 文件；相对导入闭合，外部 SDK imports 为 0。

## 未全绿的套件

- Windows `pnpm test:routing` 原跑 260 项，258 通过、2 失败。共享规则测试读取了旧关键词锚点；已同步等价原则，定向复验 1/1，正常发送与凭据拦截仍通过。索引测试的旧夹具仍期待 `router.inbox`；现行 `router.batch-events` 按已入批事件 ID 查询，修后用例核对准确查询身份、不扫全会话，所在套件独立复验 4/4。未重跑整组，不把分开复验拼成整组全绿。
- Windows 初始组合 81 项，75 通过、6 失败；隔离 Linux 候选组合 36 项，34 通过、2 失败。Windows 额外四项因交接夹具缺少现行 `handoff`，已如上复验。剩余 `periodic`、`restart-frozen` 两项旧自动续跑测试在未修改的 `ea5f4edd` 正式 Linux 基线也同样失败。用例启动当前统一 Router，却等待旧会话 Router 的 `timeoutContinuation`；本轮未修改续跑、留置或不重放逻辑。
- 未运行全量 `pnpm test`、`pnpm test:runtime` 和 `pnpm test:containment`。

## 业务验收边界

本轮修复版未进入 UAT，无真模型正文验收，也没有在真实钉钉测试会话读回新消息。脚本模型只能证明原问题进入实际模型批次、Host 冻结与发送字段正确。发布后需用合成诊断分别走「只问中断原因」和「明确索要时间口径」两条正常入口，独立读回实际正文；钉钉还需在获准测试会话核对 Bot 实际送达的新消息原生引用指向同会话的原提问。原历史消息未补发、未改写。
