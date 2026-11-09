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

## 原环境未完成的浏览器验证

实际尝试：

```sh
PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium \
  pnpm --dir packages/web-console test:browser test/evolution.spec.ts --workers=1 --max-failures=1
```

fixture 已就绪，但 Chromium 在页面打开前退出，报 `process_singleton_posix.cc:297 socket() failed: Operation not permitted`。这不是页面断言失败，也不能算浏览器通过。没有本轮真实截图或 axe 通过证据。

已添加但仍需在可运行浏览器的环境执行：浅/深色、1440 → 1100 → 768 → 390 → 1440 反复调整、无页面横向溢出、下拉框键盘、窄屏表单与长内容、自进化分页/返回/加载/空/失败/权限撤销、唯一 Web 会话跨标签与旧入口、渠道名称/姓名及隐藏输入框。静态检查、构建和脚本化 Host 测试不能替代这些浏览器结果或真实厂商验收。


## 指定云环境接续验证（2026-11-09）

基于最新 `main`：`58cc40a0fe3a5d99a424c3fc9783312668431a06`（含 PR #6）。导入归档 SHA256 `be3fa71d6c64dbbb661f8af3bb9ba99fddaeea683ebeb2f3bbc50ef93801d3a9`；`git bundle verify` 通过，原提交 `9e43f30d672c9165acbdc97a518d677469e39e32` 与 tree `c89549531984ef5e5e414e1c809ac7798bd84d33` 均匹配。工作区原先干净，使用独立导入 ref 和新分支 cherry-pick。

仅渠道说明文案发生文本冲突；保留当前 main 的 `writesAuthorized` DTO、授权界面、默认不外发、目标/类型切换撤权及保存后重新编辑授权的规则。Host 配置授权实现未修改。未新增渠道代发、未发送真实消息、未部署或合并。

本环境 Node 24.19.0，依赖按 frozen lockfile 安装。实际结果：

- Web 单元/Host 测试 46/46 通过；核心资源、记忆、自进化、复盘和渠道测试 24/24 通过；Router 测试 4/4 通过。
- 渠道插件集成 29 项中 28 通过，SG12 登录文件观察超时 1 项失败；同一失败已在最新干净 main 的独立 worktree 上再次复现（`--test-name-pattern='SG12 默认真实登录文件观察'`），并非本轮全绿。
- 类型检查、生产构建、`pnpm check`、`git diff --check` 通过；本轮 strict UI audit 为 0 errors/warnings/findings。环境无 `designmd` 可执行文件，未重新执行其 lint；上方旧环境结果不作为本轮结果。
- Chromium 使用 `/usr/bin/chromium` 成功启动。整套浏览器首轮 51 项：45 通过、6 失败。发现并修复编辑按钮可见文字与朗读名称不一致；同步精简文案后的测试预期；原生 select 在无头 Chromium 将 Escape 传给 dialog 时，测试核验关闭后的焦点恢复并重新打开，保留后续键盘和窄屏表单验证。
- 浏览器复测结果见下方补记。首轮通过包含自进化加载/失败/空态/权限撤销、浅深色缩放、唯一 Web 会话、渠道名称/姓名与隐藏输入框，以及渠道显式授权与撤权。截图仅用于本地验收，不作为真实厂商接入证明。

本轮未重跑根全量测试；先前基线的 15 项失败记录保留在上方。真实厂商验收、部署和完整人工可访问性认证仍不在本轮范围。

复测：重建后运行 `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium pnpm --dir packages/web-console test:browser test/browser.spec.ts test/channels-create.spec.ts test/visual-consistency.spec.ts --grep 'axe WCAG AA|新增群聊切换|编辑回填|外发授权默认|shared controls'`，7/7 通过（32.6 秒），包括首轮失败的全部 6 项和授权回归。并非修正后重新运行整套 51 项；其余 45 项沿用本轮首跑结果。最终生产构建、类型检查和 strict 静态审查再次通过。

## PR #7 后续反馈修复（2026-11-09）

