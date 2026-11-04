# Run the headless DingTalk assistant on Pi agent loop

**迁移中草稿，尚未完成完整 Pi 原生替换。** 详见 `docs/DSH-AUDIT.md`。

将百部消息、Topic、统筹、执行、恢复、权限、通知及文件交付迁入 Night Bot，以 Pi 的代理循环驱动模型和工具迭代，提供 CLI/JSON 配置及原 HTTP API，无可视化前端。保留原 Host 的权限、会话持久格式、工具审计和副作用收据，避免重新实现这些关键约束时遗漏行为；仍有 DSH/Cordis 兼容服务依赖，尚非完全去 DSH 的实现。

源主干为 `93e431a`，200 个核心模块保留，3 个 Web 入口模块排除，3 处明确适配（指引同义措辞、两个存储声明入口）；逐文件哈希和 HTTP 路由守恒见 `docs/source-manifest.json`、`pnpm check`。保持目标已有 LICENSE；未复制密钥或生产数据。

验证结果见 `docs/VALIDATION.md` 和 `docs/evidence/`：包含本地真实模型 wire 协议、工具入模、CLI 启停、消息/交付领域及 Pi 下的原生任务/恢复测试。真实 shell 产物隔离仍受云机 `SANDBOX_UNAVAILABLE` 阻塞，Windows 专属项未执行；未做真实钉钉、业务系统、Claude 和自主模型语义验收。没有生产部署、数据迁移或真实外发。

单会话多工具调用当前串行进入原 Host 调度器；任务/执行并发和资源锁语义保留，吞吐差异见 MIGRATION。本 PR 应以草稿评审，待目标环境的沙箱与外部能力验收后再决定后续发布。

后续已用应用原生 JSON 域替换四个 DSH active 服务挂载（含默认模型选择），修复无 config editor 时模型保存 no-op；额外验证模型通过 HTTP 保存并重启读回。生产仅安装依赖的副本也验证 CLI/wire/state 路径，但仍有 56 个生产直接 DSH 包，不宣称是去 DSH 完成品。
