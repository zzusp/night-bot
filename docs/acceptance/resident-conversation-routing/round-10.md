# 第十轮：显式引用与回声窗口回归、原安装真实闭环与冷恢复

## 阶段结论

- 本地必要回归阶段已结束：公开 Router 工具缺省/显式引用2例、默认 optional DWS 精确回声/timeout/error/永久 UNKNOWN 4例、bridge 持久补读与 pause/存盘失败2例分别取得通过证据。它们分属下述真实执行及测试版本，不合并宣称“一次最终同版整组全绿”。
- 两次执行各有1个真实 FAIL：第一次 SUCCESS status 夹具漏合同版本，第二次错误要求 ACK receipt 整对象不存在。只修夹具/断言，严格身份、未验证内容不得 delivered、精确来源和冷补读条件未放宽；最终仅复验受影响 SUCCESS 一例。原失败回执和 R9 自身回声 FAIL 保留。
- Lead 本轮 `pnpm check` 与目标结构校验自然 exit0；Tests 已独立读其已结束输出，未重复运行 guard。未跑全量 `pnpm test`、runtime/routing/containment，不宣称这些整组通过。
- 原安装离线 `--check`、原监督器 `--check` 和独立空闲端口核验通过，沿唯一原入口真实启动。SDK ready、完整 backfill、HTTP 健康由独立已结束任务 `bozw4158i` 观察通过；本次允许原指定群交付，不能称为只读启动。
- **本次指定群真实闭环及同任务冷恢复已完成。** 真人新来源经正式分诊/Router/唯一执行session，产物写入、读回、冻结，父说明与附件实际delivered；原生status/mget、引用、@当前用户索引及29B附件重新下载均独立核证。持久无工具复盘完成，Router完成事件已消费并交接至g9；冷恢复无执行/发送/复盘重放，两次均正常IPC/自然exit0，六个精确PID和19298端口已释放。保留本地两次fixture FAIL及现场验证脚本失败，不生成全绿report.md。
- 本报告先在待真人输入时冻结本地阶段及ready检查点，本次在现场阶段结束后集中补终态；早期观察时点保持。原生提及结论基于同profile既有真实认证链、当前typed/native作者映射和本次完整@我索引；不是普通SUCCESS、正文姓名或48be脚本新调用whoami。mget/receipt不提供显式提及数组的限制保留。

## 受验版本与边界

- 起点 HEAD：`67d2d5011f54b1f63704b84c81b24c1216d0e3fa`；分支 `worktree-resident-conversation-routing`。产品、测试、活文档、manifest、方案及 goal 有原团队已知未提交增量，不能仅用 HEAD 代表受验版本。Tests 不写产品/配置、goal、manifest、原 spec 或 Git。
- 现场持有期间Lead保存实现`cd045eeea2253c9aaedf82065dc553f54c55c55b`，47个blob逐项等受验字节；后续`9b213cc2075f7ac3d38c9181d06234ab3b9f9e7c`、`e7d045abf71d057a6ffd1748425cd2a9437b2c26`只保存goal事实。冷恢复起点HEAD为e7d045ab，47项源码仍与btprbo14p绑定映射相同。现场阶段Tests未改产品、测试、配置或私有业务数据，只使用已清理的临时保护外层；最终待交回增量仅本报告和matrix，goal仍Lead单写。
- 四次本地执行各有 START/END 文件映射，`changed:[]`。前三次与最后47项映射比较，共有文件只有 `test/pi-channel-plugin.test.js` 的 SHA 不同；quote组未绑定bridge测试文件，其余46项均在最后映射中。五份产品字节在四组中相同。后续改动仅涉及echo夹具/断言及新增测试，未重跑已通过quote/bridge。
- 写报告前独立核当前47项与 `btprbo14p` 起止映射逐项相同。现场外层绑定该映射，保留原监督器自己的15项守卫；没有修改监督器、热改在途产品或放宽来源/import/sandbox检查。
- 本地测试为默认 application、官方 Pi/SessionManager、真实 Host/插件/adapter/bridge 接线和隔离目录，模型端点、外部CLI及平台数据均 scripted/fake，`realVendorExecuted:false`。不能据此认定真实 DWS quote/@ 或文件交付通过。
- 真实阶段仅原安装、原profile、唯一指定群。模型秘密只由原监督器按授权进程内读取，不输出/落盘；没有复制身份、账号、凭据、技能正文或业务数据到仓库。未另建实例、CLI代发、Host/HTTP注入、重放旧业务、部署、CI或合并。

