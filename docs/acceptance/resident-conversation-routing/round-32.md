# 第32轮：当前 routing/domain 完整组与逐例对账

## 结论

原 runner 的两个完整组均自然退出0，绑定同一份未提交工作树，1124项受验文件起止无漂移：

| 主组 | 实际结果 | 自然终态 | 业务 duration |
| --- | --- | --- | --- |
| `pnpm test:routing` | 72 PASS、0 FAIL、0 CANCEL、0 SKIP、0 TODO | exit0，任务 bl0nl3zx7 | 662699.5364ms |
| `pnpm test:domain` | 215 PASS、0 FAIL、0 CANCEL、0 SKIP、0 TODO | exit0，任务 b6a9zu36j | 31114.7531ms |

287个真实终态均与当前 AST 注册按完整名称、实际嵌套层级及组内唯一性精确对账，声明/终态均0未映射。没有以旧计数补齐、文件级汇总推断逐例PASS、追认跳过或控制 worker 退出。两任务均已接回，没有在途主组测试。

这只关闭当前版本的 routing/domain 两组证据。SG11/SG12仍ACTIVE；本轮没有执行 default/runtime/containment 或最终三守卫、Web、Windows Native/生产Profile/mandatory/ConPTY、Linux强owner或macOS，也没有真实模型API、渠道外发、Git写入、CI、合并或部署。不写全绿report。

## 版本、原 runner 与旧结果排除

工作目录仍为原 resident-conversation-plan/night-bot，分支 `worktree-resident-conversation-routing`，HEAD `6d79b0a0279d3f94f2d72d21f51ab1d654b0f509` 加已知协作未提交工作树，HEAD不单独代表受验源码。

本轮沿 `docs/VALIDATION.md` 和 `scripts/test-pi.mjs`，分别执行 `pnpm test:routing`、`pnpm test:domain`，不改 runner、不加选择器、不另设整任务预算或重试。`NIGHT_BOT_TEST_CONCURRENCY` 未设置，各原 runner 使用默认单 worker。宿主后台分别跟踪两个命令；采集器只启动、等待和保存原始 stdout/stderr、自然退出与起止快照，没有 kill/取消/强制终止路径。两组沿原隔离目录、local/scripted模型和fake渠道测试，不构造真实厂商调用。

当前来源表覆盖Git可见的 src/bin/scripts/test/packages源码、测试、脚本、包内资料及明确列出的根配置/合同，共1124项，含已删除的tracked源码路径及其缺席值。安装数据、secrets、node_modules和验收记录不在此集合，不扫描私有运行日志。固定锁文件与实际Node/pnpm版本一并记录。它证明这份明确来源集合无漂移，不声称排除了所有环境变化或覆盖未执行的平台分支。

四个组内起止聚合全部为：

`e91dade5513fdcdc5c6a33691f2fba4bbff47358d4aaae73d2a5f77725a544d4`

两份 source 表分别在各组启动前实际生成，两个 result 含各自结束时完整映射，均 `sourceChanged=[]`、`intervention=null`、`forcedTermination=false`。Node v24.19.0、pnpm11.25.0、Windows本机执行；不拿此结果抵扣Linux/macOS。

没有复用旧整组：原第3轮 routing59仅绑定1102项聚合34930/store cf6；第11轮 domain393封定的548项中已有53项与当前不同，包括旧Topic执行模块退役及当前CLI/运行时变化。第11轮后续五组执行器已因漂移按合同退出3，routing/domain没有启动，不能把“已安排”当作结果。本轮当前domain是215项，不使用旧393计数。

## 实际时间与附件

- routing：2026-11-08 13:21:06.492902–13:32:13.777016 UTC，即北京时间21:21:06.492902–21:32:13.777016。原 `routing.log` 为16454B/SHA023448cd；`routing-result.json` 为126878B/SHA b0f93c8f。
- domain：2026-11-08 13:21:13.999455–13:21:49.819484 UTC，即北京时间21:21:13.999455–21:21:49.819484。原 `domain.log` 为20744B/SHA c79025fb；`domain-result.json` 为126872B/SHA c3d235fc。
- stderr实际分别为35B和34B，均只是pnpm输出的原Node命令echo，不是测试报错。此前消息按文本读取规范化换行所得routing33字符不等于资产字节数；本报告和索引以原35B/4356dfb8为准，不因此重跑。

