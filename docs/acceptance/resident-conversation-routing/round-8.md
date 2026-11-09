# 第八轮：渠道中立边界、显式续办与原安装交接恢复

## 阶段结论

- SG10 的 Tests 动态验证已完成。最新 `423a2e97` 版的 live handoff/普通 recover 确定性交错、关联 scope 错误传播，以及原安装已 settled Router 的普通交接恢复均通过并自然退出。原完成任务未重跑，旧续办 proof 未再次调用。
- 本轮通过真实 Host/SQLite/官方 Pi/默认 application 或默认 CLI，使用 loopback 脚本模型及 fake 渠道执行。原安装验证读取私有技能的既有严格收据，没有新增真实模型或真实 DWS 请求、监听、发送。SG9 真实交付只保留第七轮原证据，没有重新验收或重发。
- 结果按各组实际源码与测试指纹分别成立。没有执行最新版本全量 pnpm test、runtime/routing/containment 全组，也不把不同版本的分组相加成一次同版全绿。既有失败、取消及强制清理事实保留，不建立全绿 report.md。
- HEAD 为 `2e6cf2ebf2df41d90aa46af5895a42401988ae4d`，分支 worktree-resident-conversation-routing，存在本任务团队已知的未提交工作树改动。Git、manifest、goal、原方案和原 PR 由 Lead 整合；本报告不声明提交、合并、部署或长期目标完成。

## 用例与真实终态

计数为每次命令的 PASS/FAIL/CANCEL/SKIP，不是去重后的总用例数。退出码为自然退出的外层命令；CLI 旧失败中另行终止的自有子进程不计为自然退出。

| 原执行 ID | 范围与结果 | P/F/C/S；退出 |
| --- | --- | --- |
| bbbk1k02x | 可选DWS typed边界、实际runner→adapter→bridge→插件→统一application本地链、中立读工具、多实例、职责贯穿、身份冷隔离、伪造拒绝、unknown不重放八项通过；neutral材料场景取消 | 8/0/1/0；code1/signal null |
| bax20lrh1 | legacy prepared/unknown payload、operator默认及requester原scope/session、initializer三项通过；legacy冷批次夹具失败；CLI关闭阶段取消 | 3/1/1/0；code1/signal null |
| bppgsm0i9 | neutral漏观察官方schema拒绝，legacy误计合法handoff admission，两项夹具失败 | 0/2/0/0；code1/signal null |
| b8axyawpe | 原legacy packet先于后续事件且各唯一通过；neutral新增pending夹具taskId错误 | 1/1/0/0；code1/signal null |
| b0p9odfb7 | CLI已completed/drained，停在task-completed-shutdown，取消后只终止精确自有PID；不计正常关闭 | 0/0/1/0；code1/signal null |
| bdti8w0rp | neutral材料读取、冻结附件、四项ACL/schema拒绝、禁用渠道终态恢复及pending失败对照；默认CLI真实任务和正常IPC均通过 | 2/0/0/0；code0/signal null |
| bana4lwf6 | 严格原tool input绑定与legacy/neutral精确supplemental冷修复；不重写历史或重入队 | 3/0/0/0；code0/signal null |
| b5h03nfxg | 原安装私有技能首次任务脚本在Router批次未结处失败；后续严格历史证明execution已完成，整脚本不改判 | 0/1/0/0；code1 |
| b3we9iekt | 原30项后第31pending模型前拒绝、另一scope错误传播、默认CLI通过；两个实际续轮被memory admission守卫拒绝 | 3/2/0/0；code1/signal null |
| bockg3hqv | memory修复后再失败续轮及原proof冷拒绝通过；成功例最后误读旧journal的handoff seed，整例失败 | 1/1/0/0；code1/signal null |
| ba779gfp3 | 仅修读取candidate journal，显式续办成功、合法交接、再冷不重放 | 1/0/0/0；code0/signal null |
| beiiysg9s | 原脚本误读DTO session.id，正式续办前失败；不是task终态改变 | 0/1/0/0；code1 |
| brt8jyqyp | 修为session.sessionId后原批次实际settled，后续handoff报NOT_LIVE；整例失败保留 | 0/1/0/0；code1 |
| bc39joqdx | 最新版确定性交错：挂起真实handoff请求，ordinary recover已开始，原owner未中止；共同完成、candidate发布、再冷不重放 | 1/0/0/0；code0/signal null |
| bekhpc09z | 最新scope遍历关联回归：A未结保留，B真实store EACCES传播；模型请求不增 | 1/0/0/0；code0/signal null |
| byaesj68v | 原安装默认application普通恢复已settled Router，仅一次无工具handoff；健康、原业务保护、重复恢复不重放与正常关闭均通过 | 1/0/0/0；code0 |

