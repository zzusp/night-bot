# 第十一轮：DSH迁退与SG12当前验证检查点

> 附件清理说明（2026-11-09）：按只保留最新轮最终证据及大 binary 不入库规则，本轮目录中已无当前用途的 31 张 PNG 与 4 份 trace.zip 已经精确清单 --check 后以同清单 --run 清理。正文中的截图名称、哈希及“保留截图”等描述仅记录当轮历史，对应二进制附件现已清理；原文字结果、PASS/FAIL 和受验版本边界不变，普通文本证据及复用脚本保留。

> 私有原始观测：`round-11/windows-probe-results.json` 含本机安全标识，仅在本地 ignored 保留，不随 Git 交付；原文件未删改，相关失败与边界摘要保留于正文。

## 阶段结论

本记录是已结束验证批次与Platform生产写权交接的检查点，**SG11/SG12尚未完成，不是最终全绿报告**。唯一目标仍为`goal.md`，由Lead单写；本记录集中保存Tests结果，历史轮次不改写。

- `runtime`完整组：162项，150通过、12跳过、0失败，exit 0。514文件受验清单起止无漂移；随后共享UTF-8测试夹具已变；本轮后继DWS专项已使用修正版，不据此宣称最新工作树全部通过。
- `domain`完整组：393项全部通过，exit 0，548文件受验清单起止无漂移。结果仅绑定该清单，不自动覆盖随后变更。
- `default`完整组：1234项，1202通过、6失败、26跳过，exit 1；运行中4个Web文件变化，且保留叶测试PID105072曾受控停止的事实。日志虽列cancelled 0，不能把整组称为自然、同版通过。`pnpm test`的`&& pnpm check`未执行。
- Web当前独立整套：Node 29通过、build exit 0、browser 30通过，各组起止无漂移。真实Chat Host专项另计，末尾forget仍失败，不以这套Web结果替代。
- 默认组五配置调用方定点：实际4通过、1失败；新核`default-config-targeted-source.json`的`source={}`，故`sourceChanged=[]`不能证明执行源版本一致。保留原记录，不补造历史哈希，不将4个通过提升为当前同版验收。
- 本批DWS与Windows必要回归均已结束、消费者排空；DWS源交回Core，Windows源交回Platform。两者当前已验证范围见本轮后继批次；不重跑旧Windows probe、不动旧Profile资源。

## 受验版本和证据边界

工作目录为本worktree，分支`worktree-resident-conversation-routing`，HEAD为`bbb7508d93f350b29fe341b921692e63cddc20e1`，另有大量已知协作未提交修改。**HEAD不是受验源码全集**。本批没有commit、push、CI、合并、部署或真实渠道外发；测试使用隔离目录、local/scripted模型和fake DingTalk。

各完整组使用`round-11/final-<group>-source.json`内实际文件哈希；Web使用`web-chat-current-source.json`。新建`tests-handoff-source.json`只记录交接时6个待验测试/驱动文件，不是已执行版本的补录证明。

| 结果 | 日志及可定位终态 | 日志SHA256 |
| --- | --- | --- |
| default exit 1 | `round-11/final-default.log:1273`，结果`final-default-result.json` | `19238949ebc73624f9d4cf641edcd80eb53fece31448889b380d7fb75e88dbb4` |
| runtime exit 0 | `round-11/final-runtime.log:389`，结果`final-runtime-result.json` | `7d423d632b5c45ad2157ab2e77e1402da72e515f567649c61676badf6720a0bd` |
| domain exit 0 | `round-11/final-domain.log:406`，结果`final-domain-result.json` | `09253c110262f8edfcf9da65dab1ca9ae426cdd57626cd694d25540742344627` |
| 五配置定点4通过1失败 | `round-11/default-config-targeted.log:46`，结果`default-config-targeted-result.json` | `dfa74eef74a3629dd502df70509173ed6477f4a7417112df279e9d44113b6779` |
| DWS冷补录定点失败 | `round-11/dws-cursor-cause.log:9`，结果`dws-cursor-cause-result.json` | `43d76fafe946a1c9ea8fe24f1cce3d17162b1d2ce3fff4cdf4afac3b55acd4d6` |
| Chat forget失败 | `round-11/web-chat-forget-boundary-browser.log`，结果`web-chat-forget-boundary-run.json` | `572e0950f8d60c70da417c86bdd1d72a3b89a2b321553a84ffee3cc7f99f6b00` |

以上日志哈希已在本次归档前独立计算核对。default的4个漂移源为`packages/web-console/server/plugin.js`、`packages/web-console/src/ChatPage.tsx`、`packages/web-console/src/api.ts`、`packages/web-console/src/styles/app.css`。不把不同时间的通过结果拼接成一次完整同版通过。

## default六项失败及处理

| 原注册/位置 | 本次实际失败 | 已做修改与当前状态 |
| --- | --- | --- |
| `test/pi-channel-plugin.test.js:529` timeout冷补录 | 完整组在typed deferral lower bound等待超时 | 未改产品或注册。另一次fs-cause定点到cold complete history admission仍超时；根因未收敛。 |
| `test/pi-resident-router-flow.test.js:62` durable receipt echo | `DINGTALK_PLUGIN_NORMALIZED_CONFIG_REQUIRED` | 测试改`validateDws`规范配置、每channel单目标和fake认证绑定。定点又遇`CHANNEL_PLUGIN_NOT_READY`；随后补手动`night/ready`的`app.config.resident.taskSessions.ingressEpoch`和真实ready状态断言，尚未复验。 |
| `test/pi-runtime-data.test.js:102` 默认CLI真实任务 | `INVALID_CONFIG` | 未知fixture provider需显式本地api/baseURL，已补测试入口。定点实际通过，但源码清单缺失。 |
| `test/pi-runtime-data.test.js:218` initializer通用私有配置/不覆盖 | `INVALID_CONFIG` | 同上；不改生产模板、不恢复隐式provider兼容。定点实际通过，但源码清单缺失。 |
| `test/pi-schedule-wire.test.js:338` 持久提醒真实CLI冷恢复 | `NIGHT_BOT_RESIDENT_CONFIG_UNSUPPORTED:dws` | 测试移除旧`resident.dws`。原重启、文件效果一次、回读、不重放断言保留；定点实际通过，但源码清单缺失。 |
| `test/pi-wire.test.js:82` headless CLI/health/drain | `NIGHT_BOT_RESIDENT_CONFIG_UNSUPPORTED:dws` | 仅迁测试配置。真实CLI健康、正常IPC关闭及冷恢复模型配置定点通过，但源码清单缺失。 |

定点仍验证无vendor默认加载/探测，未用恢复旧ABI、跳过认证、缩短业务样本或放松业务断言解决。receipt跨群改不同channel绑定，仍保原事实、精确echo过滤、变内容/actor/flags拒绝及跨scope不误滤。

DWS两次超时阶段不同：完整组为typed lower bound未持久化到预期；cause定点为冷恢复未正式接纳同一条消息。cause日志无`DWS_CURSOR_FILESYSTEM_CAUSE`，不能把该结果继续归因为底层fs错误。现有底层诊断重新throw、不吞错/重试；产品由原owner处理。

## Chat真实Host链与UTF-8根因

验收沿真实`POST /api/chat`，Host/Pi/SQLite和页面执行过程，不以任务详情ExecutionHistory、Router工具名/计数或组头代替Chat实际工具输入、输出、分页及状态。

最新失败链实际越过：A的Router模型调用挂起时B从Web创建唯一任务并完成排空；之后释放A，长中文目标/结果保真、原图bytes/hash及模型非空PNG输入、Router查询完整结果和换代；Chat展开关联task/session，实际read输入输出及`task_result`长输入逐游标分页；真实reflection生成memory/skill、正文尾部可见、scope 403、stale 409及只读刷新不增模型/journal/state。最终在forget后旧skill正文GET返回403而非预期404，整条专项仍为1失败/0通过。

此前失败与修正集中如下，均不改生产语义或放宽必要断言：

| 失败证据前缀（`round-11/`） | 证实的测试问题与修正 |
| --- | --- |
| `web-chat-absence-contract-*` | `task.get(...,true)`缺席返回null；原脚本错误期望undefined。改为null，仍要求A未创建。 |
| `web-chat-page-count-*` | 原summary转义/格式化成JSON后不止两页。按真实`nextOffset`读至null，每页绑定HTTP响应、正文范围/内容，核最后尾标。 |
| `web-chat-receipt-contract-*` | `task_result`输入含完整summary，输出是`{received:true,accepted:true}`。输入完整回拼，输出精确回执且实际可见；业务completed/drained/Router结果仍独立验证。 |
| `web-chat-learning-selector-*` | substring同时匹配memory和skill卡。改exact heading；未截断字段可省略，禁止`truncated===true`。 |
| `web-chat-forget-boundary-*` | 脚本直调底层`memory.store.forget`，漏正式`memory.mutate`内Reflection派生清理。已改官方actor显式“忘记 experience/<key>”，但未复验；继续要求旧change不存在返回404，不把403改成通过。 |

底层store路径失败不能证明正式forget正确或错误。下一次必须核正式forget结果/回调完成和旧skill拒读，同时独立计入显式忘记产生的一次合法模型请求，保持之前只读阶段零推理及旧任务journals不变。

长中文损坏已通过因果证据定位在`test/fixtures/memory-host.js`：Buffer分块独立转字符串使跨块UTF-8中文成为U+FFFD。全部消费者排空后新增一行`req.setEncoding('utf8')`，责任在测试HTTP输入边界；不改原文/中文样本、不换ASCII、不缩短样本。修正后SHA为`923ca3c6d85c1180eb4411902b5176ae0374506cbde9e8d7ce1d1089dc3008c1`；后继DWS Host专项已无preload实际使用，完整Chat专项仍未复验。

待验Chat脚本`docs/tmp/tests-web-real-host-browser.mjs` SHA为`ff9cfa6430cd4f6e70f7e668d02098ba8d7ad552bd4d81dcd622b3d54c1f1ac3`。下一次不带`scripted-model-utf8.mjs`诊断preload。最终执行/learning截图尚未实际看图，不声称视觉验收通过；成功后实际看最终图，并将可再生成驱动归既有acceptance fixtures桶。当前没有可宣称完整PASS的Chat结果。

Web独立整套证据为`web-chat-current-result.json`和对应node/build/browser日志：29通过、build 0、30通过；471文件源集有效，不能与Chat专项混为一项。无影响部分不重复整套运行。

## Windows、Docker和剩余执行边界

