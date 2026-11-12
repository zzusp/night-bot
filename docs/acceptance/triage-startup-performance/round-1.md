# 第一轮：协议预加载与分流分项观测

## 结论与边界

第一轮实现和相关专项通过；完整默认回归未全绿，不能作为发布通过证明。本轮不部署、不重启运行安装、不发真实渠道消息、不调用付费模型。未证明生产首答实际降低多少秒。

实现范围：

- `src/pi-provider-catalog.js:136` 只导入选中模型真实 api 对应的官方 Pi 模块，按协议去重，不解析凭据、不做模型发现或推理。
- `src/pi-official-runtime.js:15` 在官方工厂发布前等待预加载，覆盖耐久默认模型及显式运行时/记忆模型。有效模块导入失败阻止工厂就绪；无效/缺失模型声明保留既有延迟诊断。
- `src/channels/resident-router-business.js:21` 由 Host 生成计时能力，贯穿工作目录、存储、挂载、资源解析、SDK 创建、输入、请求、提交与收尾。既有三次请求前资源刷新和授权/持久化顺序不变。
- `src/runtime/pi-agent-observation.js:113` 阶段只生成白名单元数据，保留耗时和失败标志，计量异常不替换业务结果。
- `packages/dingtalk-core/task-session-service.js:343` 普通 SDK 事件仍验证实时 actor；入队时捕获真实分流身份。Host 阶段走独立可信回调，不伪造尚未创建的 actor。
- `packages/dingtalk-core/performance.js:164` 与既有 resident 性能分区/队列共用耐久投影；分流无 taskId，以 sessionId/groupId/runtimeOwner 查询。释放 actor 后的排队记录及冷恢复仍保留，旧数据不推测回填。

真实可选渠道在 `night/ready` 后启动入站：`src/channels/plugins/dingtalk-dws.js:190`；应用在任务恢复后发 ready：`src/application.js:46`。预加载没有加入任何 DWS 探测。

## 受验源码

- 日期：2026-11-12；Windows 11，Node.js 24.19.0，pnpm 11.25.0，Pi 1.5.0。
- 分支：`feature/public-marker-delivery-recovery`。
- HEAD：`b9a7bd2a61f0c31d0f8e03457431dace8c976617`。
- 验证对象是包含其他既有改动的未提交工作树，不是仅 HEAD。`git diff --name-only -- src packages test` 共 37 个文件。
- 实际代码差异指纹：`b1efb64604fd075a9b20ea6760b3d1177beae31312e812540c82e888aec7a0b7`。
- 指纹算法：按上述文件名排序，依次对 UTF-8 文件名、NUL、当前文件原始字节、NUL 做 SHA-256。没有暂存、提交或推送，也没有覆盖其他会话原有改动。

关键当前文件 SHA-256：

| 文件 | SHA-256 |
| --- | --- |
| src/pi-provider-catalog.js | 63cdd4f52b37ac302fa7e89bd4ac66ff6a8be6b44ac5889f660dc0712a45a9dd |
| src/pi-official-runtime.js | 8852d93a8dd37d95db6d68e5a432b3cfa2f32fe05fece8795c9e9d28a30c2e14 |
| src/runtime/pi-agent-observation.js | c713d9710b9d9e4a3e993acff174c2c2e57f70b0870c48a6745d0188bb69553e |
| packages/dingtalk-core/performance.js | ca1751c33d0bc388afabef0d8398d7cb1ced37b2200519b2a04e9005641599c5 |
| packages/dingtalk-core/task-session-service.js | 695feef12c1fdfacac1549c4da3f9655235cad21bcdcde36efea0aacf08118bc |

## 实跑与结果

1. `node --test test/pi-agent-observation.test.js test/pi-official-agent-factory.test.js test/pi-official-context-hooks.test.js test/pi-official-session.test.js test/task-session-observability.test.js`：40 通过，0 失败。后续仅将 SDK 创建写回显式 await 结构以满足原守卫，最终完整回归中的相关用例也通过。
2. `node --test test/pi-official-model-runtime.test.js`：16 通过，0 失败。公开模块 load hook 实测选中协议只加载一次，未选路由未加载，fetch 调用为 0，读取凭据引用会抛错的夹具仍通过。真实 Host 使用本地 HTTP 模型，并验证依赖官方工厂的插件可就绪。
3. `node --test --test-name-pattern='taskless triage persists preparation' test/pi-resident-router-flow.test.js`：1 通过。真实 Host/Pi/本地模型执行纯分流；模型/工具计数各 1，无任务、无发送；分项齐全；actor 已释放；重启并重投同一来源后指标一致、无新增模型请求。
4. `node --test test/performance.test.js test/performance-runtime.test.js test/task-session-observability.test.js`：23 通过、1 文件加载失败。失败是额外旧测试导入已退休 `openResidentRuntime`；该导出在原 HEAD 就不存在。本轮未恢复旧运行链。
5. `NIGHT_BOT_TEST_CONCURRENCY=2 pnpm test`：1370 总计，1306 通过、37 失败、27 跳过、0 取消，约 1414.8 秒，exit 1。新增用例均通过；由于测试失败，命令中 `&& pnpm check` 未执行。
6. 独立 `pnpm check`：exit 0。来源守卫：190 保留、10 退休、3 排除、59 适配；生产导入：400 文件、195 literal bare imports；原生守卫：400 文件、外部 SDK imports 0、旧编排定义 0。
7. `git diff --check`：通过。

