# Web 控制台第一轮验收

日期：2026-11-07。基线 `origin/worktree-resident-conversation-routing@d27350972df888bf864186eabe64513c12460382`，分支 `worktree-night-bot-web-console`，新功能处于未提交工作树。Bot 核心源码、schema、根依赖清单及锁文件未改。

本轮已有自动场景通过，但独立审查发现两项合同错误，不能视为交付完成；修复后的证据归第二轮。

## 实跑结果

- `node --test packages/web-console/test/*.test.js`：20/20 通过（22.18s），0 失败、0 跳过。包含真实 Host 插件发现、官方 Pi 脚本模型接纳和回复、同请求去重、重启回读与恢复待发通知，以及真实任务执行上下文只读投影。
- `pnpm build`：TypeScript 和 Vite 构建通过。最后样式/中文状态增量构建为 416.35 KB JS / 128.13 KB gzip。
- 浏览器完整 10/10（51.5s）；最后颜色、手机说明、状态文案增量后，受影响 4/4（28.3s）。不把增量复验表述为最终代码完整 10 项重跑。
- 浅色、深色各 5 个路由 axe 检查均 0 violations；390px 手机导航、焦点归还、Escape、工具返回展开、IME、刷新历史、失联及登录失效草稿、真实 POST 回执丢失后只读核对且不重放通过。
- premium strict 静态审查 0 errors / 0 warnings；设计 token 文档检查仅 11 条文档镜像 token 未引用提示。
- 手动浏览器实际登录、发送隔离消息并看到 Markdown 回复。所有数据来自隔离 fixture；没有真实模型或厂商渠道验收。
- 根 `pnpm test` 在本轮结束时仍运行，结果不计入本轮通过项。

## 发现及后续

先前浏览器失败包含浅色辅助文本和深色链接对比度，修正后通过；一次精确文本定位错误修正了测试选择器，未放宽业务断言。

独立最终审查发现：

1. `ChatPage.tsx` 把 `pending` 回执及 `202 accepted:false` 当作成功，可能提前清草稿。修复前文件 SHA256 为 `4e626cf583245613edca5339f08f1e1d0ff97137aaf0e19f013d2a3bcf04cba1`。
2. Web 把 `task.blockers` 当数组，实际核心返回 `{executions, operations, legacy}`，阻断记录未展示。修复前 `TasksPage.tsx` SHA256 为 `76fca326a86c66a0abb0e0309ea52fa9028d6ec1f39cba734cedac41836192be`。

两项都在可选 Web 包内修复，不要求 Bot 增加或改变字段。第二轮补协议分支及真实核心形状用例。

第一轮截图和静态审查 JSON 在第二轮最终证据核对后清理，保留本报告文字结果及 matrix 历史。最终截图统一见 `round-2/`，不能当作第一轮原始截图。
