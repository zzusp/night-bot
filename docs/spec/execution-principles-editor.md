# 会话工作原则

- 两份独立实例文件：`data/config/router/AGENTS.md` 与 `data/config/execution/AGENTS.md`。不读写通用 harness 文件，不迁移、不把用户正文纳入源码。空白文件不注入上下文。
- 沿用 Pi 官方指令资源。只有 Host 标记为 `conversation-router` 的常驻 Router 在每轮开始读取 Router 文件，当前轮中的工具回合继续使用原版本。只有 `night-bot-task` 执行预设加载执行文件，刷新时机不变。分诊、普通对话和复盘不加载，两份指令均不授予新能力。
- Web「设置 → 工作原则」通过现有操作者设置服务分别通过 `/api/settings/router-principles` 和原 `/api/settings/execution-principles` 读写固定文件，沿用登录、同源和 CSRF。按文件内容版本防止覆盖多页保存；固定路径不接受客户端路径，检查链接，使用既有锁和原子替换。保存成功回读；冲突保留草稿，不自动重试。
- 以真实本地模型请求核对两个角色的入模隔离、Router 轮内固定与下轮更新；以 Web API 和浏览器验证权限、保存、读取及冲突。
