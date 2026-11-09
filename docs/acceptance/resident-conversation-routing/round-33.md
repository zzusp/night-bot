# 第33轮：出生 Low 私有 temp 组件与外层预检分列

## 结论

准确94b稿在原Review前审、Lead确认五源消费窗和同参fresh check0之后，唯一Native组件实际 **Node自然exit0、componentPass=true**。本次全新私有temp出生Low/NW、DACL write add/release、最后独立全树真实原SD逐字恢复均通过；30项分配和5个句柄全部单次关闭，新根已由probe删除并独立lstat确认缺席。

**外层执行流程不全绿。** 额外argv文本预检出现AssertionError后，Bash顺序命令仍进入采集器。实际采集器内的原四资产hash、五源、参数、fresh零效果门和唯一Native另有独立证据，不能用采集器/外层最终0抹掉该预检错误，也不能把路径文本错误说成实际Native门被跳过。

本轮只证明本次Host-owned、空、未发布的read-only policy私有scratch组件能力，不证明生产Profile/mandatory/Job/ConPTY或已有NULL业务树支持。63af、scopeReady=false及SG11/SG12 ACTIVE不因本组件PASS改变；没有生产修改、新FFI、提权、真实模型/渠道、Git写入、CI、合并或部署。

## 准确稿、消费窗与参数门

原worktree/分支保持，HEAD `6d79b0a0279d3f94f2d72d21f51ab1d654b0f509` 加未提交协作工作树。本轮按原spec16.18/单一准确规格，不重跑routing/domain或旧五个失败现场。

原Review在review.md:1793全文前审准确四资产，Platform亦独立核规格。probe31151B/SHA `94b40116ee871e489783d71c9d22b1eb1a6f6944bfb6e78bf536b5237a32014f`；check2848B/5f5cd7d6、check-execution1972B/dcf87ab7、checklist8359B/496bd72c。四准确资产没有在前审后改写。

Lead明确Core/Platform无在途并保持五源只读后确认本次消费窗。唯一任务bfdxues8h于2026-11-08 13:57:08.023809–13:57:09.064035 UTC执行，即北京时间21:57:08.023809–21:57:09.064035。实际终态接回、五源和资源核清后立即交回窗口，没有为归档继续冻结实现。

采集器4763B/SHA9dd37f70在启动Native前核四原资产hash、五源码pin、所有新输出缺席及ignored/untracked/unstaged。fresh check使用原check-execution中的同一fe8e绝对root参数，实际完整argv已逐元素核等原check argv；run仅将--check替换为--run。fresh Node0、stderr0、effects0、nativeExecuted=false，stdout与已审check逐字相同，SHA仍5f5cd7d6，才唯一run；没有重试、取消、强停或改变API/参数。

五源消费窗口起止全同：ACL63afcbaf、Profile22513f6e、win32 730d4649、contracts a9eb7a93、index c5028b99，完整SHA集中于summary。前三为实际组件消费源，Profile/index仅关联pin；这不是1124项主组重跑或全环境恒定证明。结果绑定当次五源，不追认窗口释放后实现者的后续改动。

## 外层预检错误的准确层次

任务原console保留如下错误，不改写原输出：

```text
Traceback (most recent call last):
  File "<stdin>", line 5, in <module>
AssertionError
```

额外预检把预期相对probe参数写成正斜杠文本，原收据使用Windows路径文本，因此完整argv直接文本比较在参数index1失败；绝对root参数没有差异。两个Python调用在外层Bash按顺序排列，没有用成功短路连接，所以这个额外失败没有阻止进入采集器。该预检单独退出码未被另存，不伪造一个独立退出收据；原console实际包含错误，宿主最终exit0属于随后采集器的自然结果。

原始证据为Bash调用`call_6578d32913e84727af0e743e152d812e`、后台任务`bfdxues8h`的宿主output：452B/SHA `ff61ba34f22b7eff28a22363c5195ce4022568fbc8db975f46ceb6ec8e21b601`。公共console副本逐字相同，原宿主私有路径已直接交Review。以下仅是该次工具command参数的准确转录，不是新执行或重放入口：

