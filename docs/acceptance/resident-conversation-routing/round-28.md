# 第 28 轮：PAI 创建请求未在首次实际读回保留 DACL AUTO_INHERITED

## 范围与准确版本

原 worktree / `worktree-resident-conversation-routing` / 原 PR，HEAD `6d79b0a0279d3f94f2d72d21f51ab1d654b0f509` 加未提交协作树。仅新 PAI 自有根原子创建和原四 setter 组件资格探针；不改生产、goal、spec 或来源 manifest，不 Git 写入、不跑 CI/合并/部署/真实模型/渠道。SG11/SG12 仍 ACTIVE，唯一目标为 [goal.md](goal.md)。

原 Review 的准确前审在 review.md:1680，脚本/清单/check/execution 四 hash 及五源、唯一新根已独立核回。只沿同一脚本、同一绝对 root 重新 --check，再唯一 --run；没有复用旧根或旧前审。

- probe `cb463dd429d6ec05e58659dd4cf60a85ea57be312e1e7978c729f9d59ad96b58`；清单 `cc7b0a62a48942420b7f917f04f87eb20d39c9ad6be3031bab6300eb9d638eea`。
- 初始 check 与 fresh run-check 都是 `c8ae3b83981789cb2692f4a991073f547e447b3ed44a80563efe99038bba5e4f`：Node自然0、stderr空、effects0/nativeExecuted=false、rootAbsent=true，位于动态产品/FFI导入前。
- Windows 11 x64 / Node v24.19.0；组件消费 ACL `f5c414c965b77049e4cfa216638456816cb70f6ccdf988e6eb0e7805f36bf25f`、Win32 `730d4649449c92a68a80700dda2b9fc1bd7e50ee89538fb06b0f559489125d3d`、contracts `a9eb7a93a4a4190a690c37cfb4ecc12bece676056eeb19613a04f72cd47e3329`。
- Profile `4164922a215241c35988ef6dbbefa3766d0272e32167ac5e88fef41e8f15c29d` 和 index `c5028b994efd3f927d3d56b7ed45789f8fb717c3312cae4d43ae6ed9de7e88aa` 只是静态关联 pin，未作为本探针的 Profile/父端生产链消费。五源起止全部相同。
- 唯一新根 `data/workspaces/sg11-security-projection-pai-0131323a873048979e50911c39762ffb`；执行前缺席/ignored/全祖先非链接。本轮完整 SID/SD/FileID/Native raw 留本地 ignored；正式 [脱敏摘要](round-28/windows-pai-create-summary.json) 只保谓词、控制位、计数和八项私有材料 hash。

## 真实终态：Node 1，创建精确控制位门失败，Set 0

宿主任务 `bk1dirns2` 的父采集器自然0，只代表已收集。真正 Node 自然1 / FAILED，stderr0，elapsed约0.172秒。CreateDirectoryW 返回1、created=true、unknown=false；随后只按原程序创建 child 与 child/file，并以原访问打开三对象。没有后续重试、补位或更改比较器。

| 首次读回谓词 | 请求 | 实际 | 结论 |
| --- | --- | --- | --- |
| 新根转换/实际 SD control | 0x9404 | 0x9804 | 全控制位不同 |
| 创建比较 mask0x150c | 0x1404 (5124) | 0x1004 (4100) | xor0x400，准确断言失败 |
| owner/group/DACL 内容 | 各自真实转换请求 | 三项逐字相同 | 不是这三项字节失配 |
| 请求/实际 SD 长度 | 160B | 160B | 长度相同不能代替 control 相等 |
| root/child/file 的真实 control | 不预补实际位 | 0x9804 / 0x8804 / 0x8804 | 三者仍缺 DACL AI400 |

失败错误原文为 `Expected values to be strictly equal: 4100 !== 5124`。`initialRootMatchesCreation` 尚未完成赋值；只读离线解析 raw 中转换请求与首次实际 SD，独立复核 owner/group/DACL 相等和 mask/xor。该解析未调用 Native API、未再读取失败目录实际安全信息，不改原始字节。

