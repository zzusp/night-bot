# 常驻 Router 独立审查

## 范围与版本

- 审查成员：`night-router-review [6f4329]`，仅本文件可写；产品及测试源码只读，不做 Git 写操作、CI 或外部服务操作。
- 任务入口：[goal.md](goal.md)；合同：[方案](../../spec/resident-conversation-task-routing.md)、`docs/MIGRATION.md`、`docs/VALIDATION.md` 的原生消息边界和完整任务归档章节。
- 初始输入：Lead 记录的开始版本 `eca0df5`，共享实施分支 `worktree-resident-conversation-routing`。初始合同表行号绑定当时源码；实施核证和实跑见后续章节，不以初始 HEAD 代表未提交实现。
- 当前阶段：已在 Lead 指定稳定点完成最后必要增量静态核证和源码指纹收口，已审范围内没有剩余已确认未修复实现缺陷。C1 用例补齐定向通过；R12 受众及父子冻结继承已修，正式五链路通过但有 store 读期漂移，不作为统一版本验收。稳定点 routing/runtime/default 与真实模型结果尚待 tests，最终综合结论未出。

## 必须保留的合同与反例

| 边界 | 已读取的当前证据 | 需要防止的具体错误状态 |
| --- | --- | --- |
| 默认接线 | `src/channels/service.js:43` 身份含 type/channel/conversation，私聊另含 sender；`:46` attachIngress 提前转向业务；`packages/dingtalk-core/task-session-service.js:1705` 是默认统一入口 | 仅修改 Channels fallback，默认 ingress 仍运行 Topic；跨渠道同 ID、私聊不同对端被错误复用，群逻辑 actor 替代真实作者 |
| 直接来源与动作 | `task-session-service.js:705` 旧动作过滤自身通知、captureRevision、按 basis 选当前来源；`:735` 绑定真实作者，取消限 owner/operator；`:756` 起区分 supplement、revise/reopen 与 cancelLiveTask | 去 Topic 时丢来源作者/版本或同群约束；查询/完成摘要创造新授权；普通补充中止执行；目标修订/重开后旧 actor 未排空就复用 |
| 分诊与发送 | `src/channels/triage.js:13` 精确唯一引用，`:22` 全批覆盖；`task-session-service.js:1307` 冻结通知来源验证，`:1310` 依赖旧固定前缀 | 新 schema 已产出但旧 validator 拒绝实际发送；回复 unknown 阻断原消息转交；分诊失败被当静默；重复或改版消息重发/重复转交 |
| 特殊入口 | `fixed-topic-handler.js:99` 平台排期提交工具；`fixed-topics.js:27` 平台任务查询 | 去 Topic 顺带丢无业务 Task 的查询、配置或排期；过去时间被自动顺延；查询制造空执行任务 |
| 依赖与完成 | `dynamic-task-store.js:525` create 即 active+wake，`:770` claim，`:1036` 完成检查，`:1986` 同事务完成事件 | B 创建后在依赖落盘前抢跑；只在 scheduler 守卫而 claim 可绕过；旧 A 版本/旧 B 安排/撤权来源的评估释放 B；重复完成多次 wake |
| 重开与取消 | 方案第 8 节；现有要求版本、控制版本、租约和 humanRequests 守卫 | A 原目标返工推进 requirementRevision 后 B 永久等旧版，或目标变更被自动追随；B 已取消/改成 C 仍被旧评估放行；已执行副作用被假定可回滚 |
| 跨代幂等 | `src/runtime/pi-business-admission.js:24` 与 `:52` 的 packet/entry 去重限于单个 store | 新 Pi session 以不同 ID 重做旧动作；内部完成事件成了新授权；把 admitted 当业务 cursor 已提交 |
| 无工具交接 | `src/pi-official-agent-factory.js:157` 等待原生 settled 与工具 drain；`:180` maintenance 先 pause admission/abort | 在 maintenance 内发摘要必被 admission 拒绝；只隐藏工具但 Host 仍接受业务副作用；摘要截断或漏最后一批仍发布新代；handoff settled 自触发无限轮换 |
| 发布与恢复 | 方案第 9 节及现有 native commit/owner/drain | 候选提交前发布指针；CAS 前/后崩溃导致两代有业务权；旧实例已 fence 却简单恢复 phase；迟到消息丢失或双投；恢复重放已知/unknown 效果 |
| 归档隐私 | `src/tasks/ledger-archive.js:5` 与 `:18` 严格表白名单，`:28` paused/reviewRequired；VALIDATION 完整任务归档约束 | 打包整群 Router journal/交接或另一任务全文；恢复的完成事件/来源重新入活动队列；恢复 B 前置 A 不可验证仍保持 satisfied |
| 当前策略 | 方案第 9/12 节；现有 memory/Skill 边界 | 下一代继承旧权限快照、复制整个 memory scope、复活已忘记的内容，或由摘要扩大来源与可读范围 |

## 已反馈与当前依赖

已将默认接线、来源/发送和特殊入口合同发给 core；将依赖、完成事件、admission、无工具交接及发布故障窗口发给 platform；将对应默认接线与恢复反例发给 tests。Lead 已收到归档范围提醒和初始检查点。

后续输入需要：core/platform 已稳定的 store/lifecycle API 与实际变更文件；tests 的默认真实接线终态证据。审查将先按实际调用链检验反例，再报告确认问题；未实现的方案条目此时不登记为代码 bug。修复由唯一责任成员执行，本成员只读复核，不接受自报通过替代证据。

## 已确认问题

初始读取时尚无实施变更可作确认结论；随后发现与核验结果记录如下。


## 实施审查与修复核证

审查基线为 `eca0df5ed127d8b043ba087291bfb1426d0ca5d6`，分支 `worktree-resident-conversation-routing`，以下结论绑定未提交的共享工作树，不以 HEAD 冒充最终实现版本。当前代码仍在实施，不作最终全量通过结论。

| 编号 | 已确认的输入状态与错误结果 | 责任与核证状态 |
| --- | --- | --- |
| R1 | A 第一版完成但不达标，经默认 Router 工具同目标重开到第二版；工具/schema/service 未传 `sameGoal`，B 始终等待第一版，后续评估必 stale | core/platform 已补 schema、传参及同事务目标不变约束；已回读 `resident-router-business.js:89`、`task-session-service.js:734`、`router-ledger.js:147`。默认完整返工回归待 tests 证据 |
| R2 | 同群 Bob 补充 Alice 任务或配置操作者控制；service 允许而账本一律限 task owner，实际拒绝 | platform 已将同群 supplement 与 owner/operator 控制分离；已回读 `router-ledger.js:144`，跨群/真实作者约束保留 |
| R3 | 前代动作已提交但 settle 尚未提交，新代以同业务 operationId 重试；物理 session/generation 进入内外两层 digest，幂等重试冲突 | ledger 与 dynamic store 外层均剔除物理执行字段，动作栅栏独立；已回读两层，等待最终回归 |
| R4 | 等待依赖的 B pause→resume 或 revise 后其控制/要求版本推进；依赖仍保存旧版本，后续完成评估永久 stale | 初修仅 Router 分支生效；后续独立复现普通 task.revise 遗漏（B 版本 2、依赖版本 1、当前评估 STALE）。现已下沉共用 taskMutation；独立复验普通 revise + pause/resume 后依赖为 req2/ctrl3，当前 C 证据可实际 claim B，见定向核证 |
| R5 | lifecycle 向 business 交完整 binding，其中有真实 actor；plan/evaluate 整体 spread 入 command，首次序列化就失败 | lifecycle 不再传 actor，业务命令显式传 conversation/generation；已回读 `resident-router-business.js:86` 与 `:90` |
| R6 | 初代 Router 从不存在的 context.memoryBinding 绑定，后代复制空/旧权限；Memory 读取未绑定或旧策略延续 | 当前每代由认证 context 重算 chat 单一 principal 或 room 只读 scope；任务计划也保留 channelType/memoryGroupId。已回读 lifecycle bindMemory 和 plan metadata |
| R7 | 业务游标已提交、inbox 为空，交接前中断；重启 recover 仅调度非空 inbox，cursor>lastHandoffCursor 的旧代永久不交接 | 独立真实 Host 实证旧代码失败；修复后无新入站冷恢复到新代 published，见下节。持久 processedCursor/requiredSourceIds 和内部 admission 恢复同时核证 |
| R8 | A 合法冷归档移走完成事件，B 尚未评估；evaluate 与 inbox 只读热事件表，引用丢失并永久 stale | platform 新增统一 readEvent 读热/冷表，重复身份拒绝；已静态回读 `router-ledger.js:20`，A 先归档再评估 B 的实跑待 tests |
| R9 | schema 接受 currentIntent 空串或 1 MiB 文本，正文仅 schema/引用校验就可跨代，不能保证短交接预算 | 已补非空/段数/项长/引用数及 32 KiB UTF8 整体预算，原始文本与解析对象双检查，超限不裁剪；独立复核合法短例 PASS，空/1MiB/17项/中文多字节整体超限均 REJECT。真实预算失败保留旧代待 tests |

| R10 | 同一补充/修订/重开已提交，默认 service 重试时从修改后的 task.request/sourceRefs 重建 action；相同工具参数和 operationId 得到不同摘要，无法返回原收据 | 默认真实 Host 反例 `be5nktk6c`：首次成功、第二次相同参数返回 `DYNAMIC_COMMAND_ID_CONFLICT`，13.3s 断言失败。ledger/store 起止 SHA 相同、service 有协作漂移；断言后进程未自然退出，已停止，不计 PASS。现已回读 Router 稳定业务参数/Host 栅栏分层及 replay 不取消新 lease 修复；Web 也已冻结原 request/kind/action、优先复用 operation 收据并保留同 requestId 内容冲突拒绝。两条默认入口修后实跑由 tests 承担，本记录尚不将静态回读计为回归通过 |

| R11 | 已有 B 的前置 A 改目标后需要重新安排，但无依赖替换/移除能力，arrangementRevision 永远为 1；plan 又可借新任务无 CAS 改旧 B | Lead 确认属既定范围。已补 arrange 真实来源、三版本 CAS、排空/效果、全集替换及旧评估失效审计，plan 禁止旧目标；独立定向实跑通过，见下节 |

| R12（P2） | Alice 交办、Bob 补材料，结果需显式通知两人；普通 Router reply 的 strict schema 无 atOpenDingTalkIds，纯文本只能默认原作者，taskDelivery 最终说明默认受众为空，合法工具参数无法表达原有多人通知 | 原缺陷静态确认于 resident-router-business.js:91 与 task-session-service.js:758–760；旧两个显式多人实发用例被删除。现 schema/父通知显式受众、同会话参与人校验与稳定重试已修；后续发现的子件漏受众也已修为继承冻结数组/atAll且事务精确比父子。文本 smoke 与正式附件归档冷续用例均已独立读真实通过输出；正式组 store 有漂移，稳定源码统一验证尚待下一组。不要求恢复 Topic 或给普通任务开放平台专有 atAll |

上述编号只记录审查发现，不替代测试矩阵，也不表示未覆盖部分没有缺陷。

## 独立冷恢复实跑

使用本仓真实 Host、官方 Pi factory/native persistence、隔离 SQLite、本地脚本模型和假渠道；不修改产品/测试源码、不调用真实模型或渠道。运行创建的隔离目录由夹具清理。两个通过用例各自记录了源码 SHA 起止一致，未以队列 idle 替代持久终态。

### 空 inbox 但业务游标已推进

- 初次反例：后台 `beksw0z39`，11.6 秒，exit 1。在 `router.handoff.begin` 前注入故障；原业务已结清，`generation=1/cursor=1/lastHandoffCursor=0/inbox=0`。完整关闭和重启恢复后状态未变、增加模型调用 0，原断言失败。
- 修复实跑：后台 `btq9bxb11`，15.2 秒，exit 0，1 PASS。故障持续到 close 后释放，排除重复 schedule 抢先交接；无新消息，重启后 `generation=2/cursor=1/lastHandoffCursor=1/phase=active`，inbox 0，rotation `published`，仅增加 1 次 tool-free 模型调用，requiredSourceIds 含原消息。
- 中间两次验证没有作为产品结论：一次性故障被重复调度提前恢复，另一次 Proxy 包装冻结 store 违反 JS 不变量。随后改用普通委托包装并将故障保持到 close，未降低终态断言。tests 的同类 Proxy 问题已同步修复。

### 内部交接已入 admission、尚未投递

- 在真实官方 actor 的完整 native journal 中保留 `admission/enqueued-internal`，对应 handoff packet 无 `admitted`；原业务游标与来源已持久化，SQL phase 为 handoff。完整关闭、重启后走实际 Router recovery。
- 后台 `b6ocrqtc6`，12.5 秒，exit 0，1 PASS：旧 packet 恰好出现一次 `cancelled(reason=router-handoff-recovery)`，其 admitted 数为 0；旧 rotation `aborted`、新 rotation `published`，到达 generation 2/cursor 1/lastHandoffCursor 1。仅增加 1 次新 tool-free 模型调用，requiredSourceIds 仍包含原来源，没有新增业务 task 或发送。
- 首次夹具未声明 Router 的 runtimeOwner/conversation/generation，被新增身份 guard 拒绝；补正确原生身份后重新验证。未放宽产品 guard。

两项通过运行共同的源码 SHA256：

| 文件 | SHA256 |
| --- | --- |
| `src/channels/router-lifecycle.js` | `0cfa6c058d96672e187c193968917d0b97cfc256952dc9daf06497e07357a1c4` |
| `src/channels/router-ledger.js` | `406806bf93a962f53f3b663eb222f89b184e78092a3ed787bc662a957f167c21` |
| `src/pi-official-agent-factory.js` | `9d556d6fa206e3f8a1bf571012da75b29b6bd13ae0561f8cf70bd0ef232f587a` |
| `src/runtime/pi-business-admission.js` | `0b37ff49f447a02bde6904a930a4c636af55eddf552e9971052667c140b5c287` |

后续 R9 对 lifecycle 的有界 schema 修改不改变上述运行版本；R9 的反例检查另绑定本次读取的新源码。最终交付前仍需对最终实际源码的相关差异集中复核；没有因共享工作树变化重跑已覆盖且未受影响的场景。

## 共用 mutation 与依赖重安排定向核证

在隔离真实 SQLite 上实跑，不改产品或测试源码，结束后清理自己的临时目录；结果 PASS，未代替默认 Host 业务回归：

- A 完成、排空并被认可后，将原 B 从等待 A 改为等待 C：arrangementRevision 推进至 2；旧依赖和旧评估从活动表移除，并完整保存在 task.arranged 任务审计事件。
- 旧 evaluate operation 收据重试不恢复旧依赖，不释放新安排；新安排仍待 C。过期安排 CAS、同群 Bob 越权、B↔C 环和运行中的 B 重安排全部拒绝。
- plan 试图借创建 D 给既有 B 加依赖被拒绝，D 也随事务回滚，不留半创建任务。
- 普通 task.revise(B) 与 pause/resume 后，依赖绑定当前 requirementRevision=2/controlRevision=3/arrangementRevision=2。C 实际 claim→complete→wake.ack→drained 后，当前证据评估通过，B 可以实际 claim。
- 起止 SHA256 一致：router-ledger.js 为 `fd5b894db733c82b425fbd08aa11c2029ebb779e97eed8e0e7f0929d0fae06d8`；dynamic-task-store.js 为 `97d0af6cd4e4afb062ae7bbb2ba5032e4e4e6f964229e564fc9e7cdfd187ad70`。

## 四份测试迁接差异核证

仅审新增差异及对应断言，不修改测试、不重跑旧全量。活动 Topic 拆分/Coordinator、旧 routingHold API 和 Topic revision/taskIds 发送冲突可按新合同退役，不能据此删除仍有效的来源、权限、效果和通知合同。

| 仍适用的合同 | 当前实际承接断言 |
| --- | --- |
| claim 提交前/后改版栅栏 | task-topic-routing-native.test.js:20 的两种真实官方 provider 门闩，检查只当前版本进 provider、真实来源 actor/version、仅一次当前 effect-intent/result、旧版本文件不存在及 execution 排空 |
| Web admission/材料/幂等 | 同文件 :73、:118、:133：同任务串行而异任务可进；cancel 失败重试不重复 revision；真实材料路径故障、完整冷重启后补材料、冻结 requestIdentity、对象字段换序幂等、同 ID 不同内容拒绝 |
| 排空、replan、CAS、reopen | 同文件 :191、:255、:290、:320：旧 body 未排空不启新 body、新 body 未结束不挡接纳；过期要求/控制版本不改任务；真实 complete 后 HTTP 拒伪 actor/旧 CAS，重开与重试只多一次 run/source，仍原 session、零 Topic |
| 澄清/未知发送/真实作者 | topic-routing-clarification-native.test.js:9：delivered/unknown 两分支，精确 sourceRef 和发送人、冷恢复只 readback、不重调模型、不重发；own echo/重复原消息去重；新真实来源沿原 logical Router 推进 |
| Topic 入口退役 | topic-routing-hold-native.test.js:1：三个旧入口 HTTP 410 且 runtime getter 调用为零；不要求恢复旧 hold 控制 |
| 人工 review provider 失败恢复 | task-session-execution-provider-recovery-native.test.js:153：保留真实 FIRST_REAL_ANSWER 来源批次；多次时间推进与冷恢复均不自动重试；SECOND_REAL_ANSWER 经原 task supplement/humanReview 解除，原 session、无执行效果；helper 并未直接注入 answered 状态 |
| 入站 epoch 与权限/版本 | task-ingress-epoch.test.js:128、:153 的负收据冷恢复及零业务变化；task-clean-ingress-native.test.js:43 在 model/下载/材料前拦旧历史和缺时间来源；pi-router-ledger.test.js:101、:213、:222 分别拒跨 conversation/错来源版本、同群他人取消、旧授权评估及依赖 claim |
| 既有冻结回复 | fixed-topics-native.test.js:77 两种真实持久格式；:95–110 检查原正文/来源恢复、一次 send/readback、再次冷启动零发送/推理；不将这些旧 fixed 兼容断言当新 Router 发送前版本门闩 |

