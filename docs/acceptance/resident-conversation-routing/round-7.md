# 第七轮：正式停用与独立交付验收

## 阶段末结果

- **指定群独立事项已完成实际交付与持久复盘，必要冷恢复和正常排空已核证；不再等待真人输入。** 原Review/Lead接回报告、矩阵与原回执后负责整体审查及原PR收口，Tests不代判长期目标或Git交付完成。
- 新事项 `sg9-independent-20261107-02` completed/drained、独立session/workspace、无旧依赖；本群中文文本及48字节附件已实际平台status/mget/下载核对，同完成event复盘done/attempt1。原任务取消和unknown保留，历史失败不回填成功。
- 实际业务入口为 `2e340e7b`；同安装顺序冷恢复为 `522be99d`，自然exit0、15项源码稳定、closed观测落盘，15份严格journal/assistant、两收据、复盘和产物不变。停止后缓存窄修为 `6f44710a`，仅隔离actual apply/atomicWrite验证，未再次起真实实例。三版分别绑定，完整SHA见下文。
- 坏observer未保存新消息的原始实时event快照。实际平台消息、认证source/version/actor、持久ingress及消费链成立，但无法区分该条当时由live event还是同实例补读接入。保留此观测盲点，不伪造快照或重发消息；POSIX rename后目录sync故障也未动态注入。
- 以下前阶段各节保留待输入时历史事实与完整源码表，本次终态见“新独立事项实际终态”及后续章节。没有新全量或全平台全绿结论，不建立全绿report.md。

## 前阶段范围与结论（待输入时快照）

- 对应唯一 [goal.md](goal.md) 的 SG9，前阶段记档时为 **WAITING_INPUT_NEW_AUTHENTICATED_SOURCE**。旧事项正式取消、取消后冷恢复不重放、最终真实补读已经核过；新独立事项尚无真人 SDK 入站。监听就绪、本地 PASS 或旧事项取消均不代表新交付完成。
- 真人新增授权为“停用旧事项，独立完成交付”，仅原安装及指定 Night Bot Test 群；Tests 仍为唯一真实执行者。无第二实例、Web/SDK 注入、自发自收、其他群/私聊、全局账号变更、生产部署、合并或 CI。Git/原 PR 仍由 Lead 整合。
- 旧事项 `sg9-live-20261107-01` 已正式取消，原 session `task-session-405bdad6-5215-4b76-a879-073a46d93d88` 与原 source/version 保留。原未知 find 意图没有 effect-result、effect-reconciled、owner-drained 或 owner-drained-inputs；取消不结算 unknown。[round-6.md](round-6.md) 的失败与 BLOCKED 冻结，不回填成功。

## 停用前权威只读基线

- 原 SQLite 为 active/control active/drained=false、recovering=false，requirement/control/lease/run 均 1，无取消/reconciliation；原 source v1 routed、triage committed，唯一 Router source.message 已 consumed、无 pending。task.json 只是派生快照，不是权威或恢复命令。
- 首次 Node DatabaseSync(readOnly:true)+query_only 创建了空 WAL 与 32768 字节 SHM，前后指纹守卫失败；未将该尝试宣称零副作用，未删除旁车。之后仅在 WAL=0、无 rollback journal 时，以 Python mode=ro&immutable=1、query_only、BEGIN/SELECT/ROLLBACK 只读，前后 DB 与旁车指纹相同。主 DB 当时 684032 字节/SHA `7fbf07776bd26696c1ad1bc0a0f6cb6b536424ec105a6393e27559f5ae97a5f8`。
- 原权威回执：task `call_8805741b608b41f393c5ec309c4c54aa`；source/inbox `call_5e38bb2c23414b8687826992b297d0fb`。本次落档未重复查询这些基线，也未对活动 WAL 使用 immutable 读取。

## 默认组合、正式取消与冷恢复

