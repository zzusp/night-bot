# Web 控制台

## 总目标

在最新常驻 Router 开发线交付可选、独立、BoardUI 风格的中文 Web 产品：AI 对话、配置渠道、活动/最近任务与执行详情、渠道聊天记录。Bot 脱离 Web 正常运行；不增加展示专用核心字段。

## 必需工作项

| 工作项 | 状态 | 证据 |
|---|---|---|
| 基线、接口与架构边界 | 已确认 | `docs/spec/independent-web-console.md` |
| 可选插件、认证、回执和 API | 已完成 | `packages/web-console/server/` |
| BoardUI 视觉与多页面交互 | 已完成 | `packages/web-console/src/` |
| 集成、安全、浏览器与核心回归 | 已完成必要验证及第三轮复核 | [第三轮](round-3.md)；历史核心回归边界见第二轮 |
| 操作说明、提交与 PR | 沿同一 PR 交付 | [PR #3](https://github.com/zzusp/night-bot/pull/3)，第三轮源码与证据随本分支提交更新 |

## 当前检查点

2026-11-07 用户追加复查完善已完成：跨页面/重登的发送恢复、迟到回执归属、旧401/退出与重登竞态、多标签CSRF恢复，以及错误空态、窄屏长文本、概览局部故障、只读字段投影和同毫秒状态排序均已修复。最终服务端24/24、浏览器27/27、构建/TypeScript/guards通过；源码绑定为Web subtree `1324cceb46fefeca76cb92c87290c111bc09fd32`，证据集中在第三轮。

远程开发基线仍为 `d273509`；[PR #3](https://github.com/zzusp/night-bot/pull/3) 的 base 为 `worktree-resident-conversation-routing`，head 为 `worktree-night-bot-web-console`。本轮没有核心运行源码/schema/根依赖增量；未重复无改动的根全量套件，历史默认回归和Windows断言修复结果见第二轮。

没有开启真实渠道、合并、部署或主动触发 CI。后续合并/上线按用户授权和既有运维流程执行。参考克隆递归清理遭自动审批拒绝，保留在已忽略的 `docs/tmp/`，不提交；其余临时测试数据、旧轮截图和中间 trace 已清理。