### 冻结产品与测试

| 文件 | 当前 SHA256 |
| --- | --- |
| `src/channels/resident-router-business.js` | `cf28408367dca53b7e7e862f2580c80fbee27194ff7d32358a59f470f4bb6c12` |
| `packages/dingtalk-core/task-session-service.js` | `6592256ffb0b77c0156d332ef32f5cbc338a32a8a61043d5b4cac72cb06b221a` |
| `src/channels/plugins/dingtalk-dws.js` | `d1cc7cd0b54cfdd45591dd089b9cc349d9c584e9b82178f6e704e89cc34741e7` |
| `packages/dingtalk-core/native-dws-send.js` | `247191b298c30583569225caa007549d3b1d832cb8f7f1308fbd236eb816d9f4` |
| `packages/dingtalk-core/dws-bridge.js` | `082218473340959f3ffe9d8e6b0b364e87d6bd3c2819535135e54734408fea8c` |
| `test/pi-channel-plugin.test.js` | `e5b7a83569076079b4923c55b32fed02ecf3605fc27708c883042290cde80085` |
| `test/dws-bridge.test.js` | `410f50d31d8cf6850cc1b26594e884ffa1c13e0fcac738f3f0d543c98d18cc3a` |

## 本地执行及两次真实失败

入口均为 `node --test --test-reporter=spec --test-concurrency=1`；下表为实际 `--test-name-pattern` 与文件，没有全库重跑。

| 执行ID | pattern / 文件 | 实际终态 | 总耗时ms |
| --- | --- | --- | --- |
| `b9mg6uq8o` | `^default application neutral Router tools`；`test/pi-channel-plugin.test.js` | 2 PASS / 0 FAIL / 0 CANCEL，code0 | 64147.738 |
| `bqpz1986y` | `^default optional DWS\|^identity deferral`；`test/pi-channel-plugin.test.js`、`test/dws-bridge.test.js` | 5 PASS / 1 FAIL / 0 CANCEL，code1 | 54646.6924 |
| `b24nr8a3q` | `^default optional DWS`；`test/pi-channel-plugin.test.js` | 3 PASS / 1 FAIL / 0 CANCEL，code1 | 53616.5885 |
| `btprbo14p` | `^default optional DWS filters exact echo`；`test/pi-channel-plugin.test.js` | 1 PASS / 0 FAIL / 0 CANCEL，code0 | 17991.0669 |

四组各自 skipped0。quote正常结束时既有abort诊断标签仍写 `default-neutral-tools-interrupted`，正式统计PASS/取消0，不据标签改判。

| 执行ID | 绑定项数 | `test/pi-channel-plugin.test.js` SHA256 | sourceSetDigest |
| --- | --- | --- | --- |
| `b9mg6uq8o` | 46 | `27b8506272fd8d17722958bc4b131de6dca6aad4e24eb35856a1862321bdae9b` | `2860dce60bd30aab5f3d3b8ab53bb1549425f9e44cfe648ae13a4b8eda097dee` |
| `bqpz1986y` | 47 | `1b519ebb31ea503afb2246182d9c22f50ead98e2170e1a65fef9d401dc986439` | `86743f1924f6383b32f1b3f32bd7f5c41eb4577314346463e4533000787733ed` |
| `b24nr8a3q` | 47 | `ed9b0066d4dc49bed1900233b9360d8bbd6d8afe34525bcddccbf4d17a065bb9` | `a49eae74192d4f45e226d49355e66c717582bbd3d9058ba61c5decc1e8177899` |
| `btprbo14p` | 47 | `e5b7a83569076079b4923c55b32fed02ecf3605fc27708c883042290cde80085` | `669959964ec2d4bf5476b767ff1069194552d20fd2c2a8ea9d0ef5b0ad06ee5e` |