| 操作 / 原回执 | 真实结果与边界 |
| --- | --- |
| bnsc8k1u2 | 原 --check：effects=0、identity=verified、groups=1、credentialRead=false/network=false。随后原安装首启自然 exit1，新增错误为 `cannot get property "piAuthority" without inject`；sourceStable=true、keyInPrivateLog=false。没有取得 cancel 回执。 |
| 失败后权威读取 | 19298 无监听，该 supervisor/launcher 及其子进程均无。旧 journal 未变；SQLite 仍 active/control active/drained=false，recovering=false→true、updatedAt 改变，control/lease/run 仍 1，无取消。immutable 读取前后指纹相同。这是启动技术写入，不是取消或效果结算。原回执 `call_03afd45777fa44699755a52d80650518`。 |
| Core 最小修复 | application inject 仅补已有 provider piAuthority（最终 cc9f8b30），未改启动顺序、unknown/drain/授权。最终语法及空白检查通过；下述原安装真实冷恢复覆盖默认组合，没有另起副本。 |
| b9babylpk / bvqb61r6n | 修后控制 HTTP 200。首次 recover 合法 claim 到 lease2；旧任务 blocked，limitation=`TASK_EFFECT_UNCERTAIN_NO_REPLAY`，旧 session 工具未执行、journal 不变。不能要求首次 recover 的 lease 不变，也不能声称全实例零模型：Router 曾产生实际状态文字。 |
| 正式 cancel | 先 GET detail 冻结 controlRevision=1；POST `/tasks/sg9-live-20261107-01/cancel`，固定 requestId=`sg9-stop-old-20261107-r7-01`、expectedControlRevision=1。仅一次 POST 200、独立 GET 200：cancelled/control cancelled、revision2/lease2/run1、drained=true、recovering=false、notifications0。reason 参数未被 service 写入持久 command，不宣称该文字已审计。 |
| b9babylpk 停机 | --check --stop 后仅走 supervisor→launcher 正式 IPC，自然 exit0、ipcShutdownSent=true、sourceStable=true、keyInPrivateLog=false；application 启前/停后 cc9f8b30 相同。 |
| b095xqafp 冷启 | 同安装保持 cancelled/control cancelled、revision2/lease2/run1、notifications0；旧 journal committedBytes=totalBytes=45111、assistant2、task audit 仅 identity+effect-intent、旧 session 工具0。取消后基线未被新 claim 或旧业务重放改变；此时 listener ready，但 backfill 有下节的真实冲突。 |
| b095xqafp 停机 | 冲突取证后正常 IPC，自然 exit0、sourceStable=true、keyInPrivateLog=false；19298 无监听，该 supervisor/launcher 及其子进程均无。旧 journal 不变，停机后才交还产品写权。 |

正式 cancel/独立 readback：`call_c38ba4bc610b4eaaa70cea39786f82c7`（2026-11-06T19:39:57.476Z）；完整取消后冷恢复：`call_148d8ad99507400ebf47b97ed855044b`（2026-11-06T19:42:06.686Z）；冲突后正常停机：`call_6f6277280e25452191044eaf5810245a`（2026-11-06T19:45:33.383Z）。

旧严格完整 journal 一直为 45111 字节/SHA `ad7062f54993597bdc74d23a4c2b31a666d578240c3630e2fd46a7c92b5c9d15`；原工具 callId=`call_OURs5Srraq18SF6JFmHNjmO7`，intent key=`793847e0630d393ac07214f8c53491a13491ba7f5877f1d5682ffacd8d6160b6`。SQL drained=true、新 marker 或新成功均不能补成原 producer 排空证明，旧 unknown 保持未关闭。

## 自消息补读冲突与必要修复

- b095xqafp 的 backfill 实际报 `CHANNEL_MESSAGE_ID_CONFLICT`。冲突对象是恢复后 Router 已 delivered 的状态文字，taskIds=[]，不是原真人消息，也不是目标文件交付。消息 ID 仅保留 SHA `2daace504611bef510f1c5c84a657478e517ff2483621ca22a8591323575ea93`，不复制私有正文/群/账号标识。
- 同 profile 真实历史读取仅覆盖该事实时间前后 5 秒，complete=true、hasMore=false、failedCount0，精确匹配1条，正文与 outbox delivered notice 相等。fact v1 的 payloadHash=`f5562f2c5d4c0a5306823b8b5c993c535ae01c832dabb851a5ff4dda196d2cf0`；history 归一后=`b33fc5d880d8f04c0e826d9365b60c498e26f5004490e7f1955a264dc44443c7`。
- 保持 principal/text/resources/quote/mentionedAgent/mentions，仅将 history 的 platformFlags 从 `{messageAiSendFlag:'DWS',automated:true}` 改为 `{}`，精确重建原 hash。contexts 没有原 raw envelope，不能据此证明首次登记来自实时 event 还是某次 history。原回执 `call_066780641f7845229a8eab106b4c58ed`（2026-11-06T19:44:34.706Z）。
- 原统一入口先 registerConversation，之后才按持久收据判断 own-notification，因而平台后补 flags 先触发事实冲突。首版六字段 hash 补丁会拒绝当前安装已存的七字段事实；Tests 静态找出反证、Lead 独立确认后拦截。该版未上现场、未跑对应测试，记 STATIC_REJECTED_NOT_EXECUTED，不伪记测试 FAIL。
- 最终 `src/channels/service.js` 保持原七字段 hash（含 platformFlags）及 authorizeInput，不删除、迁移或重算旧 fact。DWS 插件仅在认证/typed envelope/命名空间验证后、receive/register 前，复用精确内部 conversation+平台 messageId 的持久 outbox/receipt 过滤。非 own 原样 receive；不按同账号、正文相同或 DWS 标记泛过滤。

