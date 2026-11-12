# 第五轮：执行记录、真实待办与模型思考

> 归档说明：本报告来自原工作树，保留该阶段的真实结果；最新主线已有另一个任务的第五轮，故放入特性子目录避免覆盖。新 PR 分支的整合验证见 [第六轮](../round-6.md)，不能将本阶段结果冒充为新分支结果。

2026-11-12。范围为安装操作者的执行记录可见性：保留业务路径，公开常用执行工具输入/文字结果，展示真实待办卡片及已返回的可读思考。不要求模型追加进度文字，不更改执行权限、Pi 记录或任务完成合同。实施前快照见 [execution-record-visibility.md](../../../spec/execution-record-visibility.md)，现行界面规范以根目录 DESIGN.md 为准。

## 受验源码

分支 `feature/public-marker-delivery-recovery`，HEAD `b9a7bd2a61f0c31d0f8e03457431dace8c976617`，存在未提交修改。结论绑定本轮工作树；原有其他模块的修改保留，不作为本轮成果。没有提交、push、PR、合并、部署或重启运行实例。

| 文件 | 最终 SHA-256 |
| --- | --- |
| packages/web-console/server/session-view.js | bfce1c71377f85ba9552f7ca5ad6e8468290e114603afbd18abd70c85556874f |
| packages/web-console/server/views.js | a45ab16a5384604a13ecf1a0148b14f7d3e9556b8328104962df2517b8226d88 |
| packages/web-console/src/api.ts | 420cce23ceffaeb104081e5dce368a5bdb0fdeb4f38582a874b363fdf13caafc |
| packages/web-console/src/components/ExecutionHistory.tsx | 977d35ebe30e86fc4684343b74a2a53c387037019e30e34464fdc31b7c07e700 |
| packages/web-console/src/components/Shared.tsx | 993fcff9b4c4e337a4269ad81a861112d9d5826b5bea927d8d1a20a4534880e8 |
| packages/web-console/src/styles/app.css | 4825fa4ba5501fa1ec0ff0a25adeda5307d85fed20d67d5b24fd4bc872712cc2 |
| packages/web-console/test/session-view.test.js | 865f277f9877d3f11590857822ce9b57663e3a7a7ad6bcd8b4a56d53f314ecab |
| packages/web-console/test/session-host.test.js | 26d03a70059647d4d835eb8a60dbb1500ad9b5a40d8af60eceba1fbdf556d63c |
| packages/web-console/test/task-progress.spec.ts | 126ccc8338e0c1c028122a55ba7b67666a5e9b8ab016f541e9763cda13d3c54b |

## 结果

- 所有当前上下文工具调用都保留真实名称、状态和来源，不再把未知工具名称替换为「未公开工具」。文件、检索、命令、作业、工作目录、TODO、网页工具的已声明业务输入与准确配对文字结果可读，包括错误正文、路径和网页地址。
- 未知输入/DTO 字段、未知工具正文、孤立或冲突结果、独立 memory/skill scope 仍有明确拒绝原因；系统指令、私有 custom/audit、环境/权限对象、凭据、厂商签名与二进制不透传。秘密在命令、错误、思考及 JSON 键/值中同样脱敏，默认未授权视图的 Windows、UNC 和 Unix 路径保护保留。
- 模型 text、可读 thinking 和 toolCall 按原块顺序展示；思考默认折叠，沿原 revision 正文分页。没有思考或普通文字的旧记录不补写。
- TODO 卡片只取同一任务会话最新已提交的 `planning/todos` 回执，显示事项、真实状态与更新时间；不从待执行调用参数取值，不因任务已完成推断全部待办已完成。清单独立于历史分页及上下文压缩，未提交和已清空分别处理，撤权隐藏全部缓存。
- 同一共享组件覆盖任务详情「执行记录」与 Chat 内任务组。更新 DESIGN、README、使用及运维说明；没有新增数据库表、核心任务字段或模型执行链。

## 验证与必要证据

