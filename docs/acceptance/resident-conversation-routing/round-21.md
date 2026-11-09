# 第 21 轮：NULL 无800真实反证与 NRU/NXU 读依赖

## 范围与版本

原 worktree/分支/PR，HEAD `6d79b0a0279d3f94f2d72d21f51ab1d654b0f509` 加未提交协作树，SG11/SG12仍ACTIVE。本轮只改原`test/pi-native-sandbox.test.js`一个新注册及验收材料，产品修复归Platform。未Git写入、CI、合并、部署或真实模型/渠道外发。第20轮已闭的默认PID1/fake绑定与六项Native均未重跑。

受验ACL `4cf27e7237b8a3cc5cb78731e16d01420b703fd859ed91bb70788205465eda45`，contracts `62a6ddc58f4d052619c680fa59d936efd28931fa8c8236623c46238ff5fa82b3`；Native另含Win32 `f5b76f43012a1e0662d4b304f0024da790e4abeadefa288edb7061d205a6a2fe`。两批各自起止无漂移，不追认后续Platform改动。

## 两项真实 Native 反证

第20轮NULL基线本有800，不能回答缺席情形。按Lead/Platform一致的最小范围，同一probe仅保NULL × directory/file两项；新proposed parent/child Buffer只清SACL_AUTO_INHERITED(0x800)，真实原SD全文、其余控制位/owner/group/DACL均不改。没有单边四项、重复Medium或额外OS动作。

准确脚本 `a8502b759b696fd2e9748c5806c6b67366365f04c3ddc7c56fecda0e83fe993c`，清单 `7ca0f7a2ce7a6b1c4a1937b7fcfa81c6e27ce4219c84369849c8b542a54cf237`，自检 `2ec6b2ff5391976a7a28d1b288005a721534c0a479443cebae10925962bbeaf9`。原Review准确前审后，原Tests同一新root参数先--check自然0/effects0/native=false，再唯一--run。执行自然0、status OBSERVED、stderr空、errors=[]；这是观察完成，不是冻结器通过。

| NULL 变体 | proposed parent/child | Native parent/creator | Native output | merged | xor / 全文相等 |
| --- | --- | --- | --- | --- | --- |
| directory | 0x8404 / 0x8404 | 0x8404 / 0x8404 | 0x8804 | 0x8c04 | 0x800 / false |
| file | 0x8404 / 0x8404 | 0x8404 / 0x8404 | 0x8804 | 0x8c04 | 0x800 / false |

Native在两个输入都缺800时实际产生800，现有merge最终保留该位，因此merged全文不同于原proposed child。原严格完整基线重建判据不成立，矩阵按业务FAIL保留，不将Node0写成PASS。没有清Native返回位、掩比较位、放宽冻结器或用退出码掩盖反例。已交Platform沿实际调用/规划层修复，Tests不改生产代码；不能仅以“原现场对象已有800”排除这组明确内存输入。现有冻结器的保守拒绝仍在，本轮没有放行生产路径。

实际原句柄FileID和真实SD全文回读不变；6个LocalFree、2个DestroyPrivateObjectSecurity及3个只读句柄均单次attempted/closed，retained均0；新根`data/workspaces/sg11-label-inherit-6308e50b02244f4891aac45058233b6c`安全回收并独立核缺席。零SetSecurityInfo/Profile/Token/Job/进程/Resume/网络调用。完整个人SD/FileID/raw只在本地ignored `docs/tmp/sg11-null-label-control-run.json`，SHA `cf3f857f12af8ccb2c9b1f5e760e00149019387b471369ca2a7990841ab047db`，未上传或入Git；仓库只保`windows-null-control-summary.json`脱敏结果，SHA `4f0bb468010aaf7b691113b09e2744c5394a7e16e53edf12b68d914b256c64e5`。原Review/Lead/Platform各自已只读核原raw，不代跑。

## NRU/NXU 单注册实跑

原文件新增完整注册：`Windows scoped Low read borrowers retain NRU NXU labels until the final reader exits`。受验测试SHA `8105f17e917261c9b40419f705eb4291a304f266caff2e3c07ee176f1a463962`，原Node命令按该完整名精确选择，仅这一注册自然0、1PASS/0FAIL/0SKIP，三pin稳定。

- mask2/4/3/7：A由Medium写作用域降Low；B只读借同FileID准确来源。A先退出时保B原Low及mask，A公开released后B最后退出恢复原Medium全文；不依赖NW-only假设，不改NRU/NXU位。
- 读者下新继承FileID没有原来源时拒绝；A回收对仍被B读根覆盖的新后代不允许任意label传播。新后代SD不被规划器静默改写。
- mask1的Low read和Medium read不建立无必要借用，candidate全文保持。

以上为实际纯规划器调用和字节夹具，历史proof是测试输入，不是真实Job提交、Native Low有效权限或生产准入。没有重跑原七Low/三DACL primitive整组。本轮Python包裹器在结果、stdout、stderr已落盘后，仅向GBK终端print Unicode勾号时报编码错误；独立读回证明真实Node早已自然0，未为打印问题重复跑测试。

| 证据（round-21/） | SHA256 |
| --- | --- |
| windows-low-read-dependency-result.json | 32bdde7d41f8a9b383ab64f8ac8cb619fb6a9ce3c27c886de88a4686951d3fd4 |
| windows-low-read-dependency.log | 5ee608b3e06ea9fda83afba11865848b46fcdffacec8956eac189a18bda007a3 |
| windows-null-control-summary.json | 4f0bb468010aaf7b691113b09e2744c5394a7e16e53edf12b68d914b256c64e5 |

## 集中登记与剩余

库存5466→5467，仅新增上述一个正式注册，逐完整名绑定受验测试SHA/log/source，原(file,case_name,occurrence)及registration SHA全部保留。AST提取520文件/5209注册、未解析0/未登记0，仅证明静态完整，不是全量执行。matrix283业务行，新增round_21，原Native qualifier行保本次真实重建FAIL，新增NRU单项PASS与库存行；旧轮结果/FAIL不变。不写全绿report.md。

本轮Native专属根已经不存在，无在途Native/测试；实际未知不追改。第20轮Docker最终证据与不同范围六项观察保留，未被本轮两项当作重复通过。生产NULL无800重建问题待Platform修；原DACL共享回收/runner-IPC/bootstrap差量、mandatory cleanup、真实Windows scope/ACK/Resume/ordinary/ConPTY，以及fake监听/入站和最终同版整体验收仍未完成，唯一goal由Lead维护。