### 最短本地回归

操作 `bj02xs18s`：`node --test --test-name-pattern="durable receipt echoes tolerate later DWS flags" test/pi-resident-router-flow.test.js`。最终 case **1 PASS / 0 FAIL / 0 CANCEL / 0 SKIP，自然 exit0**，业务 23685.7385ms、Node 37484.4968ms；10项产品/测试 SHA 起止一致。

- 真实 Host、SQLite、Pi、loopback 脚本模型与实际 DWS 插件入口；仅外部 DWS send/status/mget 是内存 fake，没有真实 DWS 调用或 listener。
- 经真实本地发送/读回路径形成 durable delivered receipt；复现原部署已登记的七字段 fact，再冷恢复。同 ID 后补 DWS flags 命中精确 receipt，旧 facts 不变、source/model/send 不增。
- 非 own 同 ID 的 text/actor/flags 改动仍拒绝 CHANNEL_MESSAGE_ID_CONFLICT；相同 ID 跨群/跨 channel 不误认自消息。同账号/同文/DWS 标记但新 ID 无 receipt 仍接入。最终 source4/task0，发送次数不增。
- 最终 original/echo 显式使用 dingtalk-dws；Platform 曾提出的默认 channelId 疑点已撤回，不记实际失败。仅运行该新增 case，没有旧组、全量或重复 guard。

## 真实补读就绪与恢复入口

- 最终受管运行 `bmpv0tlos` 使用原安装/原配置/原 epoch，supervisor73972、launcher53972；入口先 --check 后 --start。配置 SHA=`cb7aca3948dc952948459a806bd82a2cd04c521db942672b9a69cc525cdc602b`，ingressEpoch=`2026-11-06T17:57:44.948Z`，groups1、direct/operator false。没有重配、倒退时间、另查账号或复制第三方凭据。
- 原就绪任务 `b6kvdjing` 自然 exit0；独立 ready marker 时间 `2026-11-06T19:56:41.722Z`（北京时间 **2026-11-07 03:56:41.722+08:00**），health200/status ok/modelMode real/recoveryIssueCount0；listener.readyAt=`2026-11-06T19:56:39.484Z`，backfill.succeededAt=`2026-11-06T19:56:40.493Z`、state ok。HTTP healthy 没有代替 SDK ready。
- 后续 `call_9692e5e9e1584acf935b05dce1b402e3`（2026-11-06T19:57:02.413Z）再次绑定配置/epoch/journal，backfill.succeededAt=`2026-11-06T19:56:59.813Z` 仍 ok、tools0/errors[]。旧 task 仍 cancelled/revision2/lease2/run1/notifications0，旧 journal 完全不变。
- 前阶段记档时运行尚未关闭；当时不能给 bmpv0tlos 填最终 exit0/sourceStable/keyInPrivateLog 结论。b6kvdjing.output 前段重复携带本地回归结果，其中 sourceStable=true 属于 bj02xs18s，不是当前真实实例退出证明。
- Monitor `b8ouup508` 为原工具结果、监听/补读错误与受管进程终态的通知入口，只读、不发消息、不调用模型；到期接回后按实际等待需要续建，不把30分钟当整个任务时限。bmpv0tlos 退出由宿主后台任务通知，不能另启副本或用轮询 output 冒充推进。
- 前阶段记档时新真人 SDK 事项尚无新 messageId/source/task/session/workspace；新事项建议 marker=`SG9-INDEPENDENT-20261107-02`，已交 Lead 协调同群真人一次发送。不是重新索发送授权，不能以 Web、SDK 注入、自发自收或旧 source 重放替代。
- 后续仍沿本轮：核新 source/version/actor 与独立 task/session/workspace、无旧依赖/clone/reopen/attempt 复用；生成并读回 work/sg9-live-check.txt、Host冻结 descriptor/hash；完成真实同群中文说明与附件、status/mget/附件回读及 durable delivery receipt、同 task/event 无工具持久复盘、精确回声去重，最后正常 IPC 排空及必要冷恢复不重放。当时上述新业务均 WAITING_INPUT/NOT_RUN，不用本地 fake 或旧 Router 文字补齐。

