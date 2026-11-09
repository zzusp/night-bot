# 自进化、会话与界面回归

日期：2026-11-09。基于 `main` 的 `1177e5fa524660b19e9c62861176f4abdfad239d`，Node 24、Linux 隔离环境；未连接真实钉钉账号、发送真实消息或部署。本文是本次验证记录，设计规则仍以 [DESIGN.md](../../../DESIGN.md) 为准。

## 范围

- 自进化入口展示当前获权记忆、复盘学习技能、候选/应用状态、版本及最近更新。新增成功读取、搜索与技能资源加载的持久聚合采集。没有历史采集时显示未记录；不把资源加载（包括运行时自动准备）当作模型使用/采纳，也不包含外部安装技能。页面不读取正文，不展示完整历史的假时间线。
- 共享布局、表单、原生下拉框、按钮状态、徽标、链接装饰和长内容换行修正；移除重复介绍。容器允许随窗口缩小，表格在自身区域滚动。沿用 BoardUI 色彩和组件。
- 渠道与 Web 会话合并到最近列表；可信适配器名称和发送人姓名贯穿入站、持久来源与模型元数据。显示名不改变身份/权限，缺失或误传原始 ID 时中性回退。渠道输入框暂时隐藏，无新增代发 API。
- 每个实际 Web 渠道/操作者范围固定一个会话，不再新建。保留旧历史、执行记录和精确收据；旧入口仍正常输入，新消息接续当前唯一 Web 对话。未决结果不重放，延迟回复仍回到原记录。

## 已执行

| 检查 | 结果 |
| --- | --- |
| `pnpm --dir packages/web-console test` | 46/46 通过，包含真实 Host、单会话并发/重启/旧请求恢复、渠道名称投影、自进化 API 与无效操作者显示名回归 |
| `pnpm --dir packages/web-console typecheck` | 通过 |
| `pnpm --dir packages/web-console build` | TypeScript 与 Vite 构建通过 |
| `node --experimental-test-module-mocks --test test/pi-official-host-resources.test.js test/pi-evolution.test.js test/pi-reflection.test.js` | 20/20 通过，包含真实资源准备计数、作用域隔离、并发计数、无正文泄露与目录一致性 |
| `NIGHT_BOT_TEST_CONCURRENCY=2 pnpm test` | 1341 项：1303 通过、15 失败、23 跳过；不是全绿，见下文 |
| `pnpm check` | 单独通过：保留模块清单、生产导入闭合、Native 边界守卫；核心文件指纹已更新 |
| strict UI 静态审查 | 0 findings / errors / warnings |
| `designmd lint DESIGN.md` | 0 errors，11 warnings，1 info；不是视觉验收 |
| `git diff --check` | 通过 |
| `pnpm --dir packages/web-console test:browser --list` | 成功发现 6 个文件中的 50 项测试；仅证明可发现，不表示执行通过 |
| 浏览器 fixture | 隔离服务实际启动与关闭通过 |

根测试中的 15 个失败名称均在同一干净基线提交重现。涉及 Linux 无 `pwsh`、Windows LPAC、文件工具注册/权限与隐私、未决 Job、SG12 登录文件观察超时、Router 无工具交接时序、搜索安全、人审与归档拒绝断言。基线复现运行相关 11 个测试文件，共 126 项，101 通过、17 失败、8 跳过；交接 sibling 用例存在时序波动。没有为了通过而放宽这些权限或跳过失败测试。

基线复现命令：

```sh
node --experimental-test-module-mocks --test --test-concurrency=1 \
  test/pi-approval-wire.test.js test/pi-channel-plugin.test.js \
  test/pi-file-tool-registration.test.js test/pi-job-ledger-wire.test.js \
  test/pi-native-sandbox-protocol.test.js test/pi-official-memory-privacy.test.js \
  test/pi-resident-router-flow.test.js test/pi-search-safety.test.js \
  test/pi-single-task-review.test.js test/pi-single-task.test.js test/pi-task-archive.test.js
```

## 未完成的浏览器验证

实际尝试：

```sh
PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium \
  pnpm --dir packages/web-console test:browser test/evolution.spec.ts --workers=1 --max-failures=1
```

fixture 已就绪，但 Chromium 在页面打开前退出，报 `process_singleton_posix.cc:297 socket() failed: Operation not permitted`。这不是页面断言失败，也不能算浏览器通过。没有本轮真实截图或 axe 通过证据。

已添加但仍需在可运行浏览器的环境执行：浅/深色、1440 → 1100 → 768 → 390 → 1440 反复调整、无页面横向溢出、下拉框键盘、窄屏表单与长内容、自进化分页/返回/加载/空/失败/权限撤销、唯一 Web 会话跨标签与旧入口、渠道名称/姓名及隐藏输入框。静态检查、构建和脚本化 Host 测试不能替代这些浏览器结果或真实厂商验收。
