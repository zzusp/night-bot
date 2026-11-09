# 第44轮：Host维护ACE继承守恒拒绝scope冻结

## 结论

沿唯一方案§16.26、既有真人专属可逆资源授权及Main准确一次窗，本轮仅消费最终b67a driver一次。**driver与Node97900均自然退出1，componentWasProduced=true、componentPass=false。首错为 `Native scope inheritance changed Host maintenance ownership`，name=Error，code/api/win32Code均null；仍未到scope-frozen，scopeEffects全程0。**

原失败链join后受控停止挂起child58260，processSettled、Job0成立，经原无scopePlan/effects0分支完成回收和Profile删除，原同Job seq5 c2dd30cb耐久released：0句柄、0 Local、0 scopeEffects。Job仍failed，task仍active/drained、blocked/TASK_EFFECT_UNCERTAIN_NO_REPLAY。没有成功producer、live或严格cold；资源释放不抵扣组件FAIL，也不是有plan mandatory完整恢复通过。SG11/SG12仍ACTIVE。

本轮错误不同于R43的候选materials/WRITE_DAC拒绝，但没有导出失败parent/child、继承份数或新增逐stage观察，不能据错误变化宣称此前维护权问题全部修复，不能确定本次具体继承边或完整根因。责任层定位由Main协调Core/Platform；Tests不改生产、不放宽守卫，不追加Native观测。

## 准确来源与准备

受验版本为HEAD `6d79b0a0279d3f94f2d72d21f51ab1d654b0f509` 加 `worktree-resident-conversation-routing` 未提交协作工作树。source.json保存准确251项映射，聚合 `796f66f535398140e258208ac3f7b3a3a79fd3d3f850ac26bcf9836dbe54dec4`。ACL129130B/5208611f、Profile98611B/4524f774、consumer26104B/e847e5d2；固定249项相对R43仅这三项改变，其余246项保持。另两项为本轮probe/清单。准备、fresh check及实际sourceBefore/sourceAfter同源，image未变；释放保持后的当前源码不能追认为本轮字节。

准确五稿为daa5/2b2c/92bc/8d96/b67a，bytes依次75804/34723/32159/60245/9618，完整SHA集中于evidence-index.json。前缀 `docs/tmp/sg11-profile-scope-maintenance-`，nonce为7b42bb3c63894a6eaf1a6778a0dc6ed6，未复用旧1887/979f安装或旧窗。

语法/check复用Platform真实最终工具call_9d30a95036ab4f429d04ec7896912697和call_08c20092a58245c6acaee6e1e75fa9b5。完整原stdout32159B逐字等正式check，未用截断预览；Tests未重复两命令。准备收据明确时间为host-tool包络、exit0依正常末命令语义，无单独childExitCode或Node输出捕获；sourceAfter为Tests独立磁盘核回，不冒称probe内置after、语法前后夹持或连续冻结。

Tests正式准备工具为call_864a54cae4b24834a7c25d0fcdc358f9；driver推导/AST/真实零效果自检为call_f8ec474acf734c2588aac72a586a7605；独立五稿/251/image/私有边界核回为call_fbc04352f47b486583f7b2f221129b87。driver除prefix/I/四pin/aggregate外仅两处probe argv改为实际正斜杠文字，逆全文精确回原9632B/c12e，控制流不变。此前长准备命令仅shell解析失败，独立核新资产缺席后才正式短脚本生成，未消费半稿或Native。

完整五稿前审位于review.md:2183：741511B/SHA `5b35f852946747912322ea967e54be7273fc37e391b6eee4ccd42f0242e70afc`，原734662B/f9d3全文前缀保持。Tests已亲读新增6849B并独立核回。实现审、纯JS五组和Main三守卫复用既有有效证据，不重复运行，也不当Native通过。五组前两次4/1和最终5/0历史保持。

## 唯一执行与保持释放

Main亲读完整前审，于北京时间09:02:30末核五稿、251项来源、image、HEAD/原分支、cached空、新I及五输出缺席后，交准确一次窗。唯一命令仅作为数据展示：

```text
python -I docs/tmp/sg11-profile-scope-maintenance-execute.py --run
```

原tool为 `call_1e06ec150bbc483d9cef584a81857b6e`，宿主后台任务 `bwiohsajy`。driver记录UTC2026-11-09T01:04:44.871661至01:05:14.488538，即北京时间09:04:44.871661至09:05:14.488538。Node97900/driver均自然1，naturalWaitReturned=true、forcedTermination=false、intervention=null，无collectorError/sourceReadbackError。没有整实验期限、重试、外部强停、设备预试或追加观察。

fresh check自然0、stderr空，32159B逐字等92bc。原driver复核四资产、来源/image、I与输出缺席后，只将同argv的index2由--check换为--run，一次Popen、自然wait。sourceChanged=[]、imageChanged=false；image339968B/SHA `14cc8ab1dcf0d9f19e8fb82deb547cf8c462c56a0e43f7addc02641ab3c81651`。本轮真实raw产生，不是无raw/null或原身份fail-stop中断。

收到宿主终态即先直告Core/Platform及Main解除最小保持，再读结果；三方均确认解除。没有为归档、只读定位或新文档继续冻结。本窗已消费，没有第二次运行权；首错与最小真实业务/资源状态已直接交三方，不等分析文档。

## 实际到达与未到达

原Host、loader、factory及原Pi exec实际进入，executionIdentity与原registration同源。真实standing为workspace-write，materials/work/outputs/tmp四读根、仅work/tmp两写根，scopeCount4；没有read-only改写扩权、full或额外授权，没有第五Profile私有temp。