- 渠道执行视图根因：渠道页仅读取 observer messages/outbox，Web 则独有执行视图组件和 ledger ID 转换接口。现抽取共用 `ConversationExecution`，渠道以实际 groupId 提供 Router 正式历史及完整关联任务（含归档）读取；逐次核验会话可见性与任务归属，复用原正式历史分页、正文、脱敏和来源链。输入框保持隐藏，消息姓名投影不变。执行记录遇权限拒绝或记录消失时不继续显示已缓存正文。
- 认证根因：原客户端直接将资源 401 视作会话结束；CSRF 换代核对中的任何异常（包括网络和 503）也派发失效事件。现只读查询 `/session`，只有明确 `401 AUTH_REQUIRED` 才退出；普通资源权限拒绝不退出，核对故障保留页面和草稿，不重放写操作。有效会话的同一 CSRF 不触发无意义的认证换代；旧请求不能撤销新登录。会话仍为内存存储、固定 12 小时，重启会结束会话，访问令牌仍可用；未修改 Cookie、CSRF、限流或授权策略。没有现场会话日志，不能断言用户那次重连究竟由重启、到期还是误判触发。
- 三张用户截图逐一核对：侧栏 `.rail-channel > span` 将徽标也固定为 32×32 图标框，导致竖排；限定为图标节点并防挤压。复制动作原有 30px 左边距与负底边距，改为正文之后正常布局、左侧对齐。渠道卡片改为名称与状态同一标题行、独立状态区域及底部编辑动作，自适应列数。
- 新增 `channel-execution.spec.ts`、`session-recovery.spec.ts`、`layout-feedback.spec.ts`；服务端补可见性、跨会话拒绝、归档查询和不可用状态回归，精确检查 12 小时 Cookie/服务端到期边界。
- Web 单元/Host 回归 47/47、构建/类型检查、`pnpm check`、strict UI audit 和 diff 检查通过。浏览器完整结果及最终复测补记如下；不将中断或旧构建尝试计为通过。

本轮完整浏览器运行：58 项，57 通过；布局测试唯一失败为误选隐藏 dialog 中的按钮，已将选择器限定为可见卡片操作。随后以最终认证逻辑重建，认证/生命周期/布局/渠道共 16 项中 15 通过，渠道测试因顶部 h1 与内容 h2 同名的选择器歧义失败，改为精确 h2（不修改产品行为）。最终权限缓存修复后重建，再跑正式任务记录、提交等待、浅深色 axe 和渠道执行 5/5 通过（29.9 秒），涵盖渠道权限拒绝后隐藏记录及重试。认证/生命周期/布局的 15 项通过结果沿用同轮复测；未再次完整执行全部 58 项。最终单元/Host 为 48/48，新增重启撤销会话而令牌不变回归。构建、类型、strict audit、边界和 diff 检查通过；designmd lint 仍因缺少命令未重跑。

交付目标变更：核验远端时发现 PR #7 已于 `2026-11-09T12:58:06Z` 合并。后续修复以 `21154c5d878574c49b79b1f490064f905b4ee732` 为基线创建独立 PR，不向已合并 PR 追加不可审查的提交。

## 所有会话统一参考截图布局（2026-11-09）

已读取用户参考截图：目标为顶部「对话 / 执行过程」、相同消息区与宽屏工作动态，不再沿用渠道单独的大标题和固定说明页脚。新增共用 `ConversationFrame`，Web、钉钉、自定义群聊和私聊共用同一会话壳；名称在工作区顶栏显示，工作动态和显示/隐藏操作对全部会话一致。渠道仍无输入框，只有 Web 提供输入；更早消息分页仅在需要时展示。显示名和身份投影、正式执行记录权限与归属校验未改变。

增加自定义群聊/私聊隔离夹具，使用渠道无关的实际 groupId、独立任务归属和正式 Pi projection，经生产 Web HTTP 路由读取；不将自定义渠道当作钉钉。夹具证明 Web 展示与 API 链路，不代替第三方插件或真实厂商验收，也没有新增通用插件安装/配置入口。

实际验证：Web 单元/Host 48/48；类型/生产构建、strict audit（0 findings）和 diff 检查通过。浏览器 `browser.spec.ts`、`channel-execution.spec.ts`、`conversation-frame.spec.ts` 共 27 项首跑 26 通过，唯一失败为增加自定义渠道后卡片数旧断言仍为 3；修正为真实 4 张卡片，重建后原失败与四来源布局共 5/5 通过（14.4 秒）。四来源均反复覆盖 1440 / 1100 / 768 / 390px、对话与执行切换、外部输入隐藏、Web 可输入、宽屏工作动态，以及自定义群聊/私聊正式任务记录；本地检查桌面与窄屏截图。首跑已通过浅深色 axe、网络恢复和渠道权限缓存回归。没有重复无关根全量、真实厂商接入或部署；designmd lint 的既有限制仍保留。