## 关键行为与修复依据

### 渠道中立、默认组合及旧事实

- bbbk1k02x 的本地链经过实际runner、adapter、bridge、可选插件和默认application，不只替换插件工厂；外部平台调用仍为fake，不记真实厂商集成通过。
- bdti8w0rp 经中立source/material工具读入附件，执行写文件并由Host冻结，向原受众送出一条文字和一个冻结附件；四项recipient/source ACL或schema拒绝有实际工具/官方schema观测。业务原文的厂商字样保留，不机械清洗。禁用渠道冷启保持terminal通知；另一个pending通知保留transport失败，不伪造delivered。
- 默认CLI由initializer生成新私有配置，正式起服务，经HTTP创建真实本地任务，核completed/drained后以IPC正常退出。bdti8w0rp与b3we9iekt均观察两进程；启用渠道0，DWS插件/runner/bridge/adapter加载0、DWS进程调用0，历史group-message格式helper加载1。不能声称所有历史helper静态依赖消失。
- legacy prepared replyRequest和cold unknown保持原payload字节/digest，neutral参数复用原通知，语义冲突仍拒绝。冷恢复先处理原pending packet再处理较新事件，原business input/admission各唯一。bana4lwf6使用严格原生绑定，foreign task/session仍拒绝，不以宽松JSON解码替代运行合同。
- operator默认问题入口只到内部Web；显式requester保持原conversation/session/受众，不产生渠道权限越权。职责配置经实际triage、Router、唯一execution与无工具持久复盘贯穿且隔离。

### 已admitted失败批次的显式续办

正式Host入口为 app.tasks.resumeRouterBatch({conversationId,generation,sessionId,packetId,failedEntryId})。失败entry来自严格官方branch。未改deliver duplicate分支、未换packetId，也未直接改SQLite/journal或调用私有SDK续轮。

- 首轮真实loopback HTTP400持久化assistant stopReason=error。正常关闭与严格冷开后，普通recover不触发新模型轮，原history前缀、唯一packet/admission保留。
- 跨conversation、旧generation、foreign session/packet、伪失败entry、并发同proof、已消费旧proof均在模型前拒绝。Host控制记录不是新用户来源或新授权。
- b3we9iekt用正式task.control产生29个内部事件，加一个用户来源构成原30项batch；再正式source/triage产生第31pending。默认inbox30仍看不到新项，但inbox-count=31；旧proof模型前拒绝且新事件保留。未放宽15条用户输入或总30项上限。
- MEMORY_ADMISSION_REQUIRED是真实缺口：冷开只恢复admission事实，current仍空，显式轮不能再deliver。修复仅factory传已核完整原packet，wrapper冻结admission current的稳定委托在该完整SDK轮临时绑定它，并于finally清除。memory守卫不变。
- Tests在实际SSE请求处读取公开actor.admission.current，核等于严格journal的原{id,messages:[完整packet]}，不是控制消息。bockg3hqv再次HTTP400后current恢复冷开undefined，新增原生错误保留，原proof冷开不能重用。
- bockg3hqv成功例误查旧g1的handoff seed。读取factory合同后，只修为新candidate journal，并精确绑定published rotation的candidateSessionId/handoffId/conversation。首失败保留，ba779gfp3最短复验通过。

### ordinary recover与live handoff并发

