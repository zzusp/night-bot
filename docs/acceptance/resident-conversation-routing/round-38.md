# 第38轮：Windows task 初始化的非 Native 合同回归

## 结论

最终同版相关集实际 **13/13 PASS，fail/cancelled/skipped/todo 均0**。宿主任务 `bw7mhqmcf` 已完成，Node 自然退出0、无强停、stderr为空；TAP duration为60038.9034ms。stdout的TAP注释保留Node原Experimental/Deprecation警告，stderr为空不表示无警告。252项声明来源在运行前后完全一致，Tests随后独立重算当前文件也无漂移。高层8项覆盖真实 Host、官方 Pi SDK、本地 scripted provider、真实 SQLite、Web service、Router及 sealed restore/adopt；低层5项保留真实 ACL 资源管理，仅使用假 FFI。

本轮是§16.22的非 Native 行为证据，不证明真实 Win32 ABI、Low出生SD、OS隔离、LPAC读写、SDK seal或§16.21组件通过。无初始化字段的旧task行为、同一owner内两个未closed Local的活跃别名防御仍仅静态核验；没有为覆盖率伪造账本或扩展生产API。SG11/SG12仍ACTIVE，不写全绿report。

## 版本与实际入口

受验版本为 HEAD `6d79b0a0279d3f94f2d72d21f51ab1d654b0f509` 加 `worktree-resident-conversation-routing` 的未提交协作工作树。不是只按HEAD推断结果。

```text
node --experimental-test-module-mocks --test --test-concurrency=1 --test-reporter=tap test/pi-task-workspace-initialization.test.js test/pi-task-workspace-resources.test.js
```

实际工具为 `call_125bcb575d8c47c792cdcb5ece850d4d`，driver采集区间为北京时间2026-11-09 03:25:15.012704–03:26:15.393107。源选择及完整252项map在 `round-38/workspace-contract-source.json`；其插入序聚合为 `136226787036ce295e09871220919bc6bf432b25e5f71683ef0b78fedbb8bc25`。这一集合包含原Host/fixture/Native声明依赖和两份新增测试及原runner，不表示其中每个文件实际执行，更不表示已加载列表中的Koffi二进制。

| 受验文件 | bytes | SHA256 |
| --- | ---: | --- |
| test/pi-task-workspace-initialization.test.js | 20396 | 8cc5da31e75fd410a7348e9f315293d1f1d54da89f1a86371628a346fd4d4336 |
| test/pi-task-workspace-resources.test.js | 6545 | 32fe648da7ddf619b44cbd9f415c51d7684be4146f2067418c340c5f79f55056 |
| scripts/test-pi.mjs | 2174 | 0b9a665b65e424f5a9df2fb5ea60b98472e8cc4f73c8a546c7a63c646181a542 |

原七源保持最终静态受审版；完整源hash集中在上述source文件，具体修复的静态审查见 `review.md:1927`。service为cb09f98b、ACL为7d48ad15、Profile为ff6019ce。本侧未修改生产实现或runner。Core另行只读核过原13项TAP、result与252个当前文件，不把其核回当作新一轮测试。

## 实际用例

| 用例 | 结果 | 实际边界 |
| --- | --- | --- |
| Web并发、ready当前投影、冷重放及已有work | PASS | 原创建/初始化一次，当前DTO不被旧pending收据覆盖 |
| partial failure、idle、重放与重启 | PASS | failed不发布、不执行、不ack保留wake，不重新初始化 |
| Native边界错误与finish提交错误同时发生 | PASS | 保两个原Error及原ownership对象引用，不二次尝试；错误为注入值 |
| 请求伪造fresh/ready字段 | PASS | 不授权初始化、claim、archive或ensure |
| 真实Router两task及换outer后的同operation重放 | PASS | 逐task creationCommandId门，ready/failed分别保留，不重复创建 |
| 真实Router非法依赖事务 | PASS | 回滚后无task、无初始化 |
| admissions、whenIdle及close并发 | PASS | 等已接纳初始化和同task重放，store最后关闭，close后拒新创建 |
| sealed backup/restore/adopt | PASS | ready身份及work原内容保留、review hold有效、恢复后无Native重新创建 |
| LocalFree成功后同地址再次分配 | PASS | 两次分配各释放一次；数值地址全部来自假FFI |
| nonnull out后返回失败status | PASS | 先认领再传播原失败，仅释放一次 |
| nonnull out后抛异常 | PASS | 保原异常，先认领并仅释放一次 |
| LocalFree失败 | PASS | attempted=true、closed=false，保ownership，不重试、不继续申请 |
| 一个CloseHandle失败 | PASS | 另一句柄仍收口，保原失败及未闭ownership，两个句柄均不重试 |

完整原注册名、行号、源码hash及注册调用片段hash见 `round-38/workspace-contract-cases.json`；逐项实际输出见 `round-38/workspace-contract.log`。status/throw两用例来自同一for-of注册调用，原登记算法静态展开为两个不同名称，共用该调用片段hash是正常现象。

## 隔离与证据适用范围

高层文件在导入ACL/Win32之前拦截原 `contracts.createLazyRequire` 的koffi分支，只替换 `createPrivateTaskWorkDirectories` 为普通目录fixture；其mocked摘要不冒充Low SD。真实begin事务必须已提交到initializing后才能进入该替身。SQLite公开端口被冻结，测试仅包装原factory返回的实例方法边界，事务仍交原store，无直接SQL改账本。

