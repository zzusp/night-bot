# 第 4 轮：真实模型业务验收与必要修复

日期：2026-11-06。两个既定真实业务用例各自完成：**Web 原会话续办通过；Router A→B、逐文件 fake 交付、交接换代和冷恢复去重通过。** 历次真实失败和本地测试断言错误保留在下表；不是一次统一版本并发全绿，也不是完整 `pnpm test` 全绿。没有新建 `report.md`。

## 范围、版本与安全边界

- 分支 `worktree-resident-conversation-routing`；本轮 HEAD `82a5ae59951034f65054da8fa4e71452809a6225`；基于团队共享未提交工作树，不能只用 HEAD 代表受验源码。Node 24.19.0 / pnpm 11.25.0 / 官方 Pi 1.5.0；Windows 11。
- S6 只写三个独占测试、原真实验收入口、本报告、矩阵及安全证据。Core 修改 service，Platform 修改交接提示，Docs/Lead 分别维护文档、manifest、goal 和 Git。未覆盖其他成员改动。
- 凭据授权已可用。只读准确授权 YAML 所需连接/密钥字段，每进程一次；密钥仅进程内注入 provider，不进入命令参数、日志、异常配置 dump、证据或 Git；不搜索邻接秘密、不搬取其他会话凭据。
- 配置协议 `anthropic-messages`，配置模型 ID 的 SHA-256 为 `54c5bec709983242ac4f5eda4deae369e7e941d79486af94886c9b015c66250a`。这只绑定配置，不独立证明上游实际模型部署身份。
- 每 case 独立临时安装根、SQLite、Host、Pi sessions、fake transport 和收据；业务文件只在任务 work 内。最初同一 Node runner 原生 concurrency=2，并行 Router/Web 两个既定独立 case；Web 完整通过后只补 Router，不新增场景或调度框架。
- 没有真实渠道外发、CI、merge、deploy；S6 没有 commit/push/切分支。用 fake 渠道的实际文件发送/回读证明应用合同，不声称真实 DingTalk 厂商联调通过。

### 源码指纹

以下缩写仅用于本报告表格；起止相同表示该实际操作覆盖的文件起止 SHA 相同。

| 标识 | 文件 / SHA-256 |
| --- | --- |
| S0 | `packages/dingtalk-core/task-session-service.js`：`da4f819d7811ceca3642ea3ca5cb5cb8482ed4b2b5f340fee1758e67a973d4f4` |
| S1 | 同 service，无群 Web scope 修复：`f7c5de388d56456d390aff577854d31c4b7907fa1c06416ddc4616f97977d40b` |
| S2 | 同 service，当前依赖证据入模：`e319fdcf6538df875a385f6e2b54fb728ec8077e696916df5cd1de0e6ab99782` |
| L0 | `src/channels/router-lifecycle.js`：`fb0f402967cc9e01840cda190830d51521d5122df508c53df8885fbe7f01bf40` |
| L1 | 同 lifecycle，仅字符串数组提示补充：`69d3f2b1e20c26cb67e1fbb99901a31805260e687ca89dd0055376b606a7c0d7` |
| D | `packages/dingtalk-core/dynamic-task-store.js`：`d1c165197602825c0b6f800160c4327dbc163b6c89da9745c7cc6b3dfd2526db` |
| R | `src/channels/resident-router-business.js`：`82e3fa265a3f272891b7fcf9bd710c6f8589a47bd7d88c672ca8e7610598dbdf` |
| T | `src/tasks/single-session.js`：`db2f4db08781a99b2e77a982e6c470e6651252ffcb99fde25ab17b4d53eae441` |
| G | `src/channels/router-ledger.js`：`fd5b894db733c82b425fbd08aa11c2029ebb779e97eed8e0e7f0929d0fae06d8` |

真实入口为 `scripts/real-model-router.mjs`（相对此 feature 目录）。各实际版本如下，不将后补断言追认到旧运行。