- brt8jyqyp原stack指向预创建cancellationError定义行，不能独立证明现场准确交错。只读strict/immutable断点与源码竞态分别核证，不把推测写成观察事实。
- 修前recover在conversation tails外处置handoff/释放旧owner，可能把活跃交接当冷中断。最新lifecycle将recoverConversation与published旧owner清理放进原drain/tail；recover只收集id并逐scope await原schedule，drain内重读当前row。没有新队列、停timer或放宽live守卫。
- bc39joqdx挂起真实无工具handoff模型endpoint，再调用ordinary recover，用真实router.list查询gate证明恢复已开始；此时phase=handoff，原owner signal未aborted。释放SSE后await续办和recover共同终态。实际settled/cursor1/generation+1、published candidate/严格seed、原history/input/admission唯一，再冷无模型重放。
- bekhpc09z只补原unrelated-error单项。A未结告警不能吞另一conversation正式store.query的EACCES；B pending不消费、模型请求不增。注入仅在该store边界，其余调用委托真实SQLite。

## 原安装私有技能与交接的实际链

私有正文/脚本/references/assets不进入fixture、仓库或本报告，仅保留摘要和两文件SHA。原任务始终同一task/session，不新增任务、不重跑execution，不导入旧系统数据。

1. b5h03nfxg先--check/effects0；原execution实际完成skill→read→task_result，两个skill-observation收据分别绑定原toolCallId/resultEntryId。后段ROUTER_BATCH_UNSETTLED失败；HTTP健康和工具成功不能替代整批完成。旧15份strict journal/config/私有文件保护通过。
2. beiiysg9s正式续办前错读DTO，修复仅两处session.sessionId并重新自检，没有重建task。
3. brt8jyqyp实际消费原task.completed：cursor1/event consumed，原g1 active/gen1、lastHandoffCursor0；一次claim/turn、一次成功settle；rotation aborted/interrupted-handoff，无candidate。原task completed/drained/run1不变。此后proof已消费，禁止再resume，原安装连重复拒绝负例也未调用。
4. 断点通过Python mode=ro&immutable=1/query_only读取，先拒非空WAL，前后fingerprints一致，无手改DB/journal。g1为39entries/36535B，SHA186082fdd9c38d719927b0f676000a53e22fb7a372cd4eaeba20dd4795cd3c16；DB995328B/SHA23f161f8b6f07dc468df70cf62436d4eb2888df432e3d113c8666e726b1ceef2，当时无非空WAL/SHM。原只读回执call_b4e30fa2abd647ffb5be5df9e84882e3和call_3cd737ab3b72414d80c77630c53e9407；归档未重复读现场。
5. 最终脚本只接受精确“settled但handoff未完”断点。2026-11-07T05:22:40.748Z的--check通过：effects0/network=false/instanceStarted=false，17strict/16整字节保护，原g1与DB hash一致，技能ignored/untracked/unstaged。成功后断点已改变，不可原样重跑或机械改expected hash。
6. byaesj68v从默认application启动普通恢复，唯一1次tool-free handoff，businessRequests0/executionRequests0/tools-result0/channelTransports0。Router gen2/cursor1/lastHandoffCursor1/active，candidate严格header/seed核对。原task completed/drained/run1、同execution session/completion；task.list/notification.list前后深等。重复recover/whenIdle请求不增加；原packet/enqueued/admitted/claim/turn各唯一，39-entry物理前缀不变。
7. 初始/最终health ok、recoveryIssueCount0/outboundAuthorized=false。app/Host/endpoint正常close，自然code0，无cleanup AggregateError。原config、16份其他journal含已完成execution整字节不变，29source起止一致，技能Git边界通过。

| 私有文件摘要 | SHA256 |
| --- | --- |
| 技能入口，4355B | 560c5ac2e82588f17337b69dd29af478b403542b6733cee83a0cd1db054c07ce |
| 配套引用，11071B | 058769a15c33397ab2fba6988e7127aaa84bc99a2833db82cfd4c778a6080b3a |

## 验证入口与最新受验版本

Node24.19.0/pnpm11.25.0；未加依赖，模型endpoint仅loopback。最新隔离入口：