- Windows：ad8e root→leaf已过的OS步骤不重跑。整体仍BLOCKED/run exit 2、`productionAdmissible=false`、`deletionGate=false`，full/privacy保持fail-closed。Platform已接既定生产写权；ordinary/ConPTY默认接线及必要清理未闭环。不碰旧65bae/ad8e资源，不用父PID退出替代Job0或句柄关闭。
- Docker：两镜像12项network-only证据继续保留且未重跑。显式TUNA参数的修正版r5已实际build成功；原入口sandbox自检仍有namespace阻断。详见下一节，不把build成功当应用可用，不降TLS/验签或sandbox。
- Topic/latency：七旧review/reply wrapper尚未逐注册迁退；latency首项旧执行协议已在本轮后继精退；现有原文/图像/来源/version/隔离等有效合同须先保留当前owner覆盖。没有整删混合文件、恢复Owner/Topic协调器或九次常数门槛。
- 最终routing/containment及`pnpm check`本批未取得闭环结果。当前runtime/domain通过不等于最新全工作树五组通过。

## Docker实际构建与沙箱阻断（本批追加）

Dockerfile新增两stage显式`DEBIAN_ARCHIVE_URL`/`DEBIAN_SECURITY_URL`后已实际执行，不再等待原源ECONNRESET。Review发现空`?`/`#`校验缺口，实际写者修为原参数`/[?#]/`后，Review独立确认两stage反例闭合；Tests未并改Docker生产文件。

| 尝试 | 实际结果与版本 | 证据 |
| --- | --- | --- |
| r3 | exit1，490源无漂移；Tests驱动误把容器代理地址用于宿主Docker CLI，registry auth无法解析host.docker.internal，未到APT | `docker-build-tuna-result.json`/对应log，日志SHA `303c507130a00ba6e0d58ffa8441b9a93504465995463e59b3d70efe7e68a0f7` |
| r4 | 修Tests代理作用域后build exit0，490源无漂移；Dockerfile `9066be8d`，image `e96a8ffb`，是空分隔符修复前版本 | `docker-build-tuna-r4-result.json`/source-map/log，日志SHA `e679c126f658453f09798420af015cfe144cc651779e4b3ae6ea0f389e88ebd4` |
| r5 | 修正版Dockerfile `df07054a690870100b73ab03dbfa508bab48775fe7fa8dff72050c9ed0b776a8`，build exit0，490源无漂移 | `docker-build-tuna-r5-result.json`/source-map/log，日志SHA `aaebf83bebad8ff2182325f52f65fd4336e368b6b0b06d15e42d1289bf7e2c8d` |

当前保留镜像`night-bot:sg12-tuna-df07054a-r5`，独立image inspect核到`sha256:b3964940df2d6abcfc8e27dbfba00bca01ff5f00dbcd75e5bb8e1202eb77f713`，linux/amd64、USER node。TUNA两stage的InRelease、APT严格TLS/原Signed-By及包摘要验证未关闭；DWS tar/LICENSE/NOTICE摘要OK、pnpm按锁安装、Web build成功。代理无凭据，CLI原环境与构建预定义proxy args分离，未改全局/daemon代理或把proxy值写入日志。

r4原入口`--check`在非root、network none、只读根、cap-drop ALL、no-new-privileges及显式`seccomp=builtin`下实际exit1：`bwrap: No permissions to create new namespace`，随后`NIGHT_DOCKER_BWRAP_UNAVAILABLE`。未启动应用/模型/登录，不把文案推断为宿主内核不支持。`docker-image-check-result.json`保精确参数和终态Pid0；日志SHA `6e0785dea0b114c88d85040cd616b08ecda5c19b76d9740b98736447edcc4f7f`。自有容器与新卷先cleanup-check，终态/所有权核实后精确清理并独立确认不存在，见`docker-image-check-cleanup.json`。r4旧镜像标签已在无消费者检查后精确移除，见`docker-superseded-image-cleanup.json`；未prune共享缓存。

r5未机械重跑同样完整check。经Review先审①②后，唯一只读容器按相同安全边界读取sysctl/LSM和版本，`docker-namespace-info.json`实际exit0：uid/gid1000、CapEff=0、NNP1、Seccomp2、max_user_namespaces=15629；另外两个sysctl为ENOENT，LSM原标签`kernel[NUL]`。Node24.13.0、bwrap0.8.0、DWS1.0.67及util-linux2.38.1实回，strace缺失。pnpm版本读取因当前无卷镜像内`/opt/night-bot/data/temp`不存在而exit1；完整入口未走到该步，未用临时改TMP掩盖。只读容器已独立确认自动删除，无namespace尝试。

匹配Engine26.0.0/8b79278的官方v26.0.0 default.json与default_linux.go已读取并保内容哈希（`9c1025c8…`/`4529ff8a…`）；clone的NS mask、CAP_SYS_ADMIN条件及ptrace的kernel条件仅作候选解释，不替代实际syscall/errno。随后③已获既有范围内技术审查并执行，取得真实clone EPERM；再按固定官方基线加单精确clone规则对照，clone成功、后继mount EPERM，详见下节。生产seccomp未修改，不能仅据文案归因内核或LSM。不会加入privileged/SYS_ADMIN/SYS_PTRACE/unconfined、关闭AppArmor或改系统配置。

## 库存、交接与下一步

`matrix.csv`保留round 1–10全部字段，新增round 11列和17条本轮摘要（含本批Docker阶段5条）。旧timeout冷补录用例本轮标失败，不能继续拿round 10通过当当前结果。

`test-case-inventory.csv`仍5364行；仅更新default六个实际失败注册的最新证据及边界，原`file/occurrence/registration_sha256`身份均不变。四项定点PASS保留真实TAP结果，但显式注明空源码清单；receipt标失败及修正未验，DWS标实际冷补录失败。不批量给其它历史PASS赋当前有效、不用缺module/runner遗漏推定退休。

当前Tests无在途后台操作。Core接回DWS生产写权并处理工具公开投影；待server冻结后，接receipt及既有无preload完整Chat链，纳入未知工具/未知字段秘密反例与合法业务输入输出保真，不以全部隐藏通过。Docker下一最小差量由Review据mount证据判断；fe541e3b镜像temp修正与新卷/非空恢复卷显式离线重建须在同一必要稳定镜像验证，尚未运行。Windows三P2定向已通过但不代表生产LPAC可用。最终组/guard与Topic旧注册迁退仍待完成。

本检查点只维护上述已结束批次和真实未验边界，Lead仍负责唯一goal/spec及最终Git交付。中间诊断资源暂保用于尚未闭环项目；最终证据确认后仅清理本任务不再使用的脚本/日志/旧截图，历史round报告保留，不清live资源或其它会话文件。


## 后继批次：DWS冷补录、Windows非OS与Docker syscall

### DWS真实诊断与最小修复复验

- `dws-cold-diagnostic-utf8-*`：原timeout仍FAIL，984源无漂移、923夹具且无preload；日志SHA `53c4fea0475aba72cb24fd1dabd8377b4e78cca4d3f85cfc30cc221d9d9bffa8`。失败在cold-admission：history曾覆盖deferred，但complete空读后恢复下界已清，冷启后范围不再覆盖；source/triage均0，health却healthy/backfill ok，errors为空。不能归为fs或仅UTF8问题。
- Core修三插件源：DWS `845dbb7f6024213066b5b0369a3707fd5e662b9c5fef245feb451c8d1e9a78f1`、storage `d7b0c082097090c677893675f2d7e9d105c9c4c3d9a1a0f8d85f6c295a411a5d`、ingress `a10ecc730f390f0b2a66b4b9f596f7c10bebbacf85fce5d2b54b541089fd552f`。仅持久pin已认证暂缓消息身份/时间，正式处理或精确自回声才解除；旧bridge snapshot不能覆盖消费元数据，complete页缺已知消息拒绝。不加新调度/retry、不存正文副本。
- `dws-cold-fixed-timeout-*`：原注册1 PASS/exit0，984源无漂移；旧消息source1/triage1、send1、成功恢复才清界，日志SHA `a6c2e4a03dc57b5dc673d355ffbd51c384836b0b582ac16647a5586da09cedd9`。
- `dws-cold-fixed-related-*`：4 PASS/1 FAIL、984源无漂移。error冷补录、永久unknown拒接纳/保界、精确回声、CLI check零写/跨日起点均PASS；唯一FAIL是新增纯store测试夹具漏三个路径字段，日志SHA `9b266396439edb0d8f596c55123e9bb22610fd0add9438b60144d8b80bc54124`。
- 补齐隔离夹具后只复验该失败注册，`dws-cold-fixed-store-*` 1 PASS/exit0、8源无漂移，日志SHA `db1fcce7df7453bc3ac1b3b6921a67d2c015cc56d251d0993e69f4c785486ae6`。证明旧快照不抹pin/新消费、cold重开保pin、缺已知消息空页拒绝、consume后才允许advance。未重跑上述已绿四项，不拼成一次6 PASS同版整组。

### Windows准备、传递和拒不安全降级

`windows-prepared-regression-*`初轮21 PASS/3 FAIL；三失败为新增Windows路径字符串夹具转义错误，改String.raw后同一最小组复验。`windows-prepared-regression-r2-*`为24 PASS/0 FAIL/SKIP/CANCEL、425源起止无漂移，12生产源独立核同冻结值；日志SHA `674db8cda39d976fb6c2a1de42cea3e327829d0fb7ef8827864b1c5dfdfacc05`。覆盖真实两sandbox/local到spawnSpec的WeakMap、pwsh复制、work/tmp交集、原argv、严格IPC、fallback/node-pty拒绝、真实runner在current-token解析前显式未就绪，以及async/generator前置拒绝、INHERIT_ONLY OWNER RIGHTS拒绝。

Review新增三P2后Platform修正并冻结：contracts `3bfc078c03bc79f32836640c58fa14e4accbf8ef4685f937ba7a05449cac7a40`、privacy `04ed53a7198a566eb213368a70b7239940fdc212324f3483e562a561a52cc65a`、native-sandbox `877b3a3be8d5f705505b6cf8c784c67039907fe5f08d39780aa3dff6c3ba655a`。`windows-private-policy-p2-*`最小5 PASS/exit0、425源无漂移，日志SHA `01eb8d2b14052aec48d5e4dc48311e0333f3db96fd815282da7ae418ba22b6b5`：拒taskRoot:null取消task写界、伪根及尾点/空格；真实createPrivacy识别Windows TASKS并限制work/tmp、拒sessions；custom Windows两mode在wrapper/grant前拒绝，原custom正例显式POSIX。此Windows执行未覆盖POSIX大小写分支，亦未执行native policy/Profile/ACL/OS旧probe。24 PASS不冒充新三源全组通过，5项只证明该差量，production/full/cleanup仍未验。

