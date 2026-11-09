# 第37轮：既有四个只读根的全树资格观察

## 结论

方案 D 的准确五稿经原 Review 完整前审和 Lead 唯一消费窗后，仅执行一次原 driver。**Node84576 自然退出0，driver退出0，真实 qualified=true、unchangedVerified=true；四个原 readRoots 的完整 forest 前后各8个对象、4条真实内部边通过本轮 DACL baseline 与原 Native 继承恒等检查。40个查询句柄、16份 Local 分配、4份 private-security 分配均逐项单次释放，retained0/0，unknown/errors/资格失败/漂移均为空。**

这只是原保留安装中本次实际 forest 的窄资格观察。readOnlyAdmission=false、labelOriginQualified=false、productionScopeReady=false 保持；不证明 LPAC 读拒/写拒、SDK seal、真实 token、mandatory、Job ACK/Resume/ConPTY、Low 来源或已有 NULL 写树恢复，不关闭第35轮未决资源。SG11/SG12 仍 ACTIVE，不写全绿 report。

## 版本、输入与前审

工作目录/分支保持 resident-conversation-plan/night-bot 和 worktree-resident-conversation-routing。受验版本是 HEAD `6d79b0a0279d3f94f2d72d21f51ab1d654b0f509` 加未提交协作工作树，精确来源仅为 check 中列出的19项，不冻结或借用第36轮1125集合。

- 原输入为 `docs/tmp/sg11-profile-unlaunched-fixed-run.json`，372359B/SHA `f00874409ff9f6432d5b56e73fcf19a912f51c9903bdc0a16b4baa69057c2f81`。只用它绑定原四根 path/48hex FileID/access，不重放其命令或收据，不改原 raw。
- 原 scopeRoots/privateProof.roots 没有 directory 字段。check 的 expectedDirectory=true 只是任务目录合同；本次 Native class9/1 才实际核四根 directory=true，并与原完整24B FileID绑定，前后复核。原第五条 write temp、SDK/Profile proof.objects、R35/c2134d 和其他安装不纳入观察。
- 19项来源插入序聚合为 `c34655b38cffadf86319bf8fe892cb521f28879aa88b2dc2dc153611819d81a7`。本地 import 闭包、准确已装 Koffi/Cordis/Cosmokit、Profile944b/原 ba0b 参考及本 probe/checklist 的完整 map 见本轮 index；参考文件没有被当作 factory 调用。
- 准确 probe26987B/`5f35a20d0ed3ec865606b9db43f1d98579a0a00ae5aef9ee6f0f9ebb76ad8d2f`；checklist15575B/`b533d60e792f35ac2918fa3937abad039d87a095ef6eacc25cca504e10ed9335`；check6991B/`22e8557d6b882788da025a524089995664c041f8fa78f27cbd3327123d721460`；准备收据7421B/`fe7e754d7fed3a79d696dcec4bea8660b2849d6481c162ea0bfdf748596a3387`；driver8584B/`efe49dba30f988f7f27d6987c5de763dda56b2d4cc776bf623bba7f779457879`。十项私有材料的完整 bytes/hash 集中于 index。

原 Review 在 `review.md:1901` 完整核准确四稿及 driver；Tests 实际读回597876B/SHA `699f27650dfb46efc4315727d5bdd273d79c342dade395e9643b9d9a356670be`，原 R36 的589887B前缀逐字不变。Core 窄核不替代此整体审查。Lead 随后确认 Core/Platform/自身保持19项责任交集、准确五稿和不可变输入，才给予本批唯一消费窗；前审自身不构成执行批准。

## 准备与唯一执行

Tests 的原工具 `call_64433dc6f36844daa7f9a71f3afbb498` 先运行 node --check 自然0，再按准备收据完整 argv 运行 probe --check 自然0/stderr空。check 在产品动态 import、Koffi addon/DLL 和 forest 之前返回；effects0、nativeExecuted=false、hostInstantiated=false、forestObserved=false。19项独立回读一致、原输入未变、运行输出缺席。这里的零效果是 probe 的业务/Native 效果，不否认准备材料写入。

随后一条长 Bash heredoc 在 shell 解析阶段 exit2/unexpected EOF（原工具 `call_49ec4288925b4d6da777d29428b1222a`）；原 `call_74d6290016ed446d8302dd3c84e0caf6` 独立确认 driver 和五运行输出均未创建。改用文件工具完整写入 driver 后，原 `call_0cf8870b064143ed81d1ef4e27c3e957` 实际 AST_OK/driver --check0、stderr空。此错误不是 Native 失败或重跑；晚于原准备收据，未倒改既有收据掩历史。Platform 清单已保留其自己的准备错误，不把它们当本轮 Native 结果。

准确唯一工具输入为 `python -I docs/tmp/sg11-readroots-qualification-execute.py --run`。宿主任务 `b3d4gbol0`，原完成通知 tool-use `call_6e384faca0ad43f1bdd3a2d4cef63db4`。采集区间为北京时间2026-11-09 01:48:18.327830–01:48:22.614592；这是 driver 区间，不冒称 Node 出生时刻。

原 driver 先同准备收据 argv 做 fresh check，实际 exit0、stderr空、stdout6991B逐字等已审22e8 check；复核四稿、19项来源、原输入和输出缺席后，仅把 argv[2] 的 --check 换为 --run，唯一 Popen 并自然 wait。Node84576/driver 均0，qualified 字段实际产生为 true、qualificationWasProduced=true；sourceChanged=[]、inputChanged=false，无 collectorError/sourceReadbackError、干预、强停、重试或执行总期限。