## 受验源码与证据归属

环境 Windows 11、Node 24.19.0、pnpm 11.25.0；本轮受验基线为 HEAD `d27350972df888bf864186eabe64513c12460382` 加共享未提交工作树。落档时已有 staged 协作增量，Tests 本次 round-7/matrix 尚未提交；不能只用 HEAD 代表受验字节。以下完整指纹本次落档前独立比对相同：

| 文件 | SHA-256 |
| --- | --- |
| `config.example.json` | 99acbc412d3edc9ce6f1ed59329b3b05d193d912fd2219f150c86aa1435798ab |
| `src/config.js` | 673c669068264a467d8715d923af95e963bfbac45c47b3de774234b8cc99df2a |
| `src/application.js` | cc9f8b30b02c4a8b16acae8b3d8b4496292027c03d81ba32aaacbf1d2ee6bf0b |
| `src/channels/service.js` | bdb1a84d28910fc6548d3926bfca3589c993961e8e0115cf0a643cc19613e10d |
| `src/channels/plugins/dingtalk-dws.js` | 101c7010f2d2ca2d41f5ab89a12eccdd98bdd4873d33512932fca83cf94346b6 |
| `packages/dingtalk-core/task-session-service.js` | 866966b8c97d69a09acfc40dbe7dc0569b2162e0378fdc6fd7e65d2a25a7a5d0 |
| `src/channels/resident-router-business.js` | edc2c1d72f7b3c80fd0f212dec710a96dca51ea026cbc489e20088bfb2a70c4f |
| `src/tasks/single-session.js` | a141811f1ecabb6ddbef2adde684e50e0920488ac513bee7a4e3804d68c1f0da |
| `src/native-tool-fs-search.js` | 729f6336ba0266cc6f1d2f324d4f885627673786db3e9cedc174bd3330b09b70 |
| `src/tasks/effect-scope.js` | 91673a8568ecd1dcfa16cc17a76d363526c8baa92ae22b58f29198beb6afeedf |
| `src/memory/reflection.js` | 8876dfc80f3687dca77b5fad16088e6c1e43fc838d17cc3eddc45d5e4aabff01 |
| `src/memory/reflection-inference.js` | 8c945064b9fc82a22864a140f054de8e7e88d0b4fd4c29ede042f1ea92124c39 |
| `package.json` | 4fda002d0c72c4248d343abdc94cbca8e4f9132ef5e67e796ea4b706332c41dd |
| `pnpm-lock.yaml` | 833f4d06c3b458679a2f7b6b8c0d32d781e2bc5b3ccd6bd8a118ea70bc20a30b |
| `docs/acceptance/resident-conversation-routing/scripts/live-channel-instance.mjs` | 2e340e7b0bfadcc15c1927b4b6e95332dfb56ffcf64f850ad8c517992b12c5a5 |
| `test/pi-resident-router-flow.test.js` | 0f28cf6789dc9a631be10864f34fc2ec86e1b83eb9cf904e2216b05cf4624a0b |