### Docker取证和单规则对照

Review审后的专属取证镜像从r5 image b3964940派生，只增加可信Debian strace并恢复USER node；image `29687f6ea17d26028ab3f8575edd6b2ae71191f0e11e4ca07d06d586edc6e45c`，base ID/layers、Dockerfile和TLS/验签核实。`docker-bwrap-strace-result.json`原builtin下实际clone（三NS+SIGCHLD）=-1 EPERM，未启动应用。

`docker-clone-delta-*`按Review独立核过的官方v26基线SHA `9c1025c8…`仅追加一条amd64 clone arg0 EQ805437457；候选前后SHA `470618eadd7ae452860ae2e3c75a92f55dd212b56756d1641746ab34371aaef9`。相同image/argv、node UID1000、capdrop ALL、NNP、root-ro、network none、私有tmpfs且Mounts=[]，原clone现返回17成功；紧接 `mount(NULL,"/",NULL,MS_REC|MS_SILENT|MS_SLAVE,NULL)=-1 EPERM`，stderr为`Failed to make / slave`，bwrap exit1。wrapper exit0只表示取证完成，不能当sandbox可用。日志SHA `e3b27ef656f7d38c7554f9dbb93cb4774100cdb91dea1e4564fbff0ae9f659ae`；本次容器终态Pid0，cleanup-check后精确删除并独立确认缺席。未追加规则、cap或启动应用；下一责任层交Review。

当前Dockerfile fe541e3b的data/temp修正尚未重建实测；旧/恢复非空卷由runbook新增显式privateDirectory离线准备，不能让只读check隐式写卷，也不能以新卷copy-up证明旧卷。新卷/恢复卷owner0700、symlink/权限失败仍待同一必要镜像验证。


### 后继mount差量与Docker当前明确边界

`docker-mount-delta-*`使用同29687镜像、原argv/安全参数，无卷无宿主挂载。官方基线及clone32规则逐字段不变，仅追加amd64 mount的source=NULL、type=NULL、flags=573440、data=NULL比较；seccomp不能解引用target，不声称目标仅/。profile `40e9a1836ce1c1b4cc4194466d4fc352399845be4b6277c637be7967159f5cf4`前后同；driver `15573fb61b27a5a26d9aaf7629a409d39471f9bb11e0001447d04733c09684d5`。实际clone=17、传播mount=0，下一`mount("tmpfs","/tmp","tmpfs",MS_NOSUID|MS_NODEV,NULL)=-1 EPERM`，bwrap1/wrapper0。日志SHA `702abfb3f9413ca5062d9984841a6de7b5a5c46ccdd5056b8fbcc505d31d3254`；90234780专属容器终态Pid0，经cleanup-check/cleanup及独立命令核缺席，未启动应用。

Review已独立核证并比较三案：按指针地址允许不能表达字符串语义；按flags+NULLdata允许会开放任意source/target/fs的新建挂载类别，超出现有不泛放mount边界；当前采用停止此分支，不追加规则/cap/旁路probe。现有seccomp default ERRNO1仍足以解释tmpfs拒绝，不能直接归因LSM/内核。继续此Docker沙箱分支需要原授权方接受该真实诊断范围，或提供已授权可用的隔离执行环境；本结论不阻断Chat/Windows。新fe541镜像及新/恢复卷temp验证仍未执行。

### ConPTY资源原语实际运行反证

- 冻结生产win32 `4ee4bc2a5d60592d8c07c2860a18a1ede31dc85d4d5f03fb21991e72f734178a`，probe `7b45434839a965369a34aa99662ebc97d25413a4f6278f06d359ad63aea5cb65`；仅本次两个同步匿名pipe/HPCON create/resize/worker close，不建业务payload/Profile/ACL/Job，不动旧probe资源。15项源码起止无漂移，见`conpty-primitives-source.json`。
- `--check`自然exit0、JSON preflight PASS/effects0/pipes0，日志SHA `0b3f8c4e2f47ffc5f9a73ff485a3e1a0af48d4cd5689c88d24f92f3ffa59407f`。不把此视作真实API已通过。
- 唯一`--run`由受管Monitor `bjvbzryih`接回异常exit139，执行器原文`Segmentation fault`；run.log为空、无run JSON。原始执行器输出另存`conpty-primitives-executor.log`，结构结果见`conpty-primitives-result.json`。HPCON状态、handlesClosed、EOF、closeReturned均未观测，不能把崩溃或命令结束当显式清理通过。未重复调用native；消费者已结束并交回Platform写权，由实际ABI/调用最小差量定位，下一probe必须分列真实调用阶段。
- 独立非native `conpty-dimensions-*`仅原sandbox入口尺寸前置拒绝单注册1 PASS/exit0，5项源码无漂移，实际调用前拒0/负数/非整数/超signed SHORT/缺值。既有24/5项不重复，未报终端provider、生产LPAC/full通过。


### latency旧执行包装器精退

只删除首注册“真实协调器中九次非法旧决策不挡住新图文任务，公平续行不消耗请求重试次数”及其专用旧SDK/Topic协调器构造。退休的是group_*菜单、role路由、公平切片调度和固定九次校验协议，不将旧计数门槛移到Pi/Router；原来源/图像/跨会话隔离、只接纳不完成等业务合同仍有效，当前入口见库存，不声称新完整Chat已验证。首注册原identity和`d22e0516…`hash保留，记RETIRED而非PASS/SKIP。

同文件历史Host动作阻塞跨重启注册原样保留，`latency-retained-history-*`完整文件单注册1 PASS/exit0，33项实际import闭包起止无漂移：重开后topics/messages/routeHistory/taskReservations/outbox逐项相同，重复决策不新建Task，blocked与原错误保留，未应用操作不能提前完成。当前file hash和日志全SHA分别绑定source/result；没有整删混合文件、恢复旧ABI或重跑旧九次协议。其余Topic wrappers与最终五组仍未收口。

### 当前等待边界补充

主控后继同步纠正两项前提，尚无对应新执行结果：Web是安装access-token认证的本机单操作者控制台，私有业务/Skill不直接等于操作者无权；Core按operator→task/session/learning真实scope最小修正，不新增public-proof账本，不将文件正文全隐藏当第7项PASS，原Chat read正文断言未改。此前aec6262b候选未启动，读权已交Core继续修改。

Docker的“不泛放mount”由主控明确为不无条件ALLOW整类或关闭过滤器，不要求指针字符串匹配。下一numeric flags/NULLdata候选必须先由Review核真实权限范围、namespace与能力共同限制；若可证初始namespace仍不可写且不增宿主权限，才由Tests做一次原bwrap true对照及初始namespace拒绝负例。当前尚无该候选执行，禁止无条件mount、SYS_ADMIN、宿主挂载/daemon改动或应用sandbox降级；不把规则条数少当安全证明。前段停止建议保留为当时判断，不据此另造真人审批门。


### 最终operator工具投影与原真实Chat同链

受众纠偏后的server `a38fdbe8d0cab8bcfd22f7a10a16b576fa4bd0da0793d87429560270a74e3f91`、plugin `313171bd…`、Shared `e8f9b6e9…`。使用既有安装token/operator cookie、Chat groupId、严格task/session journal与learning binding/scope/version；没有新增public-proof账本、HTTP operator参数或弱化原read正文断言。read/read_window/grep声明的JSON样式业务string不误当DTO，未知输出反例放在structured task_result；孤立/重复/名称冲突不能误配，合法JSON正文保原始空白并全页无损回拼。

- `web-tool-projection-*`两个受影响文件完整12 PASS/0 FAIL/SKIP/CANCEL、自然0，9源起止无漂移。日志SHA `40c4e994ff21a5af0d30e43fd94ac5e76f192e3f65a3a39518ecbe584c2cc5c1`；12条按完整注册名唯一匹配回填，保原身份，补遗漏7注册。库存5383、matrix196；未以汇总PASS推断其它case。
- 原 `docs/tmp/tests-web-real-host-browser.mjs` 未改，用原生req.setEncoding('utf8')、无preload。受管bpopqgrlk自然0/1注册 PASS，无FAIL/SKIP/CANCEL；476实际source/dist起止无漂移。完整版本见`web-chat-operator-final-source.json`、终态`web-chat-operator-final-run.json`，浏览器日志SHA `181758fd21e103fac1704a7cf871e5ce379e66b196319aad16e9c5f83eda5d85`。末尾phase=forget诊断来自Node结束时t.signal abort监听，不是业务失败/取消，实际cancelled=0。
- 两task各唯一session且completed/drained；A的实际模型挂起期间B经浏览器真实POST Chat完成。25991字符来源、21630字符目标、24224字符结果原样核验；114字节PNG经Host材料/read_image进入实际模型请求，MIME和像素一致，Router generation1→3，正式结果查询已核。仅scripted/local模型，没有真实厂商调用。
- Chat页实际展开执行组和read输入/输出，原CHAT_ACTUAL_TOOL_OUTPUT可见；task_result输入逐页核UI及完整回拼，receipt仅received/accepted。跨Chat/task404、无认证401；收起组不预取session，刷新不推理、不改task journals/learning state。
- memory168字符、skill8700字符授权全文等于reflection.inspectTask，UI最后STEP_TAIL_5可见；越scope403、旧version409。正式用户忘记experience入口后仅新增1次模型请求，原skill正文404，两个task journals不变。业务结果`web-chat-real-host-result.json` SHA `984240dc0cc97a1d019e62ca4752c2c552ca27f449de8f9ce8747a2fd3f0f350`。
- 两张本轮截图已实际读取查看：`web-chat-real-host-execution.png` SHA `9fe25434a76f12543f3e7bedf36498d19fbc81501d2fd1048c46f1977afadbfd`，真实read输出可见；`web-chat-real-host-learning.png` SHA `ac467d087c4d5b2f89944d4f31040f448a12a78c0355bbb6cd677a35f285c419`，授权skill正文尾部可见。同名旧截图已由本次拍摄更新，不以旧图证明新版。
- 实际dist index e811d08e、JS54d2b85f、CSS93cc56b2，完整hash在业务result。未重复构建或跑Web整套/CLI/DWS；旧整套保持原版本边界，不拼成本版全量。

### ConPTY阶段日志版第二批反证

Review前审probe `4f8169baa4de69694adb1f166597ec13f115b7471998d22c485805689997ed82`、win32仍4ee4bc2a。原资源范围不变，check自然0/PASS/effects0/pipes0后唯一run；blfdtlbjq异常139。`conpty-primitives-r2-*`分别保存15源、check、stdout、native stderr、Bash executor和result，sourceChanged=[]；原139批全保。