```powershell
node --test --test-reporter=spec --test-concurrency=1 --test-name-pattern="only through an explicit Host checkpoint" test/pi-resident-router-flow.test.js
node --test --test-reporter=spec --test-concurrency=1 --test-name-pattern="unsettled Router cannot mask" test/pi-resident-router-flow.test.js
```

原安装脚本必须传原config/skill/task，先--check再--run；实际参数不在报告公开，且只适用于执行前精确断点，不能重放。bc39joqdx/bekhpc09z同39项sourceSetDigest=82f0e702dd7d9f6fdef4afc6151963fac3d6827dd9666b5bb65a0d9a35091743，START=END/changed=[]。byaesj68v的29项起止一致，交集与39项相同，额外4项在表尾。

| 最新受验文件 | SHA256 |
| --- | --- |
| `src/channels/message-safety.js` | `2e80fb622a426291d49298bf8686b3a08ebe2b758fd941c94ed0a34a154fe9c3` |
| `src/channels/resident-router-business.js` | `782027bdcb319b3009ab3e1b22f1d0805f647e473ce6b0ba58cc452350f368db` |
| `src/tasks/single-session.js` | `261f4cc7cae5ccca01966e880713c648f957962b4088d97cb3e7550ed1e672e4` |
| `packages/dingtalk-core/task-session-service.js` | `cfaaf8c0217faed404f7d196d90624717721967fcf41736a00d5e2e664b208e9` |
| `packages/dingtalk-core/group-notification.js` | `8508fc53d9b994b255fbef2d5dbdfe20340dec6c5ca1761dfb08469fe281f4b6` |
| `packages/dingtalk-core/group-reply-format.js` | `e41b3d81b038738f845612451e4cda65d8294f309d196d091fd81ae93ed53b20` |
| `packages/dingtalk-core/platform-notification.js` | `57e220a10812b1d2097e7cdeeac822b19689cd443c7beff5935d76f250050139` |
| `packages/dingtalk-core/platform-schedule.js` | `d0118f0df0d5438aeac1a618fa1302633ca044bede3fe1ae114a00c47bf6ea92` |
| `src/tasks/input-origin.js` | `38f6c9ffca712df74a644b296cd9bed37adeed68a38d4175d3842536c91e87de` |
| `src/channels/service.js` | `184c4daf01a20f81c0d1cd71efa6606473545e43292c620aee694fb7f6f7093b` |
| `src/channels/router-lifecycle.js` | `423a2e97d0fff083fc84927d4338c0ef0242cbc09d626235fcf53b1c95a1882f` |
| `src/channels/plugins/dingtalk-dws.js` | `c4dd1b067da0c376367044652625eb5dd7966165cd0d5d30c521dcd619abd5cf` |
| `src/channels/router-ledger.js` | `425b730e772d84b8dd06253695badc44584652137765c1737fd1988ea069198c` |
| `packages/dingtalk-core/task-message-projections.js` | `0fbe37ae98dd301209ad72527503cee0050511d3e640a4608a3370c12a9ee099` |
| `packages/dingtalk-core/dynamic-task-store.js` | `2eaf598ffa90b8d75a2d581f03442a2940d891715b98af2475948ef18fee0b03` |
| `packages/dingtalk-core/group-message.js` | `0e5b36bc8dc2e0ea9ec36426bb5410ad7c143766024f3f6d4120e712d9206eb2` |
| `src/runtime/pi-business-inputs.js` | `6aa4216ed39811fee31bdd0e9711c66de37a317b0b1d5c1553936df4e1e22b9d` |
| `src/runtime/pi-business-admission.js` | `0b37ff49f447a02bde6904a930a4c636af55eddf552e9971052667c140b5c287` |
| `src/pi-official-agent-factory.js` | `f402d9e6084f013a97b239d4198e5c084b2a92f193159e7df47203d57ccfb976` |
| `src/pi-session-persistence.js` | `387d722ed7eff4a4dca38229b7b69c85825f106af4d6a35a4eeeced2cc478d37` |
| `src/pi-authority.js` | `691082a02bb13887253807af83f3592f0494255e618b2ed951a1f9d4bbcfc1c4` |
| `src/application.js` | `cc9f8b30b02c4a8b16acae8b3d8b4496292027c03d81ba32aaacbf1d2ee6bf0b` |
| `src/host.js` | `adccb36da085132375e4d413adb46a891793e99b07c6b547c5dc4d57e27bd1f4` |
| `src/config.js` | `673c669068264a467d8715d923af95e963bfbac45c47b3de774234b8cc99df2a` |
| `src/channels/loader.js` | `3ebe4683bae74bc57c9e0944620dfa770685f038f65644dace2a87d15663d666` |
| `config.example.json` | `99acbc412d3edc9ce6f1ed59329b3b05d193d912fd2219f150c86aa1435798ab` |
| `bin/night-bot-init.js` | `884dd27610cf8460a3a49d919a03aa45ce3e1d7fe091d48dbb48976e5aef2f07` |
| `bin/night-bot-run.js` | `222bbafa0b1e9f9ac71758668a53b8eff458bbdd5bb3d3634624c15dcea27f08` |
| `bin/night-bot.js` | `02764240e585bb334a689a60425c52579c7de3fa413ba52f416d1b7c5f6ec53f` |
| `test/fixtures/memory-host.js` | `773dcbbde4e07fb024423d3ab95a3d1a8d03c3953687460be048cea7e7f44aaa` |
| `test/fixtures/resident-router-host.js` | `00c9a40a36254accceb6f72178f6805736bf844f303bf00698dd237c028c0e3a` |
| `test/fixtures/native-lifecycle.js` | `ad2a65d34afa7ecdb824662c65ed5be1b7e53c12297c6cd389d972c255dc9829` |
| `test/pi-runtime-data.test.js` | `802f690549404424bc958151ea5b25d58ab831dc3bed3c3a43e92f7b26e04516` |
| `test/pi-resident-router-flow.test.js` | `14c64098a0b7ca9ede874a045be55b85a2d7703ab87a4627b3543427f4e1b3d1` |
| `test/pi-resident-router.test.js` | `7bfb3c0d70ab6c0fe6d40936581a176ae49cdf329b6f4b92d02e2e013527edae` |
| `test/pi-channel-plugin.test.js` | `5d6154d567b465f9a9cda4fe1c3b9f1092e175095eb120ec43b032489e0c28e5` |
| `test/pi-task-input-origin.test.js` | `e273cd168e808de93985da42761f380d8f9c7342e6dc2c7e9f278b8892975c1f` |
| `src/runtime/pi-official-session.js` | `1cef70fa0e9020100953f29fa24b4db8e12485f5e29d537ca78c9dd7596d6780` |
| `docs/acceptance/resident-conversation-routing/scripts/private-skill-check.mjs` | `efb92ce5b45d6b5594235a68fb936319ffef9120e8f691cdaccb32b9b2874052` |
| `src/native-skill-filesystem.js` (原安装额外) | `4ef8728d235fbe65085f6176d6af8d1f19344863ec1f13826acce385dfd5f877` |
| `src/native-tool-skill.js` (原安装额外) | `4b571f36d206d70a5f6d42943075df297cb8a95fda3c1e44eb83d820d99dcb32` |
| `src/memory/private-fs.js` (原安装额外) | `66afb37d6acde1391d12bb1d2f571382a8098d48eb2363fd919e002ad18f4385` |
| `packages/dingtalk-core/session-skill-refresh.js` (原安装额外) | `5742a4f221077d013a7a813f0e58a7b523e15a5cf7c69a46aaab074617938c0f` |

