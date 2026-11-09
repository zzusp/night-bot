# 第 3 轮：完整组终态与受影响用例复验

日期：2026-11-06。本轮接回原串行完整组，定位并修正失败测试后，只复验受影响的原用例。**定向复验通过；原 runtime/default 完整组失败保留，不能表述为当前版本完整 `pnpm test` 全绿。真实模型仍 BLOCKED。** 第 1、2 轮和矩阵历史列保留，各分批计数不相加。

## 实际源码与授权边界

- 分支 `worktree-resident-conversation-routing`；HEAD `eca0df5ed127d8b043ba087291bfb1426d0ca5d6`；团队共享未提交工作树。HEAD 不代表实际受验内容，以下以各操作起止指纹绑定证据。
- Windows 11、Node 24.19.0、pnpm 11.25.0、官方 Pi 1.5.0。使用真实 Host、SQLite、Pi journal/压缩与本地脚本模型；渠道为 fake。本轮没有真实模型请求或真实消息发送。
- S6 本轮只修改七份独占测试与本报告/矩阵。没有修改产品源码、共享模型/Host fixture、guard、总目标或审查记录；产品修复沿用其他负责人的当前源码。
- 没有 commit、push、PR、CI、merge、deploy。没有搜索邻接秘密或从其他会话搬取凭据。

## 正式终态

| 操作 / 范围 | 实际终态 | 源码与结论边界 |
| --- | --- | --- |
| `bui9nxa82` routing | 59 PASS / 0 FAIL / 0 CANCEL / 0 SKIP；297875.2113ms；`GROUP_EXIT:routing:0` | 1102 源码聚合 `34930ad661688edbffe6af82a69d91005b51805932c9db45fbff34308e506df1` 起止相同；store 为 cf6，不冒充随后 d1 的完整组。 |
| 同操作 runtime | 162 tests：139 PASS / 9 FAIL / 2 CANCEL / 12 SKIP；1893933.2511ms；`GROUP_EXIT:runtime:1` | 聚合 `34930ad6…` → `2bd8219ad6d729494931c5b0357015a32e3721a617744aade6265508de4612d0`，store cf6 → d1；这次完整组不是 PASS。 |
| 同操作 default | 1204 tests：1172 PASS / 4 FAIL / 2 CANCEL / 26 SKIP；2365488.54ms；`GROUP_EXIT:default:1`；wrapper exit 1 | 起点 `2bd8219a…`，终点 `3e952ffb32a0400bd6176ef9219e6ee2778d362b1d656ac3e043516d03bb55e4`；生产关键源为 d1/da4/82/1f，期间只迁接已退出 runtime 的两独占 native 测试。存在下述准确文件 worker 强制结束，不能称整组自然通过。原 `pnpm test` 的 `&& pnpm check` 未执行。 |
| `b0ygn56vz` runtime-affected | 12 PASS / 0 FAIL / 0 CANCEL / 0 SKIP；465937.0153ms；`GROUP_EXIT:runtime-affected:0`；自然 exit 0 | 先观察原 `GROUP_EXIT:default:1` 再启动；1102 源码聚合 `3e952ffb…` 起止相同，七项关键 SHA 相同；不是与 default 并行。 |
| `bku4phlr9` cleanup 诊断 | 1 FAIL / 0 CANCEL / 0 SKIP；7366.8804ms；自然 exit 1 | 保留原不响应 Router 的模型，只修完整清理与递归诊断。真实错误仍失败，进程不再被 HTTP listener 保活。四项关键 SHA 起止相同；single-task 测试为中间指纹 `80dd385b5c9c0196429dbb568dd4f5e50bdfa7939f2fb2cfbd3adc9d9877633b`。 |
| `beilfcapo` default-affected | 10 PASS / 0 FAIL / 0 CANCEL / 0 SKIP；50680.1159ms；`GROUP_EXIT:default-affected:0`；自然 exit 0 | 六个原问题及清理变化涉及的另外四个原用例；五个独占测试、五个公共 fixture 和五个产品关键文件，共 15 项 SHA 起止相同。没有重跑无关全量。 |
| `bcxuy7xnh` 当前 `pnpm check` | exit 0；`GROUP_EXIT:post-default-check:0` | 194 retained / 53 adapted；404 production import files / 190 literal bare imports；404 runtime JS / 0 external SDK imports / 0 legacy orchestration definitions；5 historical source files verified / 9 historical format files removed。没有放宽 manifest/hash/import/native guard。 |

