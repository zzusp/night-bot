# 第 24 轮：标准 temp 合同的原夹具迁接

## 范围与版本

沿原worktree/分支/PR，HEAD `6d79b0a0279d3f94f2d72d21f51ab1d654b0f509` 加未提交协作树。仅修改原 `test/pi-native-sandbox.test.js` 和 `test/pi-native-process.test.js` 合法夹具及同注册必要反例，没有新增注册、生产修改、Git写入、CI、合并、部署、Native setter/Profile或真实模型/渠道外发。第23轮fake余项已闭且未重跑，SG11/SG12总体仍ACTIVE。

Platform交回的稳定消费窗：Profile `0f6a04f3738b3b6db48401baa2384a7af4ca7a952e2be70fc3951a6ce51a80a0`、runner `e2c399718c9a9517e16779b1da095f7ccbf561e8388ab4d521eb0bd158524814`、contracts `a9eb7a93a4a4190a690c37cfb4ecc12bece676056eeb19613a04f72cd47e3329`、ACL `8d3f7d5a23dddb3f187269b0977a8e515e30c30d5e0027e690ca88070e5c3003`、privacy `51b398b57368753d6ff20c80cafa3a76126371adbd9cac1eb5c6f04b01592ac6`。受验test sandbox `556798d3c8e6252a8b82ae1969e7cbc3caefc83bd5444a19acaedc8b7056cf21`、process `a330814b26ade35ddb99546418c2a3c0e1fce96f3531e2bc783fdee65f49b8f4`。结果含上述及Win32/process/index/runner-launch共10项起止pin，sourceChanged=[]，不追认后续变更。

## 最小迁接与实跑

- 原Windows policy两合法夹具明确补 `installRoot/data/temp` 的tempRoot；不加缺省、兼容fallback或假Profile成功。正式fork仍使用resourceProtocol未协商的真实前置拒绝，不进入exe解析/Native。
- 原privacy夹具补可信tempRoot及私有根全集，保原task写交集、外部批准读写、argv精确解包、相邻/秘密/其他task拒绝；read-only业务writeRoots仍空。
- 原scope投影注册补缺tempRoot、错标准根拒绝，大小写同根接受，以及安装temp不得列入业务read/writeRoots；原6个去重scope和只读升级断言保留。
- 原portable privacy注册补paths.temp，实跑缺字段严格拒绝、返回tempRoot和私有根全集、temp后代不可读；原TASKS大小写识别仍保留。OS临时目录仅为原隔离测试根，测试结束正常清理，不触碰生产data或系统安全配置。

命令在 `round-24/windows-temp-contract-result.json.argv`，Node按六个完整名精确选择原两个文件；自然exit0，6PASS/0FAIL/0SKIP/0CANCEL，十pin无漂移。没有将整文件其他注册或旧纯规划测试追认为本版执行；本轮只证明policy/隐私投影与真实IPC前置拒绝，不证明新Profile/temp的Native创建、DACL保密、有效权限、完整pending ACK/join/seal/close、真实Job或默认Host准入。

| 完整注册 | 实际日志行 |
| --- | --- |
| Windows LPAC never enters fallback ordinary or node-pty providers | 1 |
| Windows LPAC runner requires durable Job protocol before current-token executable resolution | 2 |
| Windows privacy intersects requested task writes and unwraps the original argv exactly once | 3 |
| Windows privacy projects only Host-bound external roots and rejects neighbouring or private scopes | 4 |
| Windows scope projection deduplicates case-insensitive roots and upgrades only matching reads to writes | 5 |
| Windows privacy recognises TASKS casing through real installation paths and POSIX stays case sensitive | 6 |

## 证据与集中登记

| 证据（round-24/） | SHA256 |
| --- | --- |
| windows-temp-contract-result.json | 76ef0b1dd7c0fcfd031694614997b27a5243ab2fc0731715082aa78955e15187 |
| windows-temp-contract.log | bbc49d9c820cba7e40d95b8da8b8189a98fbb0af417819e2466c80f5437a1797 |
| windows-temp-contract-stderr.log | e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855 |

库存仍5468，原身份/registration SHA和旧unavailable历史注册保留；本轮复用既有AST提取器仅读两个受影响文件，当前37注册、未解析0、未登记0，刷新实际行号/当前source SHA并绑定六条完整名的受验test SHA、log行/hash。未跑全量提取/测试，不将局部groups结果覆盖原全量归组。库存SHA `e1f29c70217c62b5f4236868c8d49628f6fc2fed246ad5b13b4e2d9ad1595914`。matrix290业务行，新增round_24及一条库存行，复用原policy/scope/protocol行登记六项实际PASS；SHA `51199318b843c5e8f08006e5e9734040fd74fd2af38f8407f1f7dd9dcc42ea47`。第22轮首批FAIL及各自分版证据、第23轮父driver FAIL等历史列不变。无全绿report.md。

## 原 Native 准备与剩余

原setter最小清单已另交Review准确前审：ignored `docs/tmp/sg11-security-projection-checklist.md` SHA `ba149a7be47c6fb184501e5146e323f4cb22e9a3909bd91c81d093c5edcb855f`，probe `9f860e43395736f964d51ebae8788fe33d123447175d860843917abb42365a46`，check `042c18167a954b3c2ce0dd9f66306cb8d8ecbafa11a17be362187d1fd8b0ec4f`。仅语法及--check自然0/effects0/nativeExecuted=false，唯一随机根缺席，尚无--run。该准备不记为本轮Native PASS，也不授权新Profile/temp或新增目录/删除Native API。

当前无在途测试/Docker/模型/Native。准确前审完成后，原Tests仍须核源窗及同参数--check，再决定是否在既有授权范围执行准确setter批；Win32等源未提前交回供并发Native改动。真实生产scope/Low有效权限/差量回收、Profile内部temp、耐久Job ACK/Resume/mandatory cleanup和完整未知路径仍待；最终相关主组/guards、集中审查、敏感/Skill检查与原PR交付由原分工继续，唯一goal仍由Lead单写。