- 原入口14项包含入口自身；application 在前两次成功运行额外以启前/停后 cc9f 独立绑定。仅在实例停止后扩为15项（14项产品/依赖+入口），最终 bmpv0tlos 使用该入口，没有在现场运行中改受验产品或入口。
- Lead 的 app 修后 guard `bao28nmzs` 与最终 plugin guard `b3r3usfxq` 均已独立读原输出：自然0、14/14起止同、whitespace0；194 retained/53 adapted、404 production/runtime JS、191 declared bare imports、0 externalSdkImports/legacyOrchestratorDefinitions、legacy source verified5/历史格式 removed9。前者 plugin75d6，后者 plugin101c/app cc9f；不以 round-6 的旧 guard 代替最终插件版本，不增加映射或放宽守卫，Tests 未重复运行。
- 本轮新增回归唯一受验 test 为0f28cf，旧搜索/单事项等测试与第六轮证据复用，没有重跑。运行中 tools0/errors[] 只是相应时点的实际观测，不预测之后永远为0。
- 原宿主 output 按操作ID定位；本会话 transcript UUID=`8d59080e-5ce2-49dc-827d-2663d26a6778`，配合本文 tool_use_id 可独立回读。真实就绪任务的 tool_use_id=`call_76ff375e5b9e4c23b65750234ec39c4f`。只保留必要文字摘要，不复制完整日志/journal/DB、真实平台正文、群/profile/模型连接或凭据入 Git。
- matrix 本次追加 round_7 与14条必要记录；原74数据行的原8列逐项保留，其 canonical JSON（UTF-8、ensure_ascii=false、紧凑分隔）SHA=`26cb4e5000ccff97e231a2090ae0b91ee80dde2e879e7927c58751da7aee5a52`。原 round-6 文件不改，不建全绿 report.md；该阶段新交付仍 WAITING_INPUT。
- 本轮无新增日志副本/截图/dump/单轮fixture。原实例、配置及旧unknown档案仍用于当前运行和恢复，保留且不入Git；本地fixture沿原teardown清理。该待输入检查点已在下文沿本轮阶段末集中补完，未逐事件刷新报告。

## 新独立事项实际终态

- 真人标记 `SG9-INDEPENDENT-20261107-02` 的平台消息时间为 `2026-11-07T00:57:40.435Z`（北京时间08:57:40.435），source receivedAt=`00:57:41.469Z`；channelType=chat-room/channelId=dingtalk-dws、version1、automated=false。消息ID SHA=`20e2978a82140a331cbacd934df8a9a2270df189c7f68cea7af06c02131b702b`，source ID SHA=`82c05d23134203116502be3bbeda4bc67d074a9d879382d2e5b2cfdb0ac38b0e`。同profile实际mget的原生sender经既有 `channel-actor-` + SHA(JSON([channelId,senderId])) 严格等于ingress principal和task.owner；不按昵称/后缀映射、不改身份合同。
- triage committed/needsHandling=true；Router source.message于 `00:57:50.220Z` 建立，consumed、processedCursor5/generation4；source settled、processing issues=[]。Tests没有Web/SDK注入、代发真人请求、复制/reopen旧任务或另起实例。原监听曾真实ready且持续在同安装，但坏observer没有这条消息的最新raw event/lastEventAt，不能仅凭source-read span推断live/history分支。
- 新task=`sg9-independent-20261107-02`，session=`task-session-83c5ac6e-8ade-4da8-9697-74cc186af6ea`，安装相对workspace=`data/workspaces/tasks/sg9-independent-20261107-02`；source/session/workspace均与旧事项不同、dependencies=[]。createdAt=`00:58:10.887Z`、completion.at=`00:58:27.639Z`，completed/control active/drained=true，lease/run/controlRevision均1，blockers的executions/operations/legacy均空。
- 新task journal严格 `decodePiJournal(...,{codec:portablePaths(runtimePaths(config)),requireComplete:true})`：49968字节全部committed，SHA=`e3be3784a04b7c4bae55ce305b2c59caa013b2ca533fa70b1c9149a1aeac42a5`、assistant3；工具依次write/read/task_result，三个toolResult均isError=false。write有一对effect-intent/result，read不另造副作用意图；没有raw JSONL回放、删尾或修账。

### 文件、冻结产物与平台实际读回

