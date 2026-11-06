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
