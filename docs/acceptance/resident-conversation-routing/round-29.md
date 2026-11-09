# 第 29 轮：空新根初始化成功，标签撤销完整控制位投影失败

## 范围与版本

原 worktree / `worktree-resident-conversation-routing` / 原 PR，HEAD `6d79b0a0279d3f94f2d72d21f51ab1d654b0f509` 加未提交协作树。本轮仅新空根条件初始化及原四 setter 组件诊断，不改生产、goal/spec、来源 manifest 或 Git；SG11/SG12 仍 ACTIVE，唯一目标为 [goal.md](goal.md)。不把初始化成功或前三阶段通过写成整批 PASS/生产准入。

- 原 Review 准确前审为 review.md:1700；probe `97b224654963d94c909bd9adc8b896533839eddf6579060a928feb4d83a41446`，清单 `dc6cff02c9a7253005fe2b293b800db28ca7ffa615be93c66c7687d1f6c83212`。node --check自然0。初始check与同参数fresh run-check逐字相同，SHA `4ca05dc320d570a4d8b88cd5ea62f48a176b5f2fafb13b4dde26a847e00bb98d`，Node0/stderr0/effects0/nativeExecuted=false/rootAbsent=true；动态产品/FFI import前返回。
- Windows11 x64 / Node v24.19.0。实际消费ACL `f5c414c965b77049e4cfa216638456816cb70f6ccdf988e6eb0e7805f36bf25f`、Win32 `730d4649449c92a68a80700dda2b9fc1bd7e50ee89538fb06b0f559489125d3d`、contracts `a9eb7a93a4a4190a690c37cfb4ecc12bece676056eeb19613a04f72cd47e3329`；仅静态关联Profile `4164922a215241c35988ef6dbbefa3766d0272e32167ac5e88fef41e8f15c29d`、index `c5028b994efd3f927d3d56b7ed45789f8fb717c3312cae4d43ae6ed9de7e88aa`。五源起止不变，未验证Profile生产链。
- 唯一新根 `data/workspaces/sg11-security-projection-initialized-8ac556c1811b44bbbf2db045db8dcc15`，执行前缺席/ignored。与原三个失败根分开，不重跑或接管旧根。八项准确私有资产的bytes/hash、完整起止pin及脱敏谓词见 [本轮摘要](round-29/windows-initialized-setter-summary.json)；SID/SD/FileID原文仅本地ignored。

## 真实执行终态

宿主任务 `bue53yjjx` 的父采集器0只代表收集完成，实际 Node 自然1 / FAILED、stderr0。执行为 `2026-11-08T12:01:36.646121+00:00` 至 `12:01:36.876162+00:00`，约0.234秒。原同绝对根fresh --check后仅一次 --run，没有retry、补位、改预期、自动回滚或删除失败根。

| 阶段 | 实际观察 | 结论 |
| --- | --- | --- |
| PAI请求与创建后立即根读回 | 请求9404；actual9804；150c投影1404→1004；full xor c00 | 创建请求未精确匹配，明确matched=false；本轮已在后代创建前观测到缺400 |
| 空根一次同DACL初始化 | Set status0；actual9804→9c04，full xor400；长度及bytes[0:2]/[4:]全部不变，所有组件不变 | initialized=true；前后空目录/路径复核/同FileID通过，没有第二次初始化Set |
| 创建child/file后再读根 | 实际根完整SD仍逐字节等于已核settled业务baseline | 不覆盖创建原SD；本轮排除“后代创建才导致本根缺400” |
| 三对象业务baseline | root9c04、dir8c04、file8c04；各过DACL400/label800/无REQ与protected边界 | 根初始化成功未外推后代资格，各对象独立通过 |
| 原4次baseline Native边重建 | 两边DACL/label的sameOwned、bytesEqual均true，xor0 | 完整基线重建通过；内存布局未另放宽 |
| DACL-add / exact-release / Low-label | 三阶段各三对象sameOwned均true、control xor全0 | DACL两阶段bytes也均true；Low三对象bytes均false，仅完整组件比较通过，不新增布局失败，也不抵最终恢复 |
| label-release | expected9c04/8c04/8c04；actualbc14/8c14/8c14；xor2010/10/10 | 三对象sameOwned均false，原完整比较门真实FAIL |

4业务阶段及8次未来继承在首个业务Set前冻结，未按读回重定基线。初始化1+业务4共5次SetSecurityInfo返回值全0，但最终完整投影未通过；没有final独立snapshot、finalObjects或actualOsBusinessBaselineRestored证明。本轮恢复目标仅是实际settled/initialized业务baseline，不能称恢复创建请求或初始化前SD。

## 最终失败的组件分层与原因边界

离线严格解析raw中的SD头、组件偏移及长度，不再调用Native或读失败根ACL：最后三个actual与冻结candidate的revision/reserved、owner、group、DACL、SACL逐项字节均相同。三者SACL指针均NULL/offset0，与预期一致；根control额外SACL_PROTECTED2000及SACL_PRESENT10，后代仅多SACL_PRESENT10。错误原文 `Actual setter projection differs from fixed native stage`。不能把本轮说成Low ACE仍残留，也不能因内容相同而清control/掩差量/降低sameOwned或最终OS字节恢复门。