- `work/sg9-live-check.txt` 实际48字节、精确两行：`SG9-LIVE-20261107-01` 与 `真实群消息闭环验收`，无末尾LF。SHA=`1c2ec48694affb8c6414695062b6b46c9f3c5d031211a18770e6f5f526c97d69`；work、Host冻结输出及平台实际下载字节相同。初次验收预设末尾LF的断言失败，随后按用户“两行”合同修正谓词，没有改业务文件迎合测试。
- artifactId=`c63548db4dd08fab324015c09d94d6479f60dcb7ead16efe3a2d5fb28fd4c453`；冻结输出在task的 `outputs/<taskId>/<artifactId>/sg9-live-check.txt`。descriptor requirementRevision/version1，producer.runId同新task、nodeRunId同新session、outputRef=single:1、role=final-delivery、size48/SHA同上；descriptor585字节/SHA=`153428e844282438ce1d15a35a8daeb3e55a18aaaea9a5824a41874ec1ab8961`。
- notification主ID=`router-operation:f3df9778a9d332746a2a292dc008f035ee7dc4618ac98faaec94a3aee21a3430`，附件ID为主ID追加 `:file:<artifactId>`。两者delivered、sendAttemptCount1/readbackAttemptCount1；deliveredAt分别为 `00:58:44.882Z`/`00:58:49.295Z`（北京时间08:58:44.882/49.295）。完成与送达分别核对。
- Tests使用既有adapter、writesAuthorized=false再次平台只读核验：文本于 `01:09:55.780Z` status SUCCESS、complete mget、sameDeliveredText=true，正文SHA=`9759ca49f364cb50a58ccdb62e934ce1128b859671c90a63e3d54b0325f0c602`；消息ID SHA=`f9c0a42ca9d73b0a896ca83b1758b00f9e0fdb213d4ac68e8fd95c69a06afe87`，evidenceRef=`notification-readback:af99a9d3c18f1c3ee06c06bbda8a281333d9adfcfa4f0d1c0d233ba6ca4ea82b`。
- 附件于 `01:09:58.023Z` status SUCCESS、complete mget、精确resource及实际重新下载48字节/SHA均同descriptor；消息ID SHA=`aaa48236fd34ef6bb86efbcdd5bec455731421ba9c9ffefb7104bee10e259ab5`，evidenceRef=`notification-readback:6c72ecd93b4c27e2f37cb4fd46fd7977f0310c5d891f3a455cf66a1296e84b33`。临时下载由原adapter finally清理，没有再发送。
- 两receipt JSON SHA分别为 `6d1895307169fa831218739c2bceea3beaed34f737f709cf87b8a2781866bf8b` / `0a6c5fbe891ca4f7787dd8cc7b81a9b4e26a210810fded841b7549abf0e7e627`。首次两个平台断言误把内部conversation与外部群、内部principal与原生sender直接比较，均失败；依既有namespace转换修正验收投影后通过，产品/持久身份未改。不以status或receipt替代正文/附件实际读回。

### 同task/event无工具持久复盘

- eventId=`task-completed:complete:sg9-independent-20261107-02:1`，记录id=`09ae283e64a288f0fbd16f5391ae4c52825df6d43506920a7456ef940898374d`，done/attempts1/lessons1、recordedAt=`00:58:35.301Z`（北京时间08:58:35.301）。记录1334字节/SHA=`d990727ffd3225e3bfddfa5bd771a035bfd406d3c024fea1437399a897d6994d`。
- task reviews副本与group evolution/reviews字节同、evolution state对应记录深等；scope严格对应task memoryGroupId/owner，experience Markdown纯decode的唯一对应entry来自同新session/event，lesson.evidenceIds精确为[eventId]。未调用带事务的MemoryStore.read作只读检查，未复制整个共享scope入task/Git。
- 无工具合同来自实际officialReflectionText：system/user请求不提供tools，stopReason必须stop，任何toolCall在done前拒绝。未创建额外复盘执行session，done不授予执行/发送授权，经验不冒充事实/权限。冷恢复后仍attempt1、task review仅1份、同session/event经验entry仅1条。

## 观测故障、最小修复与版本边界