低层文件与高层分进程/模块缓存隔离，保留原 `createPrivateTaskWorkDirectories`、指针解码和句柄关闭逻辑；只替换FFI绑定/内存读写，在第一个CreateFileW边界停止，没有真正CreateFileW或Native目录副作用。fake handle/pointer不是OS身份。两个文件都检查实际require缓存没有koffi.node，最终集检查通过；不能由假类型size推出ABI正确。

## 准备失败与修正

本轮过程中出现的准备/fixture失败没有合并成产品FAIL，也没有抹去：早期 `mock.module('koffi')` 只拦ESM入口，实际CJS createRequire仍加载了addon，前置断言就失败，尚未进入Host/测试业务，未调用其load或Win32业务API；这次不能记零addon。之后改到原lazy-require边界，最终集不加载实际addon/DLL。

另有冻结store端口不可重定义、冷Host未先关闭导致Windows EBUSY、Router fixture缺occurredAt、假系统目录字符串反斜杠转义、新restore目标未显式initialize等fixture错误，均修fixture后复验，没有降低产品校验或改通过断言。长Bash heredoc曾在测试文件及归档器创建时于shell解析阶段失败；归档器尝试exit2后独立确认文件缺席，均改文件工具创建，没有因此执行测试或归档。分批3项通过、4项复验、5项低层及单项restore结果仅作排障证据，最终结论只取本次同版完整13项。首次fixture setup遗留的本任务9个临时根已精确check后清理并独立确认缺席，未全局清Temp或处理别人的锁/进程。

## §16.21准备状态（尚未Native执行）

Platform在原安全fail-stop边界及无raw语义补齐后，Tests按最终两稿真实重取零Native准备。原身份恢复失败的 `ExitProcess(0x4e424c50)` 不可关闭；若它在run.json写出前退出，driver仍保 `componentWasProduced=false`、`componentPass=null`，整体失败并保SDK/Profile/child/journal为unknown/no-replay，不用Node退出推定资源已清理，不合成raw或false组件结果，不追加Delete/Terminate/Close/rm。

私有五稿统一前缀为 `docs/tmp/sg11-profile-suspended-seal-`，完整内容保ignored，不复制Native绝对路径/安全描述符到公开证据。

| 私有准确资产 | bytes | SHA256 |
| --- | ---: | --- |
| probe.mjs | 57812 | 98f38589211a385e083830165c7955b034b227a216ed928bba1bd23ec5616546 |
| checklist.md | 24112 | d1af9ea06a1e2d2bc9fbf1a1ec445a155e58e9c9462934eee2a70a647dedf087 |
| check.json | 31296 | 621e166dbd7fd2294b0ee569858b909a98a83586692e38cb5c73ac13c6ae7f45 |
| check-execution.json | 58152 | 8ad3260aeaa8b9c985dc23da07fc68904e0b19aaab032ed8d6debeaec721c717 |
| execute.py | 9634 | 4487a4bfdeb7078c8c0a11534eba64409dbf0fb9c9834704e1a407d16cf1e9b5 |

真实准备工具 `call_8c766e325c76441aae258368117c121d`（2026-11-08T19:34:53.357Z）得到node语法0、同argv probe --check0、driver AST_OK/--check0，stderr为空；251项聚合 `b124530d35a98b1873b9c82de0b083837ce659b42f3075e668b810b901b9128b`，249实际依赖不变，sourceBefore=sourceAfter，effects0/nativeExecuted=false/hostInstantiated=false/nulOpened=false。下一独立只读命令核五稿bytes/hash、ignored/untracked/unstaged、新安装及五运行输出缺席。零效果仅指probe业务/Native，不否认准备材料写入。

上一b041/525及241c/cf9准备确曾执行，已被新稿淘汰；新收据保supersededPreparation事实。不消费旧五稿，不因文案变化重跑13项或已证guards。新五稿已交原Review核准确差量；本轮此检查点没有Lead的Native消费窗，未调用--run。

## 集中归档与剩余项

本轮库存只追加实际匹配TAP的13身份，5472→5485，旧5472行及其注册hash逐字保留。复用原 `sg11-case-inventory.mjs` 的纯AST登记visitor，只解析两份测试，不导入/执行测试、不运行全库collector；hash仍取原CallExpression源码片段。矩阵只追加round_38及13条业务行，298→311；两总汇保PARTIAL，其他旧行NOT_RERUN_ROUND_38，旧轮次列不变。归档器先--check零效果再--run，独立核回历史前缀/逆构、证据hash及13项一一对应。

最终文字证据、摘要和索引只留本轮目录；本任务已被归档副本替代的临时13项来源/输出/声明副本在独立核回后删除，所需最终证据不删。历史round-N.md保留；R35未知现场及R36/R37原安装/journal/锁不改写，不重跑旧collector。

本轮未跑其他主组或整树检查，没有真实模型API、DWS外发、Git写入、CI、合并或部署。后续仍需最新五稿前审及准确Lead窗后的唯一Native组件、默认LPAC完整业务、既有NULL/外部写树恢复、Linux/macOS与最终同版全量/原PR交付；本轮13项不能抵扣这些目标。
