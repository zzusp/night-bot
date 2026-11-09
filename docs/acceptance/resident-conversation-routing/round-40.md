# 第40轮：NUL设备端点通过，原挂起创建记录Win32 203

## 结论

本轮沿原真人Native授权，经最终五稿完整前审及Lead准确来源窗，仅执行一次新 `be8c1ca2` driver。**Node102044与driver均自然退出1，componentWasProduced=true、componentPass=false。三个自有NUL端点已真实打开、校验并关闭；首错推进至原挂起创建路径，原错误记录为CreateProcessW/Win32 203，child未创建，SDK seal未开始。** 后续 `assert.ok(out.settled&&out.releasedEntryId)` 为成功路径未满足的断言，不替代首因。203的实际采样及根因留原Platform只读定位，不仅凭原记录推断API瞬时错误或环境缺失。

原失败frame已释放preparation并关闭Job handle；原Profile回收后，同Job的seq3 released已耐久提交，0句柄/0 Local。Job仍failed，task仍active、drained=true、blocked/TASK_EFFECT_UNCERTAIN_NO_REPLAY。没有成功settled、live或严格cold证明，不手工补完成。SG11/SG12保持ACTIVE，旧R35未知及R39失败历史不由本轮关闭。

## 准确来源与唯一执行

受验版本为HEAD `6d79b0a0279d3f94f2d72d21f51ab1d654b0f509` 加 `worktree-resident-conversation-routing` 未提交协作树。准确251项来源、排序JSON聚合 `6ed31f06646a6194baa20671a11c389805f46724de401ce8c6875ad0220fcb78` 见本轮source.json，实际sourceBefore=sourceAfter，image不变；不能仅用HEAD或旧R39结果代表本轮。

最终五稿为152d/42ff/c224/2728/be8c。原Review在 `review.md:2010` 完整前审，Tests全文读新增段并独立核656557B/SHA `29a8c27f1be85f52ef6d2782579347c2370b0cffbcd73e473357c11b973ee983`，原647110B前缀保持。Node C++桥接依据文案缺口已修，probe执行机制未变；最终driver逆换准确绑定后逐字等旧4487。中稿ff422/a378/a4b2保真实准备历史，但未消费Native；152d语法结果明确复用原call_1195b48a，本次最终准备call_ae41ce37确实重跑probe/driver check，不伪称重复语法检查。

Lead取得Core/Platform实际无在途及最小来源保持确认，再核五稿/251/image/新I与五输出缺席后，才给本批唯一窗口；静态前审不当Native批准。唯一工具输入：

```text
python -I docs/tmp/sg11-profile-suspended-seal-nul-execute.py --run
```

宿主后台任务 `brwocec65`，tool-use `call_9bbd8d4c670349ebb8c61762ff2cba2a`。driver采集北京时间2026-11-09 04:37:36.848051至04:38:04.784669，probe记录04:37:41.981至04:38:03.444。自然wait，无整实验timeout、强停、重试或干预，原self fail-stop未关闭；本次有真实raw，不能写成无raw/null。

driver先同argv fresh check，实际0、stderr空、31395B逐字等已审c224；复核四稿、来源/image及缺席后，仅argv[2]换--run，一次Popen。sourceChanged=[]、imageChanged=false，无collectorError/sourceReadbackError。接回真实终态并核原资源/业务事实后立即回交来源保持，Lead同步释放Core/Platform，不为归档延长。

## NUL端点窄通过与挂起创建失败

原NUL常量保持真正绝对设备namespace，不使用占位文件或宿主stdio。raw三项分别id0/1/2、fd3/4/5、flags r/w/w；opened、validationAttempted、closeAttempted、closed均true，flagsBefore=flagsAfter=0，nulRetained=0。这里只证明本次端点打开、校验、继承位恢复和关闭；未创建child，不能声称child实际继承通过。

真实Host、Koffi loader、原Native factory均进入。原步骤仍为original-factory-returned、original-owned-proof-committed、original-profile-delete-returned、released-committed。frameCreationAttempted=true；首错外层为WINDOWS_LPAC_OWNERSHIP_RETAINED，唯一内层Win32Error记录api=CreateProcessW、win32Code=203、LPAC suspended target。本轮只记录原错误；根因尚未收敛，已交原Platform只读追完整调用、参数与错误采样链，不凭错误码猜环境变量/镜像/ABI，也不由Tests改生产或试跑替代命令。