| 操作 | 入口 SHA-256 | 生产绑定 |
| --- | --- | --- |
| `b4ps4huyd` initial | `7090656858cf046410367522e88447f18ea9a86ee460f179feaaf94f118496ef` | S0/D/R/L0，共入口+4生产起止相同 |
| `bn3bum3oj` diagnostic-2 | `23967c4da862728ecf14bf6d933763c33c99fccdc7d0407c854c40969d83a09e` | S0/D/R/L0，共5项起止相同 |
| `bnl1z3gp9` verified-3 | `a04246cc63b93be5c237314881ea736a010152c7ca42a4a2124accb37b35ca70` | S2/D/R/L0/T/G，共7项起止相同 |
| `bs42r1j18` verified-4 | `7bb8ae39d705ce91181cbc3bd3a0ae5b6013584d6553c8dee444f44ecb66bc14` | S2/D/R/L1/T/G，共7项起止相同 |
| `bgyk4w4fi` verified-5 | `7a448ddce03e04a9d97bf4149f5d7d5d092834a3a35316c1ba02d4168811f0d6` | S2/D/R/L1/T/G，共7项起止相同 |
| `bcfyu5fir` verified-6 | `503d94b5034f0989d2a5ec61045835062c6f64967097942fd2c5d851625b852a` | S2/D/R/L1/T/G，共7项起止相同 |

## 真实操作终态与历史失败

表内 PASS/FAIL 为业务子例；Node 统计还包括父测试容器，不把父容器算成另一个业务 case。所有操作均自然结束，0 CANCEL / 0 SKIP，所有 case root 均 `closed:true, isolatedRootRemoved:true`。无遗留真实 API 操作或观察进程。

| 操作 | 业务结果与耗时 | 原因及结论边界 |
| --- | --- | --- |
| `b4ps4huyd`，两 case 并发 | Router FAIL 398696.1591ms；Web FAIL 29144.7661ms；Node 0 PASS / 3 FAIL 含父；exit 1 | 原诊断只留 generic ZodError / Error、stage=business；不能倒推首个 ZodError 就是后来 referents 类型错误。 |
| `bn3bum3oj`，两 case 并发 | Router FAIL 197566.4577ms；Web FAIL 28417.5476ms；Node 0 PASS / 3 FAIL 含父；总197614.826ms；exit 1 | Router=`router-validation / LIVE_TASKS_NOT_COMPLETED_AND_DRAINED`：A completed/drained，B active/drained/wait，缺当前 A 核验依据。Web=`web-append / group_not_subscribed`。 |
| `bnl1z3gp9`，两 case 并发 | **Web PASS 68878.1696ms**；Router FAIL 357843.0346ms；Node 1 PASS / 2 FAIL 含父；总357853.226ms；exit 1 | Web 完整通过冷恢复。Router A/B 均 completed/drained，但 router-idle 的 `referents[0]` / `[1]` 为 object，schema 要 string，交接失败。 |
| `bs42r1j18`，仅 Router | FAIL 205156.6695ms；Node 0 PASS / 2 FAIL 含父；总205168.0734ms；exit 1 | `router-validation / LIVE_FAKE_DELIVERY_NOT_TERMINAL`。已过交接和 B 当前证据包核验，但原记录未留 notice 详情，唯一根因未知。静态发现 fake transport 缺 sendFile/readbackFile，后补能力，不能认定这是原失败的唯一原因。 |
| `bgyk4w4fi`，仅 Router | FAIL 253201.6017ms；Node 0 PASS / 2 FAIL 含父；总253213.0864ms；exit 1 | `router-idle / ROUTER_HANDOFF_REFERENCE_INVALID`；A/B completed/drained；catch 快照 send/readback/fileSend=0、notice=[]。两次 reply 完成日志均在 failure 之后，与快照不矛盾，不能归因为生产接线错误。未到附件断言。 |
| `bcfyu5fir`，仅 Router | **PASS 221114.6355ms**；Node 2 PASS / 0 FAIL 含父；总221128.6868ms；`GROUP_EXIT:real-model-router-verified-6:0` | 当前版本逐文件严格闭环、native 当前依赖输入、handoff generation 4、冷恢复/原消息去重均通过；详见后节。 |

verified-5 未保存具体被拒 handoff refs、同代请求元数据及 lookup；原隔离根已清理，不能复原。模型虚构引用、提示未给合法 ID、合法同域引用被误拒三个候选均未由旧记录排除，**历史根因未收敛**。未据错误 code 盲改生产/提示/引用 guard；最终通过也不解释历史失败或证明模型稳定性。

原 initial、diagnostic-2、verified-3 Router、verified-4、verified-5 的七份旧 JSON 附件按保留规则清理；其结果、关键错误、版本和必要文字证据在本节保留。第四轮当时仅保留最终 Router 和已通过 Web 的两份安全 JSON；这两份旧轮附件已于第八轮按归档规则清理，原结论及下文必要文字证据保留。未保留整库、journal、业务文件、原始模型正文或旧附件备份。

## 必要实现修复与本地定向验证