```bash
python -I - <<'PY'
from pathlib import Path
import json,hashlib
record=json.loads(Path('docs/tmp/sg11-security-projection-born-low-check-execution.json').read_text(encoding='utf-8'))
expected=['node','docs/tmp/sg11-security-projection-born-low-probe.mjs','--check','--root',str(Path.cwd()/'data/workspaces/sg11-security-projection-born-low-fe8e0a22de5c440c9e5092e04802efc3')]
assert record['command']==expected
p=Path('docs/tmp/sg11-security-projection-born-low-execute.py')
assert hashlib.sha256(p.read_bytes()).hexdigest()=='9dd37f70d7d54d8c3082f51341c1ff7a576dbed299afeb0a5904cb063359e450'
print('EXACT_APPROVED_COMMAND_AND_COLLECTOR_MATCH')
PY
python -I docs/tmp/sg11-security-projection-born-low-execute.py
```

stdin第5行失败后，同一个Python内后续execute.py SHA断言及成功标记均未到达，不能称外层collector-hash预检通过。准确采集器9dd、收据及实际参数另有独立核对，不倒签这个失败的外层门。

归档补文调用`call_9fcb542c5f9541e8978fc2b642123c36`另发生嵌套heredoc分隔符错误：外层Python在编译期报未结束三引号，未写报告或索引；shell随后误进入原采集器，但在execute.py:21“所有输出必须不存在”断言停止，未到fresh check、Native或输出写入。随后独立核九项私有材料bytes/hash仍全部原值，失败工具原返回保留在本会话。该归档调用不是第二次Native，不计为成功；补文改用精确文件编辑，不改写原采集器或执行收据。

实际执行后只读逐元素比较，execution.freshCheckCommand与原check-execution.command完全相同，run的绝对root也相同；采集器中fresh检查本身的assert全部通过，原check stdout逐字相等后才到Native。由此可分开确认“外层额外预检失败”和“实际同参安全门通过、唯一组件运行成功”。不把这次外层命令写成全绿，不修改已执行采集器或原记录来隐藏问题，也不以重跑修复历史。

## 实际完整 SD 与业务阶段

| 对象 | 创建请求/立即实际 | 已定业务baseline | 原label | 最终真实原bytes |
| --- | --- | --- | --- | --- |
| root | 请求9c14，实际9814 | 唯一同DACL初始化后9c14 | Low/NW，flags03 | 相等 |
| child | 创建后实际8c14 | 8c14 | Low/NW，flags13 | 相等 |
| child/file | 创建后实际8c14 | 8c14 | Low/NW，flags10 | 相等 |

创建实际owner/group/DACL/SACL均精确等请求，full control仅缺DACL_AUTO_INHERITED400。SACL恰单ML、Low4096/NW1，root OI/CI；实际PRESENT10/AI800均存在，REQ200/protected2000/defaulted20均缺。没有创建后补SetLow或把NULL业务baseline重新标记为Low。

仅本次根仍空、私有、未发布且同held FileID时，fresh完整原SD逐字等立即创建实际SD后，唯一DACL4初始化返回0；实际只增400，长度、bytes[0:2]/[4:]及全部组件不变，包括SACL。请求、立即创建和settled业务baseline分段保存；建child/file后根全文仍等settled baseline。

四次baseline Native继承重建分别为root→dir→file的DACL/label：完整sameOwned全部true、control xor全部0；bytesEqualOriginal全部false，是内存自相对布局层，另记而不加OS恢复失败门。纯subtract候选的bytesEqualOriginal亦false，完整sameOwned仍通过；它不代替最后真实OS字节门。

