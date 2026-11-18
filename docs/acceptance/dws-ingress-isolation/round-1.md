# 钉钉入站隔离：本地验证

## 版本和范围

基线 `cef53e936e8d38ada559c33324406022d2c9f752`，分支 `worktree-dws-ingress-isolation`，验证对象为该基线加本轮未提交工作树修改。最终工作树包含 README、渠道及运行文档、来源清单、DWS bridge、通知观察器、任务入站、渠道服务、DWS 插件及其存储、接入和测试的修改，以及决策快照 `docs/spec/dws-ingress-identity-isolation.md`。本记录仅为验证文档，不改变受验源码。

## 结果

- 变更前以默认 Host 和 fake DWS 复现：原外发未确认后，同群独立实时来源未完成分诊。
- 最终工作树定向运行 `node --test --test-name-pattern='default optional DWS|未知外发无 ACK|DWS durable deferred|已处理文字附件|钉钉修订|撤回|receive pause' test/pi-channel-plugin.test.js`：15 项通过、0 失败。覆盖无 ACK 时独立实时及冷恢复历史来源的持久入账与分诊结清、重复不重放、身份未明项精确读取、精确回声、发送一次、暂停恢复、修订和撤回。
- 五个相关测试文件整组运行：131 项中 130 项通过、1 项失败。失败为 `default application neutral Router tools enforce recipient/source ACL and deliver material-backed frozen files with explicit source quote`，等待原公开业务标记在发送前失败的断言超时。用基线版本的相关原始模块和测试只读 overlay 单独运行，同一断言同样超时；不能据此声称该既有失败根因已定位。该组运行早于最后补充的精确回读和已结来源重复测试及插件重复处理调整；最终调整由上述 15 项定向复验覆盖，整组未复跑。
- 调整插件重复处理前，底层 DWS、观察器生命周期及 bridge 套件 81 项通过，相关路由、来源、通知防重放套件 13 项通过；最终调整未改这些底层文件，但这些结果不代表整套 runtime 或 routing 全量通过。
- 最终工作树 `pnpm check` 与 `git diff --check` 通过。曾误调用项目不存在的 `pnpm check:coverage`；随后使用项目定义的 `pnpm check` 成功执行三个守卫。

## 边界

DWS 通用 `senderId` 可能混合身份命名空间，不能仅凭字符串不同认定为其他发送者；此类记录在存在未知候选时仍须单条核对，不能宣称所有真实历史消息立即入站。原未知外发不因空页或读取失败判为未发送、已送达或已撤回，也不自动重发；通用 shell 外发回声不在本次范围。用户反馈官方已修复 DWS 问题，本轮未独立核验其修复版本。

未部署、未修改 UAT 数据、未发送真实消息，也未在真实厂商环境复验；未运行完整 `pnpm test`、`pnpm test:runtime`、`pnpm test:routing` 或 `pnpm test:containment`。矩阵见 `matrix.csv`。