1. “Low标签内容没有撤销”：与三对象actual SACL均NULL的原始字节证据不符，本轮排除此解释。
2. “新根初始化或初始继承基线就不稳定”：初始化仅400差量、后代后根全文不变、四次边重建及前三业务stage全部匹配，不支持把本轮失败归到这些已通过阶段；仍不能推广到其它树或生产Profile。
3. “NULL-label撤销后的OS控制位语义与冻结stage预测不一致”：与最终数据相容，具体API合同/生产修复由Core与Platform收敛，尚不能仅凭本轮定底层唯一根因。不盲换flags、原样重跑或修改比较器求绿。

本轮已补第28轮“先建后代才首读”的时点盲点：本次PAI请求9404在Create后立即读回9804，且后代创建没有再改已核9c04根。此为本次调用的直接观察，不追认旧PAI调用时点；尚未以第二种独立Native查询交叉验证所有绑定/读回语义，官方也不保证PAI原子保位或同DACL Set普遍必置400。

## 资源终态、保留现场与保护边界

29次GetSecurityInfo及转换1，共30份local分配；12次PrivateSecurity继承分配，共42份分配全部单次attempted/closed。5句柄（自身query process1、primary token1、root/child/file3）全部单次attempted/closed，retained allocations/handles均0。初始化与4业务Set/status分列，不把资源关闭当作恢复成功。无Profile/Job/launch/Resume/ConPTY/网络、真实渠道或模型API；不伪造producer/receipt。

失败根8ac仍在；旧c32、owned08f、PAI013三根仍在且非链接，旧PAI probe/raw及owned原材料保持。不恢复/删除任一失败根，不清全局Temp或tree kill。本轮raw SHA `3f5ab125add7f051cb68bb202197b39a7391537297a196b6f76847db8ce73590`，execution SHA `333d3ad30f15e3a3a16078cef1c874b13a99a45b495a6fecaa4741908bc2c27b`；八项私有材料均ignored/untracked/unstaged。它们仍支撑前审/本轮失败及后续修复，不属于无用中间件，未复制到正式仓库或上传发布。

Create到首root handle没有原子Native关联；持根后路径式建child/file没有整条Native祖先稳定保证。没有新增父handle。无DELETE共享、私有DACL、真实空目录和Host未发布流程不证明抵抗同账号full或任意可信插件并发换链；正式Profile自身temporary.parents合同不省略。本轮只证该隔离组件，不把这些限定写成生产完整隔离成立。

## 矩阵、库存与同阶段守卫

- matrix仍293行，只加round_29列；原Native业务行登记初始化成功但最终控制位FAIL，其它292行NOT_RERUN。剥新列逐字节恢复第28轮SHA `06f396f41e5d7ec894530b3d19fa8c2e9df0514c541cd748547c0399ddedbfde`；本版SHA `2da8c245cc1febcbf6eb3e2be6d9be6cfc501a058921763817ef5344376fce9f`，旧失败列/旧scenario字节不改。
- 库存5468身份全文未改，仍SHA `467fabea4de2708fac4bb45312d75f48e5911a1ad6028bbc4c5c2f6790764457`。没有新增/删除/改名正式注册或新PASS证据；本轮Native不是Node test注册。
- Linux两隐私注册当前5f3ba7b5的ask/portable断言仍未在Linux执行。仅准备ignored `docs/tmp/sg11-linux-provider-observer.mjs`，1014B、SHA `03e28cd7b39127069fd8b947a82459dc3c8037421c471cf9f5be8ecfd266e8b5`，只node --check0、没有import执行。它包原实际selectContainmentMode，保this/参数/返回/原异常，不预跑独立probe或注入provider；未来必须在实际worker取得kind/selected/pid，fallback与case结果分列。没有Docker info/build/run/exec；未复用旧镜像冒称当前源码同版。
  第30轮清理注：上述 observer 的原 `docs/tmp` 副本已清理；准确源码保留在 `round-30/linux-provider-observer.mjs`，1014B、SHA 不变。本轮未执行结论仍指第29轮时点；第30轮实际六例与 fallback 结果见 `round-30.md`。
- Lead本阶段工具输出（非Tests重跑；未另存日志或精确时刻）报告：check-production-imports一次通过 `{"productionImportFiles":395,"literalBareImports":193,"status":"declared-production-imports"}`。native守卫首次实际失败 `Unrecorded legacy/platform source change: src/process/windows-acl.js`；Lead同步两个manifest的适配hash及说明后，原 `node scripts/check-native-runtime.mjs` 通过 `{"runtimeJsFiles":395,"externalSdkImports":0,"legacyOrchestratorDefinitions":0,"legacySourceFilesVerified":2,"historicalFormatFilesRemoved":9}`。manifest阶段hash为ba937a1b/2e534ace，Lead/Review报告7条适配匹配、上游sourceSha/许可/历史来源不改。保留首次失败，不补造日志/执行时间；不把此阶段守卫追认为最终全版或OS验收。

本轮以真实FAIL归档，不写全绿report.md。NULL-label控制位恢复责任交Core/Platform；Profile仅能消费已证初始化部分，完整生产接线及实际验收未完成。Linux六原注册按当前生产源和独立只读payload另批准备/实跑，不与本轮Native失败混写、不并发新Windows OS动作。完整freezeScopedFile消费者、Profile/temp/有效权限/ACK/Resume/mandatory cleanup、ConPTY和macOS/最终同版整体验收仍未完成。唯一goal由Lead维护，Tests不Git写。
