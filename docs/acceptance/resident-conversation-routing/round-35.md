# 第35轮：真实 Host 未启动 Profile 组件异常与耐久现场

## 结论

准确9e90稿在原Review整体前审、Lead唯一源码消费窗和同参fresh check0之后，仅执行一次原`--run`。**Node PID48888自然wait返回3221225477（0xC0000005，访问冲突）；宿主采集命令exit1，没有生成原run.json，组件结果未知，资源终态未收敛。** 不能记普通断言FAIL、组件PASS或资源已释放。

本次真实安装根已创建。原严格Pi解码使用显式portable codec，42274字节全部已提交、无未提交尾；同一Job仅有registered及seq1/planned，没有profile-owned/privateProof、settled或released。SQLite任务仍active、drained=false。planned中的profileAbsent及零计数是提交计划时的事实，不是崩溃后的资源实况；不能由无后续收据推断未调用Create。

实际终态接回并独立核PID缺席后，已立即向Lead及各来源保持者释放源码窗。原I、SDK资源可能状态、journal、WAL、锁和私有材料继续保留；没有重跑Host/Native、第二delete、修尾、恢复、rm或自动清理。SG11/SG12仍ACTIVE，scopeReady=false不变，不写全绿report。

## 受验版本与唯一执行

工作目录/分支保持原resident-conversation-plan/night-bot及worktree-resident-conversation-routing。受验版本为HEAD `6d79b0a0279d3f94f2d72d21f51ab1d654b0f509`加未提交协作工作树，不以HEAD代替工作树。

- 完整选择集1125项，聚合`f302cf519b33b09f8709d8ad49ef7887b3e929685d6f66ed0b3f88b52b988fb7`；原execution保存起止全文映射，sourceChanged=[]。不包括安装数据、secrets、node_modules或全部环境；窗口释放后源码不倒签为本轮受验版。
- 原Profile SHA `2d89946f09a7011923be51833730694447ddbeef4e27845b030c69b2dabf7f45`；process-fork-manifest为`a819b051a90b5e76f4b1f13f8cf70aeb9d61e20df78fd4f58a91cb7ab545c5e1`。
- 已审probe23228B/SHA `9e90a078b30cba1db279b0ae872b1bad3cadff1e88d763eaca8160cf77bb6aa4`；其余三稿及准确execute.py的完整bytes/hash见本轮summary。原Review准确前审在review.md:1844；不把静态前审当Native通过。
- 唯一宿主任务`bghshp88o`，tool-use `call_c3072470231b42cd89ab742fb31dfcde`。准确工具输入仅为`python -I docs/tmp/sg11-profile-unlaunched-execute.py --run`，不是重放建议。

采集区间为2026-11-08 23:35:54.010884–23:37:52.638230（北京时间UTC+08:00）。这是采集器区间，不是单独测得的Node出生时刻。采集器先同参fresh check：exit0、stderr空、stdout118189B，逐字等原check，SHA `0c6861aa68d8c71a2038f225064793c991145244929046d2f26f80657d422de5`；四稿与完整来源门均通过后，才将同一argv中的--check换为--run。

原Node自然wait返回上述异常码；intervention=null、forcedTermination=false、naturalWaitReturned=true。stdout/stderr各0B；componentPass字段未产生，不补成false或true。START_NATIVE_COMPONENT仅为采集器启动前标签，不能证明factory或某个Native调用已到达。原execution为248122B/SHA `9fb5c6554e2dc7bff2b9eb472b27cbd45f38816d08f2cf5db07643f4413f0456`。没有重试或强停。

## 原journal严格只读取证

不创建第二Host/persistence，不调用业务恢复或消费pending。先核唯一I及实际task/session路径非reparse，从真实Pi首行取得owner并用原piJournalFilename核文件身份，再使用原runtimePaths、portablePaths和decodePiJournal(requireComplete:true)。五个纯离线依赖hash均与本轮execution起止映射一致；未替换codec或宽松解析committed记录。

原磁盘journal为42274B/SHA `a2366fff4e24eb9cd97733179beb029919231ea875d4159ec47291bb9bada5d1`，解码自然0、stderr空，committedBytes=totalBytes=42274，尾0，26个committed entries。最后commit为5f2ed82c，parent45cfa2d2，时间2026-11-08T15:37:52.532Z。

| 实际entry | UTC时间 | 真实业务锚 |
| --- | --- | --- |
| 605221ca | 15:37:51.932Z | job/registered，原同owner/job/toolCall绑定 |
| 45cfa2d2 | 15:37:52.505Z | job/resource-ownership，seq1/planned，scopeCount5；实际随机Profile名只保本地私有facts |
| 5f2ed82c | 15:37:52.532Z | 上述批次的night.commit |

