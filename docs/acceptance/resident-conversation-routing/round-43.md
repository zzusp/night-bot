# 第43轮：私有诊断定位materials候选DACL的WRITE_DAC拒绝

## 结论

沿唯一方案§16.25、既有真人隔离实验授权和Lead准确一次窗，本轮只消费最终c12e driver一次。**driver与Node99892均自然退出1，componentWasProduced=true、componentPass=false。原scope准备首错仍为WINDOWS_PROFILE_OWNERSHIP_UNVERIFIED / Exact scope Host maintenance access was lost；新增私有诊断实际定位到prepare.candidate、scope阶段、materials只读根的WRITE_DAC（0x40000），allowed=false、granted=0。** 未到scope-frozen，没有scope准备成功、实际grant或有plan mandatory恢复证明。

原失败链join后停止本次真实挂起Job，child71796 settled、Job0，原无scopePlan/effects0分支完成回收及Profile删除，耐久提交同Job seq5 released：0句柄、0 Local、scopeEffects0。Job仍failed，task仍active/drained、blocked/TASK_EFFECT_UNCERTAIN_NO_REPLAY；没有成功producer、live或严格cold结果。资源释放不抵扣组件FAIL，三资格flag始终false，SG11/SG12仍ACTIVE。

本轮只证明这一次失败位于候选DACL资格检查；不将新诊断回填为R42未记录的target/mask，不据此宣称某条ACE或完整ACL算法根因已经修复。具体责任层修复由Lead协调Core/Platform，Tests不修改生产或放宽守卫。

## 准确来源与前审

受验版本为HEAD `6d79b0a0279d3f94f2d72d21f51ab1d654b0f509` 加 `worktree-resident-conversation-routing` 未提交协作工作树。准确251项完整映射见本轮source.json，聚合为 `2bb71e7b3a7e64fc315413d22be9c2023588ff7f3de0acb47ebe5dace2c58e18`。Profile为98583B、`a2d30ea9b53ed819ad6aba87105650d655660ea891407c7161a706499f2cdf5a`；固定249项集合相对R42仅Profile改变，其余248项保持，另两项是本轮probe/清单。实际准备、fresh check、run sourceBefore/sourceAfter同源，image未变。保持释放后当前普通源码不能追认为本轮受验字节。

最终五稿为deeb/8428/300d/6b54/c12e，完整bytes/SHA集中于evidence-index.json。probe74261B、清单45445B、check32103B、准备收据58399B、driver9632B；前缀为 `docs/tmp/sg11-profile-scope-context-`。新nonce为18875d66a9f0441b9cecc498e78681be，未复用R42的979f安装或旧窗口。

Tests真实语法及同argv零效果check来自原tool `call_fdb3948618b146eb811a273e1d5f47c4`，UTC2026-11-08T23:11:29.743至23:11:38.906，均自然0、stderr空。driver推导、AST及--check为 `call_6b68b65a06dd40f58c184d062395d437`，23:12:07.496至23:12:16.464；仅换绑定，逆构逐字等R42原9636B/822a，没有控制流增量。独立核回为 `call_6e76a5f8df68480292553746bdfec57f`，23:12:55.328至23:13:03.790。没有复用旧语法证据或消费中稿。

原Review完整前审位于review.md:2115；全文713939B/SHA `50baaa639ab273755020970dfebf223debaa3dce5cbc2ac393406822fdf8515d`，原703089B/abed全文前缀保持。Tests已亲读新增10850B并独立核回。前审涵盖私有cause与原Native调用/guard分离、rawErrorValue与两个journal清理门分离、默认实际错误消费者静态路径及其盲点；没有把非枚举当保密屏障或动态隐私通过证明。Main另完成必要来源守卫，Tests没有重跑已成守卫。

## 唯一执行与输入释放

Core、Platform和Tests明确无相关在途/后台/待落盘，并保持本次251 map及准确五稿；Main在北京时间07:36:35末核五稿、251当前来源、HEAD/分支、review/image、新I和五输出缺席、11路径Git私有边界后，交本轮准确一次窗。唯一命令如下，只作数据展示：

```text
python -I docs/tmp/sg11-profile-scope-context-execute.py --run
```