同步日志证明Node v24.19.0/Windows x64 PID59784；两CreatePipe成功、CreatePseudoConsole HRESULT0/state open、首Peek成功、Resize HRESULT0，input-read/output-write/input-write三个checked-close返回。随后Close worker dispatch返回、owner closing，最后seq32 operation-join.before；无worker callback、109 EOF、output-read checked-close或终态JSON。stdout SHA `b498a8fc16104a08addd5a453676c0a3e872958407cb3dc106879d1a31670197`，native stderr为空，executor SHA `1eceffb180cb1ef1962e5102440234b5f4c27237f287c110c8eb7040469c3a73`含Segmentation fault。最后marker只限观察区间，不独定并发崩溃原因；dispatch返回不代表native Close完成。

独立Get-Process -Id 59784确认该PID缺席；同次crash UTC21:39:56–21:43:56的Application事件1000/1001只读查询返回NoMatchingEventsFound，异常码/故障模块未观测。未开dump/调试器、改WER配置或扫描/清理helper。outputEof/closeReturned/handlesClosed继续not-observed、productionAdmissible=false；不据命令退出宣称资源收口。生产/probe写权已交Platform定位；未重跑同包，Windows full仍未完成。


### 单句文案最终构建展示

新主控e3限定关联任务说明纯文案；消费者核查只见ChatPage.tsx:109的p节点，JS/TS测试与原真实driver仅用class定位，不依赖原说明字符串。Docs只替换为“这里保留本对话关联的任务，包括已完成和已归档任务。展开可查看执行过程。”；不改行为、布局、class/aria、DTO或其它UI。Docs自报原build含tsc/Vite277自然0；Tests独立绑定ChatPage `24cc27707a5506d313ed7490164bac2a58c2c18562576344e3d01db7bd9f1076`、index `af60150f83e5fa59fdca3b2d1eb4baf609f45f96026dd4a39da2db7b9d87a092`、JS `7c1b6ff3b63e29db5a7496ce66a66b492edac92ef91971fb8b84c4454a22716e`、CSS不变93cc56b2。

最小`tests-web-chat-copy.mjs`使用既有隔离preview业务fixture、真实HTTP认证及实际静态资源；bqmcncfjy自然0，新句逐字可见、无pageerror/横溢出，9源起止无漂移。结果`web-chat-copy-result.json`，截图`web-chat-final-copy.png` SHA `171a745c3b21ef48f49fb86bf752463acebb5e2c8a1ed7d9c79ee1e6dd02f7cd`已实际查看。该图Router样例未提供执行数据、显示暂不可读，只证明限定文案，不把它当真实任务链或生产健康证据。没有重跑刚已通过的完整业务链；前段476源业务PASS及两张真实Host截图仍准确绑定原ChatPage9b54872/indexe811d08e，未追认到新构建。

### 零ConPTY异步控制反证

Review前审probe `d4154a2fe6717f0a46fd85ec6dd775c1eb9092c19448c380261af54805757fb2`、win32仍4ee4bc2a，check0/PASS/effects0/pipes0后，只执行互斥--run-async-controls一次，未执行原--run。b30sf2ojk异常139，15源起止同；`conpty-async-controls-*`保存独立原始两路输出及executor/result，原两次139不覆盖。

Node v24.19.0 Windows x64 PID26328；GetCurrentProcessId async dispatch/callback均返回且number=26328，Sleep(0) void async dispatch返回后139、没有void callback或终态JSON。stdout SHA `a3c327395aa64ed5c4ff7627b6fe35c1ad6e018577df43137257339a70a132b4`，executor SHA `fab29dd369ed303660691dcb6a842cadf72d43fcdc4029198dcfde8597b0452a`含Segmentation fault，native stderr为空。独立准确PID查询已缺席；此模式无pipe/HPCON/Profile/ACL/Job，不据此清理旧资源或称Close已成功。反证说明无ConPTY/并发Peek也能复现void异步故障，不能独证nullptr具体崩点。生产/probe写权已交Platform，productionAdmissible=false，未改Koffi包/源码/配置或重跑同包。

### Docker创建文件系统差量及初始namespace负例

Review完整前审后，固定官方9c1025c8及前33条全部不变，仅第34条mount arg3 EQ6/arg4 NULL；profile `04f21a5f71902da454de66cda328a099417b2aa8a6bf3dc95e46b9e604e778b7`，driver `b9bcda0aef6ce948ac0add0b9f0d6b100c9530c57a7137f5eb5b2990b498f878`。本规则允许相同数值参数的new-filesystem类，不能限制fs/source/target字符串；不称仅tmpfs到/tmp。--check自然0/effects0后唯一bb734cwak，原29687取证镜像、UID/GID1000、五caps0、NNP1/Seccomp2、rootro、network none、owned64m tmpfs、Mounts=[]不变，无应用/厂商/宿主挂载或daemon改动。

实际kernel6.6.114.1-microsoft-standard-WSL2。初始namespace的libc精确mount(tmpfs,/tmp/sg12-newmount-negative,tmpfs,MS_NOSUID|MS_NODEV,NULL)=-1 EPERM且子exit0，证明拒绝并非未命中新规则。此前后mnt/user身份、五cap、NNP/Seccomp及root mount逐字段一致。仅负例成功后原bwrap argv唯一运行：clone=27、传播mount=0、创建tmpfs=0，下一mount(newroot,newroot,NULL,MS_MGC_VAL|MS_BIND|MS_REC|MS_SILENT,NULL)=-1 EPERM，bwrap真实exit1。wrapper/container0仅表取证完成，不能报sandbox可用；到下一阻断已停，未预加bind/remount/umount/pivot或特权。

`docker-newmount-delta-result.json`/原始log SHA `178fcad28d660f467e3a8837e23935df5c1b38e57c061f5841e62eba8b91ec0a`，profile起止同。专属367b6d3a容器终态Pid0，经cleanup-check0→cleanup0，另独立inspect精确No such container；`docker-newmount-delta-cleanup.json`保原身份。本批无在途容器，下一最小bind类及初始ns安全边界已交Review，不把数值规则少当安全充分证明。最新fe541镜像及新卷/恢复卷temp仍未重建实测。


### Koffi3.2.0修后异步控制与真实ConPTY原语

Platform仅更新package/lock中的官方Koffi闭包3.1.1→3.2.0并正常frozen安装；Review已独立核原字节baseline、完整非Koffi锁图、官方root+16optional闭包及实际安装，无静态阻断。Tests未改依赖或生产ABI，独立核package `40436c7d767fb0381f08af6d58a65a76d0d82989618ae3db11eff5eb9f2cc536`、lock `0ffcb3b02f659e439cc858fe5176f69a39b5d4b9bdbb185fedd6c891d57b2438`，workspace allowBuilds整字节b16b376a不变，win32仍4ee4bc2a、probe仍d4154a2f。实际metadata SHA `3b7a363693801907911dc932ef7a4cd4f89ba4e2b7cd3e8af6d78d0d1c2b3ee7`、call.cc `ce3b41b048284a499a71a538f88ba5514aea4a5bf26c1a87a1b25ea80de9b33c`、Win64 native `c2345e8178dc3cac051e1066c7082028d3096959050bcf3e6d46a0e839e64b3f`；官方call.cc:1638将空FFI返回转换为env.Undefined后才传入异步callback，未伪造Sleep void或改变其声明。每批在原15项上纳workspace、安装metadata/call.cc/Win64metadata/binary，共20项起止核，不用win32SHA单独代表native版本。

先唯一check自然0/preflightPASS/effects0/pipes0，再原--run-async-controls一次；bnn73wjdt自然0，Node24.19.0/x64 PID78548。真实GetCurrentProcessId callback number=78548，Sleep(0) void callback typeof undefined，两callbackError=null，两个operation fulfilled、handlesClosed=true、resourcesRetained=false/pass=true，零pipe/HPCON/Profile/ACL/Job/payload。Tests独立读全stdout和终态并核日志摘要后才进入下一步。证据`conpty-koffi32-controls-{source,result,check,check-stderr,stdout,stderr,executor}`对应.json/.log；stdout SHA `b39d7e489a56783570b5c25eaa56839fddacba861cb990b431afec95b4e55515`，stderr/executor空，20项sourceChanged=[]。

控制满足前门后仅原--run一次；bf5q8ddc3自然0，PID80536。两CreatePipe success1、CreatePseudoConsole和Resize HRESULT0；seq33 ClosePseudoConsole真实worker callback error=null，seq34输出EOF/Win32=109，最终四端点input-read/output-write/input-write/output-read各checked-close一次，close-returned且owner null、output-drain/pseudo-console-close均fulfilled、handlesClosed=true、resourcesRetained=false、errors=[]、pass=true。重复close同Promise、close开始后resize拒绝断言保留。证据`conpty-koffi32-primitives-{source,result,stdout,stderr,executor}`；stdout SHA `c08bff03b0dce945a83ee5f7bc50de0682f6da72b19c0364ed6f7bdd0951bbb8`，stderr/executor空，20项sourceChanged=[]。独立Get-Process分别核78548/80536缺席，结果中分列；这不替代实际close/EOF证据，也不证明旧批资源已清理。

本批仅证明官方升级后无ConPTY void async故障及真实ConPTY原语均通过，productionAdmissible=false；未创建LPAC/Profile/ACL/Job或payload，不能外推生产LPAC/provider/完整业务隔离。原三个139及旧HPCON/helper/handle未知原样保留，不用新成功追认旧资源。两批终态后已向Platform/Review交回证据与写权，无新消费者在途；下一生产LPAC/provider必要复验仍待具体包。没有重复已过Web/DWS/store，没有真实厂商、CI/合并/部署或Git写。


### 当前合同下完整Web浏览器套件

既有browser.spec.ts:37仍要求read输入保留path/token隐藏占位，与最终server只准入offset/limit的合同冲突。Tests仅将该断言改为{}，未改变fixture业务输入、输出全文、callId/name配对、来源/状态及敏感值不出现断言；本测试文件SHA `34247d65f088e4252190d413bcfa668f795a03c19653e97b7f3acad7c66d64ca`。没有为求绿恢复被拒字段，也没有改产品或重建dist。