### 公开 Router 引用、受众及冻结产物

入口为 `test/pi-channel-plugin.test.js:294`，经注册的 `resident_router_reply`、真实 Host 与 taskDelivery，不直接调用底层发送绕过ACL。

- 省略 `replyToSource` 保持既有默认；显式仅接受布尔true。false、字符串及旧vendor参数由官方schema拒绝。
- 当前真实sourceId/messageVersion绑定原消息及作者。引用受众缺省、空数组或仅含他人均在prepare/send前拒绝，不自动补作者；原跨来源、外来actor负例保持。显式例共11次拒绝，缺省例4次，均无额外交付。
- 同operationId的相同完整请求幂等；去quote或改受众的实际语义变更冲突。父通知冻结原source、作者、受众、replyRequest及当前taskDelivery；file child不继承quote，不宣称附件自身原生引用/@。
- 实际材料读取、work写入和读回、task_result冻结输出，文字1/文件1、回读2。显式例挂起file readback时，父说明delivered、file child未delivered，释放后才完成文件终态。
- 冷开禁用渠道，历史delivered通知及execution journal不变；另prepared待发送仍显式保留transport unavailable，不用冷恢复静默跳过。

### 默认插件接线的精确回声与未决身份

入口为 `test/pi-channel-plugin.test.js:429` helper及`:499`、`:520`、`:544`用例。默认application + optional DWS plugin，operatorNotifications=false，内部scope明确不等native conversation；ACK只有openTaskId，status与内容mget分开控制。

- 最终SUCCESS例：mget挂起时精确自身mid在channel注册、fact/source/triage前过滤，三者均0，send1。通知未delivered，receipt无已验证messageId/observedAt；内容完成前不承认投递完成。
- 同账号、相同正文、通用flag但异mid的真人消息，以及同mid异room/异channel均正常接纳；不按账号/正文/泛标记过滤。
- timeout/error两例：真人原消息比最新已接收消息早120秒，超出默认30秒overlap。未决typed暂缓，不accepted/ignored、不落fact/source/triage；真实ingress.json保存覆盖原消息的recovery下界，其它scope正常。状态可证后冷开，经正式完整history接纳同ID/version，source1/triage1/send1，成功后才清下界。
- 永久PROCESSING例：冷开仍degraded、typed错误可见，待补真人fact/source/triage仍0，持久下界不清、send仍1、通知不判delivered。

失败责任与复验：

1. `bqpz1986y` 的SUCCESS夹具漏 `contractVersion:'im.message-send-status.v1'`，strict status正确拒绝并报 `CHANNEL_NOTIFICATION_IDENTITY_PENDING / status-unconfirmed`。仅补夹具字段，未改产品或放宽身份合同；该组其余5例通过。
2. `b24nr8a3q` 已完成精确echo过滤，随后因 `receipt === undefined` 断言失败。既有账本可保留仅含openTaskId的ACK对象；改为非delivered且无已验证messageId/observedAt，保留内容挂起与发送次数条件。`btprbo14p` 最终单例通过；timeout/error/永久UNKNOWN在该失败组仍各自通过，不抹掉整体code1。

### bridge持久补读、pause交错与写失败

入口为 `test/dws-bridge.test.js:1351`、`:1376`，复用既有ingressFixture/atomicWrite，不新增调度器或测试平台。