原 run84296B/SHA `8e3c2f6001b0997dab2f7231ad003c4e098bcdcd368f3868ad18c18f1bf31fcc`；execution7638B/SHA `4e36bc96a4c32ddd46bfa89e6a74f7817961c024cc8522938ca8bc196849b462`。Tests 接回原宿主 output、原 raw 与 execution 后独立核真实业务/资源终态，才立即通知 Lead/Core/Platform 释放来源窗，没有为归档延长。之后源码如有变化不倒签为本轮受验版。

## 实际 forest、baseline 与内部边

两轮完整 forest 均为8对象：7目录、1文件。四个根直接沿用原 scopeRoots，四个后代均位于 materials；没有造 fixture 补边，也没有扫描根外祖先的兄弟或读取文件正文。

| taskRoot 内相对对象 | 本轮类型 | 完整 control | 原态资格 |
| --- | --- | --- | --- |
| materials、work、outputs、tmp | 4目录 | 均0x8c04 | DACL400且无REQ100 |
| materials/runtime-evidence | 目录 | 0x8c04 | 同上 |
| materials/source-27f33cf856267a968aaa731d54176980.json | 文件 | 0x8c04 | 同上 |
| materials/runtime-evidence/process、materials/runtime-evidence/tools | 2目录 | 均0x8c04 | 同上 |

每轮另有12个准确边界祖先，只核实际类型、完整 FileID、native final path 和直接父子/同卷身份；不读其 SD、不要求其400、不把根外父→森林根当内部继承边。所有查询按原准确0x20080/share3/OPEN_EXISTING3/flags0x02200000，拒 reparse/delete-pending/别名和非目录多链接；四个原 readRoots 的本轮目录类型及完整原 FileID前后均一致。

全部8对象的记录 label=null、lowNruNxu=false、labelOrigin=not-queried。这不证明旧 NULL 写树可恢复，也不补 Low NRU/NXU 来源或借用合同。

4条实际内部边依次是 materials→runtime-evidence、materials→source JSON、runtime-evidence→process、runtime-evidence→tools。protectedEdges=0；每条均原 scopedFileInheritanceInputs→CreatePrivateObjectSecurityEx(0x19/Token=NULL/原file mapping)→mergeScopedFileInheritance→sameOwnedSecurityDescriptor(默认第三参false)，真实 sameOwnedOriginal=true，byteEqualOriginal=true。protected 分支没有在本轮实演，不额外造样本。

GetSecurityInfo 使用0x17（owner/group/DACL/mandatory-label，不是 audit-SACL）；baseline 只取原 `(control & 0x500) === 0x400` 判词。前后成员、完整身份、类型、父关系及原 owned SD 全量复核，before.complete/after.complete/unchangedVerified 均true，drift=[]；不 mask control、不排序 expected、不以布局差异放宽比较。两次观察不等于运行时锁、事务内容快照或生产准入证明。

## 实际调用与资源终态

| 直接调用 | 实际次数 |
| --- | ---: |
| CreateFileW / FinalPath / CloseHandle | 各40 |
| FileInfoEx（class18/9/1） | 合计120 |
| GetSecurityInfo / LocalFree | 各16 |
| GetSecurityDescriptorLength | 20 |
| CreatePrivateObjectSecurityEx / DestroyPrivateObjectSecurity | 各4 |

实际40个 query handles、16份 Local 分配、4份 private-security 分配均有逐项 releaseAttempted=true/closed=true；retainedHandles=0、retainedAllocations=0，ownershipKnown=true、unknownOwnership=[]。这与2×(12祖先+8targets)、2×8 Local及4条适用边一致，但结论来自原逐资源条目和实际调用，不拿公式预填计数。loader 的 GetSystemDirectoryW 未 instrument，DLL/addon 装载不混称业务查询句柄或全局总分配数。

errors、qualificationFailures 均为空。没有故障注入证明失败nonnull out/释放失败分支；它们仅经原完整静态前审。本轮未调用业务 Set、SDK Create/Delete/derive、目录创建删除、token查询/改写/impersonation、Host、OS Job/业务 child、Resume、ConPTY 或网络；Node/Git 准备进程和 docs 证据写入单独区分，不宣称整个 OS 完全没有进程/IO。

## 集中归档与剩余边界

本轮公开材料仅本报告、脱敏 summary/index、短 native console 和实际 archive-update.py；完整 SD/FileID/绝对路径及新十项准确私有材料保留 ignored，不复制为公开附件。本轮无新的中间文件待清；新十项仍用于正式核验，R35 现场不再访问；R35/R36 原材料、安装根/journal/锁不改写或清理。本次只读取四根森林和必要祖先身份；“R36现场不改”不否认这项已批准的只读查询。

归档先 --check/effects0，再 --run。矩阵仅追加 round_37 和 sg11-readroots-qualification-forest 一行，297→298；两总汇记本轮窄资格 PARTIAL，其他295旧行 NOT_RERUN_ROUND_37，未重跑三守卫，不覆盖R35异常或R36组件历史。剥本轮列/新行须逐字回原202662B/SHA `22334bdd73e9934a5a3f4444c69e27000e228d36ce5b881500a21149768e202a`。

5472身份库存全文保持3320505B/SHA `aeb6cc97bcedbcce7b7d63aa984159a18b699b7b67f347deb2e4e057f5464fdb`，没有新增 Node 注册。本轮未改生产/测试源码，未运行其他主组、真实模型或渠道，无 Git 写入、CI、合并或部署。后续 SDK seal/真实token、grant/release/mandatory/ACK、NULL写树恢复、Linux强owner/macOS、其他主组/Web及原PR交付仍需各自证据。
