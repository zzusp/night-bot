# 全站说明文案精简验收

基线：main `0a1eafc065a7468d6a55e6fa5a890c151b39be10`。

## 范围

- 登录、未知路由和页面错误：移除静态使用说明，保留错误、访问令牌标签与恢复动作。
- Web 聊天、渠道会话：欢迎入口只保留图标和动作名，空态只保留状态；实际消息和任务正文不变。
- 任务列表、任务详情、执行上下文、复盘/学习：移除重复用途介绍与空态解释，保留记录范围、版本、业务内容、错误和读取权限。
- 自进化列表与正文：保留最近更新时间、旧快照、采集比较范围、脱敏和来源状态，不重复解释列表或按钮用途。
- 钉钉新增/编辑、自定义渠道表单：移除字段用途段落，以账号元数据、明确标签和选项表达。自定义启用字段不再误称必定重启后接入，是否在线应用仍由原服务端回执决定。
- 权限与审批：移除 Host 实现介绍和重复引导，保留权限边界、模式切换后果及审批范围。
- 助手外观、每日工作日志、角色模型：移除静态 helper；待重启改为状态徽标；local 的服务器时区语义放到标签；空错误/反馈不再占位。
- 渠道删除、暂停/恢复、离开未保存设置、角色保存等确认内容已按源码核查，保留必要后果，不改业务请求或安全门槛。
- 模型路由/API/密钥卡片由并行的独立布局改动负责；消息处理浮层由 #60 负责。本变更不修改这些组件和专属样式。

## 布局与可访问性

共享 EmptyState 的 description 可省略，不产生空段落。欢迎按钮改为图标/标签同排；登录输入与提交按钮保留 16px 间距；渠道账号行与字段保留 16px 间距。移除字段说明时同步更新 aria-describedby，仅引用现有安全提示或实际错误节点。身份、错误、状态和操作后果不依赖图标或颜色。

## 已完成检查

- Web `tsc --noEmit` 与 `vite build` 通过。构建仍报告既有大于 500KB 的 bundle 提示。
- `node --test packages/web-console/test/*.test.js`：192 通过，0 失败。
- `scripts/check-coverage.mjs`、`scripts/check-production-imports.mjs`、`scripts/check-native-runtime.mjs` 通过。
- 官方 frontend-design-premium `audit_project.py --mode strict` 配合仓库 premium-ui.json：0 findings。
- Playwright `--list` 可解析全部 212 项测试。新增 6 项精简文案检查，覆盖 1440/390px 页面与弹窗边界、空段落、错误关联、焦点返回和必要安全文案；同步更新既有文案断言。
- `git diff --check` 通过。

## 未完成的运行验收

浏览器测试被执行环境阻塞：Chromium 启动时 Unix socket 返回 `Operation not permitted`；获准提升执行后仍相同。CUA 浏览器访问隔离本地 fixture 返回 `ERR_CONNECTION_REFUSED`。这些是浏览器启动/连接失败，不是已执行的页面功能断言失败。

因此，本轮尚未完成逐页真实截图、窄屏视觉、键盘及 axe 运行验收，也不能据静态检查声明排版验收完成。需要在支持浏览器的 runner 运行 `pnpm --dir packages/web-console test:browser`，审阅新增截图及既有全套流程后再合并。未改服务端业务逻辑，未部署或合并。
