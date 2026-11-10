# 渠道接收暂停与恢复验收

日期：2026-11-10。基线：main `19970f21be55d75972872c75f0b92ceed26b7455`。
本目录绑定包含它的提交，不代表生产版本。未部署、未调用真实渠道发送；浏览器截图均为明确标注的隔离合成样例。

## 原行为与本轮结果

main 的渠道菜单没有独立接收开关，DWS 启停复用了 bridge 暂停检查点，普通重启会恢复订阅。不能把停用渠道或撤销发送授权当作“只暂停接收”。本轮基于源码核验原行为，未补拍修改前 UI，以下截图不伪称前后现场对照。

本轮 Web 菜单和统一 CLI 共用 Host 配置端口；外层 `receivePaused` 先持久保存再应用。暂停等待适配器在途业务入站排空，重启和渠道编辑保持暂停；恢复启动既有持久水位补拉，不用新的临时游标。状态区分已暂停、正在暂停、正在补拉、接收异常和不可用。未知请求结果只读核对，不自动重复提交。

自定义插件必须显式声明版本和能力。`backfill:none` 只恢复后续消息，界面明确警告不能补拉；形似接口而未声明的插件不可操作，持久暂停也不能由不支持的模块悄悄恢复。等待认证但控制可用时可先保存暂停意图。

## 实跑结果

- 核心/真实 Host/统一 CLI：37/37 通过。命令：`node --experimental-test-module-mocks --test --test-timeout=180000 test/pi-channel-ingress-control.test.js test/pi-channel-live.test.js test/pi-settings-cli.test.js`。
- DWS plugin + bridge：98/98 通过。命令：`node --experimental-test-module-mocks --test test/pi-channel-plugin.test.js test/dws-bridge.test.js`。包含新增6项群/私聊暂停重启、恢复补拉、去重、在途 drain、部分历史失败恢复和认证边界。DWS 命令由隔离 runner 回应，不是生产账号验收。
- Web 全量单元/HTTP：145 项，143 通过、2 失败。`pnpm --dir packages/web-console test`。本轮新增 DTO、鉴权、CSRF、严格输入及响应脱敏通过。
- 上述两项失败分别位于 `test/session-host.test.js:91`、`test/shared-evolution-runtime.test.js:13`，均为 Windows `TASK_WORKSPACE_NOT_READY`。在未改 main 上独立执行这两个文件，同样得到3项中1通过、同2项失败。没有把全量记为通过。
- 真实 Chrome：24/24 通过（新增接收控制18项，加既有删除/菜单6项），1 worker、retries 0。覆盖暂停/恢复、无补拉能力、未声明、认证待定、403/版本冲突、未知回执跨关闭重开、暂停应用失败显式重试、轮询期间状态保留、键盘焦点及窄屏。深色卡片与窄屏确认框 axe 零违规。
- `pnpm --dir packages/web-console build`、typecheck、helper3/3、strict UI audit、`pnpm check` 和 `git diff --check` 通过。构建有既有 bundle 体积提示。

Chrome 复跑（Windows PowerShell，隔离树根目录）：

```powershell
$env:PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH = 'C:\Program Files\Google\Chrome\Application\chrome.exe'
pnpm --dir packages/web-console build
pnpm --dir packages/web-console test:browser channel-ingress.spec.ts channel-delete-preview.spec.ts channel-menu-focus.spec.ts
```

使用仓库 `packages/web-console/playwright.config.ts`，本地端口3081，真实 Chrome 渲染配合合成 API 响应。HTTP/Host 集成由上面的核心测试独立覆盖，浏览器 mock 不能替代真实厂商补拉证明。

## 截图

- [浅色：已暂停接收](paused.png)，1440×960。
- [深色：正在补拉，尚未完成](recovering.png)，1440×960。
- [窄屏：无补拉能力明确警告](narrow.png)，390×720。
- [严格 UI 审计](ui-audit.json)。

截图已人工检查，无横向溢出、截断操作按钮或主题过渡帧。

## 未验证与回滚

未做真实账号长时间暂停/恢复、供应商历史过期场景、其它浏览器、完整浏览器套件和根目录全量测试；不声称任意暂停时长都能补齐。供应商返回部分历史、已知消息缺失、身份不符或水位落盘失败必须保持错误/恢复界，不能报告已补齐。

回滚旧代码前应先核对并显式恢复暂停实例，或保持 Host 停止；旧版本不认识独立 `receivePaused`，直接回退启动会失去暂停语义。不得删除 ingress 文件、倒退业务 epoch 或通过重发未知请求清理状态。发送授权、已接纳任务和独立 operator 审批控制通道不随本开关变化。