- 确定消息进入runtime.ingest后发pause，pause仍等该消息；消息typed pending时能在原controlTail持久pin，无pause等消息、消息等pin的自等待。磁盘下界覆盖两分钟前原消息；停旧桥、读真实磁盘JSON冷建、正式resume/ready补读，最终仅接纳一次，成功后清下界。
- 真实atomicWrite对已有directory目标产生文件系统失败，健康显式暴露 `CHANNEL_INGRESS_RECOVERY_PERSIST_FAILED`，recoveryRequired=true/healthy=false/accepted0，旧磁盘水位保持；不把内存状态当持久成功。隔离临时目录由用例精确清理。

## Lead guard的独立回读

已结束任务 `bddd8bjga`：pnpm check自然0、long-goal structure PASS。194 retained / 6 retired / 3 excluded / 57 adapted，relativeImports closed、HTTP routes retained；production/import/runtime文件405、literalBareImports191、externalSdkImports0、legacyOrchestratorDefinitions0、verified5/removed9。manifest与203原source/sourceSha256对保护由Lead独占核验，Tests未重写或重复跑。

输出SHA256 `db890b81cda97124ccb10d28b173e20ee046732266de759a7ff71ce1b2568d7f`。这是本地guard证据，不是DWS实际收发证据。

## 原安装预检及真实ready检查点

离线预检已完成tool_use_id `call_01b385f4ac5f4506a4c1ea35aad10a59`，时间2026-11-07T07:16:15.060Z，即北京时间15:16:15（UTC+08:00）。它不是在途 `b601nf10p` 的输出截段。

| 项目 | 实际预检 |
| --- | --- |
| 原安装 | 离线；拒非空WAL/SHM，immutable/query_only只读与DB起止保护 |
| 源码 | 最新本地47项精确绑定；临时保护外层复用原驱动，原监督器未改 |
| 历史 | 22份strict/requireComplete，assistant77/toolResult56/effect-intent2 |
| 历史聚合 | `10c4bafc4ca058b600210c64bc637d14db913ceff5b5dd5547919311a302dd90` |
| 原账本 | task3/notification4，四通知delivered，原三任务基线保留 |
| DB SHA256 | `87dd3410354b6ebf3e74060312dd2561e667175177b5a3c054a54e0a484312de` |
| config SHA256 | `cb7aca3948dc952948459a806bd82a2cd04c521db942672b9a69cc525cdc602b` |
| 原私有技能 | 两份保护；未搬正文/脚本到源码或fixture |
| 原监督自检 | `SG9_CHECK_OK; effects=0; identity=verified; groups=1; credentialRead=false; network=false` |
| 外层自检 | `SG10_R10_COLD_CHECK_OK; effects=0; network=false; credentialRead=false` |
| 独立端口预检 | `call_e1fbae1743f9440f84e54bb07b1aebac` 返回 `R10_ORIGINAL_PORT_FREE` |

随后沿原入口正式启动。不得再将离线DB hash当运行中活库hash；运行中不以immutable查询活WAL，不改DB/journal，不重用已消费resume proof。

独立已完成任务 `bozw4158i` 自然code0，于2026-11-07T07:17:25.065Z观察：

| 项目 | 真实检查点 |
| --- | --- |
| 原进程 | supervisor87404/launcher97088/service104368，127.0.0.1:19298 |
| SDK listener | ready，readyAt07:17:13.712Z，即北京时间15:17:13（UTC+08:00） |
| 完整backfill | ok、completionScope=durable-receipt，succeededAt07:17:24.139Z，即北京时间15:17:24 |
| HTTP | status=ok/recoveryIssueCount0 |
| observer | tools0/toolErrors0，不据此推导模型HTTP请求次数0 |
| 监听属性 | listenerIsReadOnly=false，原群已授权有限交付的真实监听 |

同期独立只读 `/state/tasks` 仍原3任务（cancelled1/completed2），均drained/run1，无新field执行任务证据。07:19:23Z原会话正式消息页只读观察3项、约定marker命中0；仅记录该时点，不以任务数推断绝无新来源，不把跨会话模板注入Host。Lead另独立核三个精确PID及监听归属，Tests已回读其会话PowerShell原回执 `call_50933f420cab481dbf54a94ce2750e73`：三个PID均node，StartTime分别15:17:09.967/10.231/10.488+08:00，19298仅127.0.0.1且归属104368，expectedInstanceMatched=true；OS归属不代表业务通过。

