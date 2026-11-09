# 第31轮：NULL-SACL资格门回归与Nt组件实际失败

## 结论

两组结果分列，不能拼为生产通过：

- 原六个 scoped Low 纯体合同实际 **6 PASS、0 FAIL、0 CANCEL、0 SKIP，Node exit0**；覆盖63af新增NULL-SACL资格门及相关正向/撤销、旁支行为。它们不执行Native，不证明OS隔离或生产可用。
- 经过原Review准确稿前审、同参fresh check0后的唯一Nt组件实际 **Node exit1 / FAILED**。根 NtSetSecurityObject LABEL16 返回0，但实际完整SD与提前固定原SD不符，根control差810，后代仍Low。未到最终snapshot、未调用后代Nt、未恢复/删除新根，也没有重试。

SG11/SG12仍ACTIVE，63af拒绝门及scopeReady=false不变；本轮不含生产Profile/mandatory/ConPTY、Linux强owner、macOS、真实模型/渠道、CI、Git写入、合并或部署。

## 版本与窄门回归

原worktree/分支保持，HEAD `6d79b0a0279d3f94f2d72d21f51ab1d654b0f509` 加未提交协作工作树。Tests只修改 `test/pi-native-sandbox.test.js`：原当前源码8a201369迁为 `8deea75f371508b6e69c88a2fdc36c15914b40655996e2d73b0e7a0e81053807`，不改注册名/身份或生产实现。

在原Low stages注册内，将8804/8c04 NULL基线的旧允许预期改为冻结前拒绝；补NULL→显式及显式→NULL拒绝、显式非继承根降Low后只读NULL后代受影响、双NULL仅label控制位变化拒绝、无关/受保护NULL旁支不受误伤、未改变的只读NULL零stage，以及两端显式label正向/撤销。现有单ML脚本继承fixture补按源OI/CI判断是否继承，使原态无继承标记的Medium根不先错误传播到NULL子项；它仍不是Native继承或有效权限证明。

实际命令：

```text
node --test --test-reporter=tap --test-concurrency=1 --test-name-pattern=^Windows scoped Low  test/pi-native-sandbox.test.js
```

其中pattern是单个argv，准确命令数组在 `round-31/null-label-guard-result.json`；Node v24.19.0/win32。八项测试/相关源起止hash一致，ACL为 `63afcbaf395fb5f1a26ead54b27f38a6f04f5bda3bfde43ce9c86be831c55ca2`。TAP总duration154.7057ms，完整结果与逐例行保留在唯一 `round-31/null-label-guard.log`：

| 原注册 | PASS行 |
| --- | --- |
| Windows scoped Low labels preserve native Low Untrusted and readonly descriptors while lowering only write labels | 3 |
| Windows scoped Low shared release retains active borrowers then restores the original label through a released source | 9 |
| Windows scoped Low origin rejects missing anchors wrong FileID cycles drift conflicts and unproven inherited new identities | 15 |
| Windows scoped Low read borrowers retain NRU NXU labels until the final reader exits | 21 |
| Windows scoped Low inheritance strips only inherited labels and preserves DACL owner group during merge | 27 |
| Windows scoped Low stages freeze label propagation and reject nonlabel changes protected inheritance and unreproducible controls | 33 |

纯plan历史NULL建模仍可保留，不表示Native允许NULL恢复。生产freeze门是在真实changed闭包上拒绝未证可逆变化，未改成全树NULL禁令。

## Nt准确稿与执行边界

沿原spec16.17，准确probe `440947e9da7647b05f239b946169e8606cfd482e89040a61ab8dfb6e202ad84d`、check b7761179、check-execution f9fe8bbf、checklist cdcd6e31，均本地ignored/untracked/unstaged。原Review全文前审后，Tests以同绝对root参数fresh check，输出与已审初check逐字同，Node0/stderr0/effects0/nativeExecuted=false，才唯一run；没有先Native或修改canonical绑定。

执行任务 bbwla9m75：2026-11-08 12:56:25.307251–12:56:26.116300 UTC（北京时间20:56:25.307251–20:56:26.116300）。真实Node1，外层采集器0只表示完成证据采集，不代替Native成功。全部五源起止同：ACL63af、Profile225、win32 730d、contracts a9eb、index c502；完整SHA集中在 `round-31/windows-nt-label-summary.json`。

新根仅 `data/workspaces/sg11-security-projection-nt-label-a4a62052df2046eab0087a2f6106810a`，本次Create成功。沿97b的PAI请求→立即读SD→仅缺400时未发布空根同DACL一次初始化；创建请求、创建实际、初始化和业务baseline分段，不覆写旧baseline。建后代后根原SD全文不变。