实际命令`pnpm --dir packages/web-console test:browser --output ../../docs/acceptance/resident-conversation-routing/round-11/web-browser-koffi32-artifacts`，boc2mrgxm自然0。完整配置同时包含browser.spec.ts、chat-lifecycle.spec.ts及表驱动展开，真实30 PASS/0 FAIL/0 SKIP，用时1.6m；最初按未缩进顶层声明计18的元数据假设已按实际逐例日志修正，不重跑。481项产品/测试/安装metadata/native与最终dist起止sourceChanged=[]；其中win32已是6670f5db改名版，以实际source map为准。前述纯文案后的dist index af60150f、JS7c1b6ff3、CSS93cc56b2实际消费；这是既有隔离preview业务数据、真实HTTP认证/路由/静态UI的完整浏览器回归，不是原476源实际Host/Pi/学习forget业务链重跑，也没有真实厂商调用。

`web-browser-koffi32-{source,result}.json`及`.log`保存实际版本/逐例结果；原始log SHA `b6ad38f0c0992e01b12f3f0932597eea0aeda5b93e3da4d2cc205492282b5dd3`。stderr仅pnpm原脚本命令回显，executor为空。30例逐完整file/title匹配唯一ok行入库存，不从汇总推断PASS；已有27身份registration SHA保持，三个实际新增注册按TypeScript真实CallExpression源码范围补齐，库存5383→5386。矩阵新增完整browser项，累计202。suite自行关闭preview/SQLite，未停止其它实例；当前无browser/Host/native/Docker消费者的结论仅指本批结束时，不覆盖后续独立批次。


### ordinary Job、精确bind/pivot观测及七旧包装退休收口

本阶段为`bbb7508d93f350b29fe341b921692e63cddc20e1`加既有未提交协作工作树，各批分别绑定source map，不以HEAD冒充受验版本。无Git写、CI、真实厂商/模型调用或部署；已过controls/ConPTY和30例browser不重跑，原三个139及旧资源unknown不改。

**Win32 ordinary Job。** 既有首个真实spawn用例仅增加同进程`selectContainmentMode('ordinary') === 'windows-job'`前门，阻止fixture吞warn后的fallback假阳性，原argv/output/spill/独立reader/abort/取消断言均保留。测试SHA `a52c8df9b349ca242da591fe4c635a0700615131ff54082ffad9301dd435a6c1`，win32 `6670f5db`、官方Koffi3.2.0。实际命令`node --test --test-reporter=spec --test-name-pattern='^local process fork (runs exact argv|refuses pre-aborted|cancellation)' test/pi-native-process.test.js`，bkbbgy0tg自然0、3 PASS/0 FAIL/CANCEL/SKIP；21项起止sourceChanged=[]。`win32-ordinary-renamed-{source,result}.json`及原始log SHA `5d4ac1ebc70161021f2ca87dcba38a8fb8339ccbb96bc0bc8fd18a199cb4f5e4`，stderr/executor空；三原身份/registration SHA保留，逐完整spec名唯一日志行入库存。只证ordinary Job，不是LPAC/provider/full；ConPTY两批仍绑定改名前4ee4bc2a。

**Docker第35条bind差量。** 最终driver `268ece14f3cfa05303e600a377f7828e2543de5d1022744d8af054bfdfbaf56d`经Review前审，保负例后先回读三快照再准入bwrap。固定官方v26基线9c1025c8、原forensic image29687f6e，仅新增mount AND数值类arg2=0/arg3=3236810752/arg4=0/amd64，profile SHA `f4807c28e2843dd1e458e97a780b6af64ee7b5729add3f5bff784c4b2c5c7b4f`；不声称限制source/target相等或newroot路径。唯一check0→run，bll44jxex wrapper/container0，初始namespace同形self-bind精确EPERM/negative PASS；before==afterNegative==after，UID/GID1000、五cap0、NNP1/Seccomp2/rootro保持。子ns原bwrap clone、传播、tmpfs、newroot recursive bind成功；bwrap真实1，下一stderr为pivot_root EPERM。该批trace未含pivot_root，不捏造参数。`docker-bind-delta-result.json`及log SHA `8891be22adcaaa742af36d598afd24fbaaefed5fb9494803a0718a06bb671dfe`；fb101459专属容器Pid0，经cleanup-check0→cleanup0及独立inspect准确缺席，无业务卷。

**仅追加pivot_root观测。** Review独立逆差量确认driver `54946f73241ac46b5c0b19f9186c2864587d4b2720e9fda8af04f7a4c35351bd`仅追加strace的pivot_root、新owned身份和不覆盖证据前缀，仍f4807c28策略、原argv/负例/三快照/全部安全与清理门，无新规则。唯一check自然0/effects0后唯一run，bc8pranaq wrapper/container0，bwrap1。真实trace：`27 pivot_root("/tmp", "oldroot") = -1 EPERM`；前序recursive bind已0，初始ns负例PASS、三快照相等、profile起止不变。`docker-pivottrace-result.json`及log SHA `98cb0c04632918f6fca25b9733ae430100f6fa7ff842ce92a790ce79a1fbcfcf`；99f699c1专属容器Pid0，cleanup-check0→cleanup0，再独立inspect1/准确No such container，cleanup.json保身份。只完成取证，未跑应用、未预放pivot/umount/remount，下一最小安全边界交Review；生产sandbox与最新镜像/新卷/恢复卷temp未验。

**七旧review/reply包装精退。** 复用`review.md:680`逐注册合同表，Acorn顶层AST精确移除七取消协议包装，仅随退独占readReviewSection helper与无消费者TASK_REVIEW_MAX_CHARS import；未整删文件、恢复旧ABI或加shim。test源2743b670→5eaecbc8、151→144顶层直接注册，`node --check`自然0不算业务PASS。`topic-seven-wrapper-retirement.json`保七名/原行/当前body SHA、移除边界、144保留根和七条修改前完整库存。原190库存身份与registration SHA不变；七条原NO_CASE_EVIDENCE现为STATIC_RETIRED_NOT_PASS，不标PASS/SKIP。原文/来源/版本/群隔离/可靠通知unknown读回仍归现有Host/Single/Router/Store/Pi，现行reply8000不冒称旧40k/全翻页ack协议等价。createTopicCoordinator import及其它144根保留，Core静态核134仍依赖factory、10不依赖，不能宣布DSH030/031全清。Core续核产品归属，Tests沿原库存逐注册迁退，不把190全PASS当退休前置，当前该文件只读短窗不运行。

库存仍5386、历史身份零删除；矩阵202→206，新增四项，原139/失败不覆盖。本阶段集中归档，不新增单命令轮次。

附件收口：本批browser仅保留已实际查看的execution-context.png与learning-scope-and-version.png及最终.last-run.json；另外13张自动截图与已消费的两临时归档脚本经--check后精确清理，独立枚举确认仅余两图、两脚本缺席。完整30条逐例日志/源码map/结果和历史报告保留，截图仍仅preview fixture，不冒充真实Host业务链。格式检查发现topic-runtime当前全文件CRLF被git diff --check报行尾空白；该文件处于Core只读短窗，本阶段不顺手格式化改SHA，待134逐注册迁退时统一保持LF并复验。其余本批测试/矩阵检查通过，不把该项报全绿。


### 十二项有效合同、190历史身份与两旧执行源退休

本阶段仍为bbb7508加已知未提交协作工作树，不以HEAD替代实际受验源。test/topic-runtime.test.js由5eaecbc8迁为`9e569637bf7663ad2c99f675297ec3a995841ecb3f7779ba455165f0b273013a`：十个独立根原体仅CRLF转LF、assert不变；历史Store取消/blocked reservation移到historyFixture，保原六断言；官方Host真实enqueue与稳定packet验证pending、SDK入站与durable ACK间隙、foreign facade拒绝，不把旧coordinator自动生成提醒的次数/epoch协议冒称等价。删除132个旧直接包装及六个顶层表驱动语句（13展开变体），解除createTopicCoordinator/setup消费者，不恢复旧DSH ABI或新加shim。

实际命令`node --test --test-reporter=spec test/topic-runtime.test.js`，任务btecjwjkq自然exit0，逐完整注册名12 PASS、0 FAIL/CANCEL/SKIP/TODO。434项src/核心包/fixtures/测试与依赖配置起止sourceChanged=[]，stderr空；真实log SHA `e2565429`（完整值见result），source/result及完整逐例日志保存在`round-11/topic-current-contract-{source,result}.json`及`.log`，result SHA `434524760b09713e9ec6ecd6ed97feffbe4f651b114c41aa1713f14483853286`。node --check及该测试git diff --check均0，前段CRLF问题已在9e56版本修复；不改历史当时失败记录。

原库存5386条零删除，topic-runtime原190个file/case_name/occurrence/registration_sha256身份逐项保持。当前8个历史身份有完整对应PASS，4个为部分合同迁接（含三项既有改名与Pi提醒包装），不能把它们写成旧注册整体PASS；其余178为STATIC_RETIRED_NOT_PASS：本批132直接根+13表驱动展开+26字面嵌套，以及上一批已保留的7个退休。静态退休不算PASS或SKIP。`round-11/topic-factory-wrapper-migration.json` SHA `1308009cf83eabfda9fa92c09921506548fa80874ea7a8f5550cadbb78584e47`保存逐实际assert/tools/十类当前owner、190映射及183条修改前完整库存；原七项证据保留在上一独立proof。闭包原字节副本归`round-11/topic-factory-consumer-closure.json`，SHA2bac2787不变，Core已精确清自己的tmp副本。

Review逐断言独立审查后，更正原reply映射的三分支措辞：未指定taskDelivery且未显式选择受众的普通文本仍默认原消息/作者及通知原作者；显式受众、最终文件或platform分支不隐式通知；replyToSource:true须显式受众含原作者，缺省/[]/缺作者拒绝，[]仅非quote分支可不提及。依据task-session-service.js:774–798及CHANNELS.md:120/126；不恢复旧at参数/候选全读门，也不凭owner引用新报PASS或证明旧12k/40k/三次协议预算等价。

Core在12根终态交还写窗后，精确--check/effects0再--apply/effects1退两旧执行源。单一证据`round-11/topic-execution-retirement.json` SHA `67603d509e9355dd19c8536065cc212a9c00b45b8008405542a22690c890217b`含五次真实工具记录、首次来源名单被误判consumer的拒绝、后续两源各check/apply及独立缺席回查。Tests独立核JSON/hash与两路径实际缺席；topic-model仍e4be9758、测试仍9e56。12PASS绑定退休前434项源码，退休后runtime缺席不追认为当前仍434源齐全或守卫通过。source-manifest/check-coverage仍由原单写完成退休登记；该依赖闭合后再执行三守卫及最终同版五组，不等待Windows/Docker其余队列，已通过Web/native批不无故重跑。

### Windows注册谓词原语首次实跑