C1（覆盖缺口，已交 tests）：新澄清/triage/Router flow 仅有 v1 或新 messageId，没有“同 messageId 的已认证 v2 到达后，旧 v1 prepared 直接通知不得新 send”的 transport 边界断言。旧 Topic epoch 拒发用例可以退役，但需迁接到当前 source 版本合同；账本的旧评估失效和旧 Topic notification-pending-source 测试不覆盖新发送路径。unknown/starting 仍应保留原收据 readback，不授新 send。本条是已审测试缺口，未声称产品守卫失败；测试成员若已有等价在途用例，以实际位置和终态接回。

C1 后续已闭环于本批定向运行：新增 topic-routing-clarification-native.test.js:50–104，当前 SHA256 为 299edf6d31a8fd21f4fd582835fb8acfba729a4d029d4ce52663ff46c278b023。已独立回读 prepared 的 start 前故障门闩、真实认证 v2、旧 v1 零 send 和直接 start STALE，以及 unknown 原一次 send、retry.action=readback、最终 delivered；发送/回读以对外 deliveryKey 查真实通知并按精确 old.id/new.id 计数。已独立读 tests 任务 bsvyygqeq 完整输出：3/3 PASS、0 fail/0 skip、exit 0、65.8 秒，其中 C1 两例 21.2/15.7 秒，另例为官方 Single/当前 Router 存活边界。此前 bds154i80 shell 解析失败未追加/运行；bpy3812ch 的两失败由 tests 定位为新 fixture 误把外发 envelope 当 notification.payload，修正后才有上述通过结果，未计早先命令为通过。输出没有完整产品起止 manifest，且共享消费者继续变化，不外推为最终统一源码验收。

迁接审查版本为共享未提交工作树：前三文件开审/末核 SHA256 相同，分别为 task-topic-routing 54a010f049cd0d43a5265eb7f01349f032398a45c8ee29a725cb38ab0afb8d41、clarification f62279f98919520557fcfac44d3b4eb96cce6f627b076abfceeee2634f772d43、hold 697fa2c0bbc3568303267f69f4b453fafe521c32824b80133da9bd4529141ae1。provider recovery 从 c185576c37db24ee0983c5e259d74adf7893b59e96d2ffc328b64d6aea5fb0d3 漂移至 dd35d0c4394b9202f813fefdc150c2b33f8124e4ab380ca876fe0b67bceb0c65，已回读仅新增既有 bounded review case 的 nativeTestTimeout(40000)，本批 humanReview 断言未变；不把此前实跑扩展为该新版本全量通过。

## 新增产物通知消费边界静态增量

- 已读默认 Router schema→prepareDirectReply→SQLite prepare/start→groupNotificationParts→delivery gate，并核对归档 get 的热冷 fallback。taskDelivery 显式选择单任务当前 completed 版本冻结 descriptor/caption，校验原 source、manifest 与去重 IDs；父子同事务、父先子后，归档仅允许已有合法续送，reopen/旧版本拒绝，unknown/starting 先回读。未发现这些已读校验的新增确认绕过；R12 的受众能力回归另列，不由事务守卫通过抵消。
- 已读平台 previous 的 frozen 标记与 replyRequest 重试对比：原输入和实际冻结正文分离，防止重复格式化；已读 ingest 恢复 readResource/onPhase 并按 resident projected messageVersion 登记 source。正式附件/图片/到期交付实跑由 tests 接回，本会话不重复其在途组。
- 本批起止一致 SHA256：store 2658c75221f20c575657ff85e51b582491964d75366e100e59c75efa3572b0dc；service a40c5d3d5de1b24e7d7df6e2b02ad95c43271625ab3845b1f0636a167f3a5c55；group-notification c8bcdf5e5f7fc0e73c806ae702d3392c77288b41607fa9c14c8d5139e453cef3；platform-notification 9c662dfb7c26a269f43abcbb9221ab3dbf47b6ea7c21e35a6dbc6eed3ed4c9ce；resident-router-business b4a90ffea746506b15806fe53269f9413c29ce91242319f57e996635434629bf。后续 R12 修复只补实际增量，最终冻结仍需核指纹。

## 受众修复及媒体高版本恢复增量

- 已独立读 core 文本 smoke bjasj8uxo 输出：1/1 PASS、exit 0、17.7 秒；合法两人最终 delivered、伪身份拒绝、同 ID 同受众复用、换受众冲突、无默认 quote。该运行绑定 service a95b9a16f782ffb0144ee1c4a92ea3ae967ef710233460f7845f624d797fc3f8 与 business 02536f280c76b9d82c178fcd07b5e4ff142a19eaab14d023fda21fb91ad3b792，不代替后续附件实跑。
- 后续静态回读当前 service da4f819d7811ceca3642ea3ca5cb5cb8482ed4b2b5f340fee1758e67a973d4f4 与 business 82e3fa265a3f272891b7fcf9bd710c6f8589a47bd7d88c672ca8e7610598dbdf：只新增 atOpenDingTalkIds、复用 finalNotificationRouting 验同会话真实参与人，显式受众切普通 Markdown 无隐式引用，replyRequest 冻结去重；不开放任务 atAll。
- R12 子件同根因已修：group-notification.js:50 当前 1f7cc8fa 继承父 atOpenDingTalkIds/atAll，不复制 quote；store:545 当前 cf6be603 精确核父子冻结受众与 atAll。已回读 tests task-session-service-native.test.js:70/:71/:80 的父子同受众/无隐式引用/归档冷续断言，以及 :103 的 retry.action=readback、最终 delivered；不把原 bn1b120jm 的在途状态当通过，正式结果接自后续 birot2hzc。
- 已静态核 media 更高来源版本使旧 triage 标为 superseded、由官方句柄 cancel 排空、重新读持久 pending；满 15 条时 ingest 将刚持久 source 直接交 append，避免分页漏撤。工具/入站授权拒旧快照，取消失败仍由 finally 接回。已核所有通知在 direct 分支前统一读取 afterNotificationId 的持久 delivered，防止阻塞子件反复占 send 扫描。未发现这些已读增量的新确认缺陷，正式默认 Host 结果由 tests 接回。

## 本阶段稳定点静态收口

结论：复用前述独立冷恢复、共用 mutation/arrange 与分批回归证据，只核本批实际增量；截至下表指纹，已审范围内没有剩余已确认未修复实现缺陷。R12 schema/受信受众/冻结重试、文件子件继承、父子精确一致、media 新版本取消旧分诊/持久补读及 direct 通知共用父态门闩已完成静态核证。没有重扫旧全量或重复运行既有 domain/containment。

正式五条原链路 birot2hzc 已独立回读完整输出：5/5 PASS、0 fail/0 skip/0 cancel、exit 0、123.14 秒；覆盖 due all/members 各一次完整附件冷恢复、实际官方 Single 存活边界、普通任务结果冻结文件→说明归档→冷续文件→再次回读 delivered，以及图片失败重取/实际版本/重复入站复用。运行起止 service da4f819d、business 82e3fa26、两个 fixture 和两份正式测试 SHA 一致；store 从 2658c752 推进到 cf6be603，输出未登记 group-notification 起止身份，故保留为分批实跑，不冒充此稳定点整组验收。

当前分支为 worktree-resident-conversation-routing，HEAD 仍 eca0df5ed127d8b043ba087291bfb1426d0ca5d6，以下均为未提交共享工作树实际源码。此轮只读核对开/末两次下列 13 项 SHA256 相同：

| 文件 | SHA256 |
| --- | --- |
| src/channels/resident-router-business.js | 82e3fa265a3f272891b7fcf9bd710c6f8589a47bd7d88c672ca8e7610598dbdf |
| src/channels/router-ledger.js | fd5b894db733c82b425fbd08aa11c2029ebb779e97eed8e0e7f0929d0fae06d8 |
| src/channels/router-lifecycle.js | fb0f402967cc9e01840cda190830d51521d5122df508c53df8885fbe7f01bf40 |
| src/runtime/resident-router-upgrade.js | 68274c91d6a97abf46137836158cb4245edeec6fb15037327a4bd6892bdb0804 |
| src/runtime/pi-business-admission.js | 0b37ff49f447a02bde6904a930a4c636af55eddf552e9971052667c140b5c287 |
| src/pi-official-agent-factory.js | 9d556d6fa206e3f8a1bf571012da75b29b6bd13ae0561f8cf70bd0ef232f587a |
| src/tasks/archive.js | b296ea00e28101535ce47d4a1f93ee930b3245bd4827c1aa819e174be8a07ee9 |
| src/tasks/ledger-archive.js | c60c07c590d61d42cfc43e269ac69d2d08044d1d1d1ee86a1199b3ba41aff9f1 |
| packages/dingtalk-core/task-session-service.js | da4f819d7811ceca3642ea3ca5cb5cb8482ed4b2b5f340fee1758e67a973d4f4 |
| packages/dingtalk-core/dynamic-task-store.js | cf6be603473f30680d6273061f9d62f6ba11d96b3b34073d2f38a73f624d5a8e |
| packages/dingtalk-core/group-notification.js | 1f7cc8fab4d612becf62faf90e71fe7cfce73a1aaa3d73660bc43fbcdc492ed2 |
| packages/dingtalk-core/platform-notification.js | 9c662dfb7c26a269f43abcbb9221ab3dbf47b6ea7c21e35a6dbc6eed3ed4c9ce |
| packages/dingtalk-core/task-artifact-files.js | 94610342bdbded5c44a3b15eb1f671ac19f8958ba24dc34ed4f0286a70a8d187 |

已独立只读重算本批五个 adapted 模块（store/service/group-notification/platform-notification/task-artifact-files）的 SHA256，全部与 docs/source-manifest.json 记录相等，manifest 当前 SHA256 为 0b1115d8cd40001254a63e0ec07f49aaa8bf95fc261d99b08c86da22606c0159。完整 guard 通过为 Lead 的另项证据，本会话未重复运行完整 guard；不得将五项匹配写成独立重验全生产闭包。

此结论仅为本阶段稳定点静态收口。最终综合结论等待 tests 在同稳定点的 routing→runtime→default 及单列真实模型实际终态、集中 round-2/matrix 与必要最终版本核对。外部厂商渠道、Windows 上跳过的 Linux 内核隔离仍按未验证边界分别报告；无新增需用户决策事项。

## 固定 start 负许可收据冷恢复增量

前述 cf6be603 静态稳定点之后，core/platform 确认父通知未 delivered 时以固定 command ID 得到 dispatchEligible=false，父完成并冷恢复后原收据一直返回 false，阻断合法文件首次发送。此为原默认消费者和持久收据边界的必要修复，不用更换 command ID 绕过幂等。

已独立静态回读最新 store d1c165197602825c0b6f800160c4327dbc163b6c89da9745c7cc6b3dfd2526db 的 command:2018–2034、:2083–2087，并沿 notification-delivery.js:132 固定 ID、notification.start reducer 和 task-archive.js 的 readReceiptRow/insertReceipt 热冷 stub 核证：

- 请求 digest 先精确匹配；仅原 notification.start 父依赖负许可收据、旧/现均 prepared、sendAttemptCount 为 0、无 sendPermit/dispatchToken/sendStartedAt/ack/receipt 且 payload 精确相同时允许原 ID 重新 reduce。
- 重新执行完整当前归档 hold、完成/版本/来源、冻结文件与受众及持久父态守卫。父仍未完成则依旧负许可；首次真正授许可后 prepared/零发送证据条件失效，starting/unknown 不会再次授新 send。
- 同事务原位更新热或冷收据 body，保留原 request digest、sequence 及热索引 stub，不重插入/迁移回执。不改变其它业务命令的默认重放去重。
- 本次起止 store SHA 一致，service da4f819d、business 82e3fa26、group-notification 1f7cc8fa 未变；未确认本增量的新重复发送或授权放宽反例。平台自报 live/cold SQLite smoke 未当作本会话独立实跑；正式默认 Host 固定 ID 负许可冷恢复验证待 tests。

此增量使前述 cf6 稳定点不再代表当前全部源码。首次独立只读核实时 manifest 仍记录 cf6be603、实际 store 为 d1c16519（match=false），已交 Lead；其刷新后本会话再次独立重算，当前 actual/recorded 均为 d1c165197602825c0b6f800160c4327dbc163b6c89da9745c7cc6b3dfd2526db（match=true）。新源码完整 pnpm check 通过为 Lead 的另项证据，旧 guard 不外推新源码，本会话未重复运行。tests 已确认既有附件例未预种原固定 ID 负许可收据，不能外推已有五条 PASS；其计划待已加载 cf6 的原 runtime 长组自然结束，在原附件 case 内补同 ID 两次 false→归档→冷恢复首次授许可→再冷 unknown 不重发的最小断言并定向复验，不新建重复组或测试文件。

## 集中阶段证据接回

已独立回读第 2 轮完整报告，SHA256 fd31c9830ef86ef1e01eedc9629a9516cffb7c5f2f359f7e66c95dc2727368ab；核对矩阵文件 SHA256 d319d8c3e1a33acc83a7dcc09eda77eedba7c8c34b5cc42a8455624b2f929ff1。报告保留诊断失败/停止/skip 与分批漂移，旧 Topic 合同退休及当前来源/受众/文件/媒体承接一致，没有将分批结果相加为统一通过。此阶段复用该集中报告，不复制其全部执行清单。

Lead 当前 goal 已明确 runtime 从 cf6 加载后 store 改 d1，不能把旧加载组当新 store 全量通过；原固定 ID 负许可消费者用例仍待实际定向终态。本会话不重跑任何已授权成员的在途组。真实模型因 tests 环境缺少配置引用的凭据而未调用 API，该项尚未验证；不读取邻接私有文件、不从其它会话搬凭据或寻找替代来源。恢复须在原执行环境补齐相应凭据，或由真人另授准确来源，本会话不自行扩大授权。

## 人工待答与真实来源边界核证

按 Lead 最新定向要求，仅只读 human-native 的 anonymous/unbound 三例及真实调用链；未新增测试、未改在途源码/测试、未恢复活动 Topic。绑定当前未提交工作树：test/task-session-human-native.test.js 为 12d74a898bdfd8b0ecd27b68cda7ee50d47dbabaab416927bbe07fe207c5c67c，service 为 da4f819d7811ceca3642ea3ca5cb5cb8482ed4b2b5f340fee1758e67a973d4f4，store 为 d1c165197602825c0b6f800160c4327dbc163b6c89da9745c7cc6b3dfd2526db；本次起止一致。

- anonymous 的“匿名”指原件上传者，不指交办来源。test/task-session-human-native.test.js:27 的 createGroupTask 实际 ingest 了 native-group / native-user / 原 messageId。service:976–977 把 conversation 的历史 topic 受众归一为 requester；:497 不恢复 Topic binding，:474 的 sourceFor 使用原 authorizationSourceId。问题因此指向真实原交办来源，不猜上传者或自动升级为 operator。原 session、独立授权 write、只读复现限制、冷恢复不空转及不重复 write 仍是须保留的业务合同。
- unbound 的 Web createTask 虽传 groupId 并在 service:1681 保存 conversationId，其 :1679 的新授权 source 仍是 channel:web，metadata.authorizationSourceId 明确指它。显式 topic 和省略 audience 的两个问题都归一 requester；service:1020 与 store:947–956 保留完整 waiting-reply、question/reason、evidence、attemptedActions、要求/控制版本。service:1100–1103 直接返回 requester 分支，queueReply:1081 拒绝缺来源或 Web 来源，因此现行路径是内部问题可保存、外发通知不创建，不凭 groupId 找群成员，也不落入 :1105 的显式 operator 分支。
- 内部待答有真实查询/答复入口，不依赖外发成功：service:1364–1374 的 listHumanRequests 包含 requester；HTTP :511–515 提供人工介入查询，:539–561 的答复入口要求 localConfigurationRequest，service:1377–1394 校验 Web 身份、问题与要求/控制版本和重放内容。群答复仍先经 store:643 的真实新来源待答复核及 :1015–1039 的当前 lease/request/source/evidence 守卫；保存问题、收到同群消息或通知送达均不能自动扩权或重做既有副作用。
- 独立读取原宿主 tasks/bui9nxa82.output:545–591：anonymous 在 human-native:400 断言处实际 requester、预期 topic；unbound 两例在 :418 实际 1、预期 0，与现行链路一致。三例在这些断言即退出，后续零通知、真实来源去向、原会话恢复/已保存成果等断言尚未由该次运行证明，不能将其算作通过，也不能删掉外发权限要求来迁接。TASK_COORDINATION_TOPIC_REQUIRED 仅在归一后仍为 topic 且无 binding 的 service:1008 分支触发，不是当前这两个 conversation Web 场景的失败方式。

