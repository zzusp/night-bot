# 第 15 轮：DACL 纯差量与未知注册补证

## 范围与版本

沿原 worktree/分支/PR，HEAD `6d79b0a0279d3f94f2d72d21f51ab1d654b0f509`，包含未提交协作修改；结果按实际源码起止 SHA 成立。SG11/SG12 仍 ACTIVE。无 Git 写入、真实模型 API、真实渠道/登录、CI、合并、部署、Profile 创建或 Native ACL/LPAC 执行。证据相对本报告，均在 `round-15/`。

本阶段只给原 `test/pi-native-sandbox.test.js` 增加五个DACL注册及独立SD字节夹具，另按库存精确名称执行原12个NO_OBSERVED_RESULT。未重跑已通过且未受影响的scope/proof/Job/Web/关停整组。

## 结果

| 证据前缀 | 实际终态 | 结论 |
| --- | --- | --- |
| windows-scoped-dacl | Node自然1，3PASS/2FAIL/0SKIP，5pin稳定 | 字节增量/份数/继承输入三项PASS；两stage注册未到目标断言，夹具路径失败 |
| windows-scoped-stage-fixed | Node自然0，2PASS/0FAIL/0SKIP，5pin稳定 | 仅修两stage注册路径后定点通过；原三PASS未重跑 |
| previously-unobserved-exact | Node自然0，12PASS/0FAIL/0SKIP，29pin稳定 | 原12未知逐完整名称补证，含合同根注册与两个子项 |

## DACL 刺激与实际边界

受验ACL固定 `src/process/windows-acl.js` SHA `f52e3ac42b1bef2b155f07e9cf74e03c7de350da6357e35fe91ba720779bea9d`。首批test SHA `ffd82713facbfb526bc9ba5d4b88e38cec7d106ac86a644447ef0b8027d58560`，路径修后test SHA `302cd32225032bf8d1c06d5ba22d953a00cac566254a933d387308cea9cc7b56`。完整五源清单见各result。

五个注册直接处理自构的self-relative SD/ACL/ACE字节，不调用Koffi或OS：

1. read/write及文件/目录四种增量保owner/group/SACL/control和其它SID/原ACE，增量插在继承ACE前；read无写位，write没有WRITE_DAC/WRITE_OWNER，OWNER_RIGHTS仅READ_CONTROL。
2. 三份相同增量只撤归属的两份，留下另一份及原其它SID；余一份精确撤回后等于原SD。minimumCopies不足、copies无效或重复delta拒绝，源字节不变。
3. 继承输入移除SACL及child已继承ACE，保owner/group；merge只采用规定DACL/control位，保原SACL等部分；变owner/group或protected child拒绝。
4. 三层树输入乱序，独立脚本计算普通OI/CI继承，冻结阶段按父到子排序；前后map保之前已产生的差量、不重新以原树作基线；深层重复OWNER_RIGHTS份数真实出现。protected child不调用继承callback、不受父阶段传播，仅其自己的阶段加本地差量。修改输入descriptor不改已冻结original。
5. 原树不能由继承重建时拒绝；传播改动或移除其它SID原ACE时拒绝，不修改输入。

首批两stage注册失败于 `Exact scope immediate parent is not captured`：JS夹具单反斜杠被解析成 `C:scope`、`child`、`leaf`，尚未到目标冻结断言。只替换两注册内六处路径构造为 `win32.join`，不降低断言、不改产品。独立内存逆四类替换精确恢复初批全文ffd82713，证明前三PASS正文和共同helpers字节未变；原Review亦独立核闭。两失败注册定点2PASS，不称新test五项整批全跑，初批3PASS/2FAIL原样保留。

脚本OI/CI是从parent/child实际字节计算的测试输入，只证明冻结规划器，不是Native继承、SetSecurityInfo、有效权限或LPAC IO证明。没有以预置candidate callback冒充Native。ACL窗实跑终态后已立即交回Platform；随后该产品源续改，不能将此f52e结果追认为当前ACL/新Profile行为已实跑。

## 十二个未知注册

实际过滤表达式从原库存精确名称生成，不由同文件其它PASS推断：

- fake DWS登录观察2项：在自有隔离profiles文件上走默认文件observer及内存runner。lastUsed变化不重试，lastLogin变化后只接准确绑定；账号歧义、目标漂移及非认证错误失败关闭，不从文件变化猜测重试。不是实际DWS CLI或账号登录。
- Router read 6项：分别在router.dependencies/task.list的真实await中改变phase、generation或执行actor，释放后按ROUTER_GENERATION_STALE拒绝。使用official工具夹具和本地脚本模型，无真实API。
- retired runtime容器合同3项：根注册及baseline/revived-destination两个子项，分别验证原固定合同变更或退休目标复活不能静默进入Release；没有把模块退休等同业务用例PASS。
- Web health 1项：实际loopback认证HTTP读取/api/channels，连接阶段白名单、connected必须布尔、敏感lastError getter不得读取，响应不泄露私有配置/路径，读取不接纳业务。

原Review独立读实际日志与必要源码，暂未找到本阶段新增确认刺激缺口。模型、渠道、Native与完整CLI/Host/容器边界分开。

## 证据

| result前缀 | result SHA256 | stdout SHA256 |
| --- | --- | --- |
| windows-scoped-dacl | d46f20d519414d801995b5b8f574cb6426bd4199129f623512293e6c65f82bb0 | b6b83a8cd31d4c456a81582fcaeed8322432524d20889a37ea98397a63ea09f3 |
| windows-scoped-stage-fixed | 283d08eb67a9a93414b3e7780fd6debf407619152180d39ee469e9a2cf7a0ab6 | 39857e82e7a1ae265570efffa6c4603c612ba2d067b21ef3ea465c6276c9ab13 |
| previously-unobserved-exact | 8dcbdfb29a450b909cb36c7fdfdd21a9915e1dabd2a83bc95a65c58a3025de3d | fe8681bf9f535b09f90e5e05f3f2992146502bc799b6e8dc3724ad13b756b9b9 |

每个前缀对应-result.json、.log及.stderr.log。每批naturalExit=true/sourceChanged=[]，stderr均空；stdout实际逐项结果及子项层级已独立回读。

## 库存、归档与下一步

库存5452→5457，补五个DACL注册，逐完整名称映射本轮17项PASS（五helper分版证据+原12未知）。保原(file,case_name,occurrence)/registration_sha256；没有给已映射的历史重命名身份重复补登。库存SHA `535e632441a760797a2a32a369203927734455429421d1afed6a81a697a8dbd4`，NO_OBSERVED_RESULT由12降0，不代表其它历史失败/未验场景消失。原AST520文件/5199注册/未解析0，结合原映射未登记0，仅证明静态完整性。

matrix集中新增round_15列，旧列/失败身份保留，无本轮动作项记NOT_RERUN_ROUND_15。阶段结果集中一次归档，没有全绿report.md。fixture临时目录沿原t.after清理；没有新增OS资源，无全局清理。所有Tests命令已终态，未隐藏后台在途。

下一阶段沿既有运行规程与隔离驱动推进当前源码正式CLI/容器应用业务及活动关闭，再按原分工完成剩余安全链和同版guards。第14轮service/factory关停和本轮纯helper不抵该实际应用验收；Windows生产LPAC、精确scope、原Job持久ACK/Resume/ordinary/ConPTY仍未由本轮关闭。当前源ACL/Profile的后续增量另绑版本，不自动重跑已验无关项。长期目标继续ACTIVE。
