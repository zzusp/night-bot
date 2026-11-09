# 第42轮：挂起业务scope被Host维护权限守卫拒绝

## 结论

本轮沿原方案§16.24、既有真人隔离实验授权及Lead准确一次消费窗，只执行最终822a driver一次。**Node96528与driver均自然退出1，componentWasProduced=true、componentPass=false。真实挂起child和SDK seal已到达；原prepareSuspendedScopes在scope-frozen提交之前报WINDOWS_PROFILE_OWNERSHIP_UNVERIFIED / Exact scope Host maintenance access was lost，scope准备没有成功返回。** 原错误记录没有导出具体失败对象或基线/候选调用位置，不能据此确定哪一个root、哪个mask或哪一种SD是唯一根因。

原失败链完整join后受控停止原Job，真实child settled、Job0，随后经原无scopePlan/effects0回收分支、原delete/close，耐久提交同Job seq5 released：0句柄、0 Local、scopeEffects0。它不证明本轮要求的有plan mandatory完整恢复。Job仍failed，task仍active/drained、blocked/TASK_EFFECT_UNCERTAIN_NO_REPLAY；没有成功producer settled、live或严格cold结果，不补完成或追认成功。三资格flag始终false，SG11/SG12仍ACTIVE。

## 准确来源与准备

受验版本为HEAD `6d79b0a0279d3f94f2d72d21f51ab1d654b0f509` 加 `worktree-resident-conversation-routing` 未提交协作工作树。准确251项完整映射见本轮source.json，排序JSON聚合为 `87eaab60b98532c133894ddac12ab927f6582377e8e52c4e11771a1ff0b91b23`；准备、fresh check及实际运行sourceBefore/sourceAfter一致，image不变。不能仅用HEAD、当前已释放保持后的生产树或R41结论代表本轮受验字节。

最终五稿为906c/d193/a468/436b/822a，完整bytes/SHA集中于本轮evidence-index.json。probe73253B，清单27397B。清单NUL设备字面量仅增一个前导反斜杠，与probe逐字相同；逆这一字节精确回27396B/25431c32。Platform真实25431/d8fc中间准备只作为其回传历史，不追认为Tests或最终稿check；Tests没有为该中稿生成三资产。

Tests实际最终语法及同argv check在原tool `call_e288d11e178043809821d3168f5054ac` 中执行，UTC2026-11-08T22:04:36.913至22:04:46.377，均退出0、stderr空；check32129B/a468，准备收据58612B/436b。原tool `call_b5d5463cc243451db57a02be832112d0` 在22:12:03.376至22:12:12.298实际生成9636B/822a、AST解析及driver check0。driver仅换四asset pin、prefix、精确新I和聚合，逆构整文件逐字等原9660B/5976；保留一次Popen、自然wait、无raw/null与no-replay机制。独立核回tool `call_be110b49da53426fa0af4d48f91ebb04` 在22:12:56.755至22:13:05.542核五稿、251来源/image、缺席及私有Git边界。

原Review完整静态前审位于review.md:2077，693113B/SHA `ed91b627e594881c622922058f09504005cfbce6b725f19d116dd825412530ae`，Tests已全文读新增10846B并核原682267B/d085536b全文前缀保持。前审明确逐Set scope状态未导出、阶段数/LABEL0仅同源fixture推导，实际后验以原方法guards为准；本轮失败后这些未产生的值仍不补造。静态前审不等于Native批准。

## 唯一实际执行

Core、Platform、Tests分别明确无相关在途/后台/待落盘操作，最小保持本次真实来源及准确稿；Lead在三方确认后再次核完整五稿、251来源、cmd image、新I和五输出缺席及11路径Git私有边界，才交本次准确一次窗。唯一命令如下，文档中只作为数据展示：

```text
python -I docs/tmp/sg11-profile-suspended-scope-execute.py --run
```

宿主后台任务 `bc6xug0pk`，原tool-use `call_65fefcfa535d4653ace844ff2eaa7d7a`。driver采集UTC2026-11-08T22:22:06.689783至22:22:37.090132，即北京时间2026-11-09 06:22:06.689783至06:22:37.090132。driver和Node96528均自然1，naturalWaitReturned=true、forcedTermination=false、intervention=null；没有collectorError或sourceReadbackError，没有整实验预算、强停或重试。本轮raw实际产生，不能写成无raw/null或身份fail-stop触发。

