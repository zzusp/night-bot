# 第41轮：可信LocalAppData与原挂起SDK seal组件通过

## 结论

本轮沿原真人Native授权，经最终五稿完整前审及Lead准确来源窗，仅消费一次5976 driver。**Node64036与driver均自然退出0，componentWasProduced=true、componentPass=true。原真实Profile的LOCALAPPDATA来源、三种大小写冲突覆盖及其它10键不变已实际验证；child42812成功挂起创建、纳入原Job并完成原SDK seal，全程未Resume。** 原受控终止后真实child已settled、Job空，原thread/process/Job句柄单次关闭，原Profile回收并耐久提交released0/0，原producerReported completed成立。

同Job的7条live与原严格Pi journal冷读全文相等，两个released live proof与关闭writer后的原recorder cold完全一致。Job completed；task仍active、drained=true、lastDecision.action=wait、limitations=[]，不能写task completed或自动取得后续执行授权。readOnlyAdmission、runnerIpcAckQualified、productionScopeReady仍全false。SG11/SG12继续ACTIVE，本轮是组件通过，不是完整Windows/runner/三平台或最终全量验收。

## 准确来源、准备历史与唯一执行

受验版本为HEAD `6d79b0a0279d3f94f2d72d21f51ab1d654b0f509` 加 `worktree-resident-conversation-routing` 未提交协作树。准确251项sourceBefore=sourceAfter，排序JSON聚合为 `bcda7a4c1ae09d79b643bc9efc8e979a9e981398c8a719f11930a42dc4486d05`，完整map见本轮source.json；原cmd image起止不变。Profile受验候选97568B/SHA `8f65c6ec916bf7da309e8bff9f5175ae7ad8d9a2f672212fd943f7d17496fff4`；不能仅用HEAD、当前后来修改或旧R40的ff60来源代表本轮。

§16.23实施前快照比较并排除了整包继承宿主env、先补盘变量/改encoder，选择保存Profile创建期原可信SHGetKnownFolderPath值、大小写无关去掉调用方LOCALAPPDATA再注入的最小候选。不新增OS查询、不放宽ACL或业务授权。R40原错误记录为CreateProcessW/203，API返回BOOL；本轮成功不把历史错误改成成功，也不单凭后续通过追认唯一根因。

最终五稿b035/11ba/ad9e/2304/5976的准确bytes/SHA集中在evidence-index.json。中稿47dd/e9a4/3cae/d54a确实准备过，未消费Native；仅清单将“返回203”修为“错误记录为CreateProcessW/203”。最终准备call_01c9d1ab5f1a4e03b6a5dd5cbd5d1784确实重取同argv probe check、AST与driver check，均0；未变b035语法明确复用call_ab7c2f1c5099427ca3fa3c30a73fb147的真实结果，supersededPreparation保留中稿历史，不伪称从未执行。

原Review在 `review.md:2041` 完整前审；Tests全文读新增段并独立核673027B/SHA `d0a053cecb9735567f6f20a317bd7ba62b18e0a632ca324a8f3f7efcbbd9148e`，原663575B前缀不变。driver逆换准确pins/prefix/I/聚合后全文等原be8c算法，未新增重试、预算或热改路径。Lead取得Core/Platform实际无在途及本次最小来源保持确认，复核准确五稿/251/image/新f591安装及五输出缺席后，才交本批唯一消费窗；前审或同伴消息不单独构成新Native授权。

唯一实际工具输入：

```text
python -I docs/tmp/sg11-profile-suspended-seal-localappdata-execute.py --run
```

宿主任务 `bw76t7k0s`，tool-use `call_15a945dabc044329b5f78602c20e2deb`。driver采集UTC 2026-11-08T21:21:52.270727Z至21:22:20.584686Z，即北京时间2026-11-09 05:21:52.270727至05:22:20.584686（UTC+08:00）；probe记录21:21:57.275Z至21:22:19.440Z。自然wait，无整实验timeout、强停、重试或干预；原self fail-stop保留。本次真实raw为true，不是无raw/null或补造false。