所有模型与渠道执行均为隔离目录、本地脚本模型和假 transport，不包含生产模型或真实消息验收。

## 全量失败及反证

37 项按实际错误分类：

- 31 项 `TASK_WORKSPACE_NOT_READY`：档案、复盘、Router ledger、业务失败、live supplement 等旧夹具直接 `task.create -> task.claim`，未满足现有工作区初始化合同。检查点为未改动的 `packages/dingtalk-core/dynamic-task-store.js:835` 与 `packages/dingtalk-core/session-workspaces.js:43`；原 HEAD 已有相同守卫和代表夹具调用顺序。
- 4 项 `EPERM symlink`：当前 Windows 账号无相关 symlink 权限，失败发生在夹具建立链接阶段；没有降低安全断言或改用 full 模式。
- 1 项 `ENOENT`：`test/pi-task-archive.test.js:64` 验证附件恢复时缺少 tasks 目录。
- 1 项 `Missing expected rejection`：`test/pi-resident-router-flow.test.js:226` 的既有 DWS 回执/后续 flags 拒绝断言不满足。

为避免把失败直接归因于既有代码，另开隔离 Node 测试进程，用公共 `registerHooks` 在内存中将本轮 12 个运行时模块换为上面 HEAD 的版本，分流文件仅保留开工前已有的 `channel-triage-memory` 提示；其他已有 dirty 改动和测试均保持。逐模块输出实际 SHA-256，未 checkout、写回或回退工作区。八项代表用例结果：0 通过、8 失败，与当前版本同因：

- `pi-native-task-archive` 两项与 `pi-reflection-official` 一项、`pi-reflection` 三项：均 `TASK_WORKSPACE_NOT_READY`。
- `pi-resident-router-flow:177`：仍在第 226 行 `Missing expected rejection`。
- `pi-task-archive:58`：仍缺 tasks 目录。

对照加载确已生效，例如原 `performance.js` 哈希为 `d425b31d9836d6023a4bada449a7b8f16d523077851b431cf095fe4f01599c30`，原 `task-session-service.js` 为 `b72fca2de477204bf33182e04771d0b879c17ac9ceeccabf0b3f97d0860dc7b7`，原 `pi-official-runtime.js` 为 `37e608d738b8fcfc9ea7bfdbceaee5071bd2271e080974e51c87601e25d516e3`。

这是八项代表的修改前对照，不声称对 37 项逐项做过完整基线。上述旧夹具/环境问题未扩展为本轮修复，也未绕过工作区、授权或严格 journal 校验。

## 本轮修正与未验项

首次纯分流集成验证因未接入 observe 回调而等不到尾部指标，补齐接线后专项及完整默认回归内的新用例通过。来源守卫首次因包装遮蔽显式 `await createAgentSession` 而失败，恢复清晰的官方创建结构后独立守卫通过。排障脚本的转义错误不计为产品失败或新轮次。

未独立运行 `pnpm test:runtime`、`pnpm test:routing`、`pnpm test:containment` 三个命令；默认回归中已执行其中的 Pi 用例，不据此宣称这三个组完整通过。27 项默认跳过保留为跳过。真实模型、真实渠道首答、部署与冷启动收益均未验。

分项为异步观测，业务提交完成不代表尾部已持久化；测试等待实际 `triage-total` 行可见，再检查冷恢复。嵌套父子阶段及并行读取不可相加；SDK assistant 尝试数不等于 HTTP 请求数。启动预加载转移首次导入成本，不保证端到端减少固定秒数。

本轮无可交付的临时脚本或原始业务日志，必要文字证据集中于本页。取消的早期重复默认回归不计为通过，已按确切 PID 核实并清理其测试进程树；运行实例未操作。