## 真实来源、唯一执行与冻结产物

- 北京时间2026-11-07 16:52:25.466（UTC+08:00），原群真人新来源经正式入口接纳，native message SHA256 `4edde5fe498038bd6dfe3cd4564bcabe02b25d67c7d7b0c60e95e794eab2bd60`，version1/processed。实际请求进入分诊/Router，未HTTP注入、CLI代发或重放；此前16:03的无消息窗口不外推至这一时点。
- 新task hash `7878f367a3f432b5e2b5ecff1e333b24f8c56ad75d94c6c1ae578aa122c19df4`，唯一执行session hash `abf33ccb29fb5c8ae9009c846097d707ed5dc823c5f573943ab1d46fe3422c5b`；与旧task/session分开，无旧依赖或Topic拆分，16:53:14.954 completed/drained/runSequence1。source actor等于任务owner，原3任务保持。
- 严格`decodePiJournal(...,{codec:portablePaths(paths),requireComplete:true})`通过；执行工具恰为`write → read → task_result`，toolResult3/toolErrors0，journal SHA256 `17415f728ee2fa9fbc75af414d0007e4781978902546d7fbec244e387acc8a39`。不是从task.json派生快照推断运行权威。
- `field-check.txt`为29B，work、Host冻结文件及descriptor一致，producer绑定当前唯一执行session；SHA256 `afe13bfb164fcc75d4d2a1623c8d89b0c761b75a2e665531c288a9ff401ef3c2`。原回执`call_9f684b13a2aa4bd7bd6610aad08ec573`（R10_LOCAL_FIELD_EVIDENCE）；来源原回执`call_cad9eadad3174ed0987bca2adac831b9`。原材料、正文、native IDs和业务文件不入Git。

## 群内交付、原生引用与提及

独立真实回读`call_48be6fe4ceeb4501a32eaa7dfd240b40`，北京时间16:59:45.838/16:59:46.565（UTC+08:00），仅原profile/原群，没有重发。

| 对象 | 实际证据 |
| --- | --- |
| 父说明 | notification hash `c5a88405d16b9e54939a951edebc4a4b2236ca5b3a22b083ff012bbbed33d530`；平台mid hash `572f690dbb3e6c0d511c398f518a8584476c403169c6823e2016d10a07a62d3f`；delivered/sendAttemptCount1/readbackAttemptCount1、原生status SUCCESS，receipt observedAt08:53:42.585Z |
| 正文 | `sameDeliveredText(message.text,parent.payload.text,message.quotedMessage)`通过，包含一句中文结果及Host附件对应段；原生quote渲染的作者前缀按既有函数合同处理，不修改expected正文 |
| 附件子件 | notification hash `590d47f0b5022eeb95315f2f9dcac6f35095a6381b7d035245f782e9fa7f7486`；平台mid hash `2990a64c33ebf9e779b35a0a1fec6ebef62724d1d6ec9eab544aff562a159da1`；delivered/send1/readback1、status SUCCESS，observedAt08:53:46.446Z；child不继承quote |
| 平台资源字节 | 现有readMessageFile重新下载，唯一资源及receipt绑定，29B/hash精确同冻结文件及请求预期字节；路径在自有目录，finally清理后独立目录差集无遗留 |
| 原生quote | mget quote精确原mid/原群；list-mentions raw再提供quote senderOpenDingTalkId，精确同原作者，不只按显示名 |
| 原生@原作者 | 同profile chat message list-mentions，父时间前后1秒，完整1页1条，success、requestSatisfied/sourceExhausted=true，result/paging.hasMore=false、truncated=false；唯一原群/唯一父mid。既有真实认证链的@我主体精确等原作者，经当前participants映射同唯一recipient |