新task初始化在durable Job前ready，birthInitialization全文等workspaceInitialization，creationCommandId/session同源；work/tmp均createdControl0x9814到0x9c14，16句柄/36 Local全closed。只证明本次出生初始化，不外推永久scope资格。可信LocalAppData三大小写冲突均被原方法覆盖，其余十键保持；三个自有NUL均opened/validated/closed、flags0到0、nulRetained0。

SDK seal四原bool为true，八sealEffects（六文件、二注册表）全部attempted/status0/immediateVerified。child58260真实挂起创建、Job纳管，四帧均未Resume；原末帧thread/process/job均closeAttempted、present=false。这些子组件仅各记窄证据，不能抵扣scope失败。

scopePreparationAttempted=true，但proofEntries只有profile-owned、profile-seal-frozen。scopeFrozenEntryId、scopePreparationResult/Committed/After、scopeStageEvidence及scopeReleaseCommitted均缺席，没有scope-frozen或scope-released。不能抄三true/scopeReady=false预期返回，不能补继承计数、实际grant/LPAC已有对象open或有plan mandatory通过。

错误第二项仍是成功路径 `assert.ok(out.settled&&out.releasedEntryId)` 的ERR_ASSERTION，在首错之后，不当第二个独立产品根因。两项普通错误字段白名单保留；本轮没有privateScopeHostMaintenance上下文，不能把R43诊断或当前静态推断补成本轮原始观测。

## 失败回收与业务状态

准备finally join后仅一次原cleanup；原Job单次受控停止，nativeDrain为pid58260、childCreated/processSettled/jobEmpty=true、exitCode1。不是强杀父driver，不追加第二次Terminate或delete。

四scopeSnapshots的effects全0；scopeReleaseBefore/After effects0、scopeReleased由false到true，原release返回 {scopeReleased:true}。这是无plan/effects0分支，不是有plan全SD/成员/祖先恢复；不把对象效果数当Set次数或全局系统审计。

原耐久trail为registered cceef375及seq1 planned ff745b2e、seq2/3/4 unknown-retained e3b63ad2/d38c118f/02cf5ddd、seq5 released c2dd30cb。六条jobId/owner/kind/label/startedAt/toolCall保持同registration并绑定executionIdentity。末resource全文等原released：retainedHandles/retainedAllocations/scopeEffects全0，threadRestored/childSettled/jobEmpty/nativeHandlesClosed/scopeReleased/profileAbsent均true、preparationPending=false；历史unknown条目保留，最终unknownOwnership=[]。

finalReceipt全文等deletedReceipt，state=registration-and-folder-absent、sealed=true、retained0/0；sealState保原unknown-retained诊断，不擅自更改。Job failed，task active/drained、blocked/no-replay。没有settled、liveJobAudit、releasedLiveProofs、coldViaOriginalRecorder或cold；不解码journal补cold，不改DB或追认旧unknown。

## 集中归档与边界

run.json225250B/SHA `0af0c08afec610e4a3ebd964eb9f881e69a85817fa2899e4b9b326c7ae2cf4c8`；execution.json57424B/SHA `db6fc7da6ba53d6990c499058d8beef8e54754b27cd77c712a560c6f10a20414`。console197B/SHA `dc4924ca4f2da6d1bd762da1881e5d608d52a080a4d2dbca6cb9e5d74eca7f76`，stderr0。十材料及安装/journal留ignored原处，完整SID/路径/FileID/SD不进入公开附件。

首次只读概览曾将scopeRelease前后原对象送入宿主工具输出，误含本次临时Profile身份字段；随后改为严格数值/状态白名单。该字段未复制到普通协作消息或本轮公开附件，本轮不据此声称诊断全链隐私已通过。此事不改变原运行证据或业务FAIL。

归档沿R43配方，只更新本轮绑定、继承守恒首错和对应既有用例。--check提供零效果自检，--run仅新建四公开附件并更新矩阵，不导入产品/Host/Native或解码journal，不写原材料、安装、旧报告或库存。errors继续显式白名单，不spread/copy cause；输出递归拒绝实际绝对路径、SID、私有诊断键及原scope路径/FileID。归档生成首次仅模板命中数断言失败，在建目录/写配方前退出；按实际命中数修正，不是第二次Native或新验收轮。

库存5485行、3335797B/SHA `4cb87a89885f8359d2b813580994d40dcd2d74bbc76ac4aac9138498e0891f2f` 全文不变；矩阵316行仅增round_44列、不新增case。原业务scope用例记本次继承守恒FAIL，两总汇PARTIAL，初始化/SDK seal/NUL/LocalAppData各记实际窄PASS，其余309行NOT_RERUN_ROUND_44。剥新列精确恢复R43矩阵250751B/SHA `92fe6eebc668b992b4dded1d268e6d4d237c4a462031da701bb8622367edf5ec`，不倒改历史场景和结论；完整前后hash在index。

新十稿加旧五十私有稿保持hash及ignored/untracked/unstaged；R39至R43报告、配方与附件保持，现场依原约束留存，无本轮失去用途的Native中间附件需清理。Tests仅写本轮验收材料和矩阵，未改生产/goal/spec/review/manifest，不Git写，无模型/真实渠道外发、CI、PR、合并或部署。

业务scope仍FAIL。具体继承根因、修复及下一准确准备由责任层推进；新的Native仍需完整前审/Main新窗。真实grant/LPAC IO、有plan恢复、payload写入/新增后代/取消、完整runner ACK/Resume/ConPTY、旧NULL/外部树、Host重启恢复、其它平台和最终同版验收均未闭合；不创建总体全绿report.md。