最终证据仅在 `round-32/`：两组各 source/log/stderr/result/cases，另含当前case-declarations、准确group-collector、case-scanner、inventory-update及batch-index，共15份文字附件。14个被索引附件的准确bytes/hash统一放batch-index，不另维护重复hash表。归档副本均与当时临时源逐字相等。

附件内的原临时路径及执行脚本保留为准确执行源码/收据，不改写历史路径；清理后通过batch-index的 temporarySource→正式附件名映射定位。它们不是可直接重放的入口，collector拒绝覆盖已有执行结果；本报告不要求恢复临时文件或重跑。

## 逐例库存与矩阵

复用原 AST scan/graph 逻辑，仅解析原routing/domain测试图：24个文件，routing11文件72注册、domain13文件215注册，静态名称0未解析。spec reporter的嵌套子例保留父标题，例如DWS bridge的preflight/send/postflight，不能把短名误当独立顶层身份。cases中的line是原日志行；源码行保存在case-declarations。每项都带实际测试源码SHA与当前registration SHA。

库存从5468增至5472个唯一(file,case_name,occurrence)身份：更新283个已存在且本轮实际运行的注册的必要当前行号/source及逐例证据字段；追加当前topic-runtime四个此前未独立入库的真实身份。原registration_sha256作为历史注册锚保留，当前注册hash另见cases/declarations；不因当前源码hash更新追认旧结果。

原topic-runtime190个身份全部保留，其中8个仍存在的原名注册续验并获本轮绑定；其余182个旧退休/迁移记录不改。新4项分别为长单消息连续UTF-16读回、历史分页搜索、Pi未接纳原文/恢复收据及writer失败可见性门。没有把旧Topic执行协议恢复为生产运行实体。

库存当前3321346B/SHA `b1bdb346d123d45f2ab44c652fd2eab83adb06c2576284e7286b1d245168a018`；按index逐单元rawCellsBefore逆改，再剥四项追加后，精确回第31轮 `fdbca7918643bb7131b4b2fc363b40ad312d63969c7f1bee17fe816d5d73d0bf`。原5468身份不删改，未受验历史不改。

矩阵仍293业务行，只加round_32：routing-regression记72 PASS，domain-regression及既有sg11-domain-final记同一组215 PASS而不重复计数；all-required-regressions和sg11-final-remaining-checks只记两组局部完成，明确其它主组及最终guard未跑。其余288行NOT_RERUN_ROUND_32，旧scenario/历史列原样保留。

矩阵当前178279B/SHA `b803fc7c92de974e6475385f1a3ed0edc442d8371d38b9fa3120045f48f983ac`；精确剥round_32后全文回第31轮 `39412c578cf4cbaeba693ff0bf8db3f7d176fe2f1d88c1ae624f202c43780a50`。必要检查先--check/effects0，再写入并独立核当前bytes/hash；历史可逆元数据集中在batch-index。

## 清理与未完成边界

归档逐字核对、报告与索引落盘后，仅清理本轮16个准确自有临时文件及self-cleaner自身；先零效果--check，再删除，最终独立核17个路径缺席。准确路径、check/终态和保留边界由batch-index集中记录。不会清理原AST工具、其他轮次报告/证据、出生Low草稿、Native八私有证据或五个Windows失败根。

第31轮已由原Review在review.md:1765正式核回，本Tests已实际读到；6纯体PASS和Nt完整SD恢复FAIL仍分列，本轮不重跑或重写它们。当前出生Low单一候选沿原spec16.18仅在准备准确稿，未执行其Native；其check/前审/消费窗和唯一run另按原边界推进，不混入本轮287个PASS。

Windows出生Low组件、完整生产准备/回收及ConPTY、Linux强owner、macOS、其它最终同版主组/guards和原PR交付仍未完成；生产/goal/spec由原单写者维护。本轮两组证据不代替这些完成条件。