现行合同与上述原始失败栈已直接交 Tests 并同步 Lead；产品/夹具修订由原责任成员结合完整失败决定，本会话未替其修改。runtime 的整体 139 PASS / 9 FAIL / 2 CANCEL / 12 SKIP、cf6→d1 漂移及 default 在途边界沿用唯一 goal，不因本项静态核证改变验收状态。

## runtime 失败迁接测试增量审查

已独立回读 tests 修改的两个独占 native 文件，未运行新验证。当前 human SHA256 为 6e3b2476edd7f1d155b9233150f571fc84a20ff7f695048486cb4eac8b0124f3，service test 为 76d51404c6bc10a482c99a8bcdb12888467532ebe32b0f122f545505bef8451e；不将 tests 的语法检查或本项静态审查算作业务 PASS。

- 遥测反例有效：service test:225–226 用真实 Host source.stage 命令给原任务来源写合法 host/task-commit 观测，并未伪造会话包。service 的 webTopicAction 保留原 sourceRefs，kickTask 每轮重读来源；single-session.js:85 在真实 native 包组装处移除 stages。test:227 检查后续 31 轮 admission.enqueued 包均不含 stages，:229 同时核 SQL 保留观测。若只移除生产过滤，原来源的 stages 将进入首个续办包并触发断言。32 个不同 lease/包、唯一 task identity、副作用 intent/result 各一次、文件实际内容、官方 compaction 和原物理 write 证据均保留。
- unbound 的内部待答与零外发分别验证：human test:428–431 核一个 requester/waiting-reply 和零 notification/send；:433–435 拒错误要求版本、伪问题及不存在的来源；真实 Web 答复后仍核原 session/要求版本、answered、全部来源为 Web、答复原文及作者，:443 再核零 notification/send/分裂执行。
- 初读 human594394e5 时发现“账本 answered 不能证明实际续办”的具体缺口，已直接交 tests：若 respondHumanRequest 不再 kickTask，原断言仍可通过。当前 6e3b2476 已在 :421 捕获真实第二执行轮 input，:440–442 强制原 taskId、完整答复原文与真实作者及该轮 wait/精确 summary；删除 kickTask 的反例会因无实际续办 input 或旧 decision 失败。此缺口在测试源码层已补齐，正式执行终态仍待原串行门闩，不宣称运行闭环。
- anonymous 保留已完成 write 的真实内容、唯一 effect、恢复不空转、真实新答复、原 session 和不猜上传者身份，只迁接当前 requester 受众。十一产物改为检查实际任务 read/write/task_result 工具全部属于 task.sessionId，仍有 11 写/读和实际文件；改版栅栏保留 req2 changed/waiting 且无 completed、原 session 及旧结果拒绝；provider 故障限定在带 task_result 的任务模型，未吞 Router drain 错误。
- 固定 start 原附件 case:72–108 预种同 ID 两次负许可，父 delivered 后归档/冷启仅一次 sendFile、attempt=1，再冷启原 ID 不授许可，只经 readback 至 delivered；双成员受众、文件原字节、说明不重发、附件不重发和原送达身份仍保留。源码断言已覆盖此前缺少的负许可持久收据，不以旧五条 PASS 代替本次增量运行。

本项未确认其它静态合同削弱。随后已独立读取原宿主 tasks/b0ygn56vz.output 的前置门闩、逐例结果与最终输出：PREDECESSOR_GROUP_EXIT:default:1 之后才 GROUP_START:runtime-affected，12 PASS / 0 FAIL / 0 CANCEL / 0 SKIP，465937.0153ms，GROUP_EXIT:runtime-affected:0 及自然 exit 0。1102 个源文件聚合 SHA256 起止均为 3e952ffb32a0400bd6176ef9219e6ee2778d362b1d656ac3e043516d03bb55e4；human6e3b2476、service-test76d51404、service da4f819d、store d1c16519 和两份官方 fixture 的起止指纹一致。Web 实际续办/零外发、anonymous 成果保留、32 个 lease 与唯一副作用、原任务改版栅栏、provider 故障停等及固定 start 负许可冷热续送均已获得这组正式执行证据，不再仅静态待验。32 轮另记录 businessCalls=33、officialSummaryCalls=29、nativeCompactionEntries=25，未将这些计数冒充 32 次业务完成。

同时独立读 tasks/bui9nxa82.output 最终默认组：1204 tests，1172 PASS / 4 FAIL / 2 CANCEL / 26 SKIP，2365488.54ms，GROUP_EXIT:default:1 和 exit 1。保留直接 Single 输入两例 undefined.length、memory-scope 用例 afterHook 的 Task service/Conversation shutdown 聚合错误、归档历史 fixture 的 TASK_ARCHIVE_LEDGER_INVALID，以及 effect-call identity/SQL held 两例 20s 取消。Lead 明确该组含对已准确绑定 worker 的强停，本会话未独立核 worker 进程操作，不能将默认组描述成自然全绿或用上述 12 PASS 覆盖其失败/取消/排空边界。归档 :93 的 v2/v1 fixture 迁接及其它默认修订/补验仍由原 S6 负责，不放宽生产导入或排空守卫。

已与 tests 直接协调末段一次性交付实际文件/指纹、合同差异、正式运行输出及集中报告入口；收到修订与补验阶段结果后，只审最后必要增量和综合边界，不重跑或重审已收口全部。本会话未启动新组，总体验收状态仍由唯一 goal 和正式运行终态决定。

## 最后默认增量与综合结论

最后阶段仅审五份默认测试 diff、其必要责任层及 round-3/matrix，未重跑或重审此前全部源码。五文件合计 43 行新增 / 8 行删除，实际 SHA 与 round-3:63 的对应记录一致：initial-input0652f16a、single-task c4714f5f、archive1998b5b3、effect-call-identity5eaa6a8a、service-official-only6ebb0f49。此前 human6e3b2476/service-test76d51404 与 12 例正式证据直接复用。

- initial-input 只把失效的 v1 topic_facts 读取迁接为当前 v2 historical_topic_facts，保留零历史事实、无活动 Topic/reply binding、无 missing-binding alert 及 blocked 待答。
- single-task 的局部 closeAll 逐项执行全部清理后聚合原错误；统一 after 包含原 service/store/residentStore/Host/server 释放，uncertain-effect 手动路径同样保留失败。未修改生产关闭守卫。独立读 bku4phlr9 原输出：保留旧模型时仍为 hookFailed、1 FAIL / 0 CANCEL、7366.8804ms、自然 exit 1，完整原错误链直达 Router shutdown→ROUTER_BATCH_UNSETTLED，不是吞错或把 dispose/ownership 当根因。只在 memory-scope case 用现有 Router helper 补合法 settle、无工具 handoff 并等待 whenIdle；chat/chat-room 记忆作用域、来源 metadata、两任务唯一 session、无协调 execution 均保留。
- archive 的历史恢复 fixture 显式 version=1，删除仅 v2 的 source_links/dependencies/completion_evaluations/historical_topic_facts，补合法 topic_facts，按实际 version 重算 digest；与现有 pi-router-ledger:140 和 validator 的版本全集一致。保留原 source 只读可查但不路由、Topic fact 不可活动/接受、notification 因恢复 hold 不可 start；没有生产导入放宽。
- effect-call identity 与 retained SQL operation 仅两条实际取消 case 使用既有 Windows nativeTestTimeout(20000)，其它平台预算不变。原业务断言未删：新真实来源可明确再做同参 effect，重复输入/冷恢复不重放；旧 SQL unknown held、journal 字节保留、不重建/dispatch，独立其它任务仍正常。

独立读 beilfcapo 原始头尾和正式 TAP：10 PASS / 0 FAIL / 0 CANCEL / 0 SKIP、50680.1159ms、GROUP_EXIT:default-affected:0 和自然 exit 0。五测试、五公共 fixture、五生产关键文件共 15 项起止一致，均与当前文件/集中报告匹配。独立读 bcxuy7xnh 原 guard 输出：post-default-check exit 0，194 retained / 53 adapted、404 production files / 190 bare imports、404 runtime JS、0 external SDK imports / 0 legacy orchestration definitions，保留 5 个历史源校验及 9 个旧格式清除；本会话未重复执行 guard。

已完整回读 round-3.md，SHA256=9749773eaeac484cd5e122b24f8761538798d2713887b68e23e0c15c0c400526；matrix.csv SHA256=b7feb242fd26ef8c8c2829e3727d43abfed1d1869b7fdef78a5ecb170ba70f6f。独立重算报告 17 项文件 SHA 均匹配当前未提交工作树。矩阵有 54 条数据行（另有表头）；取前 45 条旧数据行、去掉新增 round_3 列并保留原表头/换行，重建 SHA 精确等于此前 d319d8c3e1a33acc83a7dcc09eda77eedba7c8c34b5cc42a8455624b2f929ff1。历史 round_1/round_2 未被改写。已只读确认 report.md 不存在；round-3 明确保留完整组失败、强停/取消、源码漂移、定向范围和真实模型阻断，未将各批数量相加或宣称当前全套通过。

综合结论：基于先前 R1–R12/C1 与必要末段增量、真实输出和实际源码指纹，当前未有已确认且未处理的审查问题；Web 实际续办覆盖缺口也已补并在正式 12 例通过。最后五文件未发现新的合同削弱或阻断交付问题，本会话独立审查可收口，交 Lead 依既定授权继续 Git 交付，不临时增加重复全量门槛。

此结论的真实盲点：没有再跑当前版本的完整 runtime/default，原 139/9/2/12 与 1172/4/2/26 的失败/取消及准确 worker 强停/afterHook 排空历史不抹除；不能将 12/10 定向 PASS 说成新完整组全绿。真实模型仍因已授权引用凭据缺失而未调用；Windows 跳过的 Linux/POSIX 隔离/进程路径及 live DWS 厂商集成仍未验，fake 渠道不代替实际送达。Git 提交、push、PR、CI、合并、部署和真实消息均不是本会话审查已执行事项。

## 真实模型入口增量审查（已收口）

SG6 在既有目标上恢复真实模型验收。本次只读新增 scripts/real-model-router.mjs 和其实际 Host/store/service 合同；本会话不运行模型、不读取秘密或修改产品/脚本，仅维护本 review。此前 round-3 综合结论及凭据阻断是当时阶段记录，不能覆盖本次新入口的结果。当前 HEAD 为 82a5ae59951034f65054da8fa4e71452809a6225，新脚本尚未提交。

已独立回读原宿主 tasks/b4ps4huyd.output 与两份安全 JSON：两个 case 在同一 PID、相隔 2ms 启动，分别隔离 Host/根目录，均 passed:false，cleanup.closed 与 isolatedRootRemoved 均为 true，wrapper 自然 exit 1。此运行脚本 SHA 为 7090656858cf046410367522e88447f18ea9a86ee460f179feaaf94f118496ef，四项生产 SHA 起止一致；不能把随后补诊断的当前脚本 23967c4da862728ecf14bf6d933763c33c99fccdc7d0407c854c40969d83a09e 当其已受验版本。原 router-result.json SHA 为 9d29474b267c420c9fd9a912ad33985ea0baee7d3deb0f0ac6208c661165cc71，web-continuation-result.json 为 7a64f276759e6ab7b61e15fe470144ad5fa95712b517f23813a25bd405c569d0；只记录 Error/ZodError 类型，尚不足以判原业务失败根因。

入口首轮 23967c4d 静态确认的问题已直接交 tests 并同步 Lead；以下保留首次发现，修复状态见本节后续集中核证：

- RM1，Web 创建/续办合同不兼容。脚本:103 无 channel/groupId 创建任务，:109–110 又无 groupId 续办，且未 subscribe。service:1667 允许无群创建，但 :1328–1329 的 webTopicAction 要求 task.groupId 或 args.groupId 对应真实订阅，否则 group_not_subscribed。因此脚本到 web-append 会先被现有接口拒绝，不能归因模型。若目标为既有带合成订阅 group 的 Web 来源续办，应明确按该合同布置；若目标为无群个人 Web 续办，则现有两入口的真实缺口须由 Lead 按目标处理，不能悄悄造来源或放宽守卫来通过。
- RM2，配置解析失败的输出可带秘密原行。脚本:161 的 yaml.parse 早于 :178 redactions 注册；:188 外层 errorInfo 会输出解析异常 message。已只读核当前 yaml/dist/errors.js:29–55 会把原输入行拼入 message，密钥行语法错误时可能将其输出。配置解析阶段应仅报受控 code/name，不传播自由 message/issues/cause；不以真实凭据做故障实验。尚未发现本次安全结果中有实际泄密，本项是明确的失败路径漏洞。
- RM3，依赖评估先于 B 开始的断言只观察完成顺序。脚本:56 记录 tools/result，:79–80 比较成功评估完成与 B 首个工具完成，无法排除 B 先开始、后完成。可用现有 tools/execute 的 next 前入点或 Host claim/事件序列，绑定目标依赖当前评估与 B 首次执行开始；不能以完成序列直接写 evaluationBeforeBTool:true。
- RM4，目标文件被模型读回的断言未绑定目标。脚本:84–86 虽由 Host 独立核最终目标字节，却只要求 journal 有任意成功 read；读取其它路径也可满足 filesReadBack:true。若交付该结论，应关联目标 proof/report 路径的 native read toolCall 与对应成功 toolResult，不用无关 read 代替。此项不否定现有 Host 字节验证本身。

已核反证：raw store.query 在 dynamic-task-store.js:2094 直接委派 routerLedger.query；其 :255/:258 接受 router.dependencies/evaluations 的 taskId 过滤，没有必填 conversationId 的 Zod 边界。因此当前两个 query 用法有效，原 ZodError 不能在无实际 stage/issues 证据时归到它们。当时的 bn3bum3oj 由原 tests 补诊断，随后已自然 exit 1，版本与结果见下方集中核证；本会话未停止、修改其加载源码或另开副本，未重审旧全仓或将未齐证据记 PASS。

### 修后增量集中核证（运行入口 503d94b5，提交版 3c466e00）

本检查点仍基于 HEAD 82a5ae59951034f65054da8fa4e71452809a6225 及共享未提交工作树，不以 HEAD 代替实际文件。已独立读取并绑定的 verified-6 实际运行入口 SHA256 为 503d94b5034f0989d2a5ec61045835062c6f64967097942fd2c5d851625b852a；提交版仅将 297 处 CRLF 归一化为 LF，SHA256 为 3c466e00d549a7b00d02e4e2a9475759a47c034713d09b93cdf423041985a57a，逆转行尾后精确恢复运行版 SHA；service 为 e319fdcf6538df875a385f6e2b54fb728ec8077e696916df5cd1de0e6ab99782；Router lifecycle 为 69d3f2b1e20c26cb67e1fbb99901a31805260e687ca89dd0055376b606a7c0d7。以下是本次必要增量的集中静态结论；实际运行终态及最终报告核证见后文，不重审 round-3 全仓或追加测试组。

- RM1 的无群 Web 缺口已在 service:1360 修复：沿创建时的 task:<taskId> 来源作用域，sourceId/operationId 含任务作用域，同 requestId 跨个人任务不碰撞；不注册伪群，不采 args.groupId 改写个人任务归属。有群仍校验原订阅，原版本 CAS、冻结 request/kind/action/receipt 与原执行 session 不变。已独立读 b3qjurib1 无群定向 1 PASS/0 FAIL、自然 exit 0；保留 b9jlz4xwd 初始 null/undefined 断言 FAIL。下表 verified-3 的真实 Web 运行另外证明 e319 版本的实际续办、冷恢复及零外发。
- 依赖证据入模缺口已在 service:931–958、:986 和两个实时 supplement 调用点修复。仅构造当前任务入边，关联其原 evaluation、授权来源身份/版本、当前前置 completion 及原 completion receipt 的事件；要求 requirement/control/arrangement/condition 等一致，末尾仍以原 task.dependencies-ready 封口。不复制前置 session、全部来源正文或全图。single-session 原序列化保留该字段，无另造上下文。Lead 指定的清依赖反例已排除：router-ledger:76–89 将旧边/旧评估冻结到 task.arranged 后从活动表删除，:255/:258 查询不回读审计，空入边合法返回 []。已独立核 b12uxzj56：1 PASS/0 FAIL/0 CANCEL/0 SKIP，自然 exit 0，service e319 与测试 b07c24091b1aa86aedd146cf44d680419c2adcf3fa3988f10c6d1fc34cee3e4f 起止相同；B 的真实模型请求及持久输入只含 A 当前 req2 的证据，原 req1 preliminary 不进入 B。保留 be3089how 将已认证 actor 错断为 alice 的旧断言 FAIL，不覆盖该次结果。
- RM2–RM4 已在最终入口静态闭合。配置完成并注册 redactions 前仅输出固定 Error/LIVE_CONFIGURATION_INVALID；成功目标依赖 satisfied 结果序号早于 B 首个 tools/execute 的 next 前开始序号；目标 read 以规范路径、native callId 和对应成功 toolResult 关联，Web 续办仅检查初始 journal 切点之后。Tests 自报的合成坏 YAML 零模型请求/输入未披露检查，不冒充本会话执行或真实秘密故障实验。
- 交接类型提示的最小修复仅在 router-lifecycle:108 明确三个 section 均为非空字符串数组、空内容 []、禁止对象元素。schema、预算、引用验证、tool-free、native commit、CAS publish 和失败 abort 均未放宽。测试 06cccbb2fc1f084169f1e653d81c0d78e59a5547dee5e288e476d84e8dd8dc6c 的 referents-object 负例沿真实 Host/Pi 路径要求 aborted 持久终态、原 generation/commit、无 candidate、无旧消息重放；已独立回读 bg8ba8zty 原正式输出：正向四处置/unknown 短回复/冷去重及 referents-object 负向共 2 PASS/0 FAIL/0 CANCEL/0 SKIP，总 52252.6886ms，自然 exit 0；lifecycle 69d3 与测试 06cc 起止相同。没有重跑其它 flow/Web 或完整组。

