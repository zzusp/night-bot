# Router 失败批次的操作者续办

## 目标与现状

已 admitted 的 Router 批次遇到模型认证错误后，普通恢复保持原输入不重放。现有 Host `resumeRouterBatch` 有完整检查点、owner、来源、效果与批次守卫，但没有操作者可用入口。本次只接通这一能力，不修改业务模型权限、原任务身份或效果结算规则。

## 方案取舍

1. 自动重试全部 error：拒绝。无法代表操作者确认当前认证和失败原因，也会重复领取模型轮。
2. 离线改账本或直接调用 Pi：拒绝。绕开 live owner、来源授权、claim 和效果守卫。
3. 本机 capability 鉴权的 inspect / check / resume：采用。复用 operator-capability，CLI 连接现有 resident，不启动第二个 Host。

只读 inspect 只使用普通恢复已经打开的 handle，不 open、不 commit、不清错误、不调用模型。check 与执行共用完整 inbox/检查点校验；无 owner 或正在工作时明确拒绝。返回仅包含身份、revision、事件 ID 和数量，不返回业务正文。执行绑定检查点及已观察 inbox digest，再由既有继续逻辑重验。check 不授予长期许可。

新命令 `night-bot-router` 独立于离线 task archive CLI，避免把在线模型调用混入离线档案命令。resume 必须先用 `--check`，实际请求只能显式运行；响应丢失时结果未知，禁止自动重试，先 inspect 读回。

## 验证与交付

复用正式 Pi/Host 的失败批次回归，增加 HTTP/CLI 边界、只读无变化、完整 inbox snapshot 绑定及后续输入消费验证。已有错误工具、未决效果、分页外输入、并发和旧 claim 拒绝规则保持。提交、PR、合并、本地部署后使用正式入口恢复原批次；业务验收以 inbox settled、原 session 和任务事实为准。