本轮尚未到三对象 AI/REQ 门后的原始边重建，baseline=0、CreatePrivateObjectSecurityEx=0、冻结阶段=0、SetSecurityInfo=0、最终实际恢复未验证。四阶段 DACL add/release、Low/original label 均未执行，不能写成 setter PASS，也不能用“Set0”宣称已证明恢复。

## 原因边界与反证

已证事实是：请求携带400，在创建根并创建两后代后的首次实际读回缺400。没有在 CreateDirectoryW 返回后、建后代前读取根，所以尚不能把变化时点唯一定位到该 API。

1. “SDDL转换阶段本来就没带400”：转换请求实际control9404、mask1404且已通过请求检查，现有证据排除此解释。
2. “CreateDirectoryW创建时规范化/未保留请求400”：与现象相容，但没有紧邻创建返回的独立读回，尚未收敛。
3. “随后创建后代触发父对象控制位变化”：同样未被现有时间点排除；本轮不能靠猜测排除此反例。

绑定/读回语义也未用第二种独立 Native 查询交叉证明。完整组件相同支持对象及内容路径基本正确，不等于所有 API/时序原因已排除。下一最小诊断由原产品/平台责任人结合官方合同决定；Tests 不自行把实际位清掉/补上、不改 expected、不提高权限，不原样机械重跑。

## 资源终态与保留现场

4个 local 分配（转换请求1、三次安全信息读取3）全部单次 attempted/closed；5句柄（只读自身process1、primary token1、三文件3）全部单次 attempted/closed，retained allocations/handles=0。两次无 thread token 检查沿原合同执行；没有 Token 创建/修改、Profile、Job、业务进程启动/Resume、HPCON/NamedPipe或网络动作。全部资源与 API status 见私有 raw，正式摘要只保计数和释放谓词。

因创建比较失败，不执行自动恢复或 rm。新013132失败根仍在；旧 c32c97、owned08f 两根及原探针3c6e/raw89666412原样保留。未清宿主 Temp、未 tree kill、未触外部共享ACL或系统/Node安装目录。

私有本轮 raw SHA `1db7485f00247cc730a1c6647a15473ac2c4517bb4388924787f26aca91d8735`；执行收集器记录 SHA `e4fe910b954b928907df5e26c2c72ee55bc1f65258255734ca97203dc92d439c`。八项材料均 ignored/untracked/unstaged，不复制私有原文到正式归档、不上传或发布。原前审和失败资产仍是后续核验所需材料，保留，不作为无用中间产物清理。

## 矩阵、库存和未验边界

- matrix仍293行，只新增round_28列，原Native业务行登记 `FAIL_PAI_CREATE_NATIVE1_DACL_AI400_NOT_PRESERVED_MASK1404_TO1004_SET0_RETAINED_PIN_STABLE`，其它行NOT_RERUN；r26/r27原失败与结果不覆盖。剥新列逐字节恢复SHA `38266be01a3dc54001b7a6ea7b62d2affb8ec02e06ba01a48128ff671c2e0041`；本版SHA `06f396f41e5d7ec894530b3d19fa8c2e9df0514c541cd748547c0399ddedbfde`。
- 没有新增/删除/改名正式test注册。另两条原Linux隐私用例只在原preset后各补一行应用mode=ask/runtimePaths.mode=portable断言，逆去两行逐字节回旧源码3226b2f8；当前 `test/native-memory-privacy-kernel.test.js` SHA `5f3ba7b5d424c24ab6b21342eb6c869171e31a0e3356ed1446a238fa5d79b57b`，node --check通过，Linux尚未执行，不计PASS。
- 库存限定该文件8声明更新当前源码/行号，5468身份及全部历史registration hash/证据保持，未把历史PASS推广给新断言。本版SHA `467fabea4de2708fac4bb45312d75f48e5911a1ad6028bbc4c5c2f6790764457`。该元数据变更不改变round27各批受验版本。

本轮以真实FAIL结束，不写全绿report.md。PAI新模板稳定性、完整freezeScopedFile消费者、Windows受限Profile/temp/有效访问/ACK/Resume及ConPTY真实IO/resize/close仍未验；Linux六个原注册、实际强owner与macOS执行端/最终同版整体验收继续未完成。仅把本轮证据交原Lead/Review；唯一goal由Lead维护，Tests不Git写。