driver内fresh check实际0、stderr空，32129B逐字等a468。复核四资产、来源/image及缺席后，只将同argv的index2换为--run，一次Popen自然wait。原系统cmd为339968B/SHA `14cc8ab1dcf0d9f19e8fb82deb547cf8c462c56a0e43f7addc02641ab3c81651`，sourceChanged=[]、imageChanged=false。

宿主真实终态通知到达后，Tests立即直告Core/Platform释放本次最小保持并同步Lead，不等原结果细读或归档；Platform已回确认解除。本次消费窗已用完，没有第二次执行权，不热改准确稿、不追加Native查询/清理或恢复来源冻结。

## 实际到达点与首错

原Host、loader与factory实际进入。原standing真实为workspace-write，四读根materials/work/outputs/tmp、仅work/tmp两写根，去重scopeCount4；没有显式read-only扩权、额外permission_scope/full/scoped授权或第五Profile私有temp。原工具exec与原Host executionIdentity保持同一调用来源。

本新task初始化在durable Job前已ready，birthInitialization与最终workspaceInitialization全文相等；原creationCommandId/session绑定。work/tmp均createdControl0x9814、initializationNeeded=true、control0x9c14，原初始化16H/36Local全部closed、retained0。只证本次新task创建，不证明所有scope对象后续永久满足Host维护权或其它生产准入。

原resource的LocalAppData验证实际通过：当次原owned proof绑定SDK根及可信来源，三种大小写冲突均被覆盖，其余十键不变。三个NUL设备端点fd3/4/5均实际打开、校验、单次关闭，flagsBefore=flagsAfter=0，nulRetained0；不是普通文件或宿主stdio。

child103728实际挂起创建、JOB_LIST纳管，assigned=true；frameSnapshots为original-frame-bound、original-seal-complete、native-drained、native-handles-closed，全部payloadResumed=false、resumeAttempted=false、preparationReleased=true、pendingPreparation=false。原SDK seal四bool为true；八个原sealEffects（六文件、二注册表）attempted=true/status0/immediateVerified=true。这里只记录本轮已到达的SDK子组件，不抵扣随后业务scope失败。

scopePreparationAttempted=true。原错误第一项是 `Exact scope Host maintenance access was lost`，code为WINDOWS_PROFILE_OWNERSHIP_UNVERIFIED，api/win32Code均null。已对照原Profile:640的Host READ_CONTROL(0x20000)/WRITE_DAC(0x40000)检查；同一守卫可从基线检查或候选检查调用，raw没有更细调用位置或target，当前不将任何一个根/权限位当已证唯一根因。产品根因由Lead协调Core/Platform沿原责任层定位，Tests不修改生产、初始化既有读根、改ACL或补Native观测。

原错误第二项为成功路径 `assert.ok(out.settled&&out.releasedEntryId)` 的ERR_ASSERTION。它发生在首次失败之后，不是另一个独立产品根因，也不能覆盖首错。两项原错误均完整保留在私有raw和脱敏summary，不吞错追绿。

raw没有scopePreparationResult、scopePreparationCommitted、scopePreparationAfter或scopeStageEvidence。原proofEntries仅profile-owned、profile-seal-frozen；没有scope-frozen、scope-released，不能填四phase通过。原源码将scopePlan设定在整个冻结构造通过之后，scope commit先于scope apply；本次未到scope-frozen且effects始终0，不存在已观测的业务scope grant、LPAC目标open资格或逐stage写盘成功证明。原prepare返回的三true/scopeReady false对象本次也未产生，不能抄预期值补入raw。

## 失败回收、耐久收据与业务状态

原prepare的finally已经join后才进入一次cleanup。原挂起Job被一次受控Terminate，nativeDrain为pid103728、childCreated=true、processSettled=true、jobEmpty=true、exitCode1。不是无child分支，也不是强杀父driver。原thread/process/Job句柄末帧均closeAttempted=true、present=false。

scopeReleaseBefore/After的scopeEffects均0，scopeReleased由false变true，原releaseScopesAfterNativeDrain返回 `{scopeReleased:true}`。没有scopePlan/冻结proof时，原方法走无plan且effects0分支，记录回收资源后返回；它不执行本轮要求的有plan全SD/成员/祖先差量恢复，不能称有plan mandatory通过。四个scopeSnapshots的实际effects均0，不把它当Set次数或凭此推断全局OS资源归零。