首业务Set前冻结根write DACL add/release及四次未来后代DACL继承，全部候选固定后才执行两个根FILE1/DACL4业务Set，均返回0。两阶段前后全树同held FileID/tag/type/精确成员及实际完整SD都核；每阶段三对象sameOwned与固定stage全部true、control xor全部0，SACL/非DACL控制和owner/group均保持原值。最后另作独立Native全树snapshot，三真实SD的bytes.equals原业务baseline及sameOwned双硬门全部通过，未从actual重定期望或补位。

本次没有Profile/Job/token mutation、launch/Resume/HPCON/pipe或网络动作。合成package SID仅作DACL ACE主体，不是已创建或有效运行的AppContainer身份，不证明真实token的有效权限。

## 资源、回收与保留证据

实际GetSecurityInfo21，SetSecurityInfo3（初始化1+业务DACL2），业务LABEL0、Nt0。22份Local+8份private-security共30份唯一分配、5个owned handles全部单次attempted/closed，retained均0，errors为空。两次thread-token查询1008/空out，未模拟或启权限。

仅本次Create成功、独立final原bytes全等、源稳定、全部资源closed且零错误后，probe最终精确树复核并清理本次fe8e根；Tests独立lstat确认FileNotFoundError。旧五失败根仍为非reparse目录，不恢复、复用或删除。非原子Create→首open、路径式后代及关handle后Node删除的祖先/删除盲点保留，不能把组件路径检查说成正式生产父链或任意可信插件/full的隔离证明。

正式round-33/仅三份文字：9179B/windows-born-low-summary.json、452B/windows-born-low-console.log及batch-index.json。console与宿主任务原输出逐字同，保留外层Traceback和实际Node结果。summary只保脱敏控制位、label、组件相等布尔、资源和九项私有材料bytes/hash；公共材料已检查无SID正文、完整SD hex、FileID或绝对盘符路径。

准确raw run89586B/SHA a6cd4fc7、execution2739B/256967ac、fresh check2848B/5f5cd7d6、run-stderr0与原四稿、准确execute.py均继续本地ignored/untracked/unstaged，共九项私有证据，完整hash见summary/index。它们仍有用途，禁止清理、上传或重放；不会为重新取得证据再运行Native。

## 矩阵、库存与清理

本轮没有Node test注册，库存5472身份及全部字段不改，仍3321346B/SHA `b1bdb346d123d45f2ab44c652fd2eab83adb06c2576284e7286b1d245168a018`。不把组件Native执行伪装成新增Node测试PASS。

矩阵新增round_33及一个独立业务行sg11-born-low-private-temp-projection，293→294行，明确组件PASS同时OUTER_TEXT_PREFLIGHT_FAILED。旧sg11-native-security-projection-setter只注本轮未重跑NULL基线、历史失败保持且新组件另列；其余292个旧行NOT_RERUN_ROUND_33。不能用出生Low成功覆盖第31轮Nt NULL恢复失败或推广到已有task work/tmp、readRoots和外部树。

当前矩阵184258B/SHA `28b87048d05b7920a1b96fc403971baa72af22947e5dcf46de1fe064b4378215`。先--check/effects0再写；按index剥新业务行和round_33后全文精确回第32轮 `b803fc7c92de974e6475385f1a3ed0edc442d8371d38b9fa3120045f48f983ac`，原scenario及历史列不变。

报告/两附件/索引已独立核回；仅清理三个本轮已无用途的摘要生成、矩阵更新及差量临时文件和self-cleaner自身。准确清理器先--check/effects0，再--run/effects4，随后独立lstat确认四准确路径全部缺席，终态集中在index。不动九项Native私有证据、旧五失败根、第31/32轮报告/附件或其他会话资源。

第33轮交原Review正式核回；生产最小增量由Platform/Core沿责任层处理，不因归档占住消费窗。SG11/SG12仍ACTIVE，Windows生产准备/回收/mandatory/ConPTY、已有NULL业务对象、Linux强owner、macOS、其它最终主组/guards与原PR交付仍待独立证据，不建全绿report。