`git diff --check` 在最后测试修改后通过。domain 391/391 与其重叠补验、containment 5 PASS / 17 SKIP、其他已收口专项沿用第 2 轮，不重复计数或运行。

### 原 default worker 保活的处置

原 `pi-single-task` 文件六例均已打印业务终态（5 PASS / 1 FAIL）后，没有新的业务连接或子进程，worker 仅剩 `127.0.0.1:54681` HTTP Listen。Lead 仅读 Windows PEB cwd，直接核实 29228 / 96648 / 86068 都属于本 worktree；S6 再核 worker 创建时间 `2026-11-06T20:47:53.6740280+08:00`、父 PID 96648、测试参数、零子进程、唯一 loopback listener。

执行前运行两项实际零副作用 `--check`：精确身份/资源核对，以及原日志六例均已终态且未有 default marker 的核对。只结束准确 worker 86068；没有杀 wrapper、聚合 runner 或按名称清进程，没有伪造 marker、添加 `--force-exit` 或把停止当 PASS。

独立只读核对得到 `ExactWorkerExists=false`、`FormerPortHasListener=false`，29228/96648 随后自行退出；原 runner 释放其余报告，wrapper 按实际失败 exit 1，已有事件门闩才启动 12 例。这段是**强制结束遗留文件 worker**，不是原完整组自然成功。

## runtime 的 11 个问题及正式复验

| 原失败 | 迁接依据与保留的业务断言 | `b0ygn56vz` 结果 |
| --- | --- | --- |
| 人工复核 empty business 60000ms 到期 | 此分支比成功/无效来源分支多失败停留、三次 recover 不自重试及真实新答复后的复核；仅此分支使用 45000 基础预算（Windows 90000），不是统一加时。保留权限、只读工具、精确答复、无自动重试；取消诊断只读缓存。 | PASS，59721.6956ms；business 57170ms。 |
| original-group changed=false/true 原裸 30000ms 被取消 | 用既有 nativeTestTimeout；变更钩子迁接真实 resident_task_action，changed=true 明确 revise。原 session、requirement/control fencing、问题 answered/superseded 保留。 | 两例 PASS，32849.5995 / 27023.5912ms。 |
| 缺原件匿名上传者仍断言旧 topic audience | 实际交办来自认证作者；问题为 requester，不猜上传人、不索账号。保留独立进度真实字节、唯一 effect、等待 recover 不空转及原 session 续办。 | PASS，35912.745ms。 |
| 无真实群来源的 Web 待答两例仍预期不保存问题 | Web 可保存内部 requester 问题，groupId 不授群/私聊/operator 外发。保留 stale/假问题/假 source 拒绝；真实 Web 答复后捕获原 taskId、作者/原文进入第二轮执行 input，再核精确 wait decision，防止只改账本 answered 的假通过。答前/答后通知与 send 均为零。 | 两例 PASS，16091.8789 / 16498.6262ms。 |
| 32 次 Web 续办误以为自动带 IM timing stages | 用 Host source.stage 把诊断元数据写入原 task source，逐轮检查真实 native admission packet 剔除 stages；SQL仍保留。删除实际过滤会首轮失败。32 来源包/lease、真实 effect/文件、官方 compaction 和原写证据保留，预算未增。 | PASS，223657.0194ms；leases=32，businessCalls=33，officialSummaryCalls=29，nativeCompactionEntries=25。 |
| 11 输出把 Router 工具计作第二任务 session | 只对实际 write/read/task_result 核唯一原 task session；保留 11 文件字节、11 write/read、11 effect-intent、completed/drained、无 execution、recover 不重调模型。 | PASS，5878.5136ms。 |
| requirement fence 把合法 changed/waiting 也禁止 | 明确旧结果不能生成 task.completed，同时要求 req2 的 changed/waiting；保留旧结果 STALE、原 session、两真实来源及 native admissions [1,2]。 | PASS，4120.1378ms。 |
| persistent=false/true 模型错误注入误伤 Router | 故障仅作用含 task_result 的真实任务请求，不再给 Router settle/handoff 注入 provider error。held、technicalFailure、drained、无自动 retry、新 context 唯一续跑、无额外 effect 保留。 | 两例 PASS，6106.0897 / 5272.1557ms。 |

### 固定 notification.start 负收据冷恢复

在原附件 case 增补，不新增测试文件或重复专项：父说明尚未 delivered 时，连续两次使用同一 `notification-start:<child>:0`，核 prepared、dispatchEligible=false、attempt=0、无 permit。父回读 delivered 后归档并冷启，原 command ID 只授一次合法发送；核 attempt=1、冷重放不再授新许可、starting/unknown 只能 readback，最终 delivered。