原tool-use为 `call_a852fb48a4f045d1a5679c3aa4fca2aa`，宿主后台任务 `bkjb3x5hl`。driver记录UTC2026-11-08T23:38:03.784661至23:38:31.836870，即北京时间2026-11-09 07:38:03.784661至07:38:31.836870。driver/Node99892均自然1，naturalWaitReturned=true、forcedTermination=false、intervention=null；没有collectorError或sourceReadbackError。没有整实验期限、重试、外部强停、设备预试或追加Native观察。

driver内fresh check自然0、stderr空，32103B逐字等300d；复核四资产、来源/image及缺席后，只把同argv的index2由--check换为--run，一次Popen、自然wait。sourceChanged=[]、imageChanged=false，原cmd image339968B/SHA `14cc8ab1dcf0d9f19e8fb82deb547cf8c462c56a0e43f7addc02641ab3c81651`。这不是无raw/null或身份fail-stop中途退出：本轮raw真实产生，组件为false。

收到宿主真实终态通知后，Tests先直告Core/Platform释放本次输入保持并同步Main，再读取raw；两方均确认解除。没有为细读、归档或产品定位延长普通来源冻结。此窗已消费，无第二次执行权。

## 新诊断的已证范围

私有原件 `docs/tmp/sg11-profile-scope-context-run.json` 的errors[0]保留完整诊断；本报告只记录非敏感投影：

| 字段 | 本轮实际值 |
| --- | --- |
| site / preparationStage | prepare.candidate / scope |
| target角色 | materials只读根本身，精确匹配本轮scopeRoots及其FileID |
| target类型 | FILE1、directory=true、access=read |
| mask | WRITE_DAC / 0x40000 |
| allowed / granted | false / 0 |
| 描述符关系 | actual=expected=candidate，original不等于candidate |

这些值来自原拒绝点已计算的内存值；probe没有新建AccessCheck、重读、Native wrapper或计数器。失败发生在候选资格检查，而非本轮prepare.original拒绝；候选不是已写盘结果。未产生scope-frozen/plan，scopeEffects始终0，不能据候选比较宣称grant或撤权发生。Tests未解码SD或复制ACE比较/规划算法，未断言OWNER_RIGHTS等具体ACE根因。

原次级错误仍为ERR_ASSERTION，来自成功路径的 `assert.ok(out.settled&&out.releasedEntryId)`。它在首错之后，不是第二个独立产品根因。两项错误的普通name/message/code/api/win32Code保留；新增私有上下文不复制到普通消息或脱敏附件。

## 到达点与未到达点

原Host、loader、factory实际进入，原工具exec与executionIdentity同源。standing真实为workspace-write；materials/work/outputs/tmp四读根，仅work/tmp两写根，scopeCount4，无read-only改写扩权、额外permission_scope/full/scoped授权或第五Profile私有temp。

新task初始化在durable Job前为ready，birthInitialization全文等最终workspaceInitialization；creationCommandId/session同源。work/tmp原createdControl均0x9814，经必要新目录初始化为0x9c14；16句柄、36 Local均closed、retained0。它只证明本次新task初始化，不外推全部scope后续永久满足维护权。

本次可信LocalAppData来源和三种大小写冲突覆盖通过，其余十键保持；三个自有NUL端点真实opened/validated/closed，flagsBefore=flagsAfter=0，nulRetained0。SDK seal四个原bool为true，八个原sealEffects（六文件、二注册表）均attempted/status0/immediateVerified。child71796真实挂起创建并纳管，四帧均未Resume。这些已到达子组件只记各自窄证据，不能抵扣业务scope失败。

proofEntries只有profile-owned、profile-seal-frozen，没有scope-frozen或scope-released。scopePreparationResult、scopePreparationCommitted、scopePreparationAfter、scopeStageEvidence均未产生，不补原三true/scopeReady=false预期返回。没有scope实际逐Set状态、LPAC已有目标IO资格或有plan mandatory证明。

## 原失败回收与业务终态

原prepare的finally join后才进入一次cleanup。原Job一次受控停止；nativeDrain为pid71796、childCreated/processSettled/jobEmpty均true、exitCode1；末帧thread/process/Job均closeAttempted=true、present=false。不是强杀父driver，也没有第二次Terminate。

scopeReleaseBefore/After的effects均0，scopeReleased由false变true，原release返回 `{scopeReleased:true}`。本次属于无scopePlan且effects0分支，不是有plan全SD/成员/祖先恢复。四个scopeSnapshots的effects均0，不能用它伪造Set次数或全局资源审计。