身份分域：typed ownerActor hash `4131eaf5935458ce5ae8ad78063dfe71ee0bdcdc4d6f034c60a3ea7b738ecd56`，native作者hash `856e4fd0186e702e5d64f5cebeca6655a56057299033a7648d4b3654cc6cda93`；经contexts.participants精确映射，不直接比较不同域hash。内部conversation与native群ID分开，父受众恰为同原作者一人。

认证复用原已完成`call_3f63dac727534f5481f34757978c08c0`同profile真实get-self，再由`call_000a6f06cd2c4a99b15bf6444a7ae165`的auth status --readonly核authenticated/userId/corpId并唯一映射openId/原群成员。原监督复用私有证据核profile/config；`call_875d26aa8a9d480e876788a82cc19a65`另核绑定。本次48be不是新get-self/whoami。当前映射见`call_d5ec3f6d52174f99b28270816ae7a71d`；`call_7e563e5dc01748f38d1b7e27c8156d1c`零DWS调用复用raw逐字段断言，R10_NATIVE_MENTION_VERIFIED。

mget无结构化mentions字段；runtime receipt的mentionVerification=unavailable、atOpenDingTalkIds=[]原样保留，不当明确无@或伪装数组可得。PASS来自原生@当前用户索引及精确身份/消息绑定，不能泛化为任意被@者数组可得。普通SUCCESS只证明投递，不能代替正文/quote/@/资源字节证据。

## 持久复盘、Router交接与精确回声

- 同task.completed event的复盘于北京时间16:53:24.639持久done/attempt1/lesson1，task归档与scope review同字节，SHA256 `06771d97ba7bd0f90ae40a1dcb6e3b37139c8f9dd88da221c7648b140416d7ee`；evolution state同event，experience条目1/revision1、actor scope精确。lesson依据当时完成/产物证据，明确不能据此宣称当时渠道已送达；私有复盘正文不入Git。
- 无工具复盘证据为reflection-inference实际默认官方一次streamSimple调用，只有stop且无toolCall才返回；reflection验证evidenceIds后持久done。不是用Router交接零工具替代复盘零工具。原回执`call_d5ec3f6d52174f99b28270816ae7a71d`、`call_2bf03b1811344d77b2b80bc4e661a507`。
- Router权威mode=ro/query_only事务（活库非immutable）核新source和task.completed consumed；phase active/generation9/cursor9/lastHandoffCursor9/pending0，g8→g9 published，旧/候选双方strict commit及candidate handoff marker成立。g8交接段assistant1/toolCall0/toolResult0/stop，journal SHA256 `8602699c608dd36f5b56d192efa15e1b6cc5b0d6433a852e355a50603cd29f56`。原回执`call_551d30e5f9c245d6ac013264fee75c36`、`call_2bf03b1811344d77b2b80bc4e661a507`。
- 完整backfill成功推进至交付之后，两精确own mid在正式来源及contexts.messageFacts均0。最终离线源表/triage核真人source唯一/v1/actor匹配、triage committed1、source及completed事件consumed2；两own source/fact均0，冷恢复后保持。不仅凭observer页面隐藏own或工具计数推断，也不声称SDK必回传自消息事件。

## 正常关闭、同任务冷恢复及结束保护