Core 的无群 Web 修复复用创建时的 `task:<taskId>` 来源域；有群仍要求真实订阅，不能在测试加假群绕过。依赖修复复用 `packet.task.dependencies`：只交当前本任务入边、当前前置 completion、Host evaluation/完成事件及授权来源版本/actor；先严核状态、scope、版本和事件/收据身份，不把 A journal、全来源正文或全图复制给 B。`task.claim` 原先返回 raw task，不能拿早先富化 query 或 fixture 读取代替实际入模证据。

Platform 只在原 handoff 提示说明三个 section 必须为非空字符串数组、无内容用 []，不接纳 object、不转换对象、不放宽 schema/预算/引用/commit/CAS/abort，不增加重试。

| 操作 | 本地真实 Host / 官方 Pi + 脚本模型结果 | 版本和保留边界 |
| --- | --- | --- |
| `b9jlz4xwd` → `b3qjurib1` | 新 personal Web case 初次 FAIL 11828.1016ms（测试误把持久 groupId 的 null 期望成 undefined）；改为 null 后1 PASS / 0 FAIL/CANCEL/SKIP，25925.616ms，总28800.9095ms，自然exit0 | PASS 绑定 S1，不冒充 S2 完整复验。覆盖同 session write/read/wait→真实 Web preserve、精确新来源、原字节、无重做、task-scoped request replay/conflict、reopen、cancel、有群未订阅仍拒绝、零渠道外发。 |
| `be3089how` → `b12uxzj56` | 原 A返工→B case 首次新断言 FAIL 36770.9242ms：误期望裸 alice，实际是认证 namespace actor。修后1 PASS / 0 FAIL/CANCEL/SKIP，38882.7732ms，总47371.7712ms，自然exit0 | S2和测试起止同。A req1 preliminary→continue，原 A session req2 verified→satisfied，B唯一执行一次且双方completed/drained；从 B 官方 admission/enqueued packet 回读当前依赖、event、授权 namespace/source/version，旧 proof:preliminary 不入模；A输入dependencies=[]；errors/toolErrors均空。 |
| `bg8ba8zty` | 2 PASS / 0 FAIL/CANCEL/SKIP，总52252.6886ms，自然exit0；正向37099.5567ms，referents-object负向8427.9668ms | L1/flow测试起止同；四处置、unknown短回复、tool-free换代/冷去重通过；对象摘要仍拒绝、原代/游标保留、无candidate、无任务重放。未重跑其他旧flow/Web/全量组。 |

三个测试最终 SHA：

- `test/pi-single-task-initial-input.test.js`：`6c2af5e47c9938f45dc891e86142d4313ca5ffca323aeb269cbf5668a4d1b796`。
- `test/pi-router-task-e2e.test.js`：`b07c24091b1aa86aedd146cf44d680419c2adcf3fa3988f10c6d1fc34cee3e4f`；原 actor 错误中间稿为 `5f494093734f7eb4c362dc39c8ff885ce724b9fef21d2c744ba756bfa9a1c826`，其 FAIL 保留。
- `test/pi-resident-router-flow.test.js`：`06cccbb2fc1f084169f1e653d81c0d78e59a5547dee5e288e476d84e8dd8dc6c`。

### 原入口的必要安全与证据修订

- YAML 解析前尚未注册秘密脱敏，原 parse error 可能拼原行。现未就绪只输出固定 `LIVE_CONFIGURATION_INVALID`，不输出自由 message/issues/cause；配置就绪后才允许选定字段并脱敏。不复制配置全文。
- 纯合成坏 YAML 实跑：exit1、controlledError=true、inputNotDisclosed=true、temporaryFileAbsent=true、modelRequests=0；合成 sentinel/原坏行均未输出。临时文件已独立确认不存在，未用真实凭据制造故障。
- 用 tools/execute 的 next 前序号证明 B 尚未开始，而非只比较 tools/result 的完成顺序。精确文件 readback 关联官方 assistant 的 read path→callId→同一成功 toolResult→预期内容；Web 续办还要求 read 在原 journal 切点之后。
- fake sendFile 读取 Host resolve 的冻结文件，验证 artifactId、实际 bytes SHA/size；readbackFile 校同 deliveryKey/ACK messageId/完整 descriptor 指纹。最终断言逐当前 A/B task/req/完整 descriptor→唯一 file notice→父 taskDelivery 选择及父子 delivered→实际唯一 sendFile→同 key/message 回读→持久 ACK/receipt。文本或 cancelled 不能替代文件完成。
- 零 API 负检查实跑了新增 `requireFileDeliveries`：两条完整链被接受；全文件 cancelled、A重复而B遗漏、stale requirementRevision、错误持久 messageId 四种反例均按具体 code 拒绝。filesWritten=0/modelRequests=0。这只是验收谓词检查，不代替真实 Host/送达验证。
- 失败 catch、close/rm 前的受控诊断按 aborted rotation→同 ID internal admission→唯一 native business-input→对应首 assistant 配对，严格核 header 的 id/conversation/generation/runtimeOwner，原请求的 identity/cutoff/requiredSourceIds 与 rotation。仅保留安全 abortCode、cutoff 是否相同、refs 的存在/scope/hold/version；未知/外域引用只留哈希，不留正文/路径/完整 journal。配对失败明确缺证，不覆盖原失败；不把坏 response cutoff 改写成新错误。该路径经限定静态审查，最终成功运行未触发其失败分支，不能称它已在最终真实失败上动态验收。
- reply 请求只留哈希，实际返回通知 ID/状态及原 sequence 单列；失败快照明确为清理前。最终 JSON 留有 prepared 收据与后续 delivered 身份链，两者不混为一谈。
- 最终入口 `node --check`、`git diff --check` 通过；verified-6 前 `--check` 实际输出 effects=0/networkRequests=0/temporaryRootsCreated=0/concurrency=1。运行期间入口及六生产文件冻结，自然退出后再归档。

