# 第六轮：执行正文、真实待办与思考的主线整合

2026-11-12。本轮从最新 `origin/main`（`569a6dc5da63cb0438d0aa193e5e019a337b36f0`）建立独立 `worktree-execution-record-visibility` 分支，只移入执行记录可见性、待办卡片及模型思考。受验源码为本轮未提交工作树，指纹如下；后续 PR head 对应同一源码，提交 SHA 不循环回填到文档自身。提交前再次 fetch 核对主线未变化。

原分支 PR #19 已合并，未继续 push 原分支。原工作树 58 个既有修改跟踪文件逐字节核对未变，没有纳入其他任务的渠道偏好、文件效果、首答或性能改动。原阶段报告单独保存在 [特性第五轮](execution-record-visibility/round-5.md)，不覆盖主线已有的 [第五轮](round-5.md)，也不把原阶段实跑结果当作本轮结果。

## 实现与整合结果

- 常用执行工具的已声明业务输入和准确配对文字结果可读，包括业务路径、网页地址及错误正文。全部工具名称保留；系统、秘密、私有元数据、未知字段、孤立/冲突结果和独立 memory/skill 正文继续限制。
- text、thinking、toolCall 按 Pi 原块顺序投影；实际保存的可读思考默认折叠，签名及 redacted thinking 不透传，没有记录的内容不补写。
- TODO 只取同一会话最新已提交 planning/todos 回执，逐项显示真实状态和时间；不从未执行参数取值，不根据任务完成推测清单完成。无新增消息的连续流响应也能携带更新后的清单。
- 保留主线 checkpoint 连续流、200 条窗口、授权前缀验证、向前补读、任务双栏、消息处理入口及撤权缓存隐藏，不恢复旧 offset 翻页界面或已移除的任务跳转。
- 长流样例因新增一个实际 thinking 投影，从 565 条变为 566 条；精确断言仍检查初始 200 条和向前补读后的 400 条，不降低数量或次序要求。侧栏沿主线现有“当前上下文”文案，不恢复旧“已载入”文案。
- DESIGN 为唯一 UI/UE 合同；README、使用和运维说明同步。无数据库迁移、核心任务状态字段或模型执行链变化。

## 受验源码

| 文件 | SHA-256 |
| --- | --- |
| packages/web-console/server/session-view.js | e0d5d9a79c5035228c296e2609bd163333900d4730d2c78a19185c0341314204 |
| packages/web-console/server/views.js | d5d1e31e8f1380edf3d23c3f1991351ff70097f0ddc577f53da7d9251922a85e |
| packages/web-console/src/api.ts | 5375be261f0df643b758fd64389732660074974f5f178d317369aaa24027ae2e |
| packages/web-console/src/components/ExecutionHistory.tsx | 11c6726fc9af381b2fd8e65abdc3e27258f071a907b7b1b5143bfea54dbadbac |
| packages/web-console/src/components/Shared.tsx | 6def5fe1f5e736e9d2aea37ad11027b0cacbffe2f64d354ba73e364bdc66e2b3 |
| packages/web-console/src/styles/app.css | 471ddbe9278b671dfea2e1d8fa5f8468d57387e0adf514300b08a0958126cdfd |
| packages/web-console/test/session-view.test.js | 55afb5df186fdb46a46aa725751cc4e44c97f0fb328ae6e45fb6e162c790097d |
| packages/web-console/test/session-host.test.js | 8777c1c74ad5ecf709c16f2a18e20f67814188355d89bee539c08563438a5e2d |
| packages/web-console/test/task-progress.spec.ts | 8710d97015b1962f2a2425fd1fdbaac445e2d3454100a8afe7485961968f76d4 |
| packages/web-console/test/execution-scroll.spec.ts | e75474e374a68aa39b3c0f99ff48ab72a155c244cb1846deceb88c89df19d34e |

## 本地实跑结果