| 阶段 | 实际终态 |
| --- | --- |
| 首次原现场 | 原监督--check --stop后--stop，经IPC正常退出；b601nf10p自然code0/signal null，北京时间17:11:56.884结束，closed/ipcShutdownSent/sourceStable，verificationError null；b66yixnw1也自然closed |
| 首次结束保护 | 原3task/4notice整body、22旧journal物理前缀、config/两技能/47源码不变；合法新增source1/task1/notice2，strict journal26，assistant/tool/effect从77/56/2到93/69/3。旧unknown/已消费proof原样保护，未直接改库 |
| 冷恢复新断点 | 首次关闭DB `7099a6ab4e14a77a64d298a42b979f3cb92d965d9597806a23a2364dc34a95aa`、26 strict journals、4task/6notice；沿原监督/原安装/config/profile/群先零副作用自检，不重跑旧DB87dd/22journal初始驱动 |
| 冷恢复实际 | b627yivlg，supervisor16456/launcher102428/service101056；北京时间17:14:28.158 SDK ready，17:14:28.950完整backfill，HTTP ok/recoveryIssue0；原监督自检/stop/正常IPC，自然code0/signal null，17:14:33.915结束 |
| 无重放 | 26 strict journals逐字相同，aggregate `4938272d10b84585ae61f64f1d2e6564804edea4298f59b5b071269033408b26`；assistant/tool/effect均93/69/3；8业务表逐项相同，新source/task/notice均0；4task/6notice/current session/completion保持，两个通知send/readback仍各1 |
| 产物/复盘 | 冷恢复11保护文件：config/两技能、work/冻结文件/descriptor、task review、scope review/state/experience/scope metadata均字节相同；经验revision不增、own fact0 |
| 最终离线DB | `a5f94eec24291df644644ff4d6fc2c3e347ec94be015e41486864a7b9eff4c17`，拒非空WAL/SHM后immutable/query_only读，读取起止hash相同；冷启动前后整库hash变化，不宣称整库字节不变；无重放结论绑定业务表/journal/产物/复盘 |
| 独立OS | 北京时间17:17:10.217，首次87404/97088/104368及冷16456/102428/101056六个精确PID均不存在，19298无监听，可归属安装node/dws进程0；不用PID退出代替IPC自然终态 |
| 清理 | 两本次临时驱动按精确hash/普通文件/ignored/untracked/unstaged先--check再删除，独立另命令核不存在；不动安装data/日志/WAL/locks或他人产物 |

冷外层运行SHA256 `8f32402c94a0a5383e1b4097e76b8837918967022d58c6fcddab627098e16703`；自检前按真实持久字段sendAttemptCount/readbackAttemptCount校正观察器，未运行错误字段版或修改产品。首次临时外层SHA256 `1270599628bf385783e058de8149fa666815c63ea9a15891d6279540e65a3575`。其newMentionQuoteCasePassed=false是启动前硬编码占位，原输出保留；它负责生命周期/基线保护，不覆盖48be/7e563独立完成的quote/@证明，不能据占位改判业务或抹字段。

准确定位：首次任务`call_e76edac7651d4350a7ef5054f08ea981`，完整回读`call_d0631948c093409ba161746ff7e9abfe`；冷自检`call_d06d7da9b1aa4d59a0564510b515075d`，实际任务`call_979be3851c3a4c2b9fc994343ff331e2`，完整回读`call_32738900812d42bd8d50aee08f4f81d2`；最终OS/离线`call_9dba72f7e87d40989de697b304b809cc`；清理`call_0e88ae2721b44273bd6e666705a4a052`，独立不存在`call_e9f5db78271f4165ad812267883533c9`。

## 验证脚本失败与修正

原执行保留，不并入产品成功次数；均未修改产品、重发或放宽守卫，本地两次fixture FAIL继续保留。

| 原已完成回执 | 失败及后续有效证据 |
| --- | --- |
| `call_cbccfbf9ac904e96bdd1e035fde45ec4` | exit1，R10_PARENT_TEXT_MISMATCH；sameDeliveredText误传true未处理原生引用前缀。改传真实quotedMessage，48be正文/quote/下载通过，不改expected文本 |
| `call_115ed6bc4c214ab093abe7a201cc7f43` | exit1，paging整对象deepEqual误拒合法lastCursor；改逐字段完整性/scope/mid/作者断言，7e563通过，未重复DWS |
| `call_179cd0229a80494596cddf8369949deb` | exit1，Python路径转义语法错，SQLite未打开；改用原生Path.as_uri |
| `call_09f3cc93550a459aa922738aa1e789dd` | exit1，按sessionId拼journal文件名ENOENT；改按真实header id路由/strict解码，551d30通过 |
| `call_e6de9220faf64830b8db9e39e898da38` | Node按原始Pi header过滤logical runtimeOwner而R10_ROUTER_G8_NOT_UNIQUE；同Bash末尾stop自检成功使整体exit0，不能当Node通过。严格解码后读logical header，2bf03b完整通过再正常stop |

