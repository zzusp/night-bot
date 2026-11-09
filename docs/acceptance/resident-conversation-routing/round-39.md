# 第39轮：原挂起进程与SDK seal组件在NUL准备阶段失败

## 结论

经原Review最终五稿前审及Lead准确来源窗，本轮仅执行一次原 `4487a4bf` driver。**Node100716与driver均自然退出1；raw实际产出componentPass=false，componentWasProduced=true。首错是probe中相对路径 `open('NUL','r')` 被解析到工作树下NUL并返回ENOENT，未到本组件挂起child创建或SDK seal。** 第二个 `assert.ok(out.settled&&out.releasedEntryId)` 是首错后未满足成功路径的断言，不替代首因。

同一次真实Host默认创建已完成§16.22初始化：task为ready，work/tmp出生control均9814，initializationNeeded均true，最终control均9c14；原初始化原语返回16个句柄、36份Local全部closed、retained0。本轮只证明这一新task的初始化观察，不是SDK seal、LPAC隔离或既有树恢复通过。

原失败路径已经回收未launch Profile，并提交本Job的released资源记录；但Job为failed，task仍active、drained=true、blocked/TASK_EFFECT_UNCERTAIN_NO_REPLAY。未产出成功producer的settled、live/cold一致性或严格冷读证明，不手工补业务完成。SG11/SG12仍ACTIVE，不写全绿report；旧R35未知不由本轮关闭。

## 准确版本、前审和唯一执行

受验版本为 HEAD `6d79b0a0279d3f94f2d72d21f51ab1d654b0f509` 加 `worktree-resident-conversation-routing` 未提交协作树。准确251项source map及排序JSON聚合 `b124530d35a98b1873b9c82de0b083837ce659b42f3075e668b810b901b9128b` 绑定本次真实执行，不沿用R36的1125项或R37的19项。完整map见本轮 `source.json`，原始完整raw/execution保ignored。

原Review在 `review.md:1956` 完整核最终五稿及真实producer/SDK/失败路径；Tests亲读新增节并独立核631710B/SHA `4406cd9d9ef682e8b955230f640e5df636ed6a687cfff1bcb87ebaffabb1a387`。Main随后确认Core/Platform无在途写入并保持来源，独立核五稿、251项/image及新安装和五运行输出缺席，才沿原真人授权给予本批唯一窗口。静态前审本身没有被当作Native批准或结果。

唯一实际工具输入：

```text
python -I docs/tmp/sg11-profile-suspended-seal-execute.py --run
```

宿主后台任务 `b00nfcgdy`，tool-use `call_4525ad2e645f4ae5b22ba64cc5b7d8c5`；driver采集区间为北京时间2026-11-09 03:47:09.513283–03:47:35.681349，probe自身记录03:47:14.199–03:47:34.464。使用自然wait，无整实验timeout、外部强杀、重试或干预。原self fail-stop未被关闭；本次也未触发它，不能把本次有raw的false写成无raw/null或进程访问冲突。

原driver先按准备收据同argv fresh check，实际0、stderr空、31296B逐字等已审check的 `621e166d`；再次核四资产、source/image与输出缺席后，仅将argv[2]从--check换成--run，一次Native Popen。Node/driver为1，sourceChanged=[]、imageChanged=false，无collectorError/sourceReadbackError。接回终态并核原事实后即通知Lead释放251来源窗，不为归档延长。

## 实际到达边界和失败根因

原步骤仅为：`original-factory-returned`、`original-owned-proof-committed`、`original-profile-delete-returned`、`released-committed`。真实Host、Koffi loader和原Native factory均已进入；原SDK Profile已创建并提交profile-owned proof，不是零Native准备或初始化门拒绝。

probe:317–320的第一个 `await open('NUL', flags)` 在fd认领前抛ENOENT，raw.nul=[]、nulRetained=0。未进入uvGetOsfhandle/markLaunchAttempted/挂起frame创建；frameCreationAttempted=false、frameSnapshots=[]、terminationAttempted=false，sealState=not-started、sealEffects=[]。没有本组件payload创建、Resume、业务scope grant/release阶段或原runner ACK证据；不推广成整个Host或OS完全没有进程和IO。

Platform只读定位同一相对路径问题，建议后续准确稿使用真正绝对Win32 NUL device语义；本轮没有创建占位文件、借用宿主stdio、热改probe或试跑替代命令。下一稿若实施，必须保持旧十稿、安装和journal，另用新准确资产与新身份，经原流程再取窗口；本报告不授权第二次执行。

## 原资源收据与业务状态分列