三份原frameSnapshot依次为original-failed-create、native-drained、native-handles-closed。均pid=null、childCreated=false、assigned=false、payloadResumed=false、jobConfigured=true、preparationReleased=true、pendingPreparation=false；没有process/thread handle。末份jobCloseAttempted=true、jobPresent=false。nativeDrain为childCreated=false、processSettled=true、jobEmpty=true、exitCode=null。这是未创建child的分支事实，不能当实际child启动后的OS Job0或退出码证明。terminationAttempted=false，failedCreateTerminationOwnedByOriginal=false，未追加Terminate。

sealed=false、sealState=not-started、sealEffects=[]、proofEntries为空。没有真实child token/seal/写拒、Resume、runner ACK或业务scope release阶段成功证据，三资格flag仍false。

## 原资源收据与业务状态

failedReceipt为owned、created=true、launchAttempted=true、5H/1Local、seal not-started。原失败路径在原frame排空/关闭之后完成Profile回收；finalReceipt等deletedReceipt，为registration-and-folder-absent、cleanupAttempted/deleteAttempted=true、0H/0Local。

原failureCommittedEntries保同Job链：seq1 planned，seq2 unknown-retained(5H/1Local)，seq3 released(0/0)，末entryId `1455975a`。末resource全文等raw.released，owner/Job/kind/startedAt/toolCall均等原registered，executionIdentity.owner及callId/rootCallId/name分别绑定原owner与toolCall。历史seq2未删改，unknownOwnership最终为空，也不将实际released抹成未决。该状态来自原producer与原耐久提交，不是Tests在退出后补SDK或账本。

Job实际failed；task active、drained=true、lastDecision.action=blocked，limitations含TASK_EFFECT_UNCERTAIN_NO_REPLAY。原资源回收与业务失败并存。raw没有成功settled/liveJobAudit/releasedLiveProofs/coldViaOriginalRecorder/cold，不把failureCommittedEntries当未执行的全journal严格冷读，不以进程自然退出替代业务成功。

本次新task默认初始化仍ready，同task/session/原creationCommandId；work/tmp的createdControl均0x9814、initializationNeeded=true、最终control0x9c14，原初始化资源16H/36Local全closed、retained0。只证本新task创建，不推广为永久SD资格、旧树恢复或LPAC隔离通过，完整SD/FileID仅保ignored。

## 归档、历史保持与剩余项

本轮十项私有材料统一前缀为 `docs/tmp/sg11-profile-suspended-seal-nul-`，准确bytes/SHA集中在evidence-index.json。run.json101387B/SHA `5b1e6658e39b23e4952295497aaacb92a059fc068751c60ac45b535b9628d9f5`；execution.json57441B/SHA `10653998a642489f63c6502c6a52ffcc59d8188596f12f3ae99da3e32c56ac73`。stdout198B、stderr0。公开仅原短console、source、脱敏summary与index，不复制完整privateProof、SD或个人绝对路径。新十稿与旧R39十稿均核ignored/untracked/unstaged并保持原字节；两安装/journal保留，未追加Native、SDK/ACL/文件清理、DB/marker改写或解除no-replay。

第一次长Bash heredoc在shell解析期exit2（unexpected EOF），未进入Python、归档器或Native；下一独立只读命令确认round-40目录及report/recipe均不存在。随后才使用专用Write创建配方与本报告，正文仅作数据，没有在文档写入命令后接执行器；该失败不写成归档成功或新的Native轮次。

归档器先--check零副作用，再--run，仅落本轮四份公开附件及矩阵。库存5485全文不变，SHA `4cb87a89885f8359d2b813580994d40dcd2d74bbc76ac4aac9138498e0891f2f`；本轮不是新增Node注册。矩阵313→314，新增round_40列及一个NUL端点窄PASS业务行；原SDK组件行记CreateProcessW203 FAIL，初始化行记本新task窄PASS，两汇总PARTIAL，其余309行NOT_RERUN_ROUND_40。剥新列/新行可精确回R39全部历史，R38/R39报告和证据不覆盖。

本轮没有需淘汰的中间Native附件；两组十稿及安装仍支撑失败追溯，不为整洁删现场。未修改生产/测试源码，不重跑13项或其他组，无真实模型API/DWS外发、Git写、CI、合并或部署。下一步由Platform只读定位203并由Lead协调必要修复；另需后续准确组件验证、真实token/LPAC、mandatory、runner ACK/Resume/ConPTY、既有NULL及外部写树恢复、三平台与最终同版全量。本轮NUL端点通过不抵扣SDK组件失败。