## 最终真实业务证据

### Router：verified-6

原附件 `round-4/verified-6-router-result.json` 已于第八轮归档时清理；本节原结论和必要文字证据保留。开始 `2026-11-06T15:40:50.574Z`，结束 `2026-11-06T15:44:31.615Z`。唯一原子计划创建 synthetic-calc-a / synthetic-report-b，均 req1、completed/drained，session 不同；两次 write/read/task_result 完成实际文件与核验。

- 同一当前 dependency 的成功 `resident_dependency_evaluate` 结果 sequence=27，B 首工具的实际 execute 开始 sequence=28；不是拿 B 工具结束时刻推测先后。B 官方入模 packet 含 A 当前 completion 和对应 satisfied evaluation。
- A 文件为 SUM=42，B 文件含 VERIFIED_SUM=42 与本次随机 marker；实际 read toolResult 与目标路径/callId 对齐，且冻结 descriptor SHA/size 等于工作文件实际字节。
- 四个通知全部 delivered（A/B 各解释文本+文件）；不是只用 sends=4/readbacks=4/fileSends=2 判通过。两文件身份摘要如下；每项实际 send/readback 的 deliveryKey 均等于该文件子通知 ID，父通知由 taskDelivery 显式选择该 task 当前 artifact。

| task / req | artifactId | bytes | send/readback/ACK/receipt messageId |
| --- | --- | --- | --- |
| synthetic-calc-a / 1 | `f22ba5115161eae588ef8cde38ee6b0f39f6d843e98ae2b0e01ef8cd53ee5821` | 6 | 四者均 `fake-visible-2` |
| synthetic-report-b / 1 | `096cc5163e52823f15094acff6bd7cc25f08aa80d63e7748764d68aaa0d05717` | 69 | 四者均 `fake-visible-4` |

A 内容 SHA=`2e975eb1c209f7809b5513e2dec1affc73fc2626ba97d3d0e5a2fe6b6bed5b1b`，完整 descriptor SHA=`3d8e837c6b9ea85946930c4d890d91c62057eb6ca5cc046156ef07da2e6b2a29`。B 内容 SHA=`f79e49435f56d923a2c3f153d68386b5faf47476b2fac850848de53e192a6346`，完整 descriptor SHA=`7b6862b948243618c3749801d3b49b3166168aecc562dbabb94905af10d4bed9`。每项与 expected descriptor、实际 sendFile/readbackFile 及持久收据逐字段一致；没有拿 A 重复交付代替 B。

- Router 当前 generation=4、phase=active、pendingInputs=0，经过原生产 native commit/换代检查；两个任务 actor 均释放，execution.list为空。
- 冷恢复后重复原认证消息：任务数量不增；两任务 journal 字节、全部 session 的 assistant 总数29、工具次数和 fake send/readback 次数均不变；没有重放业务或交付。
- `agentErrors=[]`。原输出保留**两次中间 `ROUTER_EVIDENCE_REFERENCE_INVALID`**，模型继续查询后第三次 satisfied 成功；不能写成零工具错误。先前引用 guard 未放宽。
- cleanup 报告 `closed:true, isolatedRootRemoved:true`，本例自然 exit0。Review 已独立回读实际最终 JSON、逐项身份链、原输出及7项起止指纹；没有据成功回执代替交付证明。

