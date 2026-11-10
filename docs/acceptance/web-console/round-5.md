# 第五轮：最新主线整合与 PR 回归

2026-11-10。本轮从最新主线 59f6816473c54d3158a1034bfd39694f01541265 建立独立 worktree-message-first-reply，移入第四轮首答修复；受验时存在未提交修改，结论绑定下列源码指纹及本轮测试工作树。主检出的既有渠道插件、测试及交付方案修改未带入，不撤销、不提交。第四轮历史结果保留，本轮不是对旧结果的覆盖。

## 整合结果

- 保留主线新执行过程 UI、阶段 kind/shared/durationMs、开始处理端点、累计时间线、按需读取和撤权保护，不恢复旧 UI。
- 首答按直接来源或已证明覆盖范围的共同任务回复计时，不按用途或任务类型筛选；只读历史快照关联逻辑不变。
- 保留主线更早回复可见性不确定的守卫，已送达但缺确认时间仍为 unconfirmed，不把后续回复冒认为首答；未标用途但可靠送达现在可以计时。
- 仅明确无需处理且无需回复为 no-reply，其余按等待与实际投递状态展示；共同任务回复说明在新详情布局中可见。

## 受验源码

| 文件 | SHA-256 |
| --- | --- |
| packages/dingtalk-core/observer-pagination.js | 100e9ef1ae682073377a0efcca7fee5507928850f88d1aff5fac05932d29b2a2 |
| packages/web-console/server/response-times.js | 8cb46a8842636977b58eae64b0f07e489d14aa7f24d4f135bf2349bf16f48c3e |
| packages/web-console/server/plugin.js | 32167aba3a018789bede703863fc040ade37afe85cd524b902e1051816c4e039 |
| packages/web-console/src/components/ResponseTimes.tsx | b47e5b70686d0291d038386e4ae6f2378c253051c43fde62d1abfb7b084c8149 |

## 实跑结果

| 命令 | 结果与证明范围 |
| --- | --- |
| node --test packages/web-console/test/response-times.test.js test/observer-pagination.test.js | 26 PASS / 4 FAIL；首答投影 8/8 PASS。四项旧 observer 测试仍硬编码已退役 packages/dingtalk-dsh-assistant/task-session-service.js，报 ENOENT；未恢复旧兼容目录。 |
| observer 首答共同关联和归档匹配专项 | 2/2 PASS；包含真实 SQLite、归档、query_only、版本/时间/会话反例。 |
| pnpm --dir packages/web-console test | 91 项：89 PASS / 2 FAIL。真实 Host/Pi/SQLite/HTTP 首答专项通过；两项既有公共记忆测试仍为 TASK_WORKSPACE_NOT_READY，见下文。 |
| pnpm --dir packages/web-console build | TypeScript 检查和 Vite 生产构建 PASS；293 模块。 |
| pnpm check | 源码/hash、production imports、native runtime 三守卫 PASS；404 个运行模块，externalSdkImports=0。 |
| pnpm --dir packages/web-console exec playwright test task-progress.spec.ts execution-redesign.spec.ts | 6/6 PASS，24.8 秒；首答、共同结果、所有等待/投递状态、分页/撤权、键盘、1440/390px、浅深色及既有 WCAG/axe 断言通过。 |

专项的实际命令：

```powershell
node --test --test-name-pattern '首答共同任务|archived execution summaries' test/observer-pagination.test.js
```

## 已知失败与交付边界

Web 两项失败为 session-host.test.js 的公共记忆学习与 shared-evolution-runtime.test.js 的跨渠道记忆，均在 task.create 后 task.claim 处报 TASK_WORKSPACE_NOT_READY，发生在首答查询之前。旧 observer 四项的目标路径在 origin/main 已相同，不属于本次修改；本轮没有放宽任务工作区、dispatch 或 sandbox 保护来消除失败。不能宣称全量全绿。

本轮测试结束时尚未创建/合并新 PR、部署或重启。合并与部署事实后续集中记录在该 PR 的交付评论，并核验实际 merged SHA、干净部署检出、运行进程、健康、静态资源和真实原消息首答。未进行新的真实厂商发送或模型业务验收；第四轮九条只读历史复算结果见 round-4.md。
