# 渠道回复复核：最终代码定向复验

2026-11-19，Windows 11、Node.js 24、真实 Host/Pi、本机脚本模型和假渠道。实跑基于 `00b57c7f8892f28424297980f4dbd01d6721b511` 上未提交的最终实现与测试；包含渠道任务的提交绑定快照。复核模块 Git blob `50bd4ac765e15576dbb011aef6c1063320313057`，分诊/Router 接线 blob `9b97f6b5f5f6b4cc63e431cd4453cd34032b0598`，任务服务 blob `82519b1e554d277f02f4809a325cadc3e2584f64`。归档后仅补文档。

`pnpm check` 和 `git diff --check` 均通过。下面定向运行 11 项，11 通过、0 失败、0 跳过；未用这组结果替代完整路由套件。

```powershell
node --test --experimental-test-module-mocks --test-concurrency=3 --test-name-pattern='first tier keeps|Router returns review|Router progress quotes|triage always sees|reviewer is unavailable|edited source cannot freeze|triage reuses history|cold recovery retires|conversation task questions|all four default dispositions|legacy prepared replyRequest' test/pi-resident-router.test.js test/pi-persistent-triage.test.js test/pi-resident-router-flow.test.js
```

| 用例 | 观察到的业务行为 |
| --- | --- |
| 分诊写作和拒发 | 作者实际请求包含核心规范，完整例子用原只读工具获取；无回复处置不进入复核。复核失败或返回错误索引时，原稿没有冻结或外发。 |
| Router 正文与来源改版 | 夸大根因/进展的稿子退回原会话，只冻结和发送改写后的正文；等待复核时编辑来源，旧稿不能冻结或送达。保留原来源引用。 |
| 任务直接提问 | 需求提出者的问题退稿时，没有人工请求或通知；改写后按原来源送达、回读，回复让同一任务会话继续。默认和显式操作者问题仍只进入 Web。 |
| 历史、未知投递与冷恢复 | 两条分诊历史/冷恢复失败项在最终代码复验通过。四类处置保持原语义；旧冻结内容和摘要保持不变，未知结果读回，参数冲突仍拒绝，没有新增发送。 |

另外，将当前改动过的 JavaScript 模块通过 Node 加载钩子替换为 `git show HEAD:<path>` 的主线原文，单跑未改动的 `test/pi-router-task-e2e.test.js` 的 `continuation=router-busy` 用例。在同一 `task.claim` 调用处仍报 `TASK_WORKSPACE_NOT_READY`，确认首轮第三项失败可在未改主线复现。本任务未放开工作区保护或改动该夹具。

未运行真实 UAT 模型、时延和厂商渠道验收；任务各类提问已测，任务直接事实追问未单独端到端复验。验收证明出口会执行复核且不发送被拒草稿，不能证明模型对自然度的每一次判断都正确。没有合并、部署或重发真实历史消息。