### Web：复用 verified-3 完整 PASS

原附件 `round-4/verified-3-web-continuation-result.json` 已于第八轮归档时清理；本节原结论和必要文字证据保留。本例在同 runner 与当时 Router 并发启动（PID97896，两 case 开始相差2ms），开始 `2026-11-06T14:52:24.156Z`，结束 `2026-11-06T14:53:32.967Z`，68878.1696ms。

- 无群初始 Web 输入：实际 write/read BASE 后 wait；后续认证新 Web 来源按 preserve 进入原 session，原 BASE 字节与 journal 前缀保留，只追加 NEXT 并实际 read 核验后 completed/drained，req保持1。
- 同任务 `task-159d01fa5aba129068707b15c723ae41`、同 session `task-session-39b943de-e8c2-44d3-bec7-a083d4e92b30`；frozenOutputs=1；零渠道通知/send/readback，无拆分执行。
- 冷启恢复与重放相同 Web request：task journal、assistant总数7、工具和交付计数不增。工具次数 write1/read3/task_result2/edit1；agentErrors=[]；cleanup两项true。
- 绑定 S2/L0 及当时 a042 入口；后续 L1 是 Router 交接提示变化，Web 未重跑。与 verified-6 各自结论并列，不拼成统一入口/版本/并发全绿。

## 检查、遗留及再生成

- 复用 Lead 针对最终 S2/L1 工作树的实际 `pnpm check` 自然 exit0：194 retained / 53 adapted、404 production/runtime JS、190 imports、0 external SDK/旧编排定义；manifest保留原上游sourceSha256，只绑定adapted当前哈希，guard未放宽。S6没有将旧版guard或HEAD代替当前受验源。
- 第3轮 routing 59 PASS、runtime受影响12 PASS、default受影响10 PASS，以及原完整 runtime/default 的 FAIL/CANCEL/源码漂移/准确worker强停记录继续保留；本轮未重跑这些旧组。第2轮 containment 5 PASS/17 SKIP 及Windows平台未验边界也不改写。**本轮不是统一版本全套测试全绿。**
- 本轮新增入口/三个测试与报告仍为未提交工作树；Git提交、目标分支核对、push及原PR更新由Lead收口。没有以本轮验收授权真实消息、CI、合并或部署。
- 原 verified-4 唯一通知失败原因、verified-5 具体坏引用仍未知；最终原Router用例完整通过，不代表这些历史原因已修复，也不代表对模型随机性或生产厂商作统计/上线验收。失败诊断新分支的真实坏ref动态结果未取得。
- 历史round-1/2/3、矩阵历史列全部保留。最终证据目录仅保留两份安全JSON；旧七份失败JSON已由本报告自包含摘要替代并清理，不另行备份/搬移；没有保留运行数据库、凭据、业务文件或原生journal。

再生成仅使用原入口、准确授权的配置路径与新的attempt标识；已有结果用wx拒绝覆盖。以下为PowerShell参数形态，先--check再实跑；真实调用仍受本任务授权边界约束，不自动改成真实渠道。

```powershell
$entry = 'docs/acceptance/resident-conversation-routing/scripts/real-model-router.mjs'
$approvedConfig = '<明确授权的本机配置路径>'
$attempt = '<新的英文小写连字符标识>'
node $entry --config $approvedConfig --case router --attempt $attempt --check
node $entry --config $approvedConfig --case router --attempt $attempt
```

本次没有为了重新获得已通过的结果重复运行Web、全量组或厂商联调。第四轮原交付包含本报告、矩阵round_4和以下两份安全JSON。两附件已于第八轮按归档规则清理，原结论、文字证据与矩阵历史不变；以下仅保留清理前指纹，不再表示附件仍可读取。
- `round-4/verified-6-router-result.json`（已于第八轮清理）SHA-256：`a5879141ccdcdfbad70627f56a69ce24dd16e1ef1419338dffede7d803affe7e`。
- `round-4/verified-3-web-continuation-result.json`（已于第八轮清理）SHA-256：`fe9802aa4e669aba740f90d213145bd4e22eb2638a4ed6896ff0e10a9211f72e`。

提交行尾说明：verified-6 实际运行入口 SHA-256 仍为 `503d94b5034f0989d2a5ec61045835062c6f64967097942fd2c5d851625b852a`；提交版入口仅将 CRLF 归一化为 LF，SHA-256 为 `3c466e00d549a7b00d02e4e2a9475759a47c034713d09b93cdf423041985a57a`；此次未重跑 API 或业务测试，历史运行指纹与矩阵结果不变。