- 旧observer最后at=`2026-11-06T20:41:52.996Z`、phase running、tools/errors空，随后写失败尾链永久拒绝；Monitor静默不能证明没有业务。此前日志快照15588行中15586次固定 `SG9_OBSERVATION_WRITE_FAILED`；最终为15998条旧格式错误，早期15586不是停机时刻基线。一次直接比较两者的验收断言失败，已改为区分旧固定文本与新安全code/phase格式，未清日志伪造零错误。首次OS cause未保留，不猜EPERM/ENOSPC。
- 根因是成功前就prior=text且tail只有then成功分支；同快照不能重试，更新/closed也沿拒绝链不写。Cordis卸载逐disposer catch，故observer拒绝不等于task drain失败，exit0也不证明旧closed观测落盘。
- 原业务 `bmpv0tlos` 经 --check --stop/--stop、supervisor→launcher正式IPC，自然exit0，closedAt=`2026-11-07T01:11:14.764Z`，ipcShutdownSent/sourceStable15=true、keyInPrivateLog=false；旧observer确实仍running。宿主completed0且独立OS核19298监听0、原三准确进程无，之后才改入口。
- 第一窄修 `522be99dfd95ca3930a1f05788e1178892014da8d3ee2bca06200675c90c7a77`：structuredClone固定排队快照；串行write内去重、成功后commit prior；tail.then(write,write)接续，当前失败仍reject；timer仅输出有限code/phase、不打印异常对象/私有路径/连接。通用atomicWrite、产品、账本、unknown不动。
- 隔离actual apply+真实atomicWrite：将自有runtime夹具暂设普通文件，连续两次NIGHT_PATH_UNSAFE均reject，真实timer产生1条安全错误；修复自有夹具后同快照成功、健康对象后改不污染已排队快照、B→A最终A、更新内容及closed等待均通过。无网络/模型/密钥/业务实例，夹具删除后独立access ENOENT。
- Review据原atomicWrite合同找到同层反例：POSIX rename后目录sync可抛NIGHT_WRITE_COMMIT_UNCERTAIN/committed=true，522旧prior=A可能令B实际覆盖后的下一A误跳过。这是静态已证反例，并非仅因未跑所以未知；本Windows不走目录sync，也未证它是原现场cause。
- 依Lead最终决定，522冷恢复/正常关闭后，仅在真正atomicWrite前令prior=undefined，保留原异常。最终入口SHA=`6f44710a1b89cb88003b9dc3b31ef5177671d1d4447ae9e2b268f9996a3999fa`。同一隔离actual apply/atomicWrite复验前述路径，并直接实测A成功→B真实I/O失败→再A仍reject、不能沿旧缓存假通过→恢复自有夹具后A实际写入。全部断言通过，夹具已清、源码起止同，node --check/diff --check通过。
- 最终6f44710a仅报隔离实测与静态修复，不把522现场结果冒充最终新版全分支实测；POSIX目录sync提交不确定未动态注入。不再起真实实例/重发业务/跑全量或旧组；必要产品guard证据复用。

## 同安装冷恢复、精确回声与正常关闭

- `b3hzpf9xy` 沿原安装先 --check --start（effects0、credentialRead=false/network=false）再 --start，配置SHA仍 `cb7aca3948dc952948459a806bd82a2cd04c521db942672b9a69cc525cdc602b`、epoch仍 `2026-11-06T17:57:44.948Z`。这是顺序恢复，不是第二实例；期间522入口和15项受验文件冻结。
- 真实service4872/supervisor46740/launcher26608：listener readyAt=`2026-11-07T01:25:00.420Z`；实际backfill state ok/completionScope durable-receipt，最终业务读取时succeededAt=`01:28:00.855Z`。health200/status ok/modelMode real/recoveryIssue0，观测持续更新、tools0/errors[]。初版就绪观察器误把 `health.groups[0].listener/backfill` 写成health顶层字段，未产出ready；只停止该自有观察器 `b2wek73i6` 并按真实结构核正，未停止/复制业务实例。
- 冷恢复前冻结15份journal；原数组按原字段/顺序JSON.stringify的SHA=`5b0b9fd9aee137d3daf0b354a31ae6cd606aae40e952466b88e68181fd2d9d9f`。运行中及正常关闭后，以显式portable codec、requireComplete:true逐份核bytes/SHA/assistant与原数组完全相同；枚举journal仍15份，无新增推理历史。新task仍completed/drained/control active、lease/run/revision均1；旧task仍cancelled/control cancelled、lease2/run1/revision2、notifications0，原45111字节/ad7062/assistant2/identity+intent不变，无result/reconciled/owner-drain补证。
- 权威HTTP任务列表仍仅两task，原群messages2、完整page total2/nextOffset=null、新真人marker1。3条outbox均sent，消息ID SHA为原状态文字 `2daace504611bef510f1c5c84a657478e517ff2483621ca22a8591323575ea93`、新文本f9c0a42c、新附件aaa48236；均不在source page，未把精确自回声登记为新业务。两notification仍delivered/send1/readback1、receipt SHA不变；48B work/冻结输出、复盘三处相同、attempt1/经验entry1，无执行/交付/复盘重放。
- 最后先 --check --stop/--stop，正式IPC自然exit0/signal=null，closedAt=`2026-11-07T01:29:59.535Z`（北京时间09:29:59.535）。独立supervisor为closed、ipcShutdownSent/sourceStable15=true、keyInPrivateLog=false；observer实际closed、at=`01:29:59.362Z`、tools0/errors[]。新code/phase格式错误0，旧固定错误历史保留；独立Windows OS核19298监听0、该三准确进程0。宿主completed0已接回，未强杀原实例。
- 首个新业务HTTP曾health degraded/recoveryIssue1，error SHA=`0606c12ff9ae202b8d4f366006f75ac345a9a56e99e5f15bfe527409c8b965c9`，精确匹配conversation分诊TRIAGE_NO_DISPOSITION；后续issues[]且HTTP恢复ok/recoveryIssue0。保留瞬态失败，不改账清绿、不推成旧unknown、不扩展追查所有旧case。