已审脚本1dc34c95、唯一参数34d9d0ad先Check自然0/effects0，再唯一Run，监视任务buamlg1zc自然exit2，stderr空、源未变。真实结构化失败为pre-create identity / Exception / Native identity/path mismatch：Create未尝试，profileCreated=false，Delete未尝试，handlesClosed=true、nativeOwnerRetained=false、profileState=not-created。没有创建/删除Profile、变ACL、子进程Job或模拟身份/网络能力，不补删、不重跑同条件。此处尚不能区分Host root、USER_Classes或Mappings哪条原生身份比较不符，保留未收敛，已回Platform提供最小只读诊断方案，不能放宽Same门来求绿。

脱敏摘要`round-11/win32-registration-primitive-result.json` SHA `f03d1380d8b6d778ad19353d15b4757eb9804161d28a4f5e81a2213e3038de41`；原始SID/本机registry路径/PID/随机moniker绑定仅在已核ignored的docs/tmp私有日志/result/owner中，公开摘要只保相对证据名与hash，不上传。该失败不证明registration缺席、API存储绑定、LPAC/full、生产准入或旧资源清理。旧三个139及原unknown保持，不用本批结果追认。

本集中批矩阵206→209（12根、逐身份退休、注册原语FAIL），库存仍5386。无commit/push/CI/合并/部署、真实外发或模型API调用；当前没有本批在途进程，注册原语已自然退出，剩余是来源登记及具体平台身份诊断依赖。


### Windows只读身份差量观测收口

在原注册动作FAIL后，Platform只加观测与显式IdentityOnly隔离分支，原Review同版前审通过。源ed363a8f、参数a89b84be按JSON实参先Check自然0/effects0，再唯一Run，任务byqe9oozb自然exit2；实际source/PID/moniker/readonly marker一致、源起止无漂移、stderr空。Host root的OrdinalIgnoreCase比较true，user-classes比较false，首错仍严格拒绝，mapping-parent尚未观察。仅比较不含私有值的形状关系，actualClasses等于actualHostRoot加Software/Classes，而原预期是独立USER_Classes；这定位了错误层，尚未证明哪种持久hive/merged-class合同正确，不能据样本放宽Same或跟随链接。

IdentityOnly下SID derive/leaf/folder/Create/Delete不可达，实际create/deleteAttempted、child/job/ACL/impersonation均false，handlesClosed=true/nativeOwnerRetained=false。独立仅按本次准确PID回查未观察到进程，不据此追认任何旧资源清理。脱敏结果`round-11/win32-registration-identity-result.json` SHA `156652f3f9c0a6010878427d0c2c29e77cf55da7fdaee71894cf7c9e599731c8`；原始实际/预期native名、SID/PID仍只在ignored私有证据，result SHA6ecc6626、run log2d9db211。原1dc3注册FAIL及ed36严格拒绝都保留，不将exit2写为通过或证明registration缺席、存储API绑定、LPAC/full、生产准入。

矩阵追加本阶段观察，209→210；库存5386与190身份映射无改动。Platform已接具体user-classes层证据做官方合同分析；不原样重跑。已消费的Tests迁接/归档脚本topic-test-migrate.mjs和tests-topic-archive.py经check、准确hash清理及独立缺席回查，最终proof/逐例日志保留。下一Docker pivot候选目前仅静态生成，未Check/Run；主线来源登记使用单次原生文件事件等待（bn4ax79ky），两清单交接后才核三守卫与最终同版五组，不用等待通知冒称已完成。


### 退休后守卫与pivot最小诊断集中收口

原生文件事件任务bn4ax79ky自然exit0，实际观察两项退休登记交接：source-manifest为596a3d48、coverage为0252645a；两旧源status=retired-driver、lastRetained/sourceSha与原许可/历史adaptation保持，原203 pins和其它201记录不改。Tests按原职责一次`pnpm check`，绑定`post-topic-retirement-source.json`实际1110项代码、测试、安装native/dist与守卫资料，起止sourceChanged=[]：coverage自然0（190 retained/10 retired/3 excluded/57 adapted）、production imports自然0（393文件/191 bare imports）；native在`src/process/windows-acl.js`未登记差异真实失败，整体exit1，不能报三守卫全绿。actual为5c43642a，legacy当时仍bb3e4710；完整source/guards-result及原始stdout/stderr保留，未降断言、修改源或盲改hash求绿。

Platform随后按原Root域交接更新process/legacy五pin，Tests独立核当前d5510969/4d8d3b72为该1110集合相对失败基线的唯一两处变化，windows-acl pin现匹配，代码/测试/安装产物其余全不变。Platform的单native守卫0是其本域结果，不拼接为Tests已跑完整三守卫。原Root当前没有可核可接收的入口，原Lead消息满队列被丢弃，全部按未发送；不猜旧pipe、造新主控或以沟通阻断拖住既有Tests执行权。Tests冻结`post-topic-retirement-final-source.json` SHA `68a432a68686ddafa7d3528db642f25bfa45200fbb571af26afb7f6a151f5dd1`的1110项实际版本，已启动b9d0qrkbm串行原五组：pnpm test、test:runtime、test:routing、test:domain、test:containment；第一组原脚本自带pnpm check，不人为跳过、另造重跑器或先宣称通过。每组原始日志、真实exit与sourceChanged按完成后原位保存；当前尚无最终五组结果。下一Windows3856/a57c仅只读包排在五组之后，不能成为主线前置。

Docker仅诊断第36条pivot_root规则：profile117a1609严格等父35条f480加独立amd64 ALLOW，seccomp无法限制路径字符串，明确只用于诊断、不进生产。原前审driver bd7650ad先Check0/effects0，再唯一Run bmymusysl，真实wrapper/container1；初始namespace负例实际上pivot_root(/tmp,oldroot)=-1 EPERM且negative进程0、三快照相同，但strace把等号前补五空格，旧includes期望单空格而passed=false，安全门阻断、bwrap=null。原FAIL/metadata observed=null均不追改；实际log a37758e3及result、analysis5190673f保诊断原因。09b68e92自有终态容器先cleanup-check0再cleanup0，独立inspect准确缺席。

仅格式解析修正的新driver874de743经原Review同版前审：每行只规范等号两侧空格，再匹配原完整call/返回/errno；原捕获trace离线匹配，换ENOENT或路径均拒绝，非业务PASS。换全新owned身份和证据前缀，profile117a、原bwrap argv/clone与全部权限不变。唯一Check0→Run b2238t4wi自然wrapper/container0，初始ns原形EPERM负例PASS，before==afterNegative==after，UID/GID1000、五cap0、NNP1/Seccomp2/rootro、network none/无host mount与业务卷保持。真实子ns trace pivot_root(/tmp,oldroot)=0，紧随其后的mount(/oldroot/,/newroot/,NULL,MS_BIND|MS_REC|MS_SILENT,NULL)=-1 EPERM，flags=53248，与旧MGC类3236810752不同；bwrap真实exit1，到此停止，未增加下一规则、启动应用或调用厂商。

最终证据`docker-pivot-spacing-result.json` SHA `890a4629f96f200fcefd32e436ef2bc81667bdeec75d71975b087ae900ec1c54`，原始log SHA `3405ec378ea7d83abc53517bc12a211c37b333cf1d733852e12ebb9b0e4c560f`与metadata.observed逐字段相等，profile起止不变；cleanup证据绑定完整自有137a5f6a ID/image/Pid0，cleanup-check0→cleanup0后独立inspect确认缺席。Review已独立读回结果、完整trace、运行seccomp对象与清理绑定，不声称其做过Docker删除。容器0不等于bwrap或应用通过；生产sandbox、最新镜像/新卷/恢复卷temp仍未验，原139/旧unknown仍保留。

本集中阶段矩阵210→213，库存5386和原190身份映射不变；无在途Docker/Windows原语，当前唯一行为验证是原五组任务b9d0qrkbm。所有源码与guard输入维持冻结，静态私有方案准备可继续但不并行OS批；无Git/CI/合并/部署/真实外发。


### 独立IdentityOnly并行与Classes链接门终态

按实际读写集收窄上一检查点的整批排队：Tests仍是唯一OS执行者，但独立probe无需等五组。3856/a57c不在1110受验源内，产品/测试无字面消费者，独立pwsh只读系统DLL、Host token与固定64-bit registry父链；写集仅本批ignored证据、内存和编译临时资源。没有热改生产源、依赖或全局持久状态，没有重跑或强停原b9d0qrkbm。Docker874已终态并准确清理，无新已审差量，本阶段不增加Docker动作。

只读批先Check实际exit0/effects0、stderr空；唯一Run宿主taskID b22r691g5，自然exit2，真实PID82968与source/参数/variant/IdentityOnly/输入绑定全部匹配，3856fce1/a57c5ab2起止无变化。host-root与user-classes两次原生名严格OrdinalIgnoreCase均匹配；紧接user-classes的SymbolicLinkValue查询实际LSTATUS0/type6(REG_LINK)/bytes138/absent=false，原NoLink仅接受LSTATUS2，所以在这里真实拒绝，mapping-parent未到。未读链接目标或跟随链接，不放宽Same/NoLink，不把两个原生名匹配写成完整身份/注册通过。

真实错误为pre-create identity / Exception / Registry link metadata not definitively absent: 0。createAttempted/profileCreated/deleteAttempted、ACL/child/Job/impersonation均false；SID derive/leaf/folder/存储API未进入。handlesClosed=true、nativeOwnerRetained=false、retainedHandles=[]，独立Get-Process准确PID未观察；这不证明历史unknown清理。productionAdmissible/storageApiBindingVerified/cleanupComplete保持false，profileState=not-created。

脱敏证据`round-11/win32-registration-classes-result.json`绑定原始私有check/run/result/owner/executor完整SHA；原始SID/名称/native路径仅留ignored的`docs/tmp/sg11-profile-classes-*`，未入公共摘要。private-result d889e9f3、run.log e4cd9e72；本批未覆盖原1dc3/ed36失败或Docker首跑FAIL。矩阵213→214，5386注册库存不变。真实link/Mapping未达状态及私有原始入口已直接交Platform/Review，源/owner收口后立即释放私有PS/参数写权，准备下一必要方案不等五组。给root终态回执返回ENOINBOX，按未发送，不猜旧地址或循环补发。

生产冻结依据与私有包区分：原b9执行器在本会话transcript第33189行的既有Bash内联Python，读取final-source SHA68a432a6的1110项；每个原组开始前核全体hash、结束后再核并保存sourceChanged，非空exit3，五组终态才写combined。Platform列出的12个process/privacy/shell源全部命中，含windows-acl=5c43642a与runner=1b42f8c0；最早无漂移释放点仍是b9整批自然终态及结束指纹，不以单组已import或阶段包结束提前热改。集外无Host消费者的私有方案/探针、review/CSV/spec不冻结。