## 原回执索引

详细输出留宿主任务记录，未复制私有日志或技能正文到仓库。本报告保留结果、关键失败与版本摘要。Tests会话8d59080e-5ce2-49dc-827d-2663d26a6778的tasks/<ID>.output；Lead guard会话7bf40364-200d-4b76-b8b3-18e06195ad4d。

| ID | sourceSetDigest | 原输出SHA256 |
| --- | --- | --- |
| bbbk1k02x | `24e57ffda3317e2e97edb6752cad6dfeeea351b1f0f9c4b93780b06df417749c` | `fa2d5016b6e13168cdd305aacff82b2d9d70852021c63d3d42855ea844d57cba` |
| bax20lrh1 | `cbefdb426332eb90158566756a2e88688e1b14ff3fe635ecd0dac0fdef09cbd4` | `014fbf978705529572a89fa052703245aed9e92a16fbbf54ea17cfcf5f6e7ea8` |
| bppgsm0i9 | `29a097664cb8bb00cae2f5a34d3aa9af74ce1164e497afb22b9ece60c292ef67` | `4d5b3f2b045ecb41b9770c9716efd2fb3272080fdcb5a38af9865c2cf0490064` |
| b8axyawpe | `6a5ed7d3c0ecc1c9ea309effefe4da5afa826654ab21f4c84f6adfce357017c2` | `77de42ea30e63be792f7e5c5bdd4615e9e57aadae9a3540571de04f3e83e5041` |
| b0p9odfb7 | `6a5ed7d3c0ecc1c9ea309effefe4da5afa826654ab21f4c84f6adfce357017c2` | `a993ea1abfb5c20f0c594ca74a7955eb3e6a3bd46e5711040be5969ce26723a8` |
| bdti8w0rp | `0d3fe49a547a358cb3d5e430cf86690eeb53c6e50f316ca0433a0ae51f8864d5` | `ef1f0c5e950b5e28a4501316037f5ce7d14f142f43c9e43087ad0f89cd35b919` |
| bana4lwf6 | `各项映射见原回执` | `87d6dd14197992fd09ccc9951cec6e6f03c7335466138f320d6e9da0bc81f19e` |
| b5h03nfxg | `各项映射见原回执` | `46e877050eeae9b7dbdc9a716fcfb409cd7de8cff3d4b4e4c0a33f73ed6f0efb` |
| b3we9iekt | `13796bc8c77710d26b05ab0a4b2828a65595ef012aae7f465a372d39761b3ee1` | `b53af8a675f06ad30652b13ac6a65c43e2a73511ccb4cc9a449e3f83ee0ee307` |
| bockg3hqv | `06818b4b1e11d4e8ab9aef5bf574d83bd3a350f6bcde0658a6f64686f8868f61` | `19f21cfa4ec0215e5bd7d2f64798f23594437560f3609b5d09d6e18955879e31` |
| ba779gfp3 | `211762a18db07647e49b16a9a13418dbcbf99331568b412365dd4c6a8ab4f8b8` | `5973707b2a9fd5fa4fee7dddf084a1a6d1eba29cc69a08ab80f6e8ceac59646e` |
| beiiysg9s | `各项映射见原回执` | `10e66a74580084a4e23a137f8211cc44c0cc544c068d0eb6d0a03997c7333066` |
| brt8jyqyp | `各项映射见原回执` | `db4daf676893205749112b93ce19ffaeaabf87fc67df19fc3b23909cb71dd828` |
| bc39joqdx | `82f0e702dd7d9f6fdef4afc6151963fac3d6827dd9666b5bb65a0d9a35091743` | `41ae2a5c00be25a0bd1302925a6d44b923ccf2f2e54fb140864ff9c4671dc716` |
| bekhpc09z | `82f0e702dd7d9f6fdef4afc6151963fac3d6827dd9666b5bb65a0d9a35091743` | `cc01bdcda047946dfaa102ecc525e36247b43e8d7ba2930a3f2cc3f789387b0a` |
| byaesj68v | `各项映射见原回执` | `26baef1dc769ad4c4ccf9adcdafe8371e3448a45ecc04e3280a54ce6c6b58f0f` |
| b5kq76lkg | 24项START=END/最新423版 | `e36c297dbbae947a1e0989bc3f2ef6875af1f84cc2a222622da56adc484c3146` |

