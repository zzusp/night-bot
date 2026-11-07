# 第十轮：显式引用与回声窗口回归、原安装现场待输入

## 阶段结论

- 本地必要回归阶段已结束：公开 Router 工具缺省/显式引用2例、默认 optional DWS 精确回声/timeout/error/永久 UNKNOWN 4例、bridge 持久补读与 pause/存盘失败2例分别取得通过证据。它们分属下述真实执行及测试版本，不合并宣称“一次最终同版整组全绿”。
- 两次执行各有1个真实 FAIL：第一次 SUCCESS status 夹具漏合同版本，第二次错误要求 ACK receipt 整对象不存在。只修夹具/断言，严格身份、未验证内容不得 delivered、精确来源和冷补读条件未放宽；最终仅复验受影响 SUCCESS 一例。原失败回执和 R9 自身回声 FAIL 保留。
- Lead 本轮 `pnpm check` 与目标结构校验自然 exit0；Tests 已独立读其已结束输出，未重复运行 guard。未跑全量 `pnpm test`、runtime/routing/containment，不宣称这些整组通过。
- 原安装离线 `--check`、原监督器 `--check` 和独立空闲端口核验通过，沿唯一原入口真实启动。SDK ready、完整 backfill、HTTP 健康由独立已结束任务 `bozw4158i` 观察通过；本次允许原指定群交付，不能称为只读启动。
- **现场仍在运行，完整文件请求尚无收到证据，整个 DWS 现场验收未完成。** 外层 `b601nf10p`（`--run --hold`）与 Monitor `bq0vvu12d` 由原 Tests 持有；不读取在途输出冒充终态，不因等待重启。本报告先冻结本地阶段及 ready 检查点，现场阶段结束再集中补终态，不随每条监听事件改报告。

## 受验版本与边界

- 起点 HEAD：`67d2d5011f54b1f63704b84c81b24c1216d0e3fa`；分支 `worktree-resident-conversation-routing`。产品、测试、活文档、manifest、方案及 goal 有原团队已知未提交增量，不能仅用 HEAD 代表受验版本。Tests 不写产品/配置、goal、manifest、原 spec 或 Git。
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

## 在途、未验及下一步

- 本地阶段交回后，原Tests继续持有 `b601nf10p` 和Monitor `bq0vvu12d`，无第二实例。Monitor覆盖工具/agent失败、HTTP读取失败、任务业务状态和正式关闭，按宿主事件接回，不刷在途输出。临时驱动 `docs/tmp/sg10-r10-field.mjs` SHA256 `1270599628bf385783e058de8149fa666815c63ea9a15891d6279540e65a3575` 仍使用中，不提交或清理。
- 待原群真人来源、正式分诊/Router/唯一task/session、work文件生成/读回/Host冻结、父说明与附件实际交付和精确平台回读、原生quote/@、无工具持久复盘、同任务冷恢复无重放及本次正常IPC退出。不以fake、ready、已调度或进程存活替代这些终态。
- status probe有界等待不统一取消/join底层CLI，observer.close也不统一排空该旁路；本轮不扩runner改造，尚未做实际进程关闭验收，不能泛称所有CLI统一排空。Windows进程privacy、Linux未实跑、异常close专项和旧unknown缺producer证明等边界保留。
- 现场阶段结束后才原监督 `--check --stop` / `--stop`，等外层自然终态，再核原3task/4notice整body、22journal物理前缀、config/技能/47源码及精确PID/端口；未填这些结束保护PASS。驱动无用途后按精确hash/普通文件/未tracked或staged先自检再清理，另核不存在。
- R1–R9报告与矩阵历史字段保持，R9真实echo FAIL不改，不生成全绿report.md。Git/PR保存点由Lead负责，不代表goal结束，权威状态为 [goal.md](goal.md) 的ACTIVE/SG10。
- 报告首次长heredoc在shell解析阶段EOF/code2，Node和写入均未执行；独立核round-10尚不存在后改用专用写文件工具。没有借此变更产品或重跑业务。

## 本次归档保护

矩阵现167用例/12列，新增round_10和25项；原142用例的11字段可逐字重建交回R9时完整CSV（SHA256 `9f0d766e796285deb980fa280a572d23887bfb31bccff5cc169ce6e1e65c70fa`），原122用例的10字段也与HEAD逐项相同。新增行round_1至round_9全NOT_RUN，R1–R9报告SHA逐一不变。独立核当前47项仍相同、git diff --check通过。

## 原回执定位

Tests宿主会话 `8d59080e-5ce2-49dc-827d-2663d26a6778` 的已结束 `tasks/<ID>.output`；完整START/END映射留原回执，不复制平台正文、配置或秘密到仓库。

| 执行ID | 输出SHA256 |
| --- | --- |
| `b9mg6uq8o` | `9cb3e78fa08c7734432cbd4faa094439f0ee5c45e16223c27e653f9a73b95b94` |
| `bqpz1986y` | `76f73a36d3e1704abed025971260d3dfef0d7bf02d13bdf2776d4993304ef7c0` |
| `b24nr8a3q` | `673c46e898a06b22ed7cb12f0dd89f6bda673e1533d60efe98e0f705eb34dd71` |
| `btprbo14p` | `d7372a8c7e74782663746948a0ef4ff0f54e640624827e5925f7f7842df9e45e` |
| `bozw4158i` | `e86fa169196a94089f4f41e6bdb1f8147e235d208e0fd46d2596747e79ec94cd` |

Lead guard位于其宿主会话 `7bf40364-200d-4b76-b8b3-18e06195ad4d` 的 `tasks/bddd8bjga.output`，hash见上节。在途外层及Monitor不列入已结束输出表，不预写exit0/结束指纹。
