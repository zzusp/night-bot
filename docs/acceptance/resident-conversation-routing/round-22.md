# 第22轮：协议前置与AUTO资格、共享DACL回收

## 范围与版本

原worktree、`worktree-resident-conversation-routing`分支及PR #2，HEAD `6d79b0a0279d3f94f2d72d21f51ab1d654b0f509` 加未提交协作树。仅修改原两测试文件和验收材料。SG11/SG12仍ACTIVE；没有Git写入、CI、合并、部署、真实渠道/模型外发或新Native操作。

本轮有三次自然退出，不拼成一次全绿批：协议批自然0/2PASS；AUTO首批自然1/2PASS1FAIL；只复验其中失败注册自然0/1PASS。最终五个不同完整名各有实际PASS证据。两个已过的AUTO注册只在首批受验版本有效，不用后续整个测试文件SHA追认。

## 协议前置与原fixture迁接

`test/pi-native-process.test.js` 两处合法LPAC夹具补当时必需的`readRoots:[]`。保原禁止ordinary/node-pty回退断言；原永久`lifecycle unavailable`断言退休，迁为 `Windows LPAC runner requires durable Job protocol before current-token executable resolution`，历史注册在库存保留，未恢复已退役的产品合同。

原入口真实fork正式runner，发送合法LPAC但故意不协商resourceProtocol的start。实际127、signal=null、stderr空、唯一error精确为 `LPAC requires the original durable Job resource protocol`，不是故意不存在的exe路径解析错误；目标未启动。另一原注册实证ordinary/node-pty拒绝及空live/terminals。没有Profile成功替身、运行目标或Native调用。

受验测试 `96a239499cf43952156df2f8bab768b4920ab340b7e35b4db9504630a2718166`；runner `7935651293fcc57eeecbe3402a767f1c2c3f00813f605750a5459f7bce963eb1` / Profile `cb59e4240ef65464e56818d93bfb576752243e7b3741e02c4ee3a957ae1752d6` / contracts `62a6ddc58f4d052619c680fa59d936efd28931fa8c8236623c46238ff5fa82b3`，起止六pin一致。源窗随终态已交Platform，后续temp/env新合同不由本批追认。

## AUTO资格与完整未来传播

只扩原 `test/pi-native-sandbox.test.js` 三个注册，不新增纯测试注册，不重复第20/21轮Native内存观察。ACL `2b5fa6292053af031c7ae66afbc0c8c94a6af33a95b4b8045bdaa2b0ac62fd36`，contracts已是独立的新版本 `a9eb7a93a4a4190a690c37cfb4ecc12bece676056eeb19613a04f72cd47e3329`；不与协议批拼同版。

- 原Low stage注册：NULL原SACL无800，directory/file各跨DACL400有无，原before全文保存，脚本未来继承的800完整进入阶段及最终candidate；800不被掩掉，400不随label改变。原有800严格全文重建负例仍拒，非label漂移/committed label不符断言保留。protected节点直接改自身仍继续传播其未protected后代。
- 原DACL stage拒绝注册：400未置时，无论800有无都保存真实before，未来400完整进入candidate；无400也不接纳陈旧无关继承ACE。原有400严格重建、无关ACE改写/丢失仍拒。protected节点阻止从父继承，但其直接授权仍传播未protected后代。
- 继承回调仅在原字节夹具中脚本计算，未调用Windows继承器/setter；上述证明规划资格与严格传播守卫，不能称实际400/800 setter行为或LPAC有效权限通过。

首批测试SHA `4a8759018d8d5e733af0f581844bdc08846a2e3b93ca8cf1cc0aa76a620bf4c0`。DACL stage新陈旧ACE负例确实被拒，但夹具期望错写成后置 `removed an original ACE`；实际先触发 `changed an unrelated ACE`，因此该注册FAIL。只把该新负例匹配改为真实精确拒绝，未改变生产、输入或安全判定。定点复验测试SHA `4207b915973fce09dfe81829399009a53c3eaac9e69305eab78788b85df3fa80`，自然0/1PASS；其余两注册无相关变化，不重跑。每批ACL/contracts起止一致。

## 原清理注册扩展真实两SID三层回收

原 `Windows scoped DACL cleanup subtracts only attributed copies and refuses insufficient ownership before mutation` 实际调用新生产 `freezeScopedFileReleaseStages`。使用同一完整forest依次由真实A/B SID执行 `freezeScopedFileAccessStages`，proof用各自SID及实际original/candidate/完整addedAces，不手填“已成功”的候选或复用A的SID冒充B。

三层root/child/file保原Native OWNER_RIGHTS及无关继承ACE。A先撤时父先传播，不对子对象重复扣继承份数，B各层权限保留；A公开released后，B最后撤销逐对象恢复原SD全文，owner/group/SACL及原OWNER_RIGHTS未丢。无400的当前基线允许未来400进入，已有400重建不等仍拒；缺来源、缺/错FileID、OWNER_RIGHTS份数漂移和来源baseline不一致均在规划时拒绝。该注册在首批4a875901下实际PASS，没有真实Job提交、Native ACL设置或生产准入。

## 证据与库存

证据均位于同名 `round-22/`。首批log保留，因为仍是其中两个未重跑注册的唯一实际证据，也保留原FAIL；不把失败批整体改成成功。

| 证据 | SHA256 |
| --- | --- |
| windows-runner-protocol-result.json | c48078706400f95d2744b59ec6e045f0e03dde123d8341d000354465d1364971 |
| windows-runner-protocol.log | 7e8073106dfb229ce8c0a25f8480055992a547bfd75814b016b05eb4ca4cd6de |
| windows-auto-baseline-result.json | aab5714716443c6d11a5c1bd15a19538662199c9f420c87ff0abebebd4b1cc04 |
| windows-auto-baseline.log | 60dcaa04a7a6d5bad13882105d17739a50f9e8c89e06350158ec7766e661e544 |
| windows-auto-baseline-fix-result.json | abe6ea9a97cac5cfc8f4b2b2d84e4bd3537eb4d80690712108d893c160792c19 |
| windows-auto-baseline-fix.log | 4fdbfa05ad8f8e1188bcc5508dce7ba60eca9d8f1e287b33bfe1ed85787fc15c |

三份stderr均空。库存5467→5468，仅新增迁接后的协议注册，保旧完整名/occurrence/registration SHA及旧证据；原清理与stage注册身份不变。五条PASS按实际完整名、行、log SHA和各自受验测试SHA绑定。AST520文件/5209注册、未解析0/未登记0只证静态完整。matrix286行新增round_22，原FAIL/历史列保留，更新仅本轮实跑范围，不将分组未跑注册推成通过。

## 未闭与资源窗

实际Native setter对直接target及后代的400/800投影尚未验；第21轮真实反证不删除、不重跑以求绿。本轮没有Native对象或测试容器产生，runner/Profile/contracts与ACL窗均已交回原Platform。完整runner pending负ACK/join、seal unknown/close attempted安全回收仍只有静态证据及本轮前置拒绝，不能用两项协议PASS抵扣。Windows生产scope/ACK/Resume、mandatory cleanup、ordinary/ConPTY、后续temp/env与fake实际监听/入站，以及最终同版相关验收/guards/PR交付仍待，唯一goal由Lead维护。