## 旧组版本与验证边界

- bbbk1k02x至bdti8w0rp的lifecycle为1000b332f5c5ef24ce0666579aff8e3dceada8ee5d3d0e664e374beb1a9d7f5f，factory为9d556d6fa206e3f8a1bf571012da75b29b6bd13ae0561f8cf70bd0ef232f587a。它们只代表当时分组，不是最新续办实现的同版整组通过。
- b3we9iekt：lifecycle=63c4a379e72f92bc7a37154f786e8901dbca88259f2d3aff214988c5c66affe7；factory=9dca163bf9927512eec992ba3fad330fb7eccf2e0a4f8588415f35f168f4c24a；wrapper=401ec3db63d86a456664bd36c759e143173b9b01cdda97747de6ce3cbebbaa3e；flow=3a938aa65cc54c689e821e9a28681d15c97b4b9b9e78b4f28efd934ca25837c7。
- bockg3hqv至brt8jyqyp的lifecycle仍63c4a379，factory/wrapper已为最终表内f402d9e6/1cef70fa。bock flow=ac4e07534b3d6c766d4110412cde494b71e99e78a4d814c0937ec1c8a18977d1；ba779 flow=2d7dbb093737e9aecd2444afcb635df2fa0d0ff5f8f850f1dc898d60ddc944d2。
- 原安装脚本：首任务版c10bce1933f89cc1713fe1a0eb626f5afc61881bcdfcb51f67b35d630d67d121；DTO误读版42d176b7e21f8e23bcff24897f0c2d4c86d00b7814885ae517b400fe9bc6b9ce；settle后handoff失败版00c994a2a3e63a59234e6fb736eb24fc67674c7da52f70dc51e194ccc8256e91；最终只普通交接恢复为表中efb92ce5。各次风险动作均先相同参数--check。
- 最新静态guard为Lead的b5kq76lkg，Tests独立回读并核输出SHA。pnpm check及whitespace自然0，24项START=END、绑定最新423版；405 production/runtime、191 bare imports、0外部SDK/旧编排定义、194 retained/56 adapted、relative imports closed、HTTP routes retained。旧b96up6axa仅绑定63c版，不冒充最新结果；Tests未重复跑guard。