failureCommittedEntries共六条：registered和seq1 planned、seq2/3/4 unknown-retained、seq5 released。每条jobId/owner/kind/label/startedAt/toolCall保持同registration，并绑定原executionIdentity。末entryId为 `6377bc3b`，resource全文等原released；retainedHandles、retainedAllocations、scopeEffects均0，threadRestored/childSettled/jobEmpty/nativeHandlesClosed/scopeReleased/profileAbsent均true、preparationPending=false。历史unknown条目保持，最终unknownOwnership=[]。

finalReceipt全文等deletedReceipt：registration-and-folder-absent、retained0/0；sealed=true，sealState仍为原unknown-retained诊断，不擅自改值。原Profile删除与资源released不修改业务失败：Job failed，task active/drained、blocked、limitations=[TASK_EFFECT_UNCERTAIN_NO_REPLAY]。raw没有settled、liveJobAudit、releasedLiveProofs、coldViaOriginalRecorder或cold；没有解码journal另造cold或把Host关闭当重启恢复。

## 安全归档、矩阵与历史

本轮raw为228260B/SHA `a33bf26e6683f341d9d136288bdeb9398e757a34830c9fe5163f8e2756ea562f`；execution为57380B/SHA `9de39983f1b7548f6769275d7dd2477450486898369fead8e00ebe5e7b306a5e`。stdout193B/SHA `9e32ad848aed8f2da726a80d40a7a4ee994f470a2b84e99518088045092a1e64`，stderr0。十项私有材料、安装和journal保留，不复用为执行指令；完整实际路径、SID、FileID和SD只留ignored原材料。

沿原R42配方，仅调整本轮绑定、既有scope用例及公开隐私投影。普通errors用显式字段白名单递归投影errors列表，不spread原错误、不遍历cause、不复制privateScopeHostMaintenance；另只保存上表的角色/site/mask/等同性。脱敏边界递归扫描实际JSON键/字符串，拒真实绝对路径、SID以及本轮诊断的实际target/FileID/完整SD值。没有把非枚举当保密屏障；这只验证本轮附件投影，不声称动态整链隐私验收通过。

配方提供--check零副作用和--run互斥入口；归档先check，再run只写source.json、脱敏summary.json、原短console、evidence-index.json及matrix。它不导入产品、调用Native/Host、解码journal、改私有材料/安装/库存或旧报告。首次过长Bash生成命令在shell解析期unexpected EOF/exit2，未进入Python、未写文件；独立核round-43目录/report/recipe均缺席后才创建本轮目录，改用专用Write写配方和报告，没有半稿被消费，文档写入后未无条件接执行器。这不是第二次Native或新验收轮。

库存5485行、3335797B/SHA `4cb87a89885f8359d2b813580994d40dcd2d74bbc76ac4aac9138498e0891f2f` 全文不变，无新增Node注册。矩阵316行不增用例，只增round_43列：沿既有sg11-profile-suspended-business-scope记录候选materials/WRITE_DAC首错FAIL，两总汇PARTIAL，初始化/SDK seal/NUL/LocalAppData各自窄PASS，其余309行NOT_RERUN_ROUND_43。去掉新列须逐字恢复R42矩阵244161B/SHA `8fd704176eaf2f19899b8fa735aea4d893439dda5da0a5a50cb0a06ddd5943af`。完整归档绑定及矩阵前后哈希集中于本轮index。

新十稿及旧四十私有稿保持bytes/SHA和ignored/untracked/unstaged；R39/R40/R41/R42历史报告、配方和附件保持，不用当前候选追认旧轮。旧材料和安装仍按明确现场保留约束保留，没有本轮已失去用途的临时Native附件需清理。Tests只写本轮验收材料及matrix，未改生产/goal/spec/review/manifest，不Git写、不触发模型/DWS外发、CI、PR、合并或部署。

## 剩余边界

本轮收敛的是失败位置和可安全共享的诊断，业务scope仍FAIL。后续由Lead协调责任层修复候选DACL的Host维护权问题，再按新准确准备、完整前审与单次窗验证；Tests没有重跑权。业务scope grant/实际LPAC IO、有plan mandatory、payload写入/新增后代/取消、runner ACK/Resume/ConPTY、旧NULL/外部树、Host重启恢复、三平台及最终同版全量仍未闭合，不创建总体全绿report.md。
