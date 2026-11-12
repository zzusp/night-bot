# 报错反馈

左侧“报错反馈”用于向 `zzusp/night-bot` 提交产品问题，不是自动遥测。

1. 填写标题和问题详情。页面始终显示采集范围、当前任务模型、模型服务地址与 GitHub 目标。
2. 勾选同意后，启动独立的 Pi `AgentSession`。问题描述和摘要先脱敏，再交给当前任务模型。模型或服务配置代次变化会使旧同意失效。
3. 诊断只提供 `diagnosis_evidence` 工具：运行版本/平台/内存占用、渠道注册与传输数量、最多 3 个 `.log` 文件各最后 32 KiB 中的已知错误码计数。原始日志不会进入模型。未发现错误码不代表没有问题。
4. 预览实际 Issue 标题和完整 Markdown。可手动修改，点击“更新预览”后会再次脱敏；修改后必须重新勾选确认。脱敏是尽力处理，不能保证任意文字都没有私人信息。
5. 单独确认后，服务端使用设置中已保存的 `GITHUB_TOKEN` 创建 Issue。需具有目标仓库创建 Issue 的权限；不会保存新凭据或自动扩大权限。

没有同意不会启动诊断、读取日志或调用模型。诊断没有 shell、通用文件读取、MCP、技能、聊天、记忆或发 Issue 工具。模型建议不能触发提交。Web 鉴权、同源和 CSRF 校验仍生效。

Pi 会话和报告只暂存在本进程内存中，最长 30 分钟；可撤销诊断并清除暂存，退出后其他登录会话不能读取。进程重启不恢复诊断，不重放提交。确认提交可能公开可见，已有 GitHub Issue 不会因清除本地暂存而删除。

网络超时或结果不确定时不会自动重新创建 Issue。先在目标仓库核对；页面“核对提交状态”只查询本地记录，不重新发送。明确的凭据/权限错误修复后，仍需重新确认。关闭 Host 会中止诊断、排空已开始的提交；已发出的请求可能已被 GitHub 接受。

## 验证

- `node --test test/pi-feedback.test.js test/pi-feedback-session.test.js`
- `node --test packages/web-console/test/feedback-render.test.js`
- `node --test --test-name-pattern='feedback HTTP' packages/web-console/test/server.test.js`

测试使用假模型和假 GitHub 响应，不会向真实模型发送诊断或创建真实 Issue。
