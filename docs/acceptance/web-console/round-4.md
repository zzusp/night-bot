# 第四轮：消息首答关联与状态

2026-11-10。范围限首答统计：去掉回复用途/任务类型过滤，补齐明确任务来源到共同回复的关联，并区分无需回复、等待和发送状态。方案快照见 [message-first-reply-linking.md](../../spec/message-first-reply-linking.md)，现行 UI/UE 合同见根目录 DESIGN.md。

## 受验源码

当前分支 `feature/public-marker-delivery-recovery`，HEAD `b9a7bd2a61f0c31d0f8e03457431dace8c976617`，**存在未提交修改**，本轮结论绑定工作树，不能仅用 HEAD 重现。初始已有渠道插件、测试和交付方案改动全部保留，不纳入本轮修改成果。收尾时发现的 b9a7bd2 仅修改另一验收目标文档，已获用户明确授权保留并继续，未合并、撤销或改写该提交。

| 文件 | SHA-256 |
| --- | --- |
| packages/dingtalk-core/observer-pagination.js | 100e9ef1ae682073377a0efcca7fee5507928850f88d1aff5fac05932d29b2a2 |
| packages/web-console/server/response-times.js | 104c1b5167005fb49d6abbf9af356b1b93d5e88fe5045b57fe1ca56b9413c9fb |
| packages/web-console/server/plugin.js | a4f7f39b3ffaec8d659449942c00ada69ea8279955c8aabdb14e0cb0fb130fb6 |
| packages/web-console/src/components/ResponseTimes.tsx | c9dd23373b4d8ce423963f9429d46ea1f5693aa2c3aa4b2afc91a0d1dd867432 |
| packages/web-console/test/first-reply-runtime.test.js | aec61da93cdc1c89482aa2a2793dd860db97fc2961081bf3830f499e689fa487 |

## 结果

- 首答不再按 replyPurpose、通知类型、taskId 或 taskDelivery 排除已有可靠回复，保留精确会话/来源/版本与送达确认。
- 查询只选择当前消息页及关联任务的通知、事件和必要命令快照字段。共同回复须证明该来源在回复准备前已属于同会话、同任务需求版本的历史快照；当前任务后来新增的绑定不追认旧回复。兼容归档通知、事件和收据，不改历史 payload、摘要、收据或业务状态。
- 共同回复共享送达终点，各来源使用自己的 Host receivedAt；详情明确说明共同任务回复。不按正文、同批消息或时间接近猜测覆盖范围。
- `no-reply` 只对应分诊明确 `needsHandling:false` 且无 reply 的来源。需要处理但没有回复回执时显示等待处理/等待回复；已准备、失败、未知投递分别显示真实状态，缺历史不归为无需回复。
- 使用新生产查询和投影对用户给出的 9 条消息逐条只读复算，9/9 为 confirmed：5 条直接回复、4 条附件共同任务回复。定时安排取最早的安排确认，而非后来的到点提醒。四条附件均可在主说明消息不在当前页时独立匹配。历史长延迟保留，没有修改 receivedAt/deliveredAt 或重新发送。

## 实跑证据

| 检查 | 实际结果 |
| --- | --- |
| `node --test packages/web-console/test/response-times.test.js` | 6/6 PASS；覆盖无用途、任务结果、最早定时回复、来源隔离、等待分类、共同回复和较早未知发送 |
| `node --test --test-name-pattern '首答共同任务\|archived execution summaries' test/observer-pagination.test.js` | 2/2 PASS；真实 SQLite，覆盖附件单页、回复后补入、事件/快照时间、来源版本、任务需求版本、异会话、归档及只读 query_only |
| `pnpm --dir packages/web-console test` | 首次全量 57 PASS / 3 FAIL；其中新增 WAIT 场景脚本漏调用 settle，已修正，仅该测试文件复验如下；另外两项公共记忆测试在本次关联修改前已出现同样错误 |
| `node --test packages/web-console/test/first-reply-runtime.test.js` | 修正 WAIT 脚本后 1/1 PASS，36.4 秒；真实 Host/Pi/SQLite/本地模型端点/HTTP：DIRECT 未标用途仍 confirmed，WAIT 为 awaiting-reply，SILENT 为 no-reply，UNKNOWN 为 unconfirmed，其余承接 confirmed；本轮没有再次执行全部 Web 测试 |
| `pnpm --dir packages/web-console exec tsc --noEmit` | PASS |
| `pnpm --dir packages/web-console exec vite build --outDir ../../docs/tmp/message-first-reply-build` | PASS；285 模块，隔离构建，未覆盖运行实例 dist |
| 隔离 Playwright 运行 `task-progress.spec.ts` 的首答用例 | 1/1 PASS，8.3 秒；1440px/390px 无横向溢出，确认时长、共同任务回复、无需回复、处理/回复/发送等待、失败和未知状态断言通过 |
| `pnpm check`、`git diff --check` | PASS；源码/hash/import 守卫通过，原归属记录保留 |

浏览器使用既有 `startPreview` 的 dist 参数指向隔离构建，并复用原 Playwright 配置、真实 Web HTTP/认证和明确标注的样例任务服务；不将其当作真实模型或厂商验收。临时构建、临时配置及截图不作为保留证据，本报告保存必要文字摘要。

## 未通过与边界

- `packages/web-console/test/session-host.test.js:106` 的公共记忆学习用例、`packages/web-console/test/shared-evolution-runtime.test.js:49` 的公共记忆跨渠道用例，均在直接 task.create 后调用 task.claim 时失败：`TASK_WORKSPACE_NOT_READY`。关联修改前的全量测试已出现这两项错误；未改动这些测试、任务初始化或其约束，不将全量宣称为全绿。
- 未跑全部根测试、完整 routing/runtime/containment、完整浏览器与 axe；本轮最小充分验证是上述首答、SQLite 和 Host/HTTP 专项。
- 未发送真实消息、调用厂商接口、提交、push、触发 CI、合并、部署或重启当前运行实例。现场复算只读，页面实际应用仍需后续按正常发布规程更新服务端及前端。