| 检查 | 结果 |
| --- | --- |
| 最终 `node --test packages/web-console/test/session-view.test.js packages/web-console/test/server.test.js` | 50/50 PASS；14 项会话投影 + 36 项真实 HTTP/安全/回执场景。覆盖思考顺序与长文、秘密及签名、未知字段/孤立结果、JSON 保真、默认路径保护、待办未提交/压缩/分页/清空/非法状态反例 |
| 最终 `node --test --test-name-pattern "^task session API" packages/web-console/test/session-host.test.js` | 1/1 PASS；本地脚本模型通过真实 Host/Pi 调用 todo_write 和 task_result。任务已完成时仍保留模型提交的 in_progress，HTTP 读取保留业务路径，journal 字节与模型请求数不变；总进程 22.3 秒 |
| `pnpm --dir packages/web-console test` | 首次 60 PASS / 3 FAIL。其中一项仍断言业务路径必须隐藏，按新合同更新后已纳入最终 50 项复验；另两项既存失败见下节。没有将全量报告为全绿，最终未重跑整个集合 |
| `pnpm --dir packages/web-console exec tsc --noEmit` | PASS |
| `pnpm --dir packages/web-console exec vite build --outDir ../../docs/tmp/execution-record-visibility-build-18277350` | PASS，285 模块；独立产物，不覆盖运行实例的 dist。后续前端逻辑与样式未再改变 |
| 浏览器 browser.spec.ts、channel-execution.spec.ts、task-progress.spec.ts | 首次 25 PASS / 1 FAIL；新增用例定位到嵌套来源 disclosure，测试定位器已改为直接子 summary。其后新增用例通过，并在最终服务端上再次 1/1 PASS（24.1 秒）；其余 25 项在首次通过后未重跑，不冒充同一最终版本的全量结果 |
| 最终新增浏览器验收 | 真实可选 Web HTTP/登录及 React 构建，明确的样例任务数据；待办三种状态、思考展开、业务路径与结果、清单更新、403 后旧卡片/思考/工具记录消失均通过。1440/390 宽度 × 浅/深色四组合无横向溢出，axe WCAG 2 A/AA 无违规 |
| `pnpm check`、`git diff --check` | 最终 PASS；源码来源/导入/原生运行守卫通过。验证端口 3087 退出后没有监听进程 |

### 真实已提交任务的只读核对

使用只读 SQLite 获取任务绑定，经共享 `decodePiJournal(requireComplete:true)` 严格校验后，使用官方 `buildSessionProjection` 和本轮 `taskSessionView` 逐页读取；按时间顺序回拼历史页，逐一对照工具名与顺序。仅统计原有模型文字及回执，不解释或重定位可移植路径，不改库、不写 journal、不发消息、不调用模型。隐私原因不在版本库保留任务名称、标识或正文。

| 样本（核对时快照） | Pi 工具调用 | Web 工具调用 | Web 工具结果 | 最新待办状态 |
| --- | --- | --- | --- | --- |
| A | 42 | 42 | 42 | completed / in_progress |
| B | 252 | 252 | 251 | completed / completed / completed |
| C | 169 | 169 | 169 | completed / in_progress / pending |

三项调用名称与顺序完全一致；样本 B 一个调用没有已提交结果，界面不补造结果。三项当前投影都无可读 thinking，不据此推断厂商原始协议是否生成过推理。运行实例仍在处理业务，快照计数不作为以后时刻的固定断言。

## 最终界面证据

均为隔离样例，不含运行实例的凭据、业务正文或真实任务数据。已查看桌面浅色与手机深色截图，确认卡片、状态、思考和工具输入实际渲染。

原阶段四张样例截图保留在原工作树，未重复迁入 PR；本 PR 仅保留最新主线整合后的最终截图，见 [第六轮](../round-6.md)。

## 已有失败及未验范围

- `session-host.test.js` 的公共记忆学习用例、`shared-evolution-runtime.test.js` 的公共记忆跨渠道用例仍在 task.create 后直接 task.claim 时失败：`TASK_WORKSPACE_NOT_READY`。同一错误已在 [第四轮](../round-4.md#未通过与边界) 记录；本轮不改工作区初始化或学习链，不降低该约束。
- 未跑完整根测试、runtime/routing/containment 或所有浏览器文件；未连接真实模型、真实厂商渠道或发送消息。真实 Host 使用本地模型协议夹具，浏览器使用实际 Web 插件与样例任务，不冒充线上验收。
- 当前执行上下文分页不等于原始完整历史；压缩、分支后仍可能缺少更早条目。工具返回给 Pi 的正文自身如已截断，Web 不声称恢复未保存数据。
- 尚未部署或重启当前运行实例。功能需在正常发布时同时应用服务端和前端构建，刷新旧实例不会更新服务端投影。
- 最终报告、源码指纹和四张最终截图已独立核对。通过 `--check` 零副作用检查后，已删除本轮中间构建、临时 Playwright 配置及测试产物（包括中途失败 trace/截图）；独立复查四个临时目标均不存在，报告与四张最终截图保留。未删除其他任务或历史轮次产物。