## 最终证据入口与未验边界

本次接续HEAD=`853ed2563b56308aada3a42fdd13043832286e8b`；业务/冷恢复的14项产品/配置/依赖SHA均与前阶段表及原实现一致，仅验收入口按三版变化。落档工作树含Lead单写goal.md及Tests的本报告/matrix/入口，Tests未提交、push、合并、部署或触发CI。Git与原PR最终收口由Lead独立核证，原Review单写review.md。

| 证据 / 标记 | 原工具回执 tool_use_id |
| --- | --- |
| 首个新HTTP及独立task | call_838bfdfa45e7484e9c79b1e4801667e1、call_14a81bd22b824366b1c934d00e027696 |
| session/workspace/source独立、群完整page | call_10b19dd164054a7295707fa2f9b9e1c0 |
| authenticated source字段、新严格journal | call_86e663aff54e497688f4e447ec59bb00、call_010d57eb682e4730b7732bde48ba4496 |
| 精确两行及最早日志计数 | call_c66f81082312449282abf661ecdd927c |
| triage/Router消费、task复盘记录 | call_aba624feb51e46c0924b138ee3416951 |
| typed身份、平台文本mget/附件实际下载 | call_e1acaff706784bab8aaad6b753b146c9 |
| 持久无工具复盘、15份历史/业务冻结 | call_db57b2d307a4493a99e61eb0d388de19 |
| 原业务closed及旧observer局限 | call_e5bac23cff7949259bca37e34b28aa20；bmpv0tlos宿主完成call_8ae2a245cf114d03b70b0f5296a0ce2b |
| 522拒绝链隔离验证 | call_cdca3fc1df574bc18308ebcf52f3fd75 |
| 522冷恢复历史/任务/receipt/产物不变 | call_4feb96aa0beb40ab8d9252b3f6b5d86e |
| 522精确回声/复盘稳定及正式stop | call_e1429b8648264f1e9aacdf34f2645d4c |
| 522真实closed、日志计数及宿主自然0 | call_2467f9a919db4704be276c6fd59f8749；后台b3hzpf9xy/call_20be0c45545b4444975a575a7927de02 |
| 最终6f44710a隔离缓存失效/closed | call_10ca7fc91a304cc28d317feb16694cb0 |

- 矩阵在原88行/9列上更新4条新交付终态与本轮汇总，追加3条观测故障/拒绝链/缓存失效记录；后两条是同一必要隔离检查的不同合同面，不计成多套业务测试。原74行原8列canonical JSON SHA仍为 `26cb4e5000ccff97e231a2090ae0b91ee80dde2e879e7927c58751da7aee5a52`，剥离round_7和新增行可逐字重建R6完整CSV/SHA `c14cd39fe78c22bef63a17da49a2bd014e7ffe6049c11d8a035a8991f620da3c`；round-6.md与旧失败不改。
- 保留必要文字摘要及原回执定位，不复制私有完整日志、平台正文/群/profile/模型连接、DB/journal/凭据或业务文件入Git；实际档案仍在原安装data各自桶，隔离夹具均已清。没有新增截图/dump/日志副本或旧轮附件。
- 当前真实实例已结束，无待真人输入或自有监听待续。单条原始event/live-history分支、POSIX目录sync故障为明确未验边界；旧unknown未关闭。没有新全量、其它群/私聊、账号变更、生产部署、PR合并或CI；独立审查和原PR最终收口交原成员接续。