临时Nt绑定来自原loader返回systemDirectory的ntdll.dll，沿原bind/__stdcall、int32、[void*,uint32,void*]，原handle+LABEL16+固定完整原SD。根访问e0080，dir/file a0080，无WRITE_DAC后代；share3无DELETE。没有系统SACL权限/MAXIMUM_ALLOWED/新privilege、Profile/Job/token改写或launch/Resume/网络动作。

仅SetInfo-Low作已知前态，再Nt恢复，不是双Nt正向。候选由原withScopedFileLabel及两次Native label继承在首业务Set前固定，不调用/绕63af冻结门替生产报PASS。root→dir→file逐目标前后全树读回；fresh同held FileID完整原bytes已相等才可alreadyExact跳过。实际根不相等，调用一次Nt后立即硬门失败，因此dir/file不是跳过，而是尚未到达，不能说其独立Nt已测。

## 实际完整SD观察

| 对象 | 原业务control | 原SACL指针/PRESENT10 | Nt根调用后control | 对原xor | Nt根调用后SACL |
| --- | --- | --- | --- | --- | --- |
| root | 9c04 | NULL / false | 9414 | 810 | NULL |
| child | 8c04 | NULL / false | 8c14 | 10 | Low保留 |
| child/file | 8c04 | NULL / false | 8c14 | 10 | Low保留 |

这次实际原baseline的PRESENT10三者均false；不是仅凭NULL offset推断absence。如果原baseline带10，只能证明那个NULL-pointer基线，不能追认缺10恢复；本轮不需要以额外Set制造absence。

- 创建实际仅DACL投影缺400，初始化一次status0，原字节只变400，其余全文一致。
- SetInfo-Low一次status0，三对象完整sameOwned与提前固定Native候选均true、control xor0。三bytesEqualFixedStage=false为内存布局差异，未放宽sameOwned，也未另造字节比较失败门。
- 根Nt16实际signed0/unsigned0/hex00000000，未使用GetLastError解释该返回。根SACL指针回NULL，但SACL_AUTO_INHERITED800丢失、SACL_PRESENT10仍有，所以对原xor810；根sameOwned与原bytes均false。
- 三对象revision/reserved、owner/group、DACL及非label控制位保持。后代SACL仍Low，与原NULL不等；它们仅被观察，没有后代Nt调用或恢复结论。
- 实际Nt调用1、alreadyExact跳过0；根完整SD硬门失败后停止，未到独立final snapshot。不存在三对象逐字恢复证明，不能因status0或资源关闭写成功。

结论限定为**本次原handle/完整原SD/LABEL16调用未恢复该真实原基线**；不外推所有Native路线不可能，不据此提高权限、加flags或机械重跑。

## 资源与证据

实际SetInfo2（初始化1+Low1）、Nt1、GetSecurityInfo17；18次Local分配+2次private-security共20项全部单次attempted/closed，5个owned handles全部单次关闭，retained均0。失败/未知即保根，没有自动rollback、重试或删除。新根保留，原四失败根未动，共五个失败现场；没有在途Native、后台测试或容器。

正式证据只在round-31/：纯体result/log/stderr与Nt脱敏summary，加batch-index.json共五份文字文件。summary含八项私有材料的bytes/hash、真实控制位/label、逐组件相等与资源终态；SID/完整SD/FileID及绝对本机命令仅原ignored私有材料，不复制入Git或上传。实际raw run为39644B/SHA43735bc2、execution2643B/ee05107b，完整hash见summary；工具成功回执不代替这些已独立读回的实际结果。

## 库存、矩阵与清理

库存仍5468身份。原28项 AST声明身份集合不变，仅同步本文件28行当前source hash/行号，并将六项实际PASS证据绑定第31轮/TAP行/准确测试SHA；其余旧结果不追认新版，registration hash保持。按index.fieldsBefore逆构全文精确回第30轮a8051a1e。

矩阵仍293业务行，只加round_31；三既有Low业务行记纯体合同PASS，原Native setter业务行记本Nt16变体FAIL/Nt1/SetInfo2/保根/源稳定，其他289行NOT_RERUN。原scenario与历史失败均不改，剥新列精确回5c9ecd41。矩阵/库存与附件完整SHA统一保在batch-index，不重复维护第二份清单。

本轮三个纯体临时文件在正式归档核hash后按精确自有清单先--check再清理，最终独立缺席核验状态记录于batch-index；Native八项私有证据及五个失败根仍有用途，禁止清理、恢复或重跑。第30轮报告/附件/历史结果不改。

当前阻断交Core/Platform沿责任层分析，本Tests不修改产品/goal/spec，也不自行启动新OS方案。完整Windows生产准备/回收、ConPTY、Linux强owner、macOS原生执行与最终同版整合仍未闭合，不建全绿report。