没有profile-owned/privateProof、settled、released或失败后的unknown-retained追加。不能造unknown收据来补崩溃空白。无尾只说明物理journal完整，不表示业务已完成或OS资源已回收。原planned提交早于Create；loader及constructor也可能在planned前已有只读Native活动，具体崩溃点仍未知。

Core亲读两份facts后确认：实际已经到达原factory的planned提交，排除了planned未写入、错owner及未提交尾这三种解释；不证明原await已返回或Create已调用/成功。尚无profile-owned的区间覆盖factory后续、返回断言、prepareScopeRoots、独立observer及commitOwnedProof，缺少细粒度耐久锚，且早先FFI破坏可能延迟显现，不能把故障根因强限定为planned之后。当前没有Host忘await、假settled或需要修改账本的证据。

原no-replay源码链仍保留：job-ledger:165起对registered/planned无terminal保pending，native-jobs:31起在新进程无live record时拒run，tasks/single-session:81及effect-reconciliation:207分别阻断未决Job的输入/普通effect结算。这是Core责任层静态核回，不是重启恢复实跑；本轮不补unknown/settled，不用进程死亡追认JS catch/finally已执行。

离线读取第一次内联脚本因路径分隔符转义在Node编译期SyntaxError，未执行模块或写证据；改用node:path的relative/sep后实际严格解码成功。它不是第二次组件Native运行，未改原probe或执行输出。

## SQLite、锁与Windows崩溃记录

SQLite直接以原dynamic.db的mode=ro及PRAGMA query_only=ON读取，保留并读取现有WAL语义，未使用忽略WAL的immutable方式。

四个补充值drained/recovering/runSequence/sessionBound来自原Bash工具`call_80689ec584cc4433acf3ad1d5552d84f`的`ADDITIONAL_TASK_FACTS`输出（false/false/1/true），不是从postmortem-state.taskFieldNames推得。原只读输出摘录及工具来源见`round-35/sqlite-readback.json`；本次仅提取原记录，没有重查SQLite或改两份原postmortem。

原任务status=active、drained=false、recovering=false、runSequence=1、sessionBound=true；本隔离库dynamic_executions及dynamic_task_events均0行。DB/WAL/SHM文件的读前后bytes/hash全同，没有手工改库或清锁。

唯一I实存且非reparse，data/temp当前为空；Host锁和该session锁的owner PID均48888，只读取PID、不输出token，锁原样保留。temp为空与PID缺席不能代替SDK Profile/registration缺席或released证明。本轮没有新增Native注册表/SDK探针，未测得崩溃后的SDK资源实况。

Windows Application事件1000仅按本次PID及时间过滤，未打印整份Message、环境或命令行：

- 原运行区间2026-11-08T15:35:54.010884Z至15:37:53Z查询无记录。
- 考虑事件延迟写入，终查延至2026-11-08T15:56:24.0620818Z，同PID仍无记录。

两次查询自然0；没有取得fault module、offset或精确进程出生时间。0xC0000005来自实际退出码，不冒称已有Windows事件的异常字段，也不据日志缺席解释根因。实际planned锚和两份原facts已交Core/Platform/Review及Lead，由责任层继续静态定位。

## 正式材料、矩阵与保留边界

本轮`round-35/`仅公开脱敏summary、batch-index、原SQLite只读输出摘录和实际archive-update源码，不复制私有raw、完整SID/SD/FileID或绝对安装路径。summary/index记录本地11项准确材料的bytes/hash：原四稿、专属采集器、fresh/stdout/stderr/execution四输出及两份postmortem facts；原run.json缺席，不补造。

归档更新先--check/effects0，再--run。矩阵295→296业务行，增加round_35和独立sg11-profile-unlaunched-real-host行，记访问冲突异常、组件未知及planned未解资源；两个总汇行记BLOCKED。其余293旧行NOT_RERUN_ROUND_35；剥新列/新行须逐字回第34轮190361B/SHA `b2c40bd2e747486a92029bdcc31a84ffb748093774c245a0e50ff60ea1f2217f`。库存5472身份及全文不改，仍3320505B/SHA `aeb6cc97bcedbcce7b7d63aa984159a18b699b7b67f347deb2e4e057f5464fdb`；本组件不是Node测试注册，不制造PASS身份。

第33/34轮历史报告与结果不改、不重跑。第33轮私有Native材料和本次11份材料仍参与追溯，全部保留ignored/untracked/unstaged；旧五失败根不读写/恢复/复用/清理。本次I/SDK/journal及原锁保持，不为归档收尾删除未收敛资源。

本轮未改生产实现，没有真实模型/渠道调用、Git写入、CI、合并或部署。当前阻断是本组件访问冲突且Native/资源终态未收敛；Windows完整Profile准备/mandatory/Job ACK/launch/ConPTY、已有NULL业务树、Linux强owner、macOS及其余最终主组/Web/PR交付均不能由本轮替代。