### 原default单worker受控收口与父runner推进

原b9d0qrkbm的`pi-resident-router-flow.test.js`全部17根已有逐项终态（16PASS、1FAIL），原日志973–995与冻结文件a368d2eb的完整名称唯一对应；失败是`durable receipt echoes tolerate later DWS flags without replacing existing message facts`。准确worker104860创建时间和完整owned父链、两次CPU递增、无子进程/TCP及原用例80/90/120秒Windows边界已核；runner没有文件/进程整体timeout，不能把日志久未更新单独当成挂起或无限等一个不存在的整体超时。Node逐case终态不证明所有资源排空，具体JS保活点与该FAIL完整assert/stack仍未收敛。原诊断`round-11/default-flow-worker-diagnosis.json` SHA fb526062153a8ee4dfb82e24c424c94c06cc94b7ceac2a19d448b9c49a602637保持原字节，彼时performed=false不追改。

旧批停止许可未外推；收到controller转达的本轮真人逐字指令、明确列104860/50508及精确检查条件后，先零副作用Check0/effects0，唯一Apply只停止该Process对象，不杀树/父runner/原b9，不加timeout、不删fixture、不改1110源或测试。前两次Check分别为Windows路径匹配与共享读取失败，均无停止，修正checker后才执行。真实workerExitCode=-1为受控非自然退出；独立准确PID回查缺席，原50508与65480创建身份保持，原父runner实际推进4620及后续日志996–1001，1110逐hash changed=[]。

收口证据`round-11/default-flow-worker-stop-result.json` SHA a7b9c4d40719b2094c64a8b5b120e98b6784d1eb26492a2c46ad779b7c6eaf6f已独立读回，保授权来源、Check/Apply、原FAIL、独立OS回查与推进结果。本组必须保人工干预边界，不能称未干预自然完成或全绿；原b9继续后四组合同，尚无五组最终终态，也不以本次PID缺席证明任何native/历史unknown清理。

### Classes固定目标只读绑定终态

旧含NUL长度候选在native执行前撤回，未运行；新包按Microsoft MS-RRP Symbolic Links约定（Object Name MUST NOT be NULL-terminated）使用严格计数UTF-16，禁止任意NUL。Platform/Review同版前审的源60e5ff1e、参数e94fec51仅启用`-IdentityOnly -BindClassesLink`固定argv：Host SID派生HKEY_USERS固定目标，链接返回值只比对不用作寻址，来源及目标逐组件OPEN_LINK/NativeName，目标与Mapping各级NoLink不放宽。集外私有包与原1110无交集，不等待b9；生产源冻结不变。

真实Check自然exit0/effects0后，唯一Run bzu76cr6i于2026-11-08T00:30:35.961281Z–00:30:37.756158Z自然exit0；实际PID84536、SOURCE/RESULT/输入/variant/两个只读flag绑定正确，两输入起止SHA无漂移、stderr空。13项NativeName全部匹配；Classes链接前后LSTATUS0/REG_LINK6/138B，读取状态0、长度与固定目标138B一致、原字节相同；Host根、Software、固定目标及Mapping逐级NoLink全部LSTATUS2。classesLinkBoundReadOnly与identityReadOnlyComplete均true，handlesClosed=true/nativeOwnerRetained=false/retainedHandles=[]，独立Get-Process准确PID缺席。

公开脱敏证据`round-11/win32-registration-link-binding-result.json` SHA 82b7766e5f710bb189628c65dad0a33bbd2a24f7d3b0158fd129c31aa4a27701已独立回读，绑定7份ignored/untracked/unstaged私有check/run/result/owner/executor完整hash；公开不含SID、名称、native实际/预期路径或Base64值。未Create/Delete Profile、改ACL、建child/Job或impersonation，profileState=not-created；productionAdmissible/storageApiBindingVerified/cleanupComplete仍false，不是注册、存储API或Windows生产full通过。原3856/ed36/1dc3失败、三个139及旧unknown均保留。结束hash和owner收完已直接交回Platform本包私有输入写权，不等原五组。

本集中批matrix214→216，注册库存仍5386、原190历史身份映射不动。当前Windows只读包无在途native owner；原五组b9仍在途，无五组全绿结论。Docker下一完整组合仍在官方0.8.0源码/实际argv阶段前审，未执行新容器；固定296镜像只代表其自身旧源码机制，不能冒充当前1110应用验收。无Git写、CI/合并/部署、真实渠道或模型API调用。


### 原default实际终态与注册谓词安全门

原五组的default于2026-11-08T00:43:25.654569Z结束，`pnpm test`实际exit1，1110起止sourceChanged=[]、两退休路径仍缺席。`post-topic-retirement-final-default-result.json` SHA 41b866b26c06c993eedacbac401cd7231022d4ee768b4be5c91ce855931fc1e3、原log SHA 9294da9c5cee503d257376e9f1ae41371c45ec700280ce01a84fee3bcaad4858；逐条解析1245终态，与原汇总1216PASS/3FAIL/26SKIP/0cancel一致。17根flow所属worker104860受控exit-1的边界仍适用，不能报未干预自然全绿或把sourceChanged=[]当排空。原脚本`node scripts/test-pi.mjs default && pnpm check`第一段非0，因此本次pnpm check没有执行，不能拼其它版本单守卫为本批完整PASS。后续原runtime/routing/domain/containment与最后指纹仍待原b9终态，不重启、不提前热改集合。

三FAIL已有完整堆栈：原log1295–1307的`pi-native-credentials.test.js:30`裸rename返回EPERM；1309–1326的`pi-native-restart-provider.test.js:15`实际contracts=3bfc078c与旧pin2c3deb50不符；1328–1335的flow:115在重启后使用旧channels代理，service.identity读取已inactive的旧Host.runtimePaths。Core只在集外准备flow最小补丁并查凭据/CPU根因，Platform集外准备已审实际源pin差量，均未apply；Node普通open支持FILE_SHARE_DELETE、共享冲突映射EBUSY是反证，当前不能把EPERM脑补成watcher共享删除缺失或盲加重试。具体JS高CPU点仍未证，后续flow原文件最小复验必须自然退出。即使某文件暂无活consumer，原执行器每组仍核全1110，最早无漂移写窗仍是整批终态和最后指纹收完。

已审注册谓词源1ae4cdec/参数6e09d971固定`-BindClassesLink -RegistrationPredicate`、排斥IdentityOnly，沿既有授权仅fresh本任务随机moniker、零cap；Check于00:58:09.577090Z–00:58:10.555890Z自然0/effects0，唯一Run b2n5wjbfb于00:58:46.761902Z–00:58:49.142616Z自然exit2，准确PID44572/SOURCE/RESULT/flags/输入绑定正确，两输入起止无漂移、stderr空。13身份与固定源/目标/Mapping逐级NoLink通过、精确SID叶beforeStatus2；Create恰一次S_OK、createdSid与derive相等，随后created registration binding的第二次Moniker读取联合守卫真实失败。仅首轮类型/长度门已过；第二次type/readSize/内容三个条件共用错误`Moniker bytes mismatch`，原始值未记录，不能进一步断言只内容不同。尚未进入目录API/身份绑定或Delete前重绑，deleteAttempted=false。没有补Delete、重试或另Create来掩盖失败。

本批createAttempted/profileCreated=true，profileState=`unknown-retain-moniker-sid-binding`；准确moniker/Host SID/package SID只在ignored私有owner/result保留，未公开。handlesClosed=true/nativeOwnerRetained=false/retainedHandles=[]，独立准确PID缺席不证明Profile或任何旧unknown清理。productionAdmissible/storageApiBindingVerified/cleanupComplete仍false，ACL/child/Job/impersonation均未发生。公开脱敏`round-11/win32-registration-bound-predicate-result.json` SHA f79cfbb3dd75e8cdabba7cb7a1c539951be6025924aa8aee86bd2e3cc7638674已独立回读，7份ignored/untracked/unstaged原始check/run/result/owner/executor hash全核；实际Moniker返回字节未被本探针记录，不能从长度猜大小写或直接放宽谓词。已交Platform/Review先核官方合同并针对该准确新owner准备无Create/Delete的只读诊断；结束hash/owner收完即交回私有输入写权，不等b9。

同批临时清理：Review已独立核原checker/Check/Apply及真正OS查询transcript33919/结果33926，另33928/33929保原日志推进与1110无漂移；33950仅归档不当OS查询。已用完的`docs/tmp/sg11-default-flow-worker-stop.ps1`按准确SHA3dcf6c6c先check0/effects0、仅该文件apply删除、独立lexists=false，最终a7b9停止证据和fb52历史诊断均原字节保留，后续以原工具记录追溯，不引用已清理附件作现存文件。matrix216→218，库存仍5386，暂未将新五组逐例证据覆盖历史完整身份。

Docker完整组合已在现有pivottrace入口形成候选：从官方31条重建后仅加13精确数值/NULL类，原生uint64 remount掩码不经Number取整；profile6a493f7e、driver c6657a54已语法0/Check0/effects0，交Review具体前审，尚未Run新容器。296旧镜像机制/真实Host路径与当前1110源码应用验收分开。无Git/CI/合并/部署、真实账号/渠道发送或模型API调用。


### 原default完整身份账本与授权整合的来源漂移

`round-11/post-topic-retirement-final-default-cases.json` SHA a35726dfc1b159390c0b3ffe3b31a763790642ffb665bacb25c82e2da02224a0绑定原68a432a6来源表、9294da9c日志与eec8a1e6静态声明。1245条按完整父子标题、file/line/occurrence/registration SHA/source SHA逐项对账，1216PASS/26SKIP/3FAIL，声明和终态均0未映射；同名两个occurrence与17条flow的受控worker标记保留。不改5386历史库存，不把逐项统计等同整组自然PASS。

原Lead经真人授权完成远端设计规范提交的ff整合，HEAD从bbb7508到6d79b0a，既有dirty差量恢复；本Tests只读核实际Git差量与全部1110项，命中漂移仅AGENTS.md（7d8821fb→327018ce）、README.md（8ab3a9da→8218ca18）及boardui.css（c18df605→3de642e6）。前两项是DESIGN引用/指导文字，CSS仅头注释，无运行逻辑差量，但不因语义无影响追认原表零字节漂移。`round-11/post-topic-retirement-final-source-drift.json`记录完整起止SHA、当前HEAD及实际整合文件清单。此观测时b9仍在原runtime，尚无runtime及后三组结果；不停止或重跑该组，依原执行器收真实终态/结束指纹，后续组另绑定当前实际快照并明确组间变化，不改旧表或拼接跨版本PASS。

