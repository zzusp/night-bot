# 第36轮：修复后新根真实 Profile 未启动组件

## 结论

新版原三守卫自然exit0；准确ba0b稿在原整体前审、Lead唯一消费窗和同参fresh check0之后，仅执行一次真实组件。**Node65636自然exit0、componentPass=true；原Profile完成创建、scope准备、独立观察、profile-owned证明、revalidate、唯一delete、released提交以及Job completed/producerReported终态，live与两条cold证据闭合。**

原Host task保持active/wait、drained=true，未伪装成业务任务completed。该结果仅证明本次新根的未launch组件；target child、OS Job、launch/Resume、ConPTY及网络均未调用。scopeReady=false、SG11/SG12 ACTIVE保持，不写全绿report。

本轮不追认第35轮具体故障API，不关闭其registered/planned未决Job，不修其journal或删除c2134d现场。原SDK资源回收与保留新安装根是两件事：本次SDK/temp已由原路径回收；新I、原journal及10份私有材料继续保留供审查。

## 版本与实际入口

工作目录/分支保持原resident-conversation-plan/night-bot及worktree-resident-conversation-routing。受验版本为HEAD `6d79b0a0279d3f94f2d72d21f51ab1d654b0f509`加未提交协作工作树。

- 最终Profile99572B/SHA `944b9419740fa342d4dcbd838b35567815dcc621a26bdc0e698d21df237eec13`；manifest7556B/SHA `ca04fdeb7148efb6c4d91d9abc8e3caad93127990506ec53b2e998b58112e2a6`。
- 完整1125项聚合`37c9bb7f56e2d07d07183e90857ee247b607f28ed0d5bc713118515448272170`。三守卫起止、新check、实际组件起止映射逐项相同；相对R35 f302仅Profile与manifest不同。集合不含安装数据、secrets、node_modules或全部环境，不代表其他平台通过。
- 已审probe23240B/SHA `ba0b0d2e29ef9d4be8615c93f4d73986479782294e2e9382e48c988f56a5b9d3`；四稿完整hash及10项本地材料由summary/index集中绑定。probe只替换原9e90的前缀、新I、Profile/manifest/聚合五值，全文可逆回原9e90，Host/producer/观察/清理/失败分支未改。
- 原Review在review.md:1859核第35轮，在:1870窄审944b，在:1879整体前审本轮准确四稿。Lead实际取得Core/Platform/Docs与自身1125来源保持后，才确认本轮唯一消费窗。

生产修复仅三处已解出LPWSTR指针改用Koffi3.2原decode.string16，并把KnownFolder HRESULT/NULL门移入已有try，以便失败但非空out仍finally单次CoTaskMemFree。Platform首语法因status重名失败，改folderStatus后语法0；本探针自身首语法0/check0。失败nonnull分支本轮未注入实测，不能记该分支PASS。

## 三守卫真实执行

宿主任务`bqkm061l1`，原tool `call_ffbccd29fad64b71b4e1834c9cef7aab`，实际工具输入为`python -I docs/tmp/sg11-profile-fixed-collector.py check`。采集器4872B/SHA `43e51b3aac8360816219bf55809fbecacdac37372c00f5ac0a7bb846c67eaa03`复用原第34轮采集逻辑，仅更换来源/prefix并限定check入口。

实际命令`pwsh -NoProfile -NonInteractive -Command "pnpm check; exit $LASTEXITCODE"`，北京时间2026-11-09 00:17:20.329343–00:17:30.401401，自然exit0、sourceChanged=[]，无干预/强停。原三JSON为：retained190/retired10/UI excluded3/adapted57、relativeImports closed、HTTP retained；productionImportFiles395/literalBareImports193；runtimeJsFiles395/externalSdkImports0/legacyOrchestratorDefinitions0/legacySourceFilesVerified2/historicalFormatFilesRemoved9。

原log436B/SHA `bbf6b329dc30a257f34c3d50f5fdc07a55725f12cd541481de7fca9bf737113c`，stderr120B仅pnpm原命令echo。原source/result/log/stderr及collector精确归档；不能把守卫通过当作原runner注册、真实Profile或其他测试组通过。

## 唯一组件运行与实际资源终态

准确专属采集器6404B/SHA `1bd40f92137d7102181af57ee162b3db7505246c8e889d400471d0569cc8926f`，七个唯一绑定可全文逆回原6392B/31a3c20c；AST及独立--check自然0/effects0后才运行。它保原四稿hash、完整来源、准确argv、新I与五输出缺席门，flag x禁覆盖，不重放旧collector或旧I。

实际唯一工具输入仅为`python -I docs/tmp/sg11-profile-unlaunched-fixed-execute.py --run`；宿主任务`b25egmf4e`，原完成通知tool-use为`call_1be5787c86ea4031902eff808cc75b92`。采集区间为北京时间2026-11-09 00:36:12.040691–00:36:45.972535；这是采集器区间，不冒称Node精确出生时刻。之前发给Lead的未核tool ID已明确撤回，本报告只绑定原通知中的真实ID。

采集器内fresh使用原check-execution同一argv，实际exit0/stderr空、stdout118219B，逐字等已审check，SHA `013b54a4a95896a5500be8ea4602f4c113b6f4dd5a478d07a41838b67ad82610`。完整门均通过后，只把同一argv中的--check换为--run，唯一Popen并自然wait。Node65636/采集器均exit0，componentPass=true，naturalWaitReturned=true、intervention=null、forcedTermination=false，无collectorError、重试、timeout或kill。