报告本地阶段和现场集中写入各有一次长heredoc在shell解析阶段EOF/code2，业务/写入均未执行，分别独立核文件不存在或原hash不变后改用专用编辑工具；未借此改产品或重跑业务。关闭瞬间Monitor曾报HTTP TypeError，随后closed自然终态到达，没有重启。旧通信地址ENOINBOX不当平台拒绝，结果已交原Lead/Review。

## 未验边界与交回

- 本次真实结论只限原指定群/profile及这次有限文件请求，不扩其它群/私聊/生产或广义开发运维替代。status probe有界等待不统一取消/join底层CLI，observer.close不统一排空旁路；本次实际六PID/端口/可归属进程已核，不宣称所有CLI实现统一drain。
- Windows进程privacy、Linux未实跑、异常close专项、旧unknown缺producer证明等原边界保留。本地已过组不重复，全量test/runtime/routing/containment未跑仍未跑。
- 本次现场阶段结束，无在途现场任务/观察器或第二实例；Tests交回本报告/matrix，goal/原review/Git/PR仍由原负责成员整合。本轮不替代长期目标全部收口或PR真实状态核验。
- R1–R9报告和矩阵历史字段保持，R9 echo FAIL不改，不建全绿report.md。原始证据留原安装/宿主已结束回执，不复制凭据、native IDs、业务正文、技能或模型连接到Git。

## 本次归档保护

矩阵现167用例/12列，新增round_10和25项；现场只更新其中8格终态，17个本地阶段格及两次FAIL原样保留；原142用例的11字段可逐字重建交回R9时完整CSV（SHA256 `9f0d766e796285deb980fa280a572d23887bfb31bccff5cc169ce6e1e65c70fa`），原122用例的10字段也与HEAD逐项相同。新增行round_1至round_9全NOT_RUN，R1–R9报告SHA逐一不变。独立核当前47项仍相同、git diff --check通过。

## 原回执定位

Tests宿主会话 `8d59080e-5ce2-49dc-827d-2663d26a6778` 的已结束 `tasks/<ID>.output`；完整START/END映射留原回执，不复制平台正文、配置或秘密到仓库。

| 执行ID | 输出SHA256 |
| --- | --- |
| `b9mg6uq8o` | `9cb3e78fa08c7734432cbd4faa094439f0ee5c45e16223c27e653f9a73b95b94` |
| `bqpz1986y` | `76f73a36d3e1704abed025971260d3dfef0d7bf02d13bdf2776d4993304ef7c0` |
| `b24nr8a3q` | `673c46e898a06b22ed7cb12f0dd89f6bda673e1533d60efe98e0f705eb34dd71` |
| `btprbo14p` | `d7372a8c7e74782663746948a0ef4ff0f54e640624827e5925f7f7842df9e45e` |
| `bozw4158i` | `e86fa169196a94089f4f41e6bdb1f8147e235d208e0fd46d2596747e79ec94cd` |

Lead guard位于其宿主会话 `7bf40364-200d-4b76-b8b3-18e06195ad4d` 的 `tasks/bddd8bjga.output`，hash见上节。下表外层/观察器均已结束才追加指纹；首次外层硬编码quote/@占位保留，独立平台核证不由该字段替代。

| 已结束现场执行 | 输出SHA256 |
| --- | --- |
| `b601nf10p` | `70172e70c263ca5ebe1a412e7023dc24a6c5983217839254d6f7f0b9277c17fc` |
| `b66yixnw1` | `4b36e46c40728bbf3c6ab0e453977f6a17992d3e88528fca9340e7a61bbed9d8` |
| `b627yivlg` | `3195da30399f937585fb774f4e78d7e5e3b530a113016559b5bcd58ec77f4250` |