原父子双成员受众、冻结字节/文件名/caption、无隐式引用、归档后剩余交付、任务模型不重跑全部保留。正式 PASS，27457.1362ms，使用 d1 store；不是拿旧 cf6 的附件 PASS 外推新修复。

## default 六个问题及同因影响

1. `pi-single-task-initial-input` complete/blocked 两例读不存在的 v1 topic_facts。改核当前 v2 `historical_topic_facts.length===0`，仍要求无 Topic/reply binding、无 missing-binding alert，blocked 保留等待问题。
2. `pi-single-task` memoryscope 原业务断言已通过，失败在 after。Node 24 首个 after 报错会跳过后面的 memoryHost cleanup，留下 HTTP server。局部集中清理，逐项执行并最终聚合抛出原错误；service/store/residentStore 和手动 uncertain-effect 清理同样处理。没有修改公共 memoryHost 或生产关闭逻辑。
3. 保留旧模型复现后的递归诊断明确：`Single task fixture cleanup failed` → `Task service shutdown failed`（service:1749）→ `Conversation shutdown failed`（1739）→ `Router shutdown failed`（router-lifecycle:189）→ `ROUTER_BATCH_UNSETTLED`（drain:159）。没有本次 actor.dispose/ownership cause。旧模型只响应 task_result/reflection，给 Router 默认 verified 文本。只在此 memoryscope case 按现有 helper 补真实 settle、tool-free handoff，并等待 service.whenIdle；原 chat/chat-room 记忆绑定、metadata、两唯一 task session、无协调 execution 保留。
4. `pi-task-archive` 历史恢复 case 拿 v2 导出混入 topic_facts，却用 v1 算 digest。按既有 `pi-router-ledger:140` 夹具，显式 version=1、移除仅 v2 的四表、保留合法 v1 全集，按实际 version 重封。仍要求历史 source 可查但不可路由、Topic fact 不可活动/接受、notification 不可 start；不放宽 validator。
5. effect-call identity 和 retained SQL operation 原裸 20000ms，含多轮真实输入及 Host 冷启。只这两个实际取消的 case 用既有 Windows nativeTestTimeout(20000)；保留新来源可明确重复同参 effect、重复输入/冷恢复不重放、unknown operation held 且不重建 journal/不 dispatch、无关任务仍正常。

`beilfcapo` 十例全部通过：两个 direct Single 2311.5341 / 1545.9661ms；冷续办/备份 5957.4022ms；取消排空 1455.8349ms；memoryscope 5352.3749ms；unknown effect actor/writer 释放 1751.1675ms；伪输出拒绝 2349.0437ms；历史归档 held 3323.5804ms；同参新来源 7129.4076ms；旧 SQL operation 冷恢复 7235.7479ms。不会把诊断 FAIL 改写为 PASS，也不称原完整 default 已全绿。

## 最后定向的起止 SHA-256

两个 native 测试来自 b0ygn56vz；五个 default 测试与另外十项来自 beilfcapo。每个对应操作起止相同，诊断中间 SHA 不冒充最终源码。

| 文件 | SHA-256 |
| --- | --- |
| `test/task-session-human-native.test.js` | `6e3b2476edd7f1d155b9233150f571fc84a20ff7f695048486cb4eac8b0124f3` |
| `test/task-session-service-native.test.js` | `76d51404c6bc10a482c99a8bcdb12888467532ebe32b0f122f545505bef8451e` |
| `test/pi-single-task-initial-input.test.js` | `0652f16a3b90c2699efcea93c2147b39087c4fdc25ef72ce95d58d61606f08a3` |
| `test/pi-single-task.test.js` | `c4714f5f2325d46dc715ec4c75b238357e4055ba8a0a4ee07f384c6af9aac4e4` |
| `test/pi-task-archive.test.js` | `1998b5b3e68465aebfcb563187d03500808a363c07a5e15f8486a7273b8fa085` |
| `test/pi-task-effect-call-identity.test.js` | `5eaa6a8a3ca6765ef80a57cd5d5dfa534df9086f49cbfb4042a1db10675f7fa4` |
| `test/pi-task-service-official-only.test.js` | `6ebb0f49e1eed061331b56de86c4a508d861768a2232efd65d84e2a3f3c3ae04` |
| `test/fixtures/memory-host.js` | `ba19702e8a45ed0f0e62741c2b039d8c7c5c9c57c297c8137771cd008ab37f3f` |
| `test/fixtures/provider-official-host.js` | `768089f08794965a92b4465169e99362d26be31ecb83a5f6ba6b74aaf4a9872f` |
| `test/fixtures/resident-router-host.js` | `00c9a40a36254accceb6f72178f6805736bf844f303bf00698dd237c028c0e3a` |
| `test/fixtures/routing-official-host.js` | `c0d95d73e1736bf498ec32dc6ec039a14ff9cd48fa23884509f4199eb913878e` |
| `test/fixtures/routing-official-model.js` | `908d260d1e972c4b55d24f6a4d0d8b89274307f0c86aa831693a1d90eb915541` |
| `packages/dingtalk-core/task-session-service.js` | `da4f819d7811ceca3642ea3ca5cb5cb8482ed4b2b5f340fee1758e67a973d4f4` |
| `packages/dingtalk-core/dynamic-task-store.js` | `d1c165197602825c0b6f800160c4327dbc163b6c89da9745c7cc6b3dfd2526db` |
| `src/channels/resident-router-business.js` | `82e3fa265a3f272891b7fcf9bd710c6f8589a47bd7d88c672ca8e7610598dbdf` |
| `src/channels/router-lifecycle.js` | `fb0f402967cc9e01840cda190830d51521d5122df508c53df8885fbe7f01bf40` |
| `src/tasks/ledger-archive.js` | `c60c07c590d61d42cfc43e269ac69d2d08044d1d1d1ee86a1199b3ba41aff9f1` |