## 保留风险与后续交付

- bax20lrh1和b0p9odfb7的CLI失败/CANCEL及精确自有子进程强制清理保留，不能记正常IPC。后续正常CLI与原安装code0不证明Host/application在close抛错时的串行清理短路风险消失；未无条件解锁producer、owner或data lock。
- Windows进程隐私与sandbox限制仍按已有实际边界说明；不能用第七轮48B附件或本轮脚本模型宣称广义开发运维替代完成。Linux contained runbook未在本机实跑。未关闭应用sandbox、放宽dispatch或以跳过替代通过。
- 本轮未新增真实厂商验证。第七轮旧unknown保留，不以新成功补producer排空证明。最终DWS send/受众映射能否等价复用R7，由Lead/Review按最终diff核验；需要的真实只读回读或新触发不由本报告冒充已执行。
- 本轮未另建现场实例、执行者、分支、PR或定时器；无Git写、CI、生产部署、合并或新增秘密读取。原安装只按既有授权受控运行并自然退出，不继续监听。私有技能仅保留原安装忽略数据，不复制为源码fixture。
- 无新增截图、dump、录屏、仓库内原始日志附件或一次性fixture。第八轮集中归档时，经零副作用路径/大小/hash及原任务提交一致性自检，只清理round-4的verified-3-web-continuation-result.json和verified-6-router-result.json两份旧证据；清理前分别1478B/fe9802aa、18966B/a5879141，完整指纹及清理标注见round-4.md。round-1至round-7报告、原结论/文字证据和matrix全部历史值保留，未动Web控制台证据或其他目录，未留备份。本轮无待清理的自有临时文件或运行进程；宿主输出不搬入仓库，不清理其他会话资源、live WAL/locks或私有安装数据。
- Lead/Review/Docs接回本轮证据，完成窄审、替代边界说明与原PR整合；Tests本轮动态范围无剩余在途操作。总状态以唯一[goal.md](goal.md)为准。
