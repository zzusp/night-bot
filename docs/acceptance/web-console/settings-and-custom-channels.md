# 设置、凭据与自定义渠道验收

日期：2026-11-09。基线为 PR #8 的 `001d00546ae13859944967be4a12588dc79939ce`；该 PR 仍 OPEN，main 为 `21154c5d878574c49b79b1f490064f905b4ee732`，PR #7 已合并。新增 PR 使用 #8 分支为基线，保留其登录恢复、标签/复制/卡片和全部来源统一会话布局，不遗漏尚未合并的修复。未合并或部署。

## 交付

- 设置页支持模型 API 协议/地址/名称、当前模型 API Key、GitHub Token。模型使用 Pi 配置与认证；独立 web-model 路由保留其它路由，配置正常重启后生效。没有发真实模型或 GitHub 验证请求。
- 复用 NativeCredentials、既有私有目录、原子写与锁；凭据进入 data/secrets/credentials.json，配置只保存引用。状态不回显已保存值，替换/清除需确认，提交即清空输入。环境值只读；模型和密钥保存共享配置锁，避免并发修改写错目标。
- GitHub Token 仅在已经获准的 full Shell 最后启动边界注入，沿用原权限策略；ask/auto 不自动注入，不因此授权 GitHub 操作，不修改全局环境。真实 native 子进程以假令牌验证，仅输出布尔结果，参数和正式历史均不含值。
- 助手名称、四种内置图标持久化；登录页、Logo、页面标题、消息身份与输入提示统一使用。保留默认 Night Bot/月亮及消息 N。拒绝图标 URL、SVG 和文件路径，不修改项目、渠道、操作者或会话 ID。公开 appearance 端点仅返回名称/内置图标，其余状态与操作必须认证。
- 自定义渠道发现沿用可信本地插件机制，增加声明式 webConfig.fields（字符串、布尔、凭据引用）。发现/保存不导入插件；默认停用、显式确认启用及正常重启，运行中/已启用实例拒绝通用编辑，未声明表单明确提示按插件说明配置。钉钉保留独立表单、外发授权及切换目标撤权；自定义渠道不套用钉钉字段。

## 实跑证据

- `node --experimental-test-module-mocks --test test/pi-config.test.js test/pi-native-credentials.test.js test/pi-provider-auth.test.js test/pi-operator-settings.test.js`：54/54 通过。包括保存后重新打开凭据、真实 Host 冷启动解析新 Pi 路由、只读环境/确认/陈旧版本/恶意地址和图标拒绝、配置锁、发现不执行插件、真实 Host 加载自定义插件的身份/名称/fake 外发链路，以及 full Shell 假令牌无历史泄漏。
- `pnpm --dir packages/web-console test`：49/49 通过，含设置接口的鉴权、同源、CSRF、未知字段、大小限制与错误不反射秘密。
- `pnpm --dir packages/web-console build`、`pnpm check`、`git diff --check`：通过。
- `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium pnpm --dir packages/web-console test:browser`：66/66 通过（3.4 分钟），包含 #8 的登录恢复、截图布局、四种来源、渠道授权/撤权及新设置页。
- 后续入口/状态/默认布尔字段调整：settings、layout-feedback、channels-create、conversation-frame 共 23/23 通过（1.5 分钟）。最终键盘取消/焦点恢复、IME 提交保护、凭据未知结果、匿名登录页品牌展示调整后重建，settings 4/4 通过（18.1 秒）。未在最后这些调整后再重复完整 66 项。
- strict UI audit：0 findings/errors/warnings。浅深色、1440/390px axe AA、无页面横向溢出、表单确认/失败/恢复均实跑；另在独立隔离 fixture 检查桌面和窄屏截图，不包含真实用户凭据。
- git check-ignore 确认 data/secrets/credentials.json 与 data/config/config.json 均被忽略；未将运行数据、凭据或截图加入 Git。

首轮设置浏览器 3/4，失败为测试未包含字段标签中的“必填”后缀；已修正。首轮自定义 Host 测试在清理阶段先删除了根目录，导致安装锁丢失；已改为先关闭 Host 再清理，随后相关完整回归通过。没有放宽产品权限或删除失败断言。

## 未验证边界

未使用真实用户密钥、真实外部模型/GitHub/渠道服务、Windows 实例或部署；fake 传输不代表第三方厂商现场验收。图标仅内置选择，不提供文件上传。通用插件没有网页代码安装、在线停用、目标迁移、删除或热加载；启用仍由插件正常启动验证。designmd 命令在环境中不存在，未重跑其 lint。此前 main 可复现的 SG12 登录观察超时和根全量失败记录保留于 self-evolution-and-conversations.md；本轮未重复无关根全量测试。