## 复验入口与保留证据

正式完整组是并发参数 2 的 pnpm test:routing → pnpm test:runtime → pnpm test；wrapper 按真实退出码继续并记录各组终态，不把 runtime 失败当成功。

12 例命令：

```powershell
node --test --test-concurrency=1 --test-name-pattern='完整答复.*empty$|original-group human input preserves clarification and fences|anonymous missing-original-file|Web human wait without|official service (completion freezes files|retains 32 source-authorized|fulfils eleven independent|requirement changes fence|model failure is held)' test/task-session-human-native.test.js test/task-session-service-native.test.js
```

10 例命令（正式记录另加 `--test-reporter=tap`）：

```powershell
node --test --test-concurrency=1 --test-name-pattern='direct Single (complete|blocked)|one task preserves its effect|single task cancellation|chat and chat-room task creation|an uncertain default task effect|a task rejects forged archive|restored historical sources, Topic facts|a verified new source may intentionally|Night own retained SQL operation' test/pi-single-task-initial-input.test.js test/pi-single-task.test.js test/pi-task-archive.test.js test/pi-task-effect-call-identity.test.js test/pi-task-service-official-only.test.js
pnpm check
```

原始输出在本 S6 会话 `8d59080e-5ce2-49dc-827d-2663d26a6778` 的宿主 tasks，以 bui9nxa82 / b0ygn56vz / bku4phlr9 / beilfcapo / bcxuy7xnh 检索。本文自包含计数、源码身份、原失败、最深 cause 和业务终态；没有复制大型循环日志、业务数据或秘密进 Git。没有旧轮次截图/录屏/binary 附件需要保留或清理，历史报告保留。自然结束的本次 fixtures 按 cleanup 清理隔离根和连接；强停只限上述已准确核验的遗留 worker，没有清全局 Temp 或其他会话资源。

## 跳过、阻断与交付状态

- runtime 的 12 SKIP 需要 Linux portable model-process privacy namespace，涉及真实进程/producer/job；Windows 保持 fail-closed。
- default 的 26 SKIP 包括 POSIX chmod、Linux /proc/私有 fd/execve bootstrap、真实进程组、PTY/managed range、symlink admission 和实际 packaged search 等平台限制。不能表述为这些内核/原生路径已通过。原始输出逐例保留理由；containment 的另 17 条条件跳过沿用第 2 轮，不叠加。
- 真实模型为 BLOCKED_MISSING_CREDENTIAL：唯一已授权配置只有 apiKeyEnv 引用，执行环境缺对应值。未请求端点、未取旁路密钥。恢复条件仍为用户配置该执行环境的对应凭据，或明确授权准确密钥来源；脚本模型 PASS 不替代真实模型验收。
- 本轮本地已知失败均有修订后定向终态，原完整组的 FAIL/CANCEL、源码漂移及强停事实保留。没有再运行当前全套 runtime/default，因此不建立 report.md 或宣称统一版本全绿。
- 交独立审查只核本次七份测试增量与本报告/矩阵的结论边界；Git、最终目标线核对和总体交付由 Lead。S6 没有在途测试、没有新开成员或 workflow。
