# Web 控制台

## 总目标

在最新常驻 Router 开发线交付可选、独立、BoardUI 风格的中文 Web 产品：AI 对话、配置渠道、活动/最近任务与执行详情、渠道聊天记录。Bot 脱离 Web 正常运行；不增加展示专用核心字段。

## 必需工作项

| 工作项 | 状态 | 证据 |
|---|---|---|
| 基线、接口与架构边界 | 已确认 | `docs/spec/independent-web-console.md` |
| 可选插件、认证、回执和 API | 已完成 | `packages/web-console/server/` |
| BoardUI 视觉与多页面交互 | 已完成 | `packages/web-console/src/` |
| 集成、安全、浏览器与核心回归 | 已完成必要验证 | [第二轮](round-2.md)，完整原始结果与定向修复分列 |
| 操作说明、提交与 PR | 说明完成，正在提交 PR | README 与独立运行说明 |

## 当前检查点

2026-11-07：最终 fetch 的远程基线仍为 `d273509`；隔离分支 `worktree-night-bot-web-console`。沿现有 channel plugin 接口新增独立包，无核心运行源码/schema/依赖变更。Web 服务端 21/21、最终浏览器 14/14、构建与 guards 通过；原默认回归 1179 pass / 1 原有 Windows 断言失败 / 26 skip，修正测试后该文件 4 pass / 3 skip。源码树绑定、截图及限制集中在第二轮报告。

下一步：提交已验证源码并向最新开发线创建 PR，读回真实状态。不开启真实渠道、不合并、不部署、不触发 CI。参考克隆递归清理遭自动审批拒绝，保留在已忽略的 `docs/tmp/`，不提交。