driver先同argv fresh check，实际0、stderr空、31662B逐字等已审ad9e，复核四资产/来源/image/缺席后仅argv[2]换--run，一次Popen。sourceChanged=[]、imageChanged=false，无collectorError/sourceReadbackError。接回真实终态即通知Lead/Core/Platform释放来源和五稿保持，不为归档延长；终态后的归档仅消费本次受验前后快照，不要求生产继续冻结。

## 真实环境与挂起seal边界

通过原owner.receipts取得本次同Job唯一phase=profile-owned条目73f7a3c9，核Job/owner/kind/startedAt/toolCall及Profile name/SID。原proof的唯一kind1、role=profile、directory=true、parent=null根，其末级等本Profile名、上级为Packages；上两级与原launchEnvironment的LOCALAPPDATA一致。完整路径、SID和SD仅保ignored原证据。

同一真实resource分别调用原launchEnvironment基准输入和含LOCALAPPDATA/localappdata/LoCaLaPpDaTa的冲突输入，整对象相等，唯一大写LOCALAPPDATA；原SystemRoot/WINDIR/ComSpec/PATH/PATHEXT五键及HOME/USERPROFILE/TEMP/TMP/TMPDIR五重绑不变。断言后才写launchEnvironmentVerification。没有复制算法、公共私有测试出口、大型假FFI夹具或额外SDK查询；原resource.revalidate仅移到新增receipt await之后。这里验证Host构造的真实启动环境，未Resume，不能声称child内已读取环境值。

三NUL为真正绝对设备namespace的本次自有端点，fd>2，opened/validationAttempted/closeAttempted/closed均true，flagsBefore=flagsAfter=0，nulRetained=0；不借用宿主stdio或普通占位文件。四份原frameSnapshot依次为original-frame-bound、original-seal-complete、native-drained、native-handles-closed，均pid42812、childCreated/assigned/jobConfigured=true，preparationReleased=true、pendingPreparation=false，payloadResumed/resumeAttempted=false。末份thread/process/Job closeAttempted全true、present全false。

sealResult的profileOwned/profileSealed/nativeTokenQualified/observationHandlesClosed四项均true。原sealTargets为6个kind1文件对象和2个kind4注册表对象，8项sealEffects均attempted=true、status=0、immediateVerified=true，sealState=sealed。原proof真实phase依次为profile-owned与profile-seal-frozen，不能写成不存在的profile-sealed。此结果不等于完整业务读写/mandatory或runner ACK通过。

原受控Terminate后的nativeDrain为childCreated=true、processSettled=true、jobEmpty=true、exitCode=1。child exit1是受控终止结果，Node/driver仍为0；不是payload自行执行exit0，也不是R40“未创建child”分支的空Job推论。全程无Resume、ConPTY、业务scope grant/release实际作用或完整runner启动。

## 原资源、业务终态与live/cold绑定

原资源序列完整保留：seq1 planned(0H/0Local)，seq2 unknown-retained(5H/1Local)，seq3/4 unknown-retained(8H/1Local)，seq5 released(0H/0Local)。released entryId为aa234f8a，末resource全文等raw.released；scopeCount5、scopeEffects0，preparationPending=false，threadRestored/childSettled/jobEmpty/nativeHandlesClosed/scopeReleased/profileAbsent均true。没有业务scope作用的分支不能写业务scope实际授予/回收成功。

原finalReceipt等deletedReceipt，为registration-and-folder-absent、sealed，retained0/0；原独立temp缺席为true，6个SDK文件路径缺席。资源回收和registration/folder检查均由本次原生产路径完成，Tests不在终态后追加Delete/Close/Terminate、SDK查询、ACL或文件清理。errors及unknownOwnership为空；历史unknown-retained过渡原样留审计。

