# 渠道通知与反馈诊断验收 · 2026-11-17

对象：PR #173，初始提交 `731f8dc90bd6ba738955709380c67c72ab835f91`，基线 `b3cdb95a76024e99e9fdc49591ce057171161cd9`。本目录保留验收说明和测试日志；截图已按用户要求移除。

环境：Linux、Node 24.19.0、pnpm 11.25.0、Chromium 154.0.8037.57、Playwright 1.65.0。构建为生产 dist，测试使用 preview.mjs 隔离 fixture 与 Playwright 路由合成响应，不接真实渠道、模型，不发送消息或创建 Issue。无 DOM 视觉伪装。

验收标准与结果：

- 渠道回执右上紧凑显示，关闭/自动隐藏不改变卡片持续状态：通过。
- 6 秒普通回执计时，悬停或聚焦保留通知，轮询不重复通知：通过。补测发现原实现鼠标移出会覆盖仍存在的键盘焦点，已分离 hover/focus 状态修复，并保留回归用例。
- 暂停/恢复的版本、未知回执、失败、外发授权分离语义：既有浏览器用例通过。
- 反馈诊断与表单同轴同宽，卡片高度低于 100px，停止清除保留表单，完成后清除入口位于提交内容标题行：通过。
- 桌面浅/深色与 390px 截图：逐张检查通过；窄屏无横向溢出。渠道通知与确认弹窗 axe 检查通过。

执行结果：

- `pnpm --dir packages/web-console build`：通过（含 tsc），仅既有大 bundle 提示。
- `node --test test/channel-ingress.test.js test/feedback*.test.js`：11/11 通过。
- `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium playwright test ...channel-ingress.spec.ts ...feedback-diagnosis.spec.ts`：20/20 通过（32.8 秒）。
- `schedules-render.test.js`：PR 版本和独立基线 worktree 均为 4 通过、2 失败；失败为同名旧错误文案与内联位置断言，未修改无关业务。

限制：本轮未重跑 Web 全量（此前报告 338 通过、2 失败、1 跳过），未重跑静态审计（此前报告 0 问题）；真实渠道/真实 AI 集成不属于本地 fixture 证据范围。未合并、未部署。

