# 第七轮：正式停用与独立交付检查点

## 范围与结论

- 对应唯一 [goal.md](goal.md) 的 SG9，当前为 **WAITING_INPUT_NEW_AUTHENTICATED_SOURCE**。旧事项正式取消、取消后冷恢复不重放、最终真实补读已经核过；新独立事项尚无真人 SDK 入站。监听就绪、本地 PASS 或旧事项取消均不代表新交付完成。
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
- 当前运行尚未关闭；不能给 bmpv0tlos 填最终 exit0/sourceStable/keyInPrivateLog 结论。b6kvdjing.output 前段重复携带本地回归结果，其中 sourceStable=true 属于 bj02xs18s，不是当前真实实例退出证明。
- Monitor `b8ouup508` 为原工具结果、监听/补读错误与受管进程终态的通知入口，只读、不发消息、不调用模型；到期接回后按实际等待需要续建，不把30分钟当整个任务时限。bmpv0tlos 退出由宿主后台任务通知，不能另启副本或用轮询 output 冒充推进。
- 新真人 SDK 事项当前尚无新 messageId/source/task/session/workspace；新事项建议 marker=`SG9-INDEPENDENT-20261107-02`，已交 Lead 协调同群真人一次发送。不是重新索发送授权，不能以 Web、SDK 注入、自发自收或旧 source 重放替代。
- 后续仍沿本轮：核新 source/version/actor 与独立 task/session/workspace、无旧依赖/clone/reopen/attempt 复用；生成并读回 work/sg9-live-check.txt、Host冻结 descriptor/hash；完成真实同群中文说明与附件、status/mget/附件回读及 durable delivery receipt、同 task/event 无工具持久复盘、精确回声去重，最后正常 IPC 排空及必要冷恢复不重放。当前上述新业务均 WAITING_INPUT/NOT_RUN，不用本地 fake 或旧 Router 文字补齐。

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
- matrix 本次追加 round_7 与14条必要记录；原74数据行的原8列逐项保留，其 canonical JSON（UTF-8、ensure_ascii=false、紧凑分隔）SHA=`26cb4e5000ccff97e231a2090ae0b91ee80dde2e879e7927c58751da7aee5a52`。原 round-6 文件不改，不建全绿 report.md；新交付仍 WAITING_INPUT。
- 本轮无新增日志副本/截图/dump/单轮fixture。原实例、配置及旧unknown档案仍用于当前运行和恢复，保留且不入Git；本地fixture沿原teardown清理。等待输入后在本轮阶段末集中补完，不逐事件刷新报告。