原registered、resource-ownership和settled逐字段绑定同Job、owner、kind、startedAt和toolCall，executionIdentity的owner/callId/rootCallId/name与原绑定一致。唯一settled entryId d87d53b3、parent9b9dbb2d，status=completed且producerReported=true。Job completed，task active/drained、wait、limitations=[]；未伪造producer证明、直接改DB/marker或手工补完成。

两个原proof条目73f7a3c9/8d83f05b的不可变privateProof保持对应；releasedLiveProofs保最终released投影，不能误要求释放前resource投影等释放后resource。原service.close后SessionManager writer已不存在，原recorder.readScopeProofs冷读与两份released live全文相等；随后原Host关闭，原decodePiJournal使用本session、codec和requireComplete:true严格冷读。本安装实际journal为98651B/SHA `2406bb99e2214f171d54dee985e03c138371099d0c31bec07e499e7d2ecf3b8a`，归档前只读原文件核回相同。全audit14条，同Job7条逐字等liveJobAudit；live/cold unresolved均为空。归档器只核原材料/绑定/实际journal字节，不重放journal、不重新实例化Host或调用Native。

新task默认初始化仍ready，原task/session/creationCommandId一致；work/tmp的createdControl均0x9814、initializationNeeded=true、最终control均0x9c14，原初始化资源16H/36Local全部closed、retained0。只证本次第三个新task的初始化观察，不是永久SD资格、旧NULL/外部写树恢复或全OS隔离通过。

## 集中归档与历史保持

本轮十项私有输入统一前缀为 `docs/tmp/sg11-profile-suspended-seal-localappdata-`。run.json441696B/SHA `a910e6412862ba60ac77b11ce8fa7e42198bf2b1e7fefb247e0855d14c00659d`；execution.json57547B/SHA `34d7f107f1f2d557c37e1ecc7671345e2b1b2bc8ee46362c8d3211371de4a823`，原stdout209B、stderr0。准确十稿及旧R39/R40二十稿的bytes/SHA/Git私有边界集中于本轮evidence-index.json；保持ignored、untracked、unstaged及原字节。公开仅原短console、source、脱敏summary与index，不复制完整privateProof、个人路径、SID、SD或运行数据。

本轮archive-update.py沿原归档方式复用，先--check零副作用再--run，仅写四份公开附件及matrix.csv，不执行probe、driver或Native，也不写私有材料、journal或库存。落盘后另做独立只读核回；归档成功与原Native/业务结论分列，正式Review尚需按最终稳定产物独立审查。

库存5485身份、3335797B/SHA `4cb87a89885f8359d2b813580994d40dcd2d74bbc76ac4aac9138498e0891f2f` 全文不变，本轮无新增Node注册。矩阵314→315，仅加round_41列与一个LocalAppData真实resource行为业务行；原SDK组件、本次初始化及NUL分别记准确窄PASS，两总汇保PARTIAL，其余309行NOT_RERUN_ROUND_41。quote-aware剥本轮列及末行可精确回R40的230512B/SHA `0f2d1ba35c4f73821771c9e5d53315477c011252601939615f669e51e79b0623`，不倒改旧失败或既有scenario历史。

R39/R40原二十稿、两安装/journal及本次f591安装/journal保留，仍用于准确失败追溯、成功绑定和后续原流程审查；没有已失去用途的单轮截图、dump或中间Native附件需要清理。历史报告保留，不为整洁删除现场、不另备份旧证据。Tests未修改生产/测试源码、goal/spec/review/manifest，无Git写、模型API、DWS外发、CI、合并或部署；未重跑13项、旧guards、旧collector或任何旧/中稿Native。

剩余范围仍为完整runner ACK/Resume/ConPTY、业务权限/mandatory、旧NULL及外部树恢复、三平台和最终同版全量。R35未知/no-replay以及R39/R40旧任务状态不由本安装新成功关闭。不写总体全绿report.md，也不把本报告视为另一次Native窗口。