原failureCommittedEntries共六条，保持同registration的jobId/owner/kind/label/startedAt/toolCall：一条registered与seq1 planned、seq2/3/4 unknown-retained、seq5 released。seq2的profile-owned、seq3的profile-seal-frozen各保原privateProof。末entryId为 `3a2aeab8`，resource全文等raw.released；retainedHandles/retainedAllocations/scopeEffects均0，threadRestored/childSettled/jobEmpty/nativeHandlesClosed/scopeReleased/profileAbsent均true、preparationPending=false。历史unknown条目不删改，最终unknownOwnership=[]，不把已提交released抹成未决。

finalReceipt等deletedReceipt，为registration-and-folder-absent、retained0/0；sealed=true而sealState仍是unknown-retained诊断，照原值保留，不擅自修成sealed或据此否认最终Profile缺席。原资源回收与失败诊断、业务no-replay分开陈述。

Job实际failed；task active、drained=true、lastDecision.action=blocked，limitations=[TASK_EFFECT_UNCERTAIN_NO_REPLAY]。raw没有settled、liveJobAudit、releasedLiveProofs、coldViaOriginalRecorder或cold。不能以failureCommittedEntries、Node退出、空unknownOwnership或released资源代替成功producer/live/完整journal严格冷读，也不补成功settled、修改数据库、追认旧unknown或解除no-replay。原安装及已产生journal保持原样，归档器不导入产品或解码journal来另造一次验收。

## 集中归档、历史与剩余范围

十项私有材料前缀为 `docs/tmp/sg11-profile-suspended-scope-`，准确bytes/SHA集中在evidence-index.json。run.json225111B/SHA `c9338c5ef3eae6b010e782df5a1aab55c1f69e1a54f81f4680bf52dcb280ae6a`；execution.json57404B/SHA `36ee3f49099d862ccaa4c6a279d4a748d7cb8aae3ff1133dc3133d6e8829b705`。原stdout195B/SHA `067745453b886b0f306bbd9c5c007d56c1f356fd05cca231cbb86267d77815e0`，stderr0。公开仅source、脱敏summary、原短console和index，不复制完整SD、SID、FileID或个人绝对路径；完整私有对象只留ignored原材料，不作可重放指令。

归档沿R40/R41既有配方，新十项和旧三十项均验证bytes/SHA及ignored/untracked/unstaged。只读原raw与相关收据，不重跑产品。配方先--check零副作用，再--run仅写本轮四份公开附件与矩阵；不写私有材料、安装、journal、库存或旧报告/附件。归档阶段首次过长Bash生成命令在shell解析期unexpected EOF/exit2，未进入Python或Native；独立只读核round-42目录/report/recipe均不存在后，才创建本轮目录并用专用Write写配方和报告。没有半稿被当成功，没有在文档写入命令后接执行器，该事件不是第二次Native或新验收轮。 首次归档--check还因直接扫描序列化JSON，把原次级错误文本中冒号后的换行转义误认为盘符路径而失败；独立确认四附件仍缺席、矩阵仍为R41原字节后，仅将公开边界校验改为递归检查解码后的JSON键/字符串（console检查原文本），仍逐项拒绝真实绝对路径和SID，完整保留原errors。该归档校验修正不改任何运行证据或产品断言。

库存5485行、3335797B/SHA `4cb87a89885f8359d2b813580994d40dcd2d74bbc76ac4aac9138498e0891f2f` 全文不变，本轮没有新增Node注册。矩阵315→316，仅增round_42列和一个业务scope FAIL行；两总汇仍PARTIAL，本次初始化、SDK seal、NUL、LocalAppData只记各自实际窄PASS，其余309行NOT_RERUN_ROUND_42。剥新列和末行可精确恢复R41的237308B/SHA `207e609b14008e2b8858793944ef8125c59149c3d2eceac9fa7a4ec5854e112c` 全部历史。R39/R40/R41报告、索引、附件和三十份原私有材料不覆盖，不因新结果倒改旧受验版本。

本轮没有应清理的中间Native附件，准确十稿与安装仍支撑失败和no-replay追溯，按约束保留，不为整洁删现场。Tests未改生产/goal/spec/review/manifest，不Git写，不重跑旧组或无变化守卫；无真实模型API/DWS外发、CI、PR、合并或部署。下一直接工作是Core/Platform只读收敛Host维护权首错并由Lead决定责任层必要修复，再按新准确准备/前审/窗口验证；本次窗口已消费，不允许借归档或失败定位重跑。业务scope实际授予/有plan mandatory、payload实际写入与新增后代/取消、runner ACK/Resume/ConPTY、旧NULL/外部树、Host重启恢复、三平台及最终同版验收仍未由本轮闭合。
