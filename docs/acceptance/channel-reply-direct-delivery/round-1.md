# 渠道回复直达与负责人提及验收

## 范围与版本

Windows 11、Node.js 24.19.0、pnpm 11.25.0；测试使用隔离目录、脚本模型和假渠道。受验源码为 `41b9d08c6f1d13fdcc2ae6941ea8abb28a07faa4` 加本轮未提交工作树；该提交已整合 main 的 `6bf644582a69366efc7878872058cd9680578435`。验证时生产文件 Git blob：`packages/dingtalk-core/task-session-service.js` 为 `f4bd6e94883147a8f9e6f8f5f8f4c3123499f0eb`，`src/channels/message-safety.js` 为 `63735f875d8e234635f58c5e1dcf57dbc607e585`，`src/channels/resident-router-business.js` 为 `a39c457d69e49097953fb3536c3d48acf31d439e`。其余工作树含本轮测试和文档改动；未使用 HEAD 冒充受验源码。

## 本轮结果

- `pnpm check` 通过：190 retained modules、470 个生产运行 JS 文件、相对导入闭合、external SDK imports 为 0。`git diff --check` 通过。
- `node --experimental-test-module-mocks --test --test-concurrency=1 test/pi-router-fast-handoff.test.js test/pi-router-first-dispatch.test.js test/pi-router-legacy-ack.test.js`：12 通过、0 失败。包含新旧 Host 同一任务会话续办、跨作者完成回执、来源版本/任务修订/重复 ID 在冻结事务中的反例、首轮派发及依赖、旧冻结收悉的完整 payload/digest 和冷恢复不重发。
- 假渠道附件、任务提问、两种事实追问入站、Web 直发回读及冻结前 SIGKILL 不重放定向回归：8 通过。附件父说明默认提及原负责人；DWS 文件子消息不支持原生 @，不将其受众元数据等同于文件消息提及；显式其他受众、明确引用及来源 ACL 均按各自合同处理。
- `test/pi-resident-router.test.js`、DWS adapter、群通知、主分支原文交接及 ledger/context 等合组运行中，直接回复、凭据不冻结、过期来源拒绝、显式收悉拒绝、跨作者负责人提及以及原文交接均通过；该次总计 121 项中 116 通过、5 失败，失败为 Windows 归档路径和主线输入结构变化导致的旧测试夹具。修正后以本轮上述 12 项串行复验覆盖这 5 项，不能将两次统计拼成一次全量通过。
- 对照测试的旧源码及当前源码在独立进程运行，避免 Windows FFI 同名类型在同进程重复注册。对照模型和渠道均是脚本，不代表真实供应商延迟。

## 边界

没有运行全量 `pnpm test`、`pnpm test:runtime`、`pnpm test:routing` 或 `pnpm test:containment`。没有真实钉钉发送、UAT 验证、合并或部署；普通进度的负责人由 Router 根据受信任务和来源选择，不能声称任意自由文本都由 Host 自动识别负责人。旧冻结回执按原记录对账，不重写也不重放。

## 后续错配修正

新附件通知的完成绑定必须与所选附件任务一致，自动绑定只匹配该任务。显式不一致在冻结前拒绝，历史已冻结 payload、digest 与重试不改写。正文仅沿共享 ELI5，不另加上线模板、独立回复复核或关键词/长度分类检查。文件协议不变：父说明可原生 @，DWS 文件子消息无此能力。新增测试与本次实际运行结果以 PR 更新为准，不追改上述历史计数。
