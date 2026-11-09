# 第 18 轮：Low 来源、共享回收和标签冻结纯行为

## 范围与结果

沿原worktree/分支，HEAD 6d79b0a0279d3f94f2d72d21f51ab1d654b0f509加未提交协作源码。本轮只在原test/pi-native-sandbox.test.js补五个Low纯注册，共用原SD/ACL/ACE字节夹具；同批复验原两条DACL stage planning，以覆盖产品提取共享森林拓扑。不重跑无关原三DACL原语、Web、Router或Docker。

实际命令：`node --test --test-reporter=spec --test-name-pattern="^Windows scoped (Low |stage planning )" test/pi-native-sandbox.test.js`。Node自然0、7PASS/0FAIL/0SKIP、stderr空、三源起止无漂移。受验ACL `57129f60016400c799c4a2d3dd71d8e8b2dc9477f9cbd9f0f0102183237bd2a3`、contracts `62a6ddc58f4d052619c680fa59d936efd28931fa8c8236623c46238ff5fa82b3`、test `308de00de7c56eaaf4239251fcd4a8677520cdac7a01de012b503752d4725ee7`。自然终态及日志/result digest另条只读命令核验后立即交回ACL窗，后续产品增量不追认本轮通过。

## 有效刺激与反例

- 原生Low/Untrusted的不同flags/mask保持原SD全文，borrowedFrom=null；Medium或无label只对write降为Low、保mask及DACL/owner/group，read不改。无效SID、flags、mask拒绝。
- 原Medium和原null两组分别走A引入Low→B按同FileID/owner/job/entry借用→A先退出保B→A最新resource已released仍保历史锚→B最后释放精确恢复原完整SD。准备/回收重放拒绝。
- 缺原锚、borrowedFrom错FileID、借用环、当前label漂移、多个冲突来源和release时冲突均拒绝。新FileID继承Low只有活动父源、无同FileID证明时准确拒绝，不登记该业务场景完整支持。
- label继承输入只去child已继承的ML；显式ML、DACL/owner/group保留。merge仅采用规定label/control位，原DACL和owner/group不回灌；变owner/group、protected label拒绝。
- 两层乱序输入按森林冻结label阶段，stage.before接前次after而不读回重定基线；每个目标最终label与来源计划一致。protected子树不执行继承callback；原control不能精确重建、传播改DACL或最终label不符计划均拒绝，原输入不变。

历史resource/privateProof均为schema有效的纯规划夹具输入，不是真实Pi已提交证明或OS生产者回执。脚本继承从parent/child实际字节计算普通单条ML传播，只刺激规划器；没有Koffi调用、Get/SetSecurityInfo、CreatePrivateObjectSecurityEx、Profile创建/删除、进程/Resume或任何OS安全策略改动。既有test名称中的native Low仅指夹具表示的原始Low来源，不意味着Native实测。

特别保留盲点：CreatePrivateObjectSecurityEx在NULL label/SACL上的AUTO_INHERITED控制位实际返回尚未核实；本夹具不能回答这个SDK行为。原Platform要求先给原Review精确的只读Get/内存API qualifier清单，未据其消息执行Native，也未忽略控制位降低严格baseline标准。生产scopeReady仍未由本轮关闭，原Job ACK/实际LPAC IO/mandatory cleanup另验。

## 证据和库存

round-18/windows-low-label-result.json SHA `50a9cb84ee38acc80e2f1900985e3865e4bf027d25cbcf19d96608d1554a39dc`，stdout windows-low-label.log SHA `a0e5d611fdc614c5aab9bc7e3975e450543560cd5b3043a9ecd3a8f366a505ae`，stderr为空。结果含准确命令与三pin；不是同文件其他PASS推断。

复用原AST脚本，仅静态解析520文件/5204注册、未解析0。库存5457→5462，五个新注册，七个完整名称逐名映射本轮实际PASS；保原(file,case_name,occurrence)/registration_sha256。库存SHA `74e45c9ac37d097a01e4bea27d8f5a90ad89803b1cd0247a6a680add9dc82d2f`，未登记0/未知0只表示当前库存完整，不代表历史失败和生产未验项通过。ledger先--check再--apply，未登记同义重复case。

matrix集中加round_18列，更新受影响DACL stage行及三条Low/库存记录；旧列/失败保留。没有临时OS资源，插入用短草稿已删除且不留副本。没有Git/CI/合并/部署、真实模型API/渠道外发。后续接Core异常close同版最小反例及原SG12 waiting-auth/fake自动接入、默认tini/PID1链；SG11/SG12仍ACTIVE，不写全绿report.md。