已独立接回的真实运行终态：

| 宿主操作 | 实际加载入口 / lifecycle | 已证终态与未证边界 |
| --- | --- | --- |
| bn3bum3oj / diagnostic-2 | 23967c4d / fb0f4029，service 仍 da4f819d | 两个 case FAIL，自然 exit 1；Web 在 web-append 被 group_not_subscribed 拒绝；Router A completed/drained，B active/drained wait。两 cleanup 成功；不能当 e319 修后结果。 |
| bnl1z3gp9 / verified-3 | a04246cc / fb0f4029，service e319 | Web PASS，68878.1696ms：同 session、原字节/历史前缀保留、冻结产物、零渠道外发，冷恢复/同请求重放不增加模型/工具/发送。Router FAIL，357843.0346ms：A/B completed/drained，但 router-idle 的 referents 两元素为 object，未通过既有 string schema。wrapper 自然 exit 1，两个 cleanup 成功，7 项 SHA 起止一致。 |
| bs42r1j18 / verified-4 | 7bb8ae39 / 69d3f2b1，service e319 | Router FAIL，205156.6695ms，自然 exit 1；已越过交接及任务/文件/native 输入断言，失败于原复合 LIVE_FAKE_DELIVERY_NOT_TERMINAL。原 fake 仅 send/readback，缺文件能力已静态确认；该次未保存 notice 细节，不能武断认定是唯一失败原因。7 项 SHA 起止一致，cleanup 成功。 |
| bgyk4w4fi / verified-5 | 7a448ddc / 69d3f2b1，service e319 | Router FAIL，253201.6017ms，自然 exit 1，ROUTER_HANDOFF_REFERENCE_INVALID；A/B completed/drained，7 项 SHA 起止一致，cleanup 成功。未到附件断言，没有可复用的逐文件交付链；原 offending refs/同代输入/行状态未保留且隔离根已清，引用失败根因未收敛。 |
| bcfyu5fir / verified-6 | 503d94b5 / 69d3f2b1，service e319 | Router PASS，221114.6355ms；Node 2 PASS/0 FAIL 含父容器，总 221128.6868ms，GROUP_EXIT:real-model-router-verified-6:0，自然 exit 0。7 项 SHA 起止/受验文件相同；当前依赖证据、逐 A/B 冻结文件交付、generation 4、冷恢复与 cleanup 均通过，具体核证见后文。 |

verified-5 原输出 :34 记录失败，:36/:37 才出现两次 reply；catch 的 delivery 快照在 finally close 排空之前，末尾 toolCounts 在 cleanup 之后。因此零 notice 与后来回复不矛盾，不能据此认定生产 prepare/通知接线缺陷，也不能补推回复必含 taskDelivery 或文件已送达。不存在源引用、跨作用域/held 来源、任务引用不存在/跨作用域等候选尚无法由旧结果区分；不据错误码认定模型编造、输入缺失或合法行误拒。

文件交付补证新增 RM5：7a448 的文本 send/readback 计数及全部 notice delivered/cancelled 仍允许“文件全 cancelled”或“同 A 重复、B 漏交”通过。最终入口:33–48、:200 已改为逐当前 A/B 的完整冻结 descriptor，要求唯一同 task/req 子通知、父 taskDelivery 选择与父/子 delivered、真实冻结文件字节 SHA/size、单次 sendFile、同 deliveryKey/messageId 回读、持久 ack/receipt 及 descriptor 哈希全匹配。已核真实 Channels 签名、notification-delivery 的 ack/receipt 持久字段及 safeNotificationDetail 会保留所用证明。只记录受控 ID/hash/size，不保存文件路径、正文或秘密。Tests 的纯断言反例自报仅说明断言能拒 cancelled/重复漏交/旧版本/错 messageId，不冒充真实 Host/fake 文件发送或业务通过。

最终入口:49–86 的引用诊断在 close/rm 前按 aborted rotation 的固定安全 abortCode、handoffId、oldSessionId/generation/cutoff 关联：严格核 native.header 身份；同 ID internal admission；唯一 source/content 全等的 native business input；实际请求首行 JSON 的身份、cutoff、requiredSourceIds 与 rotation 一致；取其后首条 assistant，遇其它 business input 即缺证，不取最后一条回复补猜。响应 cutoff 只保留安全整数及 matches；refs 仅保留 lookup exists/scope/hold/version，同作用域的受控 ID 与非法引用哈希，不复制外会话正文/私有路径。诊断自身失败单列固定 diagnosticError，不覆盖原 report.errors；快照序号和最终 reply 通知 ID/状态区分观测时点。未见剩余安全、配对或 receipt 字段的静态阻断。最终成功运行没有触发该失败诊断分支，故这里只确认限定静态合同，不宣称已用真实坏 ref 动态验收该分支，也不追认旧引用失败的根因。

### 最终业务及阶段报告核证

已独立完整读取 bcfyu5fir 原宿主输出及最终安全 JSON，不以成员自报或工具成功回执替代业务证据。verified-6 的 7 项起止指纹一致，实际运行入口为 503d94b5；Router 业务 PASS 221114.6355ms，Node 2 PASS/0 FAIL 含父容器，原 wrapper 自然 exit 0。提交版 3c466e00 的差异仅为上文已逐字节核证的行尾转换，没有重新调用 API 或业务测试。

- A/B 分别 completed/drained 且 session 不同；成功目标依赖评估结果 sequence=27，B 首个实际 tools/execute 开始 sequence=28，原生入模证据绑定当前 A completion/evaluation，不用 B 工具完成时刻推测先后。
- 已逐 A/B 核当前 task/requirementRevision/完整冻结 descriptor、唯一子通知与父 taskDelivery、真实文件 bytes SHA/size、单次 sendFile、同 deliveryKey/messageId 回读及持久 ACK/receipt。A 文件 6 bytes，四处消息身份均 fake-visible-2；B 文件 69 bytes，均 fake-visible-4；父子四通知全部 delivered，不以汇总计数、文本或 cancelled 代替文件完成。完整 artifact/content/descriptor 哈希及身份链保留在 round-4.md 和最终 JSON，不在本 review 重复完整证据表。
- Router generation=4、phase=active、pendingInputs=0；原认证消息冷重投不新增任务、任务 journal 字节、assistant 总数 29、工具或 fake 交付；cleanup.closed 与 isolatedRootRemoved 均 true。原输出的两次中间 ROUTER_EVIDENCE_REFERENCE_INVALID 后第三次 satisfied 才成功，不能表述为零工具错误。
- verified-3 的真实 Web PASS 继续复用：原执行 session、原进度字节/journal 前缀、精确新 Web 来源和追加/实际 read、completed/drained、冻结产物及零渠道外发，冷恢复/重放没有模型或交付增长。该次为 a04246cc/e319/L0，与最终 Router 的 503d94b5/e319/L1 分别受验；不是统一版本两 case 并发全绿。

最终 round-4.md SHA256=98b60062a3322c2f2160710ee433ef92a9a7315d369a55d299bdaca1ea9e60b4，matrix.csv SHA256=b6abbee95228819b9ab80982074eba408e04f2e65b88677fdd529290a5d760ad。已完整回读阶段报告并用标准 CSV 逐格核对 HEAD 原矩阵 b7feb242：原 54 数据行的行序、原字段及 round_1/2/3 全不变，只增 round_4 和 6 行，新行旧轮均 NOT_RUN，无重复 case_id。报告保留两次测试自身断言 FAIL、六批版本化真实终态、中间引用拒绝及未知根因，没有改写历史全量失败。最后的行尾修正独立证明只含原末两行 CRLF→LF 及一条明确区分运行/提交 SHA 的说明；去掉新增说明并还原这两行行尾后，精确恢复原报告 65baa8f5；此前核过的业务正文与矩阵未变。

最终证据目录已独立确认仅两文件：round-4/verified-6-router-result.json SHA256=a5879141ccdcdfbad70627f56a69ce24dd16e1ef1419338dffede7d803affe7e，round-4/verified-3-web-continuation-result.json SHA256=fe9802aa4e669aba740f90d213145bd4e22eb2638a4ed6896ff0e10a9211f72e。本节上方引用的 initial、diagnostic-2、verified-3 Router、verified-4/5 共七份旧 JSON 已由原 Tests 清理；历史结果、版本和必要文字摘要由本 review/round-4 保留，不能再将已清附件当作当前可回读证据。未保留旧附件备份、运行库、完整 journal、业务文件或秘密；本会话未执行删除。

最终 S2/L1 的 pnpm check 已独立按原前台 tool_use_id=call_cbb9a15357e24c5da760af44f5ea5a2c 提取唯一原命令/结果（2026-11-06T15:05:04.684Z），不是后台 task：set -e 链核 69d3 后执行 pnpm check 与 git diff --check，原结果无错误、stderr 为空且未中断。实际输出为 194 retained/53 adapted、404 production/runtime JS、190 imports、0 external SDK/旧编排定义、历史源校验 5/旧格式清除 9；与本轮报告及当前受验源匹配。manifest 保留上游 sourceSha256，守卫未放宽；本会话没有重复运行 guard。

## 当前收口边界

- 基于 HEAD 82a5ae59951034f65054da8fa4e71452809a6225 加本轮明确 SHA 的未提交工作树，round-3 已收口审查及本次必要增量均未发现已确认且未处理的阻断问题；RM1–RM5 已处理，两个既定真实业务分别取得完整 PASS。SG6 独立审查可收口，交 Lead 按既定授权完成 Git 交付，不追加全仓/整轮或重复付费模型门槛。
- verified-4 的唯一通知失败原因、verified-5 的具体坏引用仍未收敛；最终成功不解释或追认修复这些历史原因，不证明模型稳定性。安全失败诊断分支仅静态核，合成坏 YAML/文件谓词负检查不冒充本会话实跑或真实坏 ref 动态验收；旧失败与清理记录均保留。
- 当前完整 runtime/default 未重新全量跑，Windows 条件跳过的 Linux/POSIX 隔离/进程路径和 live DWS 集成仍未验；不能将分批定向与真实 case PASS 写成当前统一版本全套全绿。真实模型配 fake 渠道，不代表真实消息送达或上游部署身份认证。
- 仅本 review.md 由本会话写入；未执行模型、读取秘密、修改产品/测试/入口/报告/矩阵、Git 写操作、CI、合并、部署或真实发送，也未新开 agent/workflow。本次提交、push 和原 PR 更新仍由 Lead 处理，本审查不声称已完成这些后续动作。

## SG8 渠道职责贯通增量审查（本地阶段收口）