### 完整seccomp组合机制通过与真实Host临时目录反例

已审c6657a54入口/6a493f7e精确13类规则唯一Run blc8jkx3z，于01:04:19.578483Z–01:04:41.146064Z取得wrapper/container实际exit1。`round-11/docker-bwrap-combination-result.json` SHA 95c296406471156c2800ac5d0f6b597406a48c5a9beb99102ee576d6d4f1a870及原log SHA 4b6caf387f6e1d29e349a716dde916841d9a9e1fc9cf7f98b225ecf53bb63b88保原FAIL；规则/入口起止无漂移，实际inspect seccomp逐对象精确相等，uint64掩码未舍入。UID/GID1000、cap全0、NNP1/Seccomp2/rootro/network none、无宿主挂载和业务卷保持，初始namespace三EPERM负例与前后security相等。镜像真实sandboxProfile的read-only/workspace-write两raw均exit0，根写拒绝、workspace按mode正反；各有两次pivot_root、两次detach及第二userns成功。

真实createHost→本地scripted模型→Pi→bash已启动并返回payload；read-only的原业务writes/秘密reads门先通过，随后原eval:25要求tmpWrote=false，实际true，Host trial exit1且modes=[]。原入口在全部断言后才保存完整payload，故没有实际tmpPath、namespace或tmp挂载证据，不能补造。Review/Platform与Tests独立核既有TASK-ARCHIVE.md:184–186明确允许read-only隔离OS临时行为；原oracle与此例外冲突，但现有记录不足以验证隔离，因此保原FAIL。不能据此改当前privacy源或单把assert改宽，也不扩seccomp。296/88a295c0是旧镜像来源，不能外推当前1110应用通过，workspace-write真实Host尚未到。

Host/server均已关闭、隔离installation已移除、unknownOwner=false，准确容器3bc40ca635029bb4a14209b08c00fb319527a4d9e0eab0c69fe20fd119ed1332以cleanup-check0→cleanup0回收并独立inspect缺席；`round-11/docker-bwrap-combination-cleanup.json` SHA e3d5d4bffba7fc74b7700255d90ef392cf19d5460ccf8e4235ba07390d312740保绑定。复用原入口形成新owned Host-only包4ee6afac，语法0/Check0/effects0后交具体前审，尚未Run；不重跑已通过raw，不改原95c。新包先保payload/env/cwd/ns/tmp挂载，再保持业务/私有读门，验证read-only OS marker子可读回而Host/第二agent不可见，以及workspace-write精确task.tmp/Host读回。

### 准确既有Profile的Moniker只读终态

已审源54a29ff1/参数a9acef17仅IdentityOnly+BindClassesLink+ObserveOwnedMoniker，准确绑定原7cf5 owner/8e00结果的三身份，拒RegistrationPredicate。Check于01:16:04.854917Z–01:16:07.091031Z自然0/effects0，唯一Run bti15uclm于01:16:41.208261Z–01:16:43.872378Z自然exit2，准确PID10320/SOURCE/RESULT及四输入起止SHA无漂移、stderr空。14项身份全匹配，固定Classes链接前后138B不变、11项严格NoLink通过；当前Moniker首/二读status0/type1/94B均通过，缓冲区定义明确且唯一末尾NUL，Ordinal=false、OrdinalIgnoreCase=true。仍沿原Ordinal门报Moniker bytes mismatch；只说明当前保留值，不追认1ae4原二读未知字段、不据此授权忽略大小写或补Delete。

`round-11/win32-owned-moniker-observation-result.json` SHA 4622a21c9c2833fb10a5a5a7879d3e115b89bbe98533a211aa56ea80b50da9ed已独立读回并核八份ignored/untracked/unstaged私有check/run/result/owner/executor及四输入完整SHA，原始三身份/字节仅留docs/tmp/sg11-profile-owned-moniker-*。没有Derive/Create/Delete/folder/ACL/child/Job/impersonation；handlesClosed=true/nativeOwnerRetained=false/retainedHandles=[]，独立Get-Process准确PID缺席不证明持久Profile清理。原Profile仍unknown-retain-moniker-sid-binding，storageApiBindingVerified/cleanupComplete/productionAdmissible均false。结束指纹收完即交回Platform两个输入写权，无在途native操作。

本集中阶段matrix218→222，历史5386注册身份及原190映射不动。原b9仍是唯一五组runner；Docker新包只在前审、无新容器在途。Tests未Git写、未CI/合并/部署、未真实账号/渠道或模型API调用。


### Host-only两mode的隔离OS临时目录与业务边界终态

按既有合同修正oracle，不改产品源/规则/安全参数。原Review完整核4ee6候选后指出Object.values会丢JSON中undefined的TMP字段，最终仅两处改为显式遍历TMPDIR/TMP/TEMP逐项断言；Review逆回这两处后完整字节SHA恢复4ee6，固定d1dd31c19f514e68c7032d077d84cbfa5217d63eb783a8288cefb1124bb17b58具体前审无阻断。语法0、Check0/effects0后唯一Run be1udtey8，于01:26:57.054120Z–01:27:29.341877Z取得wrapper/container/真实Host trial均exit0，五项输入起止sourceChanged=[]、stderr空。没有重跑已过raw/namespace负例。

`round-11/docker-bwrap-host-only-result.json` SHA e76d1427b17d0b83d0c87b8976335fe649c649b53539927c678c33d9cd5265f4及原log SHA 62bb58c80670a7e2cf5d5efa7020ab44f0408b3917ab81e6b8acbc3bc2b281ee已独立回读，旧95c FAIL原字节保持。真实Host/Pi→bash两mode各观察2个本地模型请求及工具终态，原payload在全部业务断言前保存。read-only的work/tmp及metadata/materials/outputs/sessions/taskRoot/root/outside写均EROFS，其它task/symlink逃逸写ENOENT；三秘密读取ENOENT。实际TMPDIR/TMP/TEMP均/tmp，子mnt为4026532433、Host为4026532365，/tmp为独立rw/nosuid/nodev tmpfs；随机marker子写入并读回SG12_TMP，Host执行前后lstat均精确ENOENT，task work/tmp持久文件仍不存在。第二个workspace-write agent的独立mnt为4026532436，读取上一只读marker为ENOENT；三TMP字段全部等准确task.tmp，work/tmp写通过、随机TMP marker由Host准确路径读回，原metadata不变。

runner真实bwrap，UID/GID1000、五cap全0、NNP1/Seccomp2/rootro/network none，无host mount或业务卷，前后outer security/namespace/root mount相等；实际container inspect里的seccomp逐对象精确等6a493f7e（uint64原值保真）。结果仅证明固定296旧镜像/88a295c0来源图中的Host业务与OS临时机制分层合同，currentSourceApplicationVerified=false/realVendorExecuted=false；不冒充当前1110源码镜像、配置/登录后自动接入或真实厂商通过。

Host/server已关闭、installationRemoved=true、unknownOwner=false，准确自有container6dd4f78d7464c63410ae9f7e8ed03e3c996c0551438df7618dda07bf360a5700的State.Running=false/Pid0；cleanup-check0/effects0→cleanup0后另一次独立docker inspect返回No such container。`round-11/docker-bwrap-host-only-cleanup.json` SHA a664a3217e9c83775368aa4f8b186c6483d2fec81a2389916692b13eba8d61b7绑定准确ID/image/Pid0。新结果和原95c失败/62bb原日志、驱动/规则以及必要起止指纹证据保留，未清理其它任务资源。

本阶段matrix222→223、库存5386不变；无Docker/native在途。原b9 runtime仍接宿主自然终态，不热改1110、不重跑；其后源漂移结论与必要写窗/后组按真实当前快照继续。没有Git写、CI/合并/部署、真实账号/渠道或模型API调用。


### 原五组批真实终态与runtime完整身份收口

宿主已接回原b9d0qrkbm真实exit3，未取消、重启或强停runtime。该组于2026-11-08T01:30:47.380485Z自然exit0，162项=150PASS/0FAIL/12SKIP/0cancel，原log SHA e39911908b08f7b8efdd0a769e59b0e7d477d3f42e15f1642ac861f9112de438；`round-11/post-topic-retirement-final-runtime-result.json` SHA 5c021576f8aac3f7578d52dc459ad6155e7dbd6ce5f36373a52656e88a4805fe保原1110结束表，sourceChanged准确仅AGENTS/README/boardui三项设计文字/注释整合，与79d434漂移观测一致。原runner依合同在此退出3，routing/domain/containment未启动、combined未写；不是runtime业务FAIL，也不是五组同版全绿。

`round-11/post-topic-retirement-final-runtime-cases.json` SHA aa9d2b7e8a00c2e873783641d608c3f2f9e307f569e90dfc3d46673b92a4845e复用原eec8静态声明，对全部162注册按完整title/file/line/occurrence/registration SHA/source SHA匹配，声明和终态0未映射。原runtime各文件仍等旧冻结源码，组外三文件字节漂移显式保留。`round-11/post-topic-retirement-final-batch-terminal.json` SHA fe0e9cb60ae41ac07d42ba5903341b450a94ab438566bcf772f31c97a3e4f758汇总原default真实1（受控worker-1、1216PASS/3FAIL/26SKIP）、runtime自然0与准确未启动组，只是终态核算，不伪造五组合并成功。

原批消费者已自然终态、结束指纹收完，Tests直接交Core/Platform修复写窗，不继续等不会启动的后三组。Tests按已审ba969b9f仅落实两test四行：flow重启后读取现Host的channels（39a42475），凭据测试外部独立写入复用withCredentialLock/writeCredentialFile而不调用store.set（0a5f6999）；全部原断言、watcher/删除/循环保留，语法与diff-check0，不把静态apply当复验通过。Platform落实已审native-restart真实provider pins，Core单写其source-manifest登记；待该交接完成，以新当前来源快照先三原文件最小自然复验，再余下三组和未执行完整guards，不全盘重跑已过runtime/Web。原EPERM拒绝者及flow高CPU根因仍未证，原FAIL/受控stop证据不追改。

本轮matrix223→225，三路径漂移行更新为已取得自然runtime0/批exit3/后三组未启动；历史5386库存不删。修复后的实质复验另记round-12，不覆盖round-11终态和附件。不涉及新增团队/分支/计划或Git写；Windows原Profile unknown与生产full未验边界保持。