原producer的catch在launch未尝试的事实下，沿已审 `deleteUnlaunched` 分支执行单次回收。finalReceipt为registration-and-folder-absent、created=true、launchAttempted=false、cleanupAttempted=true、deleteAttempted=true、retainedHandles/Allocations=0/0。这个收据来自原回收API及其内置核回，不是Tests在进程结束后追加SDK或文件操作。

原failureCommittedEntries保存同一Job的已提交链：

| 原记录 | seq | 资源状态 | 句柄/Local retained | 说明 |
| --- | ---: | --- | --- | --- |
| registered | 无 | admitted | 无 | 原owner、Job、toolCall与startedAt |
| resource-ownership | 1 | planned | 0/0 | 原SDK创建前计划 |
| resource-ownership | 2 | unknown-retained | 5/1 | 原profile-owned私有proof已提交，准备尚未完成 |
| resource-ownership | 3 | released | 0/0 | 原回收返回后提交，entryId为2e7461b2 |

seq3 resource全文等raw.released，entryId等releasedEntryId；owner/Job/kind/startedAt/toolCall与原registered逐字段相同，executionIdentity.owner等原ownerId。历史seq2未被删改；最新released也不被抹成全未决。raw.unknownOwnership为空。released里的childSettled/jobEmpty在未创建本组件child的分支为true，不能冒称实际启动后做过OS Job0观察。

Job实际status=failed，detail仍原ENOENT；task实际status=active、drained=true、lastDecision.action=blocked、limitations包含TASK_EFFECT_UNCERTAIN_NO_REPLAY。原SDK资源回收与任务失败同时成立。raw没有成功路径的out.settled、liveJobAudit、releasedLiveProofs、coldViaOriginalRecorder或严格cold结果；不把raw中的failureCommittedEntries提升为未实际执行的全journal严格冷读，也不把Node自然退出当业务完成。

原finally仅执行已有fixture关闭回调和source/image核回后写出原raw，未新增补账或外部清理。Tests在终态后只读这些原材料，没有再调用Terminate/Delete/Close/ACL/rm或修改DB/journal/marker；安装与十项私有资产保留。

## 默认工作区初始化的实际观察

原h.stored返回同task/session及原creationCommandId，workspaceInitialization.state=ready；observation.directories.work/tmp的createdControl=0x9814、initializationNeeded=true、control=0x9c14。原缺400初始化分支适用，两目录各一次同DACL Set4，未关闭默认路径或改普通mkdir。task根/两个Low目录的Native创建由原初始化原语负责，原资源摘要为handles acquired16/closed16/retained0、Local acquired36/closed36/retained0。

这里只记录原初始化原语返回的资源范围及本次观察，不当整个Host/SDK/系统的Native调用总计。完整FileID、SD与绝对路径保原ignored raw和journal。ready不代表永久SD资格、执行授权或旧NULL/外部业务树可恢复。R38的13项非Native合同结果保原历史，不重复运行或改记为本轮13项。

## 证据、归档与剩余项

私有十稿统一前缀为 `docs/tmp/sg11-profile-suspended-seal-`，其完整bytes/SHA集中在本轮 `evidence-index.json`；所有十路径已独立核ignored/untracked/unstaged。关键原始结果为run.json98567B/SHA `8c2e8309d11a3eed8cbfbbb56dca38c791fb10a8e2c06f48136c5cb23d2b1f23`，execution.json57392B/SHA `4c4dea8130dfe76665091ce52be830c947a48c8f35eec9529456dd6ccb17cb1d`。stdout194B、stderr0；公开只留无身份/SD的原短console、source map、脱敏summary及index，不复制完整privateProof或个人路径。

归档器先--check零效果，再--run，仅写本轮公开文字材料和矩阵。库存5485全文不变，3335797B/SHA `4cb87a89885f8359d2b813580994d40dcd2d74bbc76ac4aac9138498e0891f2f`；本轮Native脚本不是新增Node测试注册。矩阵311→313，仅加round_39与两个业务行：一次新task默认初始化窄PASS、SDK组件因NUL准备FAIL；两总汇保PARTIAL，其余309旧行NOT_RERUN_ROUND_39，旧列/旧行可精确逆回R38。R38报告/附件不覆盖。不存在本轮需删的中间Native证据，十稿和本安装仍用于失败追溯，不为清理改动它们。

本轮未修改生产/测试源码、运行其他主组、真实模型API或DWS外发；无Git写入、CI、合并或部署。后续首要为原分工修正NUL设备准备、以新准确资产复验原SDK seal组件；实际token、LPAC读写、mandatory、IPC ACK/Resume/ConPTY、既有写树恢复、三平台及最终同版全量仍按各自证据完成。不能以本轮初始化成功或原Profile回收抵扣组件失败和业务no-replay状态。