| 检查 | 真实结果与证明范围 |
| --- | --- |
| `pnpm --dir packages/web-console test` | 共 244 项：231 PASS、10 FAIL、2 cancelled、1 skipped；全量未全绿，详见下节。执行记录投影 17 项全部通过；真实 Host/Pi 只读用例通过（32.6 秒）。没有将集合的失败退出报告为通过。 |
| 执行记录投影 17 项 | 覆盖路径和全部调用名、JSON/长文保真、签名/秘密、默认 Windows/UNC/Unix 路径保护、孤立和冲突结果、待办未提交/非法状态/清空/压缩、连续流 checkpoint、无新消息时的新清单。均在上述完整测试中实际执行并通过。 |
| 真实 Host/Pi 只读用例 | 本地模型协议端点通过真实 Host/Pi/SQLite 提交 todo_write、task_result；完成后清单仍有 in_progress。认证 HTTP 返回业务路径；读取前后 journal 字节、模型请求数不变。不是线上模型或厂商验收。 |
| `pnpm --dir packages/web-console exec tsc --noEmit` | PASS。 |
| `pnpm --dir packages/web-console exec vite build --outDir ../../docs/tmp/execution-visibility-pr/build` | PASS，311 模块；隔离构建，不覆盖运行实例。后续仅改测试断言和报告，前端逻辑与样式未再变化。 |
| `pnpm check`、`git diff --check` | PASS；原生/source/hash/import 守卫通过，428 个生产/运行模块，externalSdkImports=0。 |
| 七个相关浏览器文件 | 初次 47 项中 46 PASS、1 FAIL（自启动样例缺默认构建目录，HTTP 明确 WEB_ASSETS_NOT_BUILT）。包括权限认证、消息、任务卡片/思考、连续流、工具合组、撤权恢复和任务双栏。 |
| 最终浏览器专项 | `playwright test ... task-progress.spec.ts execution-scroll.spec.ts --grep '任务待办卡片|real server projects'` → 2/2 PASS，23.1 秒；新增功能用例和真实 566 条长流均通过。其余 45 项未重复执行，原 46 项中的功能用例在此再次通过。47 个不同用例已各自执行通过，不冒充最终同一命令全量重跑。 |
| 响应式与可访问性 | 新增卡片、思考展开、路径/工具结果、TODO 更新和 403 清空均通过；1440/390 × 浅/深色无横向溢出，axe WCAG 2 A/AA 无违规。另保留既有双栏、键盘、连续流和正文撤权浏览器断言。 |
| 未改主线缓存独立复核 | `node --test packages/web-console/test/evolution-cache.test.js` → 27 项：19 PASS、7 FAIL、1 skipped；七项失败与完整测试一致。缓存源码和测试与 origin/main 字节相同，模块仅导入 Node 内置库，与本 PR 新投影无调用依赖。 |

浏览器使用临时配置、3088 空闲端口及同一个隔离构建；没有更改受测产品的授权或版本行为。自启动长流样例未接收自定义 dist，首次因此无法加载页面。经 --check 后创建本任务专属 dist junction，指向 docs/tmp 内同一构建；第二次暴露主线测试残留的旧侧栏文案，按现行“当前上下文”保留精确计数断言后通过。没有延长测试超时或吞掉失败。该 junction 和中间产物不入库，交付时清理。

## 全量未通过项及盲点

- evolution-cache 的七项失败：两项受 Windows symlink EPERM 阻断；其余为缓存刷新、权限恢复、分页或 generation 断言。与主线同源模块独立复现，本 PR 不改缓存实现或这些测试。
- server.test.js 一项缓存刷新次数断言失败；first-reply-runtime.test.js 一项 Router Skill activeCount 断言失败。这两项相邻路径未修改，未进一步完成干净基线动态对照；不能仅凭未改文件就声称已经排除全部影响。
- session-host.test.js 公共记忆学习用例仍报 TASK_WORKSPACE_NOT_READY；主线第四、第五轮已有记录，本 PR 未放松任务工作区或 dispatch 保护。
- first-reply-runtime 首答综合用例和 shared-evolution-runtime 共享学习用例均被其既有 45 秒测试超时取消。没有把取消当通过，也未擅自扩大与本 PR 无关的测试预算或修改其逻辑。
- 一项现有缓存平台测试 skipped；完整根测试、runtime/routing/containment、其他浏览器文件未执行。本轮没有真实模型、真实厂商渠道、发送消息、部署或重启。
- 执行流仍为当前已提交上下文，压缩/分支前记录可能缺失。源工具未保存或已截断的文字不能由 Web 恢复。旧记录没有可读思考或 TODO 不补造。

## 最终界面证据

仅为隔离样例，无凭据、真实任务标识或业务正文。已查看桌面浅色和手机深色截图，确认真实渲染、三种状态、可展开思考和获权工具路径。保留六张必要截图，其余中间截图、trace、构建不纳入版本库。

- [桌面浅色](round-6/execution-records-1440-light.png)
- [桌面深色](round-6/execution-records-1440-dark.png)
- [手机浅色](round-6/execution-records-390-light.png)
- [手机深色](round-6/execution-records-390-dark.png)
- [真实长流初始 200/566](round-6/execution-scroll-default.png)
- [真实长流补读 400/566](round-6/execution-scroll-older.png)

## 交付边界

仅提交 PR，不合并、不部署、不重启、不发送真实渠道消息。正在运行的安装仍未应用本功能。现有 Website workflow 路径过滤不匹配本 PR，不主动触发 CI。回滚代码并按正常发布流程重新构建 Web 即恢复旧展示策略，不涉及业务数据迁移。
