# 独立 Web 控制台决策快照

基线：`origin/worktree-resident-conversation-routing@d273509`，2026-11-07 已 fetch。主检出有其他会话改动，本任务仅使用 `worktree-night-bot-web-console`。

## 目标与边界

实现中文产品界面：与 Bot 对话、已配置渠道、执行中与最近任务、任务执行信息、聊天式渠道消息。参考 BoardUI 官方免费 MIT 聊天模板 `ec5c5eb3e29c2441be63b9422cd54f411ef23466`，保留许可和来源。

Web 是可卸载的可选渠道插件；UI、依赖、构建、认证与展示投影归 `packages/web-console`。不得给 Bot 领域 schema、任务账本、Pi 历史增加展示字段；不得从核心默认组合导入 Web。关闭页面不停止任务；禁用插件后 Bot 的 CLI、任务和其他渠道仍正常运行。

## 方案比较

1. 修改核心 HTTP 并嵌入 UI：复用方便，但会将展示与核心发布绑在一起，拒绝。
2. 独立进程只代理现有 HTTP：可只读任务，但当前没有通用 chat HTTP，也不能访问未产生会话的渠道配置，不能完整交付。
3. 独立包中的可选渠道插件（采用）：通过既有 `channelPluginDirs` 和 `night-channel.json` 接口加载，用 `channels.receive` 发送认证的 chat；自建 HTTP 托管 API 与静态 UI。生产不依赖 Vite/React 构建工具，不需要修改默认核心。独立进程若另加 bridge 仍需同一个可选插件，无必要增加传输层。

## 责任层

- 核心：认证后的渠道身份、Router、任务、推理、持久化与权限/外部副作用，保持现有接口。
- 插件：loopback HTTP、登录及 CSRF、浏览器会话、固定操作者身份、独立接纳/交付回执、分页白名单投影。只读调用现有任务和消息服务；不提供任意代理或底层数据库接口。
- 浏览器：导航、排序/筛选、格式化、状态及过期提示。通过 API 同步，不读文件/数据库，不存密钥或对话到 localStorage。

## 状态与安全

202 只表示接纳；完成以现有 Bot 终态/回执为准。用快照轮询，不能伪装 token 流。请求 ID 去重，网络失败先回读；重启后的未知状态保留，不重放。外部渠道仅展示，不提供未经请求的代发。

仅 loopback；Host、Origin、SameSite HttpOnly cookie 与 CSRF 组合保护。首次访问令牌存在安装根的 secrets 内，不写源码或日志。浏览器不得指定 senderId/channelId。配置只投影标识、类型和启用状态，不暴露配置密钥。所有测试使用隔离目录与 scripted/fake 模型及渠道。

## 交付与验证

独立包安装/构建/启动说明、设计及行为合同、API 和权限测试、真实 Host/scripted 模型集成、浏览器成功/失败/空/窄屏/键盘检查、核心 `pnpm test` 及必要定向路由验证。证据集中于 `docs/acceptance/web-console`。不发送真实渠道消息、不合并、不部署、不触发 CI。