本段为 2026-11-07 新增范围，独立追加，不修改此前 SG1–SG7 审查结论或第1–4轮历史。基线 HEAD 为 d27350972df888bf864186eabe64513c12460382，结论绑定本轮未提交工作树；Core 五文件、Platform 四文件及唯一新增测试的完整 SHA 以 [round-5.md](round-5.md#受验源码指纹) 为一处证据表。本会话已从正式输出独立核十项起止与当前字节全部相同，其中 service 为 866966b8、channels 为 bdb1a84d、reflection 为 8876dfc8、测试完整 SHA256=73a660becabfa2cf9e04c5d571409773866846ab96474d84b2fcb9d0f16f85d0；不以 HEAD 代替实际受验源码。

### 已证缺口及实际修复

初查已证：统一入站首次订阅硬编码通用职责，已有群跳过该分支；一级分诊与独立复盘未消费职责。Router/执行原有群职责输入，不能概括为全链丢失。对“配置未到订阅”“角色未消费”“模型未遵循”三个候选，前两由源码确认，第三无运行证据，未将输入缺口归因模型。

- 可信配置：channels/service:9–17 校验群项/默认职责，群显式字符串（含空字符串）优先插件默认，默认只映射已列群。DWS plugin:65 按 chat-room、自身 channelId 和精确原 conversationId 查启动快照；channels:25–26 由已注册可信插件解析，不把消息 text、quote、platformFlags、摘要或最近群提升为配置。原 strict envelope、会话身份 hash、私聊/群隔离和传输授权不变；不存在按全局 preset 传播群职责的新增路径。
- 新旧群：task-session-service:136 使用同一 resolver，undefined 保留本群原值/首次通用默认，显式空值不被真值回退吞掉；:1583–1585 对已存在群仅在明确配置不同值时 updateGroup。store.updateGroup 保留其它字段并接受空字符串，不重置任务或会话。配置文件改后重启生效，不宣称热更新。
- 四角色：分诊/Router 的 :41/:115 使用当前 conversation 的 officialText，执行 single-session:114 使用同 resolver 结果且 interpolate:false；已沿 native-system-prompt:93–95 和 pi-official-context:28–30 核实际每次请求渲染与 actor 作用域，模板文字不展开。Platform 对独立 Channels.deliver:87–89 的补充同样限定当前 actor/session，不污染全局指令。
- 复盘：reflection:55 只按本任务 groupId 取得可信职责，inference:13–15 仅附加系统段，user facts、官方单次无工具推理、证据校验、记忆范围和任务 review 归档未改。基础说明已纠正为 task.completed 账本已提交，不能据此认定渠道送达；8876 相对先前静态版只再纠正同义注释。复盘结果未成为任务完成或通知发送的前置条件。

### 原定向运行与持久终态

已完整独立读原宿主 bec06vy3v.output：唯一 configured channel responsibilities 用例 1 PASS/0 FAIL/0 CANCEL/0 SKIP，子例 34754.3509ms、总 37219.4365ms，GROUP_EXIT:sg8-configured-channel-roles-recheck:0，自然 exit 0，SOURCE_STABLE:10/10。实际读取 test/pi-channel-plugin.test.js:191 的新增默认链断言，不以报告或成员自报代替运行证据。

- 实际本机 Pi HTTP 请求共 23 次；alpha/beta 各 triage 1、Router 6、task 1、reflection 1，另 alpha 的独立 channel 1，其余为原无工具交接。各被观测角色 system 均含完整本群职责与字面模板片段，不含另一群、消息正文/quote/platformFlags 伪职责或旧职责。两群事前已持久订阅旧职责，实跑证明明确配置替换已有群值。beta 独立 channel 未重复运行；渠道默认/空清除、跨 channel 和重启取新配置的边界由已述源码及 Platform 离线回传支持，不冒充本条业务用例已动态覆盖所有组合。
- 两事项 role-task-alpha / role-task-beta 各唯一且不同执行 session，均 completed、drained=true，execution.list 为空。两条文本通知 delivered，fake send→状态查询→mget 回读→持久 receipt 的群/messageId 对齐，分别为 role-visible-1/2；无工具错误或 fixture 错误。本例没有文件交付需求，不能用两次文本模拟发送证明附件闭环。
- 复盘实际返回空 lessons，两条各自 group-scope state.reviews 均为 skipped，绑定本任务及 task-completed:complete:role-task-alpha:1 / beta:1 原事件，且与各任务 reviews/<hash(eventId)>.json 副本深等；原 diagnostic 保留两组不同 scope 与目的位置。每次复盘请求 tools 为空、user 键精确为 taskId/eventId/facts，不把 whenIdle、分析次数或 task completed 当成功。skipped 的依据是合法空经验，无新技能或送达推断。
- 已读 bf1t75804 原始失败：0 PASS/1 FAIL，自然 exit 1；新增测试把不存在的 executionState 错断为 drained。复验依据真实布尔 task.drained===true，并保留 completed、执行表清空、唯一 session、请求、review 和收据断言；两次九项生产指纹相同，未为过测试修改生产或降低排空要求。首次测试 SHA 79cb3b95 不追认为已通过，失败与修正见 round-5。

### 守卫、报告与历史保留

已按唯一标记从 Lead 原前台记录提取 call_4dc1f82ff64244b7a11a66a946c77c86（2026-11-06T16:49:15.520Z）的原命令及结果：GUARD_EXIT:0，GUARD_SOURCE_STABLE:9/9，diff whitespace clean，无 stderr 或中断。pnpm check 实际输出为 194 retained/53 adapted、404 production/runtime JS、190 imports、0 external SDK/旧编排定义，历史源校验5/旧格式清除9；九项与当前冻结源相同。本会话未重复运行 guard、模型、业务测试或配置 smoke。

round-5.md SHA256=38a9da84f60b5d33e18a98fb5f937c1bddd6902bb795f0ac292a3ae88ff7248a；matrix.csv SHA256=1d3146a56b1aa0cee535ff1294d3912b75ad76057ed54479b61ceadea605a0a8。已完整读报告并逐格核原60行的行序、字段和前四轮，只有 round_5 与两行新增，新行旧轮均 NOT_RUN；剥离新列/新行可逐字节重建原矩阵 SHA b6abbee95228819b9ab80982074eba408e04f2e65b88677fdd529290a5d760ad，无重复 case_id。此前 review 前缀4664f51f、第4轮报告98b60062及最终两JSON a5879141/fe9802aa均未变，历史失败、取消与未验结论不改写。

README、CHANNELS 及 Windows 接入 runbook 的本次差异已只读核：配置优先级/重启语义、监听与发送开关区分、system账号共享边界、精确回声身份、真实终态与HTTP查询路径均与实现相符，未把 health/fake/注入当 live。公开示例 enabled/listen/writesAuthorized 三项 false。报告的私有禁用实例准备仅是 Tests 的单独交付记录；本会话未读取私有配置、检查账号或模型凭据，不从该准备行推导可真实启动。

### 本地结论及 SG9 边界

本次九文件产品增量及唯一新增测试未发现已确认且未处理的本地阻断，SG8 本地职责传播、隔离与持久无工具复盘证据可交 Lead 收口；没有新增全量或重复运行门槛，也未将合法空经验改为失败。该结论只覆盖上述版本及本地脚本模型/fake DWS，不等于追加总目标完成。

真实订阅/历史补读、单成员同账号的 SDK 手动入站及本机回声抑制、真实群内结果/附件交付和真实模型复盘均未执行；不复用旧第4轮结果冒充本版 live 证明。SG9 仍受原连接/外发禁令和账号/主体/模型配置交接缺项限制，主控转达或同伴消息不解除本会话权限。授权与条件齐备后由原 Lead/唯一 Tests 串行交接，不委托绕过、不把复盘设置为生产完成/发送前置。

本会话此次仍只追加本 review，未改 goal/实现/测试/报告/矩阵，未读秘密、运行模型、连接或发送，未执行 Git 写、CI、合并、部署或新增 agent/workflow。提交、push、PR 更新与 SG9 后续状态由 Lead 按既定授权处理。


## SG9 必要修复独立审查与真实现场阻断

本节为 2026-11-07 的阶段末集中追加，旧 SG8 及此前审查逐字保留。结论分开：本地必要修复已取得定向证据，未发现该冻结增量中已确认且未处理的代码阻断；原真实事项仍为 **BLOCKED_ORIGINAL_OWNER_DRAIN_PROOF_MISSING**，SG9 产品闭环未完成，不能标 PASS。基线 HEAD 仍为 d27350972df888bf864186eabe64513c12460382，加本轮共享未提交工作树；本会话未提交或更新 PR。

### 五文件范围与确认缺陷

仅审 Core 冻结的 native-tool-fs-search、single-session、effect-scope、package.json、pnpm-lock.yaml 及必要直接调用方。最终五文件完整指纹集中见 [round-6.md](round-6.md#最终受验版本与入口)，已逐项核当前字节：729f6336、a141811f、91673a85、4fda002d、833f4d06；其余 SG8 产品字节未变。本轮两个测试最终指纹为 pi-search-safety 41b31407、pi-single-task 557fc43b，不能把 HEAD 或最初修复版本当作最终受验源码。

- 已确认并交回 Core 的缺陷：首版 native search 标记保存 scopeOf(ctx) 后要求它严格等于 actor。native-agent-presets.js:376–386 在独立 key={} 的 generation scope 注册 preset；:571–577 只将 actor 父链接到该 generation。因此真实 actor 的 find/grep 被误拒观察性识别，SingleTask 会继续走效果意图屏障。bh7eip84h 的真实 definition+actor 返回 false 与该调用链相互印证，不能由首版 guard 成功抵消。
- 最终修正：native-tool-fs-search.js:21–24 的私有 WeakMap 同时要求真实在册 actor、scopeChainOf(actor) 包含原注册 scope、原 registry 对该 actor 可见的当前 exact definition。伪同 id 对象、copied definition、异 host/无该 scope 的 actor 不取得能力；SingleTask:103/177 在捕获及实际执行时仍比同一 definition，同名替换不能仅凭工具名称豁免。原 scope 由 preset 持有，不把跨会话来源或名字当授权。静态已核替换/跨 actor 反例；动态反例范围以实际下述测试为准，不声称所有替换组合均实跑。
- find:130–141 只对原 private-fs 授权 regular-file 表执行精确锁定 minimatch@11.0.3，按搜索根相对路径规范为 POSIX 分隔符；dot:true、matchBase:true 保留隐藏和多层基名，nonegate/nocomment 不将 !/# 当额外控制入口。未改初始路径、每级重新授权、symlink/VCS/node_modules 排除、深度/条目/路径字节预算、limit 或 Pi 原 schema/render。已沿已装 Pi 1.5 find.js:65–115 核 custom operations 的绝对搜索根与返回路径合同。find 不再启动进程；取消仍等待已启动枚举 job 排空。
- grep 仍经授权文件批次、原 subprocess 隐私边界和 waitForExit 排空；错误仍为 SEARCH_FAILED 并保留 cause，只在受控错误文字附底层 code。Windows 本地确实返回 MEMORY_PROCESS_PRIVACY_UNAVAILABLE，不能据此追认旧现场 find 的底层原因，也没有绕过 Windows 隐私守卫。
- effect-scope.js:8–21 与 Host 的 resident-router-business.js:98、task-session-service.js:986 一致：chat 不绑定记忆群，room 使用可信 metadata.memoryGroupId，旧群回退原 groupId，且仍严格检查 binding.actorId 和预期记忆 group。返回的业务 groupId、channelDigest 和包含原 memoryBinding 的 authorizationDigest 未放宽。metadata 来自 Host 认证渠道上下文，不来自模型 task 参数或消息摘要。
- 旧未知效果未按新定义重分类：SingleTask:81–82 在创建新 handle 前仍拒未结算 intent；beforeRequest、工具前置及非观察性效果屏障保留 no-replay、来源/版本/当前 owner 校验。仅 write 的真实效果仍提交 intent/result，错误 mutator 继续 held，不将普通错误解释为无副作用。

### 原始实跑、失败与最终证据

本会话只读原 Tests 与 Lead 的宿主输出，未重复运行测试、模型、guard 或实例。已完整接回 bh7eip84h、bph57eyet、bzwi0jprx、bhxlw9asg、btgj3dwfz，以及首版 bcxh7bfdl 和最终 bu0ci3mxz。

- 首版 bh7eip84h 为 2 PASS/1 FAIL、自然 exit1：枚举预算和 Windows grep 拒绝通过；find 合法匹配/隔离的前置断言通过，但真实 marker 断言失败。bph57eyet 为 2 PASS/1 FAIL/1 CANCEL、自然 exit1；personal unknown 的真实排空与新 Router room 故障用例通过，新增搜索等待耗尽，旧 chat/chat-room 用例在 Windows 30000ms 取消。上述均保留，不追认成最终通过。
- 最终 marker 的 bhxlw9asg 为 1 PASS/1 FAIL、自然 exit1：729f6336 下 native find 用例 8490.043ms PASS，实际覆盖隐藏文件/目录、多层基名、明确相对路径、未命中、foreign task/Host sessions/symlink 拒绝，copied definition 与同 id 假 actor 均被拒，0 subprocess/0模型请求；同批 SingleTask 固定500次轮询仍耗尽，不能抹掉这次失败。
- 最终 btgj3dwfz 为 1 PASS/0 FAIL/CANCEL/SKIP、自然 exit0，业务 16649.6467ms、Node 23906.1219ms。仅新增搜索用例改用已有 service.whenIdle 等业务排空，随后仍严格断言 task.status=completed、drained=true；真实 find/grep 不留 effect-intent，仅 write 一条 intent 和一条 result，实际读取 work/search-proof.txt 精确为 search-proof，personal scope.groupId=null。Windows grep 的原 privacy 错误进入实际后续模型请求，未变成 TASK_EFFECT_UNCERTAIN_NO_REPLAY。没有减少断言、改产品或延长旧用例时限；测试 557fc43b 及五产品六项由原 wrapper 报起止稳定，已核当前字节匹配。
- 新 Router room 用例在 bph57eyet 同批实际 18613.3146ms PASS：经渠道、triage/Router plan、唯一任务和真实本地故障写，effect=1、drained=true、owner-drained=1、正式 inspect 成功；认证记忆群与业务 conversation 不同，foreign owner/group 拒绝，同宿主 recover 不增加效果或请求。该实际 join 是新 fixture 的证据，不是原真实事项的补发收据，也不称冷启动或真实平台验收。
- bzwi0jprx 正式拒绝 2 PASS、自然 exit0，32.6539/209.1091ms，Node 4660.7089ms。已读原测试断言：drain 构造器拒 JSON 零计数/无完整 Host proof，inspect 对 missing owner attestation 拒绝 TASK_EFFECT_DRAIN_ATTESTATION_REQUIRED。不是对原现场 API 的实测；本轮没有为了撞错而重启现场。
- 旧 chat/chat-room case:85 的 32499.1432ms CANCEL 原输出只给出 timed out after 30000ms，取消发生于业务等待、whenIdle 或 teardown 未收敛。其仅 task_result 和 Router settle/handoff，无 find/grep/未知效果；正常 dispose 在 SingleTask:181 的 !uncertain 分支返回，不进入本次 readEffectScope。暂未证本次 scope 改动导致该取消，亦不能由旁边用例 PASS 认定旧例已通过；未改旧时限或复跑旧组。
- 最终 bu0ci3mxz 自然 exit0，GUARD_EXIT/WHITESPACE_EXIT 均0。已独立解析原 before/after 十三项并核当前文件全同；194 retained/53 adapted、404 production/runtime JS、191 declared bare imports、0 external SDK/旧编排、source verified5/旧格式 removed9。首版 bcxh7bfdl 的13项稳定仅覆盖1116961b，不替代729f最终 guard，也不替代业务断言。

### 原真实事项的证明缺口与恢复反证

真实监听/身份/持久来源和停机数据由原 Tests 独占执行，详见 round-6:19–38；本会话核正式报告与公开源码，未读取私有实例、模型秘密或平台账号。因此现场部分按原始执行者严格回传记录，不冒充本会话独立查询。

- 真人请求已消费并建唯一 sg9-live-20261107-01 / task-session-405bdad6-5215-4b76-a879-073a46d93d88，原 source/version/actor 链保留；SG8 末尾“待授权/未启动”只是旧时点快照，不覆盖本轮已由真人授权且已接入的事实。原 find 留 unknown，未完成文件或外发。
- 原正式 IPC 停机 exit1，日志仅 Task service shutdown failed；PID/端口结束不等于业务 drain。Tests 对原 Pi journal 以 portable codec + requireComplete 严格解码，45111 committed/total bytes、SHA ad7062f54993597bdc74d23a4c2b31a666d578240c3630e2fd46a7c92b5c9d15，task 域只有 identity+find intent，没有 result、owner-drained/inputs；原 journal 保留未改。记忆映射与旧 scope 校验确有合同冲突，但没有深层日志证明其就是 shutdown 唯一根因；旧 find 底层失败同样未收敛。
- 已独立比较三条现有路径：原 live owner 可在 factory:87–94 的真实 SDK/tool/provider join 后由 SingleTask:179–188 签发，但旧宿主与 handles 已退出；冷 recover 只在 service:1303–1312 改账本 drained，process-ownership:13/38–51 的 Set 属于新进程，journal writer lease 只栅栏日志写者，不撤销旧 child/外部效果；既有 readNativeHistory 只读 committed 历史，native-maintenance-receipts 要求原 execution bound/pause/terminal，不能替代当前单 task identity+intent。三条现有 API 均不能合法补出缺失的旧 producer 排空证明。
- effect-reconciliation.js:199 要求覆盖原 invocation/binding/scope/cut 的 owner-drained，:206 只容其后物理 commit；新 actor 的零计数、新 marker、PID 消失、SQL drained 或无 pending job 均不替代该事实。没有现有正规恢复路径，不新增恢复机制、不删 intent、不补造 result/receipt、不放松 inspect/no-replay；恢复需有可验证的原 producer 终态/失权证据及相应明确合同，超出当前实现增量，不在验收中偷偷绕过。

### 报告历史与阶段交付

round-6.md 完整 SHA256=217eaa81c8a92e2e405bd8a094e3d49c877f6e1d2c9652743408e2c082f90605；matrix.csv SHA256=c14cd39fe78c22bef63a17da49a2bd014e7ffe6049c11d8a035a8991f620da3c。已完整读报告、逐项核八个最终文件指纹；矩阵74个 case_id 唯一，新增 round_6 与12行，剥离新列/行可逐字节重建原第五轮矩阵1d3146a56b1aa0cee535ff1294d3912b75ad76057ed54479b61ceadea605a0a8，旧62行/前五轮未改。失败、CANCEL、BLOCKED/NOT_RUN 与本地 PASS 分开，未写全绿 report.md。

本阶段独立审查可交 Lead 进行授权内 Git/原 PR 整合，但不代表 SG9 完成。原真实事项尚无 completed/drained、冻结文件、群内文本/附件回读与 durable receipt、同 task/event 持久复盘、精确平台回声或成功冷恢复/正常排空；这些继续 BLOCKED/NOT_RUN。原 source/task/session/unknown 与私有恢复证据保留，不要求真人重发或另起任务。

本会话仍只追加本 review，未修改 goal/产品/测试/报告/矩阵，未运行测试、模型或实例，未读秘密、连接/发送、重启/重放、Git 写、CI、合并、部署或新增 agent/workflow。Lead 负责后续提交、push、PR 回查及唯一目标状态，不由本结论扩展真实执行权。


## SG9 第七轮窄审：正式停用与恢复补读

本节为 2026-11-07 的阶段末集中追加，原 review 全文及第六轮 BLOCKED 结论逐字保留。已核本阶段正式停用、取消后冷恢复及补读修复；未发现最终 application/plugin 窄增量中新的确认缺陷。SG9 总目标仍为 **WAITING_INPUT_NEW_AUTHENTICATED_SOURCE**：没有新的真人 SDK 事项，文件、附件交付及持久复盘未完成。该阶段可以交 Lead 整合，不以就绪、本地 PASS 或取消旧事项宣布产品闭环成功。

### 已修缺陷与精确过滤边界

- 默认组合首启 bnsc8k1u2 自然 exit1，没有取得 cancel 回执。缺失 piAuthority inject 的错误由 Tests 定向回传；本会话以已装 Cordis reflect.ts:144–165 的 getter 限制、bin/night-bot.js:21–23 读取并传递 applicationInject、Host 的既有 provider 和 task-session-service.js:1306/1314 的实际 recover 访问互证，不声称公开 stdout 含该错误完整 stack。Core 最终只在 src/application.js:10 增加 piAuthority 依赖，最终 cc9f8b30；未改启动顺序、权限、unknown 或 drain 策略。provider 存在不等于插件已声明依赖；反过来，补声明也不证明旧 producer 排空。
- 真实冷启 b095xqafp 曾在 backfill 报 CHANNEL_MESSAGE_ID_CONFLICT。round-7.md:34–37 保留真实历史差异与七字段 hash 反证：冲突是 Host 已 delivered 的 Router 状态文字，后补 DWS flags 与先存 fact 不同；不是新真人任务或目标文件交付。六字段 hash 补丁已被静态拦截、未执行，不伪记为一次测试 FAIL，也没有迁移或重算旧事实。
- 最终 src/channels/plugins/dingtalk-dws.js:58–66 保留原入站字段，先做原认证身份检查和 typed identity，再以内部 conversation namespace + 平台 messageId 调用既有 isOwnNotification，未命中则原样 receive。task-session-service.js:241–248 的判据是该内部 conversation 的 outbox deliveredMessageId 或匹配 notification ack/receipt，不能由同账号、相同正文、DWS 标记或别群收据单独取得 own 身份。
- own 精确 ID 命中后直接返回 ignored/own-notification，**不再比较正文、作者或 flags**；本结论不把该分支夸大成内容再校验。普通无对应 receipt 的消息仍经 src/channels/service.js:27 的原七字段 hash、版本校验及 :69–75 的 authorizeInput；同 ID 的正文、作者或 flags 变更仍拒冲突，跨群/跨 channel 的相同 ID 不被别处 receipt 无差别丢弃。service 完整指纹仍 bdb1a84d，未保留六字段删减。

### 必要实跑与版本绑定

- 已完整读 bj02xs18s 原输出及 test/pi-resident-router-flow.test.js:61–115。唯一新增回归 1 PASS/0 FAIL/CANCEL/SKIP，自然 exit0；业务 23685.7385ms、Node 37484.4968ms。真实本地 Host/SQLite/Pi/插件发送读回形成 durable receipt，先存七字段 fact 再冷恢复，精确 echo 后补 flags 不改变旧 facts、source/model/send 不增；非 own 的正文/作者/flags 冲突、跨群/跨 channel 与同账号无 receipt 的新 ID 均有断言，最终 source4/task0。外部 DWS 是 fake，realDwsExecuted=false，无真实 listener，不能充当新真实事项、附件或复盘证据。
- 已独立解析该回归10项 before/after 并逐项核当前字节相同，test 为0f28cf67。最终 Lead guard b3r3usfxq 自然 exit0、WHITESPACE_EXIT=0，14项 before/after/current 全同；194 retained/53 adapted、404 production/runtime JS、191 declared bare imports、0 external SDK/旧编排、verified5/历史格式 removed9。没有重复运行测试或 guard，不以 R6 guard 或较早插件版本代替本次最终101c7010。
- round-7.md:63–80 的16项完整指纹已逐项核当前文件一致，包括 application cc9f8b30、plugin101c7010、service bdb1a84d、原 R6 五文件、入口2e340e7b及新增 test0f28cf67。受验基线为 d27350972df888bf864186eabe64513c12460382 加共享未提交/部分暂存工作树，不能只报 HEAD；本会话没有提交或更新 PR。

### 正式停用与冷恢复原回执

本会话仅从原 Tests transcript 的指定 tool_result 提取必要脱敏状态、时间和指纹，未调用现场 API、查询活动数据库、读取私有配置或启动实例。回执定位集中见 round-7.md:28/85；没有把成员“已完成”自报替代原结果。

- call_c38ba4bc610b4eaaa70cea39786f82c7 原回执直接显示：cancel 前 controlRevision=1、lease2；固定 requestId=sg9-stop-old-20261107-r7-01、expectedControlRevision=1。正式 POST HTTP200 后独立 GET HTTP200，均为旧 task cancelled/control cancelled、revision2/lease2/run1、原 session405bdad6，GET 为 drained=true、recovering=false、notifications0。service:1736–1742 使用正式 task.control/CAS 与稳定命令键；reason 参数未被该实现持久化，本节不宣称取消原因文字已有审计，也不新增无关修复。
- 不能追认首启零写入或首次 recover 不 claim。round-7.md:20–22 明确保留失败启动的 recovering 技术写入，以及修后首次合法 claim 取得 lease2、旧 unknown 前置拒绝；Router 曾产生状态文字，不能称全实例零模型。后面的“不重放”比较对象是正式取消后的 revision2/lease2/run1 基线。
- call_148d8ad99507400ebf47b97ed855044b 原冷恢复结果保持上述 cancelled/control/revision/lease/run 与原 session；journal total/committed 均45111、assistant2、taskAuditKinds 仅 identity+effect-intent、旧工具0，SHA 仍 ad7062f54993597bdc74d23a4c2b31a666d578240c3630e2fd46a7c92b5c9d15。该次 listener ready、backfill failed 的失败被保留，没有与最终就绪拼成一次全绿运行。冲突取证后的 call_6f6277280e25452191044eaf5810245a 为正常 IPC 自然 code0、sourceStable=true、keyInPrivateLog=false。
- 正式取消和 SQL drained=true 不生成原 producer 的 owner-drained/inputs，不补 result/reconciled，不关闭旧 unknown。第六轮原 intent、失败、缺失排空证明及无现成正规补证路径继续作为历史事实保留；新任务或新 marker 不能冒充原事项成功。

### 真实就绪与待输入边界

- 已核 b6kvdjing.output 的最终 SG9_R7_FINAL_REAL_LISTENER_READY：2026-11-06T19:56:41.722Z，即北京时间2026-11-07 03:56:41.722+08:00；health.status=ok、recoveryIssueCount0、listener ready、backfill ok、errors[]、旧工具0。旧 task 仍 cancelled/control cancelled、revision2/lease2/run1、notifications0、原 session。使用原 ISO 时间，不沿用04:56转换笔误，也不由 HTTP healthy 单独推断 SDK ready。
- 后续 call_9692e5e9e1584acf935b05dce1b402e3 原回执再次绑定原配置 SHA cb7aca39、原 epoch 2026-11-06T17:57:44.948Z 和旧 journal SHA ad7062f5；backfill 后续成功时点及 tools0/errors[] 见 round-7.md:53。只陈述这些观测时点，不预测后续永远零活动。
- 当前 bmpv0tlos 是原 Tests 独占的唯一真实监听运行，尚未停机。b6kvdjing 的就绪查询自然0及输出前段重复携带的回归 sourceStable=true，均不是 bmpv0tlos 的最终 exit0/停机指纹证明；其后台与 Monitor b8ouup508 仍由原执行者接回，本会话不接管、不轮询、不开副本。
- 新真人 SDK source/task/session/workspace 当前仍 WAITING_INPUT；等待的是新的业务来源，不是重新索已有指定群授权。新事项须独立完成文件生成/读回/Host冻结、同群中文说明及附件/status/mget/readback/持久 receipt、同 task/event 无工具复盘，以及本事项正常排空和必要冷恢复。现阶段这些均未执行，不能用旧 Router 状态文字、本地 fake 或旧任务取消补齐；不自发自收、Web/SDK 注入、clone/reopen/依赖旧 task 或把新成功改写成旧成功。

### 报告历史与阶段交付

已完整读 round-7.md：87行、14609字节，SHA256=a0f859e058ce83a267117c09436de07dad4c7e225b7ebb63911400d84cefd601；matrix.csv SHA256=09108d8824cbec32d379194570c116bd66d08606518802cded8f0c1a7f02be13。矩阵88个唯一 case_id、9列，新增 round_7 和14行；剥离本轮列/行后，以原 LF/CSV 编码精确重建 R6 全文件 c14cd39fe78c22bef63a17da49a2bd014e7ffe6049c11d8a035a8991f620da3c，旧74行/前六轮逐字不变。round-6.md 仍为217eaa81，未改旧历史，未建全绿 report.md。

本阶段审查收口为“正式停用与恢复补读修复已实证，等待新真人 SDK 事项”；SG9 总目标继续 ACTIVE/WAITING_INPUT。原 review 78243字节前缀 d8bc189d 保留。后续新输入沿原第七轮材料由 Tests 继续，Lead 单写 goal 并负责原 PR 整合，不因本节另起轮次或重复整轮验证。

本会话本阶段仅追加 review.md；未改 goal/产品/测试/报告/矩阵，未运行测试、模型、guard或实例，未读取秘密、私有配置或活动业务数据库，未连接/发送、停止/重启/重放、执行 Git 写/CI/合并/部署或新增 agent/workflow。现场 API/SDK 和业务运行结果均来自原 Tests 的指定原回执，不冒称本会话亲自执行。


## SG9 第七轮终态窄审：独立交付、复盘与观测恢复

本节为同一第七轮的阶段末集中追加，原 review 及先前 WAITING_INPUT/BLOCKED 时点逐字保留，不另起轮次。已从原 Tests 的指定原工具回执确认：新独立事项 completed/drained，文件与实际平台文本/附件读回一致，同完成 event 的持久复盘 done，必要同安装冷恢复未重放，正式 IPC 与最终 closed 观测分别核实。最终验收入口窄修未发现新的确认残留缺陷；这是限定范围的结论，不是新全量或全平台全绿。单条消息的 live event/history 分支仍有观测盲点，Git/原 PR 最终交付仍由 Lead 核证。

### 独立来源与唯一任务

- 本会话只读原 Tests transcript，未运行实例/模型、查询现场 API/活动数据库或读取私有配置。已接原 call_10b19dd、86e663af、010d57eb、aba624fe、e1acaff7、db57b2d3 等必要回执；完整 tool_use_id 集中见 round-7.md:143–157，不复制平台正文、群/profile、配置或业务档案入 Git。
- 平台原消息 SHA20e2978a 与 source SHA82c05d23、version1、actor SHA4131eaf5 和新任务授权链对应；triage committed/needsHandling=true，Router source.message consumed、processedCursor5/generation4，source settled、issues[]。平台实际 mget 的原 source 身份差异回执 call_329967c3f65844c7bd7b8d56ff177597 中，原生 sender 哈希856e4fd0与后续 typed 转换匹配；e1ac 核严格 channel-actor- + SHA(JSON([channelId,senderId])) 后等于 ingress principal/task owner。不能把内部 principal 与平台原生 ID 直接比较，也不以昵称/后缀猜身份。
- 新 sg9-independent-20261107-02 / task-session-83c5ac6e-8ade-4da8-9697-74cc186af6ea 的 source/session/workspace 与旧事项不同，同原群/owner、dependencies=[]、三个 blocker 数组为空。原回执确认 createdAt=2026-11-07T00:58:10.887Z、completed/drained/run1/controlRevision1；没有 clone/reopen/依赖旧任务。新 journal 严格 committed/total49968字节、SHA e3be3784、assistant3，write/read/task_result 的三个 toolResult 无错误，写入有一对 intent/result。
- 原监听曾实际 ready，真实平台消息及认证持久 ingress/消费链已证；但旧坏 observer 未保存该条 raw event。现有 source-read span、平台 mget 或接入时间不能区分当时是 live event 还是同实例 history 补读。此专项 **未收敛/观测盲点** 保留，不编造原始快照，不以重发或注入补证；也不把该盲点说成没有真实平台消息或任务未完成。

### 文件、实际交付及持久复盘

- 原010d回执的 exactTwoLines=false 来自验收预设末尾LF；随后 c66f8108 原结果为 lineCount2/line1Exact=true/line2Exact=true/hasFinalLF=false。实际文件48字节，精确两行 SG9-LIVE-20261107-01 与 真实群消息闭环验收，SHA1c2ec486；work 与 Host冻结输出相同，未改业务文件迎合断言。artifact c63548db、descriptor requirementRevision/version1、producer.runId与nodeRunId对应新task/session、outputRef=single:1、size48/同SHA，见 round-7.md:106–107。
- e1ac 原执行输入与结果均已读：既有 adapter 设 writesAuthorized=false，经真实 querySendStatus 核文本/附件 SUCCESS，再 readMessage 比正文、readMessageFile 以预期 resource/size/SHA 实际下载验证。文本同已送正文；附件重新下载48字节/SHA1c2ec486，与冻结 descriptor 相同，临时下载清理。不是只凭 status/receipt、fake 或候选 notice 判送达。
- 两条 notification 均 delivered、sendAttemptCount1/readbackAttemptCount1，送达时点00:58:44.882Z与00:58:49.295Z；两 receipt SHA分别6d189530与0a6c5fbe，平台文本/附件 message SHA分别f9c0a42c与aaa48236、各有持久 evidenceRef。完成与送达是分别核实的事实，不把旧 Router 状态文字当新结果交付。
- db57 原回执确认同新task及 task-completed:complete:sg9-independent-20261107-02:1 的复盘 done/attempts1/lesson1，recordedAt=00:58:35.301Z、SHA d990727f。task reviews与group review副本字节同、evolution state深等、scope匹配task memoryGroupId/owner；唯一经验entry的source为同session/event，evidenceIds精确为该event。冷恢复 e142 再核 review文件1份、attempt1、经验entry1，没有重复学习。officialReflectionText 不提供 tools、拒 toolCall 后才可done的实现合同已核，复盘不另建执行session、不授予发送或后继执行权限；不以 whenIdle 或仅 task completed 代替持久 done。

### 观测故障与最终窄修

- 已确认旧入口2e340e7b:29的缺陷并直接交 Tests：prior在成功前更新，tail.then只有成功分支，一次 atomicWrite reject 后同快照不重试、变更快照也不执行写入；:30只反复打印，:32的closed同样失败。旧observer停在2026-11-06T20:41:52.996Z/running，不可用其tools/errors空或Monitor静默断言后续无业务。原日志最后15998条旧格式错误保留，15586是较早快照，不冒充停机基线；最初OS错误未保留，不能猜EPERM/ENOSPC。
- 静态沿实际 IPC 链核：supervisor转发给run launcher，再到CLI host.close；Host先application/tasks.close、factory.close，再fiber.dispose。已装Cordis fiber.ts:675–685对各disposer分别catch/log。因此观测drain reject不能直接推出task drain失败或IPC必exit1，IPC exit0也不能证明closed观测成功；三个事实分开核。原业务 bmpv0tlos 的正式IPC自然0/sourceStable15/keyfalse已由 e5bac23c及宿主完成通知证实，同时旧observer仍running，历史不追认closed成功。
- 停止态第一修522be99d将snapshot structuredClone冻结，在串行write中去重、成功后才commit prior，tail.then(write,write)允许后续sample接续、当前失败仍reject；timer仅打印有限白名单code/phase，不输出异常对象/私有路径。普通health数据已沿plugin与bridge:230–284核适合克隆。未改通用atomicWrite、产品、账本或权限。
- 本会话进一步找到同层反例：原atomicWrite在POSIX rename成功后目录sync失败可抛committed=true；522旧prior=A、B实际覆盖但报错后，再A会误跳过。此为静态合同反例，不是本机原OS cause。最终6f44710a在真正write前清prior，任何失败后不再用旧成功缓存断言磁盘内容，成功再commit；保留原异常与串行队列，该已证缺口已修。最终diff只在原sample/timer责任层，没有放宽底层路径/原子写入合同。
- 已读 call_10ca7fc91a304cc28d317feb16694cb0 的实际执行源码和原结果，不仅采信pass汇总：import真实apply、使用真实atomicWrite，自有runtime边界连续两次NIGHT_PATH_UNSAFE均reject、timer安全错误；修复夹具后同快照可写；A成功→B真实I/O失败→再A仍reject、修复夹具后A实际写入；可变health不污染已排队快照，B→A最终A，pending更新与closed均等待完成。源码起止6f44710a一致、finally恢复钩子并删除自有夹具后access=ENOENT，语法/空白检查通过。该隔离没有网络、模型、秘密或业务实例。
- 版本必须分开：真实新业务为2e340e7b，同安装冷恢复/closed实证为522be99d，停止后最终6f44710a只做上述隔离和静态核证。未再起真实实例；没有把522现场结果冒充6f全分支实测，也没有动态注入POSIX目录sync提交不确定。未做的分支不追认为已测，已修的静态反例不继续列成最终残留缺陷。

### 冷恢复、精确回声与正常排空

- 原522冷恢复 b3hzpf9xy 先check再start，同原安装/配置SHA cb7aca39、epoch2026-11-06T17:57:44.948Z。4feb96aa原输入已核显式portable codec + requireComplete:true逐份decode；原15份journal数组已独立从db57回执重建，紧凑JSON SHA精确为5b0b9fd9，恢复时bytes/SHA/assistant与原数组逐项深等。listener ready、backfill ok/completionScope durable-receipt、HTTP status ok/recoveryIssue0，不能由HTTP单独推SDK ready。
- 冷恢复仍仅新completed/drained/lease-run-revision1与旧cancelled/revision2/lease2/run1两task；两receipt、send1/readback1、48字节work/冻结产物、review SHA均不变，工具/错误空。e1429b86进一步核完整source page total2/nextOffset=null、新真人marker1、三条sent outbox精确ID不在source page，journal仍15、无新task/session/收据重放；同完成event唯一复盘/经验条数不变。该实际恢复覆盖精确自回声不变成新事项，而非仅本地fake去重用例。
- 2467f9a9原回执与宿主 b3hzpf9xy completed/exit0通知分别核实：正式IPC、closedAt=2026-11-07T01:29:59.535Z，signal=null/sourceStable15/keyfalse；observer独立phase=closed/at01:29:59.362Z、tools0/errors[]。新code/phase错误0、旧15998条历史保留，独立OS退出事实按Tests原回传记录，不冒称本会话亲查PID/端口。当前实例已结束，没有待输入、在途监听或本会话后台操作。
- 新业务首读health degraded/recoveryIssue1、TRIAGE_NO_DISPOSITION，以及原末尾LF假设、内外namespace误比、就绪观察器字段写错、早期错误计数误作终态基线均在round-7.md保留；后续issues[]和正常终态不抹去这些失败。旧事项的45111字节/ad7062f5/assistant2/identity+intent仍保留，无result/reconciled/owner-drained补造；新成功不关闭旧unknown，也不冒充旧事项完成。

### 冻结材料与交付范围

已完整分段读最终round-7.md，161行/30001字节，SHA256=2bb4353c3771ae4d8c5de15ac0bc19f95ba989f53545effbf951453c3b244fe5；matrix.csv SHA256=8ef6e2f29286de5b0696648511c26535bc514c8e343c4037ba8f088dd4babb4d，91个唯一case/9列。前阶段待输入记录保留为历史，更新四条新业务终态并新增三条观测记录；剥离R7列与新增行后精确重建R6完整c14cd39f，原74行/前六轮逐字保留，round-6.md仍217eaa81。未建全绿report.md。

当前HEAD853ed2563b56308aada3a42fdd13043832286e8b，加本阶段goal/报告/矩阵/入口未提交增量。已逐项核原14产品/配置/依赖与echo test共15项仍同冻结报告，最终入口完整SHA为6f44710a1b89cb88003b9dc3b31ef5177671d1d4447ae9e2b268f9996a3999fa；不重复已通过业务、产品guard或全量。历史review原87319字节/ec0cda4f完整保留。

本阶段可交Lead整合：指定群新独立事项的实际交付、同event持久复盘、必要恢复与正常退出证据成立，最终窄修无已确认未处理代码缺陷；单条原始live/history分支、首次OS cause及POSIX目录sync动态分支按上述边界保留。长期目标状态、提交/push/原PR回查仍归Lead，不因本审查替代Git交付或擅自宣告整体结束。本会话只追加review，未改其它文件、未测试/运行现场/发送/重启/重放、未读秘密或私有配置、未做Git写/CI/合并/部署，也未新增agent/workflow。

## SG10 第八轮终态窄审：中立边界、显式续办与普通交接恢复

本节为 SG10 阶段末一次集中追加。限定已核源码、实际原回执和最终材料，未发现新的确认残留代码缺陷，可交 Lead 继续原 PR 整合。这不把分组结果合成一次最新全量通过，不替代 Git 回查、真实厂商重新验收或长期目标完成；SG1–9、旧失败与 unknown 保留。

### 受验版本与独立证据

- 实际 HEAD 为 `2e6cf2ebf2df41d90aa46af5895a42401988ae4d`，分支 `worktree-resident-conversation-routing`；有本任务团队已知的未提交工作树及 Lead 暂存成果。结论绑定实际字节，不仅绑定 HEAD。Review 未做 Git 写入，未确认本轮 commit/push/PR 更新。
- 最终五产品为 lifecycle `423a2e97`、ledger `425b730e`、factory `f402d9e6`、official-session `1cef70fa`、task-session-service `cfaaf8c0`。完整路径/SHA 集中在 [round-8.md](round-8.md)；本会话逐项计算全部 43 项当前 SHA，与最终表全部相同。
- 已独立读必要原输出及实际测试断言，包括 b3we9iekt、bockg3hqv、ba779gfp3、brt8jyqyp、bc39joqdx、bekhpc09z、byaesj68v 与最新 b5kq76lkg。原输出 SHA、各组版本及自然退出集中见 round-8，不另建流水账。bc39/bekh 的 39 项起止与当前字节一致，digest `82f0e702dd7d9f6fdef4afc6151963fac3d6827dd9666b5bb65a0d9a35091743`；bya 的 29 项起止及当前一致，未重复实跑。
- 最新 b5kq76lkg 的 24 项 START=END=当前，check/whitespace 均 0、自然退出 0；194 retained/56 adapted、405 production/runtime、191 bare imports、0 外部 SDK/旧编排定义、relative imports closed、HTTP routes retained。b4/b96 只证明其当时版本，不能替代最终 423 版。另核 manifest 的 203 对原 source/sourceSha256 仍逐对等于 HEAD。

### 已修反例与权限边界

- 两个窗口分开核：原 enqueued 未 admitted 的 packet 冷开优先恢复，后到事件另批；原 admitted 后模型失败不能靠 duplicate deliver 再触发模型。新 `app.tasks.resumeRouterBatch({conversationId,generation,sessionId,packetId,failedEntryId})` 是 Host-only 显式控制入口，严格绑定原 scope、当前 generation/session、完整 packet 和 branch 真实错误 entry。不提供新来源/权限，不新建 packet、不换 session、不重 enqueue/deliver、不改 SQL/journal、不调用 SDK 私有续轮。
- 30/31 反例生产可达：正式 task.control 产生 29 内部事件加一个用户来源，原批满 30 后新增第 31 pending；仅比 limit30 列表会漏 SQL 新项。ledger 只读 inbox-count 与原 validate 联用，要求全量 pending 数量等于原批数量，保留顺序、完整 packet 和权限校验；count=0 也经 store 的 `!==undefined` 正常返回。b3 负例在模型前拒绝且保留新事件，未放宽 15 用户来源、30 批次或大小限制；同组另两项失败不抹去此证据。
- MEMORY_ADMISSION_REQUIRED 是冷开 current 为空的真实缺口，memory 拒绝正确。比较后排除放宽守卫、全局猜最后 admitted、重新 deliver；最小修在 factory 传入已严格核过的原 packet，wrapper 构造时建立稳定只读 current 委托并冻结。公开 sendCustomMessage(false) 的 claim 持久提交、afterClaim 复核后，才为完整公开 SDK 轮临时绑定原 `{id,messages:[packet]}`，每次 structuredClone，finally 清除；未改 raw admission/SDK 状态。
- 已核 memory.beforeRun、visibleBusinessInputs、run 关联等消费者。原来源仍须 night.business-input/lookup 精确一致，claim/turn 不成为来源；记忆命令只识别顶层 user，原 conversation-router packet 不重放 remember/forget。实际 SSE endpoint 读取发布 actor.current 的断言绑定原 journal packet；bock 再次模型错误后 current 恢复冷开 undefined，新错误持久且旧 proof 冷拒。取消没有专项动态证据，不据 finally 存在宣称已测。
- checkpoint 保留 owner/live、原授权、idle/无 pending、严格最后错误、唯一 claim/已提交 revision、toolCall/result 配对及 effect/job 未结检查，afterClaim 再核；一次错误 entry 的 proof 不可重复领取。claim 在公开触发轮前提交，保留 SDK compaction 可能先于 trigger 消息的实际顺序，未用私有 `_startRun` 或裸 continue。
- bock 成功例最后查错旧 g1 seed，原整例 FAIL 保留。factory 在新 candidate 创建时写 seed，故只改为 candidate 严格 journal/header，并关联 published rotation 的 old/candidateSessionId、handoffId/conversation；精确五行 fixture 修复未降低断言。ba 单项自然 0 证明该版成功，但 lifecycle 仍 63c，不冒充最终并发版。

### 普通 recover 与活跃交接

- 已沿 application 的 5 秒 recover、task service、tails 和 factory.dispose 核代码竞态：旧 recover 在 tails 外恢复 phase/释放 owner，rotate 已写 handoff 并 await 模型时可能被当冷中断 dispose。recovering 只合并 recover 彼此，Host 上下文 snapshot 不是锁；owner/live 守卫也不能阻止错误 dispose。预创建 NOT_LIVE stack 不能定位现场失败时点。
- 最终 lifecycle 仅将 phase 恢复和 published 旧 owner 清理移入原 drain/tail；recover union router.list/pending-conversations 的 id，逐 scope await 原 schedule，执行时重读 row。精确逆变换两块可重建 63c。recoverConversation 全在队列内，close 仍先停止接纳、join tails 再 dispose；无 busy 静默 skip、新锁、停 timer 或 factory live 放宽。
- bc39 挂住真实无工具 handoff SSE，正式 recover 已到真实 router.list gate 时仍 phase=handoff、旧 owner signal 未 abort，release 后 await 两者终态；settled/cursor1、generation+1、published candidate/严格 seed、原 packet/admission 唯一及再冷不重放均通过。bekh 另一 scope 的真实 store EACCES 仍传播，不被首 scope 的 ROUTER_BATCH_UNSETTLED 吞掉，模型不增。两项各 1 PASS、自然 0。
- brt 原安装 strict/immutable 原回执单独证明业务 settled、event consumed/cursor1，g1 active/lastHandoffCursor0，rotation aborted/interrupted-handoff、无 candidate；不证明准确现场交错 trace。代码竞态已证并修，现场唯一深 cause 不补猜。原 proof 已用，此后不再 resume；普通 recover 只续交接，不重做已 settled 业务。

### 原安装终态与保留风险

- 本会话只提取 Tests 指定两个原 tool_result 摘要，未读现场 DB/journal、私有配置或技能正文。原 task/session completed/drained/run1；初次 skill→read→task_result 及两读取收据与工具 entry 绑定事实，不能把当时后段失败改为整脚本 PASS。私有技能只在原安装忽略目录，不复制公开 fixture。
- 最终 bya 默认 application 普通 recover 仅一次 tool-free handoff，business/execution/tools-result/渠道 transport 均 0；Router active/g2/cursor1/lastHandoffCursor1，candidate 严格 header/seed 对应原 rotation。原 task/session/completion/run1、task.list/notification.list 深等，g1 的 39-entry/36535B 物理前缀不变，packet/enqueued/admitted/claim/turn 仍各一份。重复 recover/whenIdle 不增模型，不再调用旧 proof。
- 初末 health ok/recoveryIssue0/outboundAuthorized=false；config、16 份其他 strict journal 含原 execution 整字节不变，技能 ignored/untracked/unstaged，29 source 不变。teardown 实际 await app/Host/endpoint，close 错误会使本例失败。最终 1 PASS、自然 0，不能只凭 HTTP 或工具成功代替业务/关闭终态。
- 正常关闭不消除 Host/application 在 close 抛错时串行清理短路的既有风险；早期 CLI CANCEL/精确自有 PID 强制清理和 brt NOT_LIVE 保持原结果。Windows 隔离限制、Linux runbook 未本机实跑、取消未专项动态、原准确竞态 trace 未留，均不写 PASS。新成功不补旧 unknown 的 producer-drain/reconciled 证明。

### DWS 中立映射与 R7 适用范围

- 已沿 `src/channels/service.js:37` → `src/channels/plugins/dingtalk-dws.js:33` → `packages/dingtalk-core/group-message.js:71` / `packages/dingtalk-core/task-notification-readback.js:55` → 原 adapter 读完整责任链。notificationAudience 对新 recipientActorIds/replyToActorId 和旧厂商字段只作读投影，历史 payload/digest/receipt 不机械改写。envelope 将受众、payload.actorId、显式引用作者分别经当前 conversation participant 映射，未知成员不再静默 filter、跨会话拒绝；单聊 recipientIds 仍为空。
- 下游实际 native quote 条件仍是 payload.sourceMessageId 与 payload.actorId 同时存在，作者用 actorId；readback 仍按相同字段建 outbound。正式生产方 `task-session-service.js:800` 将 actorId/replyToActorId 同源写入，typed 将 actorId 映回 envelope.senderId，因此该现行路径及仅有 sourceMessageId/actorId 的历史路径保留作者语义。不能只因新 replyToParticipantId 字段存在，就宣称任意不含 actorId 的外来 payload 已获原生引用支持；本次未扩大这类输入合同。
- 新最终通知 sourceRef 只保来源，未显式引用时不从 sourceRef 反推 quote/作者；受众经 recipientIds 映到插件内部 atOpenDingTalkIds，冻结附件按原 afterNotificationId 顺序承接同受众。已读 neutral 断言：文字/附件 recipientIds=['bob']、replyToMessageId/replyToParticipantId 均 undefined。ACL/schema 与附件终态来自 Tests 原本地分组，不等于本轮厂商发送。
- group-message 从 sameDeliveredText 起的协议尾部与 HEAD/R7 基线精确相同：10283B/SHA `c6c85145a40a575d1e021a66e96eab7eb1fc01743d9146564529d9e81d5fd420`。dws-adapter.js、task-notification-readback.js 也逐字等于 HEAD，SHA 分别 `4c5e9fc34d042e47b34e087c183992c52d71693c12ebe2d526d9d8984ae78f19`、`c04a9192f01ad3a2a03cbb3970b2a25c3ef077269f989d54eafb1657cedd570e`。这是限定协议未变的静态证据，不能覆盖已变上游所有受众/引用组合。
- R7 真实同群文字/48B 附件读回、持久复盘、冷恢复保持其原版本事实；不据未变源码或本轮 fake/loopback 宣称新版 DWS 全链重新实平台验收，尤其不补称原生 mention 已核验。SUCCESS 精确回执只证明送达，mentionVerification=unavailable 的边界保留。R7 单条 live/history 盲点、旧 unknown 和未补 producer 证明不被本轮消除；未重发/重启/读取现场来装作补证。

### 最终材料与交接

最终 [round-8.md](round-8.md) 为 23319B/SHA `021d3b595c79ed7612dab024d80a60b5884b6ecc28e20fbfba91a87d09374238`，43 项最新映射逐项等当前；matrix.csv 为 22678B/SHA `2ef891d7d2c12dfcb776c554b3eb0ec6ebefac4bf83b59375b016c86f399aad4`、122 case/10 列。已独立 CSV 比较原 HEAD：原 91 case/9 列每个历史字段不变，仅新增 round_8 列及 31 case，保留 FAIL/CANCEL/NOT_RUN，不拼同版全量全绿，不建 report.md。

R4 报告最终 19686B/SHA `b9338900b8d3acf92ce68711e26ff2b72e6d425e06c453d92e161bd8497db12a`。已读相对 HEAD 六处清理注记：原结论、时间/版本、必要文字和清理前完整 SHA 保留；两份 round-4/verified-3-web-continuation-result.json、verified-6-router-result.json 已用独立只读存在性查询确认不存在。清理由 Tests 唯一执行，Review 未改这些材料或清理其他会话资源。

追加前原 review 为 451 行/98232B/SHA `06ba38be2ced1b98ae8ab472f71a5744788dd3f6af114d9f986b8a9f0b8eb276`；本节只在其后追加，原 SG1–9 和先前检查点逐字保留。本会话未改产品/测试/目标/报告/矩阵或其他文档，未另起 agent/workflow/实例、运行测试/模型/渠道、读取秘密、外发、重放、部署、合并或触发 CI。Review 交回此文件写权；唯一 [goal.md](goal.md) 由 Lead 维护，下一步仅由 Lead 完成已授权原分支/原 PR 的真实 Git 交付与回查，不据本窄审宣告长期目标结束。

## SG10 第九至十轮阶段窄审：引用、精确回声与现场待输入

本节按 Lead 交接集中审查 R9 反例后的本地工程增量及 R10 真实 ready 检查点。仅追加原审查记录，不等待尚未收到的真人来源才保存工程成果；现场目标仍 ACTIVE，本节不作为完整 DWS 现场验收通过或最终 Git 交付证明。

### 确认保留项与阶段结论

- 已证保留限制：`packages/dingtalk-core/native-dws-send.js:131` 的 Promise.race 只限制等待，不取消底层状态查询；`:231` 的 observer.close 不 join/cancel probes，ChannelsService 聚合关闭也不等待异步 observer 关闭。原 runner 超时发 terminate 后立即 reject，未等待 child.done。可达交错为 unknown 通知的额外身份查询挂起，1500ms typed 暂缓和水位保存结束后立即 stop，查询 CLI 仍可能运行至自身超时；closed 检查也不能倒推已进入 save 的投影全部 join。Platform 与 Lead 已确认，此轮不改 runner/进程治理。bridge 消息和水位排空的 PASS 不能宣称所有旁路 CLI 已排空；后续正常退出仅核实际观察到的实例及资源。
- 能力范围保留：新 resolver 只接队列 notification；原 native operation send/status 支路仍依原 conversation/query 路径，未统一 typed scope/query 接线。不能把本地队列回声 PASS 扩为 shell 原生发送通用能力，不能据同账号、正文或通用 DWS 标记粗滤。Windows 进程 privacy、Linux 未实跑、异常 close 专项及旧 unknown 缺 producer 证明等既有边界不变。
- 在上述明确范围内，未找到阻止本轮本地工程保存点的新增确认缺陷。引用的来源/受众/幂等、默认插件回声身份、typed 暂缓、持久水位及 pause 交错有下述源码与原回执支持；已证限制不写成已修，分组通过不拼为最新同版全量全绿。原群真人新文件事项、原生 quote/@、本次复盘/冷恢复/正常退出仍待实际证据。

### 实际版本、分组结果与失败责任

- 本阶段实际 HEAD 为 `67d2d5011f54b1f63704b84c81b24c1216d0e3fa`，分支 `worktree-resident-conversation-routing`，存在原团队已知未提交源码、测试和文档增量。结论绑定工作树字节，不仅绑定 HEAD；Review 未做 Git 写入或确认本轮提交/push/PR 更新。
- 五产品保持联合冻结：resident-router-business `cf284083`、task-session-service `6592256f`、plugin `d1cc7cd0`、native-dws-send `247191b2`、bridge `08221847`；最终测试为 pi-channel-plugin `e5b7a835`、dws-bridge `410f50d3`。完整路径/SHA 见 [round-10.md](round-10.md)，本会话逐项核七份当前字节与表相同。最终 btpr 原回执47项逐一等当前，digest `669959964ec2d4bf5476b767ff1069194552d20fd2c2a8ea9d0ef5b0ad06ee5e`。
- 已独立读四份本地原输出及实际断言：b9mg6uq8o 为引用2 PASS/自然0；bqpz1986y 为5 PASS/1 FAIL/自然1，含 bridge 两项 PASS；b24nr8a3q 为3 PASS/1 FAIL/自然1；btprbo14p 为 SUCCESS 单项1 PASS/自然0。各组 CANCEL/SKIP 均0。四份输出 SHA 与 round-10 表相同；各自 START/END changed=[]，前三组与最终共有文件仅 pi-channel-plugin 测试 SHA 不同，quote组46项未绑定 bridge 测试，不能称四组是同版完整47项整跑。
- 首次 FAIL 是 fake SUCCESS status 漏 `contractVersion:'im.message-send-status.v1'`，严格 proof 正确拒绝为 IDENTITY_PENDING/status-unconfirmed。第二次已过滤精确回声，但测试错误要求 receipt 整对象 undefined；原 notification-delivery 未 verified 时本来保留 ACK/openTaskId。最终仅改为未 delivered 且 receipt 无已验证 messageId/observedAt。Review 从当前测试逐步逆还原这两处，精确重建 ed9b0066 和首版1b519ebb；产品五份未改、未放宽 nativeDwsStatus，两个整组 FAIL 保留，不称为两次产品修复。

### 引用来源、受众和幂等

- `src/channels/resident-router-business.js:105` 公开 schema 仅接受 `replyToSource:true`，不接受 false/字符串或任意引用消息、作者字段。工具仍先严格验证 sourceId/messageVersion 及当前 conversation/generation，再调用原 Host prepareReply；任务来源、revision、冻结 artifact manifest、hold/archived 校验未放宽。
- `packages/dingtalk-core/task-session-service.js:776` 只从当前原 source 绑定 messageId/actorId；显式引用必须显式选择含原作者的受众，缺省、空数组和仅他人拒绝，不自动扩大受众。解析后的引用、作者和 recipients 沿原 replyRequest/payloadDigest 冻结；同 operation 相同请求不多发，去 quote 或改受众的语义变更冲突，不增加旁路幂等机制。
- 默认不 opt-in 保持现有合同；taskDelivery 与显式受众默认普通 Markdown，普通未显式受众路径保留原默认引用。引用仅作用于父说明，file child 保留顺序和受众账，不宣称 DWS 文件自身原生 quote/@。b9mg 经默认 application/官方 Pi/真实 Host/SQLite/中性 transport，实际 work 写读及 task_result 冻结，文字1/文件1、回读2；file readback 挂起时 child 非 delivered，冷开历史终态不重发。官方 schema、四类受众拒绝与 operation 冲突均有实际断言；这是本地证据，不是厂商现场。

### 默认插件身份、typed 暂缓与持久恢复

- R9 原 ACK 只有 openTaskId，没有 messageId/native conversation，不能靠扩 parser 获得不存在字段。`src/channels/plugins/dingtalk-dws.js:68` 默认 observer 直接注入自身 adapter，operatorNotifications=false 也可查询；经当前插件持久 chat-room context 将内部 scope 映到 native conversation。严格 status 需 contractVersion、SUCCESS、原 openTaskId、native conversation/messageRef 一致，投影仍写回内部 outbox。
- `packages/dingtalk-core/native-dws-send.js:169` 只投影精确 deliveredMessageId/sendReceipt 身份，不改变 notification 内容/附件验证或 delivered 状态。`:208` 等待后 fresh 重查同 scope starting/unknown 身份，超时、失败、PROCESSING 或缺 proof 均 typed 暂缓，不能当真人。`packages/dingtalk-core/task-session-service.js:250` 在 unifiedIngress 的 registerConversation/fact/source 之前执行该 guard；精确已知 own 可过滤，未决错误仍抛出，不返回 accepted/ignored 冒充接纳。
- 最终 SUCCESS 单项在 mget 挂起时验证 fact/source/triage 均0、send1；同账号同正文泛 flag 但新 mid、同 mid 异 room、异 channel 均不误滤。timeout/error 两例用早120秒真人消息，暂缓时无 fact/source/triage，真实 ingress.json 水位覆盖原消息；冷开正式 history 接纳一次/source1/triage1，完整成功才清下界。永久 PROCESSING 冷开仍 degraded、水位保留、source/triage0、通知非 delivered，不吞错或伪造成功。
- `packages/dingtalk-core/dws-bridge.js:225` 取原消息 overlap 下界与 active backfill start 更早值，先增 recoveryEpoch 使旧补读失效，再沿原 controlTail/saveIngressState 持久 pin。写失败显式 CHANNEL_INGRESS_RECOVERY_PERSIST_FAILED，完整成功才清原水位；已查旧 backfill 尾、pin 失败、pause 前后和 stop 交错，未找到丢新水位或队列自等待反例。
- pause 在原 controlTail 内仅持久状态并建立 drain，实际等待移到 tail 外；消息可回到同 tail 保存 pin，不再互等。stop 等 pauseDrain/inflight messages/controlTail 及原补读资源。bqp 两项分别用真实 atomicWrite/磁盘 JSON 验 pause 持久 pin、冷开补读一次，以及目录目标 I/O 失败显式 degraded/accepted0/旧磁盘水位保持；不据这些本地 PASS 消除本节首项状态查询资源限制。

### R9 事实与 R10 真实 ready 边界

- 已全文读 [round-9.md](round-9.md)、b5jokmzks/bxfu4kavz 原输出和四个指定脱敏 tool_result。R9 在旧67d2d50版真实回读既有文字/48B附件，随后原安装真实 ready/backfill、模型调用及一条文字答复成立；source+2/task0/notification+1，自身答复在精确身份落账前进入 source/triage 的 FAIL 保留。最终 ignore 不等于入口去重，外层自然0不等于现场全链 PASS；精确 status 首 messageRef/mget 交错仍未观察，不补猜时序。原旧任务/通知、历史物理前缀及当轮配置/技能保护保持原报告事实，不追认当前修复已现场验证。
- 本会话只从 Tests 原宿主记录定向提取已结束 `call_01b385f4ac5f4506a4c1ea35aad10a59` 的安全预检摘要：2026-11-07T07:16:15.060Z，47 source/22 journal、原3 task/4 notice，strict history digest `10c4bafc4ca058b600210c64bc637d14db913ceff5b5dd5547919311a302dd90`；原监督及 R10 外层 CHECK_OK 的 effects/network/credentialRead 均0，独立端口预检返回 FREE。未读取现场活库、私有配置、秘密或技能正文，未复跑自检；离线 hash 不当作运行中活库证明。
- 已独立读 bozw4158i 完整已结束原输出，SHA `e86fa169196a94089f4f41e6bdb1f8147e235d208e0fd46d2596747e79ec94cd`、自然0：SDK 07:17:13.712Z ready、完整 backfill 07:17:24.139Z/durable-receipt、HTTP ok/recoveryIssue0/tools0，原 supervisor87404/launcher97088/service104368、127.0.0.1:19298。北京时间为15:17；listenerIsReadOnly=false，不能称无外发权限或只读启动，tools0也不等于模型 HTTP 请求0。精确 OS 归属是 Lead/Tests 另行原回执，本会话未亲查现场进程。
- 本阶段报告没有新 field 请求已接纳证据，未发生可验的新文件事项闭环。b601nf10p --run --hold 及 Monitor bq0vvu12d 仍由原 Tests 持有；本会话未读在途输出充当终态，未停止或重启实例。新来源、文件冻结/实际交付与精确回读、原生 quote/@、无工具持久复盘、同任务冷恢复和本次正常 IPC 退出/结束保护均不填 PASS。保持原监听等真人，不注入、自发自收或重放补足；工程提交保存点不能代替这些条件。

### 最终材料与交接

- 本阶段 round-10 为146行/15937B/SHA `ffe5d67d6c41aafe2343f6d3e0aac20e80e777d60eebdf796d0551e78af3b3af`；matrix 为167唯一 case/12列、34102B/SHA `ecafabbec7786915901215f3ddbd0bd828b83de92e14e1ff028b88de32aadad0`。本会话独立剥 R10 新行/列，逐字重建 R9 完整27668B/SHA `9f0d766e796285deb980fa280a572d23887bfb31bccff5cc169ce6e1e65c70fa`；原 HEAD122 case/10字段逐值不变。R1–8报告逐字等HEAD，R9仍12439B/e5a76ea1；FAIL/NOT_RUN/WAITING/IN_PROGRESS均保留，未建全绿 report。
- bddd8bjga 原 guard 与结构校验自然0，输出 SHA `db890b81cda97124ccb10d28b173e20ee046732266de759a7ff71ce1b2568d7f`：194 retained/57 adapted、405 production/runtime、191 bare imports、0 externalSDK/旧编排、strict source5/removed9、relative imports closed/HTTP routes retained。manifest `5d748a04` 与 coverage 脚本 `fc23110d` 精确适配本轮，203对原 source/sourceSha256 与HEAD逐对不变；不重复 guard，也不把它当渠道实发证明。
- 必要文档已核：README `82e0601b`、CHANNELS `719d86b2`、Windows runbook `c3cfb03b`；仅 CHANNELS 后补已证 probe 关闭精确限制。引用受众/父子能力、队列 resolver 范围及 R8 无真实调用仅限定 R8 均与实现相符，不把 R9 旧现场或本地 fake 当最新版现场收发。阶段材料定向 diff --check 通过。
- 追加前原 review 为501行/110236B/SHA `b9f9acc5b3c231399ef4722679f83c04c19438d8faa2c6201afc87622ba9a2d9`；仅在其后追加，原历史不改。本会话未改产品、测试、goal、报告、matrix或其他文档，未运行测试/模型/渠道/实例，未读秘密或技能正文、未外发/重放、未新增 agent/workflow/定时器、未做 Git 写/CI/合并/部署。交回原 review 写权给 Lead，唯一 [goal.md](goal.md) 继续 ACTIVE/SG10；Lead按已授权原PR保存工程增量，Tests保持原现场，后续现场结果再按实际版本补验，不因本节结束长期目标。

## SG10 第十轮现场终态窄审：真实交付、原生提及与同任务冷恢复

本节在 Tests 集中交回现场报告后一次追加；前节待输入及未退出是其原观察时点，历史不改。本次原指定群/profile 的有限现场闭环、复盘、同任务冷恢复与正常退出证据已独立核齐，未找到阻止本阶段交回的新增确认缺陷，可交 Lead 整合原 PR。旁路状态查询未统一取消/join、原 native operation 范围及其他既有风险仍保留；本节不替代最终 Git/PR 回查或宣告广义平台全部验收。

### 版本与真实执行、交付

- 首次现场起点 HEAD 为67d2d50加已冻结工作树；Lead 后保存实现 cd045ee，冷恢复起点及本次材料核验 HEAD 为 `e7d045abf71d057a6ffd1748425cd2a9437b2c26`。两外层各保护47项受验文件，产品/测试未因现场改动；本会话不重复旧47份源码审查、不再运行测试/平台/实例，只读指定已结束原回执、必要复盘责任链和最终材料。当前未提交增量为团队已知最终文档。
- `call_cad9eadad3174ed0987bca2adac831b9` 的新 formal source 为 version1/processed，时间2026-11-07 16:52:25.466+08:00，native message hash `4edde5fe498038bd6dfe3cd4564bcabe02b25d67c7d7b0c60e95e794eab2bd60`。分诊/Router正式工具序列与来源对应；后续离线权威表核唯一 source、triage committed1、来源及新 task.completed consumed2，两自身消息未成为 source/fact。不能只由工具页隐藏 own 或 SDK 是否回传自事件推断入口正确。
- 已读 `call_9f684b13a2aa4bd7bd6610aad08ec573` 的实际脚本及 R10_LOCAL_FIELD_EVIDENCE：新独立任务 completed/drained/run1，唯一执行 session hash `abf33ccb29fb5c8ae9009c846097d707ed5dc823c5f573943ab1d46fe3422c5b`；strict portable/requireComplete journal hash `17415f728ee2fa9fbc75af414d0007e4781978902546d7fbec244e387acc8a39`，write/read/task_result各有成功 toolResult、errors0。work、Host冻结文件及descriptor同29B，SHA `afe13bfb164fcc75d4d2a1623c8d89b0c761b75a2e665531c288a9ff401ef3c2`，本会话另按请求UTF-8字节重算长度/hash一致，不从task.json或完成状态推测产物。
- `call_48be6fe4ceeb4501a32eaa7dfd240b40` 是原profile/原群的独立真实 status/mget/文件重下，不重发；父/子分别delivered、send1/readback1且status精确匹配原receipt。父mid hash572f690d、子mid2990a64c，正文按真实quotedMessage验证；文件资源身份与冻结receipt对应，重新下载29B/hash精确同上，临时下载已清。SUCCESS、正文、引用、提及、资源字节分层核证，不相互代替。

### 原生引用、提及与认证复用

- mget quote精确原mid/原群但不暴露原作者ID；同次原生 list-mentions raw另有quote senderOpenDingTalkId。本会话重算 raw 中父mid572f690d、quote原mid4edde5fe、native作者856e4fd0，与源/父receipt及typed映射一致；不只按显示名认作者。`call_d5ec3f6d52174f99b28270816ae7a71d` 的当前contexts.participants将typed owner4131eaf5精确映到native作者856e4fd0，父唯一recipient及replyToActorId同owner，子来源相同但无quote；内部conversation/native群分域保留。
- 已读9f原回执的精确leaf schema：chat message list-mentions / chat.search_at_me_message查询提及当前用户的原始索引。48be原查询沿原profile/原群、父时间前后1秒，success、requestSatisfied/sourceExhausted=true，paging/result hasMore=false、truncated=false，唯一群/唯一父mid。`call_7e563e5dc01748f38d1b7e27c8156d1c` 仅复用该raw，无新DWS调用；本会话逐字段及hash独立重核，不依其PASS标记自证。
- 比较三条证据路径：正文出现@姓名不足以证明原生提及，quoted作者也不是mention目标，二者均不采作目标证明；采用原生@当前用户索引的精确父消息命中，加同profile已核认证主体和当前typed/native作者/受众映射。认证复用原 `call_3f63dac727534f5481f34757978c08c0` get-self真实exit0，`call_000a6f06cd2c4a99b15bf6444a7ae165` auth readonly精确userId/corpId、唯一userId→openId及原群membership，再接875d原离线同profile/config核验。48be本身只比较配置assistantActorId，未新调用whoami；本节结论明确依赖这条既有认证链复用，不称08:59新认证核验。
- 据此本次“原生@原作者”成立，原生quote也精确核齐。mget没有mentions数组，原runtime receipt mentionVerification=unavailable及空atOpenDingTalkIds不改写；索引命中不等于可枚举任意原生mention受众，更不由quote作者或正文姓名补造数组。支持范围仅本次同profile/同群/原作者，不外推所有接收者或其它渠道。

### 持久无工具复盘、交接与回声

- d5回执核 task review/scope review逐字同SHA `06771d97ba7bd0f90ae40a1dcb6e3b37139c8f9dd88da221c7648b140416d7ee`，同event state done/attempt1、lesson1及actor scope；`call_2bf03b1811344d77b2b80bc4e661a507` 核experience条目1/revision1、task/event/actor精确。复盘以当时已完成/产物为证据，不因此追认当时渠道已送达，私有复盘正文不入Git。
- 另沿 `src/memory/reflection-inference.js:25` 核实际默认官方一次streamSimple仅stop且无toolCall才返回，`src/memory/reflection.js:54` 验evidenceIds后才在79/82持久done/review/state。两文件逐字等HEAD，SHA分别8c945064、8876dfc8。持久done与实际守卫共同支持无工具复盘，未把Router交接的零工具当复盘推理日志。
- `call_551d30e5f9c245d6ac013264fee75c36` 以活库mode=ro/query_only事务而非immutable核新完成事件consumed，g9/cursor9/lastHandoff9、g8→g9 published、原/候选strict commit及精确来源覆盖；2bf独立核g8交接assistant1/toolCall0/toolResult0/stop。d5在交付后完整backfill成功的观察及最终离线权威表均为两own source/fact0。原R9回声FAIL不因本次成功改写，单条SDK live/history分支仍不补猜。

### 正常关闭、冷恢复与保护

- 已完整读首次 b601nf10p、观察器 b66yixnw1及同安装冷恢复 b627yivlg 的已结束原输出，SHA分别70172e70、4b36e46c、3195da30，与最终round-10相同。首次17:11:56.884+08:00自然exit0/signal null、IPC/closed/sourceStable、verificationError null；原3task/4notice整body、22旧journal物理前缀、config/技能/47source保持，合法新增source1/task1/notice2，assistant/tool/effect77/56/2→93/69/3。原unknown和已消费proof未补造或重放。
- 冷恢复从首次关闭后的4task/6notice、26journal、DB7099a6ab新断点先自检再启原监督，不重跑旧DB87dd/22journal初始驱动。17:14:28+08:00真实ready/完整backfill/HTTP ok，17:14:33.915正常IPC自然exit0。26strict journal逐字相同，digest `4938272d10b84585ae61f64f1d2e6564804edea4298f59b5b071269033408b26`；8业务表相同，新source/task/notice0、assistant/tool/effect仍93/69/3，两个通知send/readback各1，11项产物/复盘/经验/配置/技能保护文件相同。整DB hash改变，不能称整库字节不变；无重放绑定实际业务表、journal、产物和复盘。
- `call_9dba72f7e87d40989de697b304b809cc` 的17:17:10+08:00独立OS原JSON核首次及冷恢复六个精确PID均无、19298无监听、可归属实例进程0。其后拒非空WAL/SHM才immutable/query_only读最终DB a5f94eec，起止hash同；source唯一/v1/actor、triage及消费、任务completed/drained/run1、通知终态及own source/fact0均再核。Review只读原回执，未亲查/操作实例或活库；这些实际退出证据不消除状态查询实现未统一drain的限制。
- 清理由Tests执行：`call_0e88ae2721b44273bd6e666705a4a052` 对两自有驱动精确hash/普通文件/ignored/untracked/unstaged先--check零副作用再apply，`call_e9f5db78271f4165ad812267883533c9` 独立核不存在。本会话另只读exists确认两路径均无；未动安装data、日志、WAL、锁或他人文件，无在途现场任务/第二实例。

### 失败分类、材料与交回

- 两次验证脚本FAIL保留：cbccfb正文校验误传true，48be改传真实quotedMessage成功，未改expected文本；115ed整paging deepEqual误拒合法lastCursor，7e改逐字段完整性/原群/精确mid/作者检查后通过，无新DWS调用。另179cd为Python路径语法错、09f为猜journal文件名ENOENT、e6de为把raw Pi header当logical owner导致Node报错；e6de同shell末尾stop自检成功使外层0，不能当Node通过，551/2bf后续按strict logical header核证。均属验证代码/定位错误，不记产品修复或重发；本地两fixture FAIL及R9 FAIL也保持。
- 首外层newMentionQuoteCasePassed=false原marker保留；它是生命周期/基线保护驱动的占位，冷驱动适配原脚本时明确将该字面量换成independent-completed-receipt。quote/@依据48be/7e独立已完成证明，不借外层exit0抹false。关闭瞬间观察器HTTP TypeError后收到closed自然终态，未因此重启。
- 最终round-10为217行/27464B/SHA `4bf10319ca911c83cb47977af23d1602120ea8ffc7a4105b4a32fde539567d82`；matrix为167case/12列、34174B/SHA `adc4a80ad5939de7f63686f9f87e835e1ac0e0dc23cbb40c3026efc546a47bf6`。本会话独立CSV比较只改8个R10现场格，17个本地格及两FAIL不动；剥R10仍逐字重建R9完整27668B/9f0d766e，R1–R9报告逐字等HEAD。最终材料定向diff --check通过，未建全绿report，不扩跑全量。
- 追加前原review为546行/122209B/SHA `b593cf64258148151e480d29938a26c284490a7ba1eab0f8e8a179c1e9fb5035`，仅追加本节。Review未改产品/测试/goal/报告/matrix，未运行平台/模型/测试、读取秘密或私有技能正文、发送/重放/启停实例、Git写/CI/合并/部署或新增agent/workflow。现交回原review写权；唯一goal.md及原PR最后整合/真实回查由Lead负责，原有限现场完成事实与既有未验/已证风险分别保留。