原raw实际九步依次为factory-returned、prepareScopeRoots-returned、independent-temp-observation-closed、commitOwnedProof-returned、explicit-revalidate-returned、deleteUnlaunched-returned、released-committed、task-service-closed、host-closed。执行收据248373B/SHA `5fdaadb285d9e13ef2f1cb31b958d0ad05ce68fbcaa1874bfe06bc7fc92fbd92`；原run372359B/SHA `f00874409ff9f6432d5b56e73fcf19a912f51c9903bdc0a16b4baa69057c2f81`，全部错误为空。

| 真实阶段 | 实际证据与边界 |
| --- | --- |
| 原Host/exec/producer | 原providerHost显式新root、真实SDK工具exec、原startDurable与原非枚举recorder；read-only仅单请求缩权，不改standing权限 |
| 创建与scope | created=true、creationAttempted=true；5个scope为4 read+1私有temp write。readRoots只到path/type/FileID，不宣称已有树DACL/继承资格 |
| 独立temp观察 | prepare后实际完整control9c14，Low4096/NW1/OICI3，空目录；独立handle1及Local allocation1均单次attempted/closed，且先于proof提交 |
| 原耐久proof | seq2为unknown-retained并携profile-owned证明；这是原未启动资源持有态，不是本轮失败catch追加。proof.objects为2个profile对象+6个profile-ancestor，真实FileID仅留私有raw |
| 唯一删除 | launchAttempted=false、deleteAttempted=true；最终state=registration-and-folder-absent，内部handles/allocations=0。SDK Delete成功、原Native缺席守卫、独立Node目录缺席分层，不冒称新增独立registry探针 |
| released与Job | seq3/released，scopeEffects0、preparationPending=false、profileAbsent=true，retainedHandles/Allocations0；原settled entry2ae70eeb为completed/producerReported=true，live unresolved=[] |

原factory返回时receipt仍持有1份Native allocation；不能把最终计数0倒签成过程中从未持有资源。本体Native调用总数未instrument，不挪用第33轮30 allocations/5 handles等计数；本轮独立观察的1+1与本体最终计数分列。

## cold、独立缺席与窗口释放

task.service.close后，原owner writer已不存在，再由同一原recorder.readScopeProofs走cold requireComplete分支，返回与released live proof全文相同。Host.close后重新读原磁盘journal，原decodePiJournal配显式原portable codec、requireComplete:true成功；cold同Job五条receipt全文等liveJobAudit，最后resource等真实released，原profile-owned证明保持，cold unresolved=[]。

五条同Job审计顺序为registered、seq1 planned、seq2 unknown-retained/profile-owned、seq3 released、settled completed/producerReported。原cold journal61199B/SHA `a018e16c707482e473bb8409645fa60a901987e94fddd7b1aa54f89e9bd0fc12`；Tests接回终态后独立读取磁盘原字节核同bytes/hash，未重建Host或再跑Native/恢复。

probe内及终态后Node/Python普通只读lstat均只对本次proof/实际scope取得的三个准确路径检查：新temp与两个SDK profile/AC目录缺席；未触及R35或其他Profile。SDK专属目录/registration仍是OS机制例外，不能宣称全部位于I。新I本身保留，runtime数据不进Git。未新增Windows故障事件查询或失败注入。

读取真实原raw/execution并核上述业务/资源终态后，立即通知Lead/Core/Platform/Docs释放源码窗；Lead亦确认各保持者已释放，不为归档延长。后续来源即使变化也不追认成本轮受验版，结论绑定原37c9完整映射。

## 正式材料、矩阵与保留

`round-36/`公开原三守卫五份文字资产、Node小console、脱敏summary、实际archive-update源码及batch-index；不复制Native raw、完整SID/SD/FileID或绝对安装路径。summary/index保存10份本地准确Native材料bytes/hash及原临时来源映射；原四稿、专属execute及五输出始终保持ignored/untracked/unstaged，旧R35原11份材料不改。

归档先--check/effects0，再--run；矩阵296→297，只新增round_36和sg11-profile-unlaunched-fixed-host业务行。source-import-native-guard记本轮三守卫PASS，两个总汇只记未launch组件局部PASS及完整链未验，其余293旧行NOT_RERUN_ROUND_36；R35原异常行保持未重跑，不用本轮新根通过覆盖。剥新列/新行须逐字回第35轮196478B/SHA `f0da44c0fd024d7f00794cf1d10583eddf0dbf5ef5827a9aa986f32a2ad374fa`。

没有新增Node测试注册。5472身份库存全文不改，仍3320505B/SHA `aeb6cc97bcedbcce7b7d63aa984159a18b699b7b67f347deb2e4e057f5464fdb`。正式归档核回后仅清理已无用途且有正式逐字副本的本轮5份临时guard资产，保留原Native10份材料、新I及journal，不清旧失败根/锁或其他会话文件；准确清理结果由本轮index记录。

本轮没有Tests生产实现修改、真实模型/渠道、Git写入、CI、合并或部署。当前通过范围到新根真实Profile未launch准备/回收；mandatory、有效LPAC token权限、Job ACK/Resume、ConPTY、已有NULL业务树、Linux强owner、macOS及其他最终主组/Web/PR交付仍需各自证据。
