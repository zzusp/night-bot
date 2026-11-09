# 第 23 轮：同容器 fake 监听、补拉与入站终态

## 范围与版本

沿原 worktree/分支/PR；HEAD `6d79b0a0279d3f94f2d72d21f51ab1d654b0f509` 加未提交协作树，SG11/SG12仍ACTIVE。本轮仅补原SG12的fake实际监听/补拉/入站余项；没有修改生产实现、测试注册或权限策略，没有Git写入、CI、合并、部署、新Windows Native动作或真实模型/渠道调用。第17轮Chat/cold、第20轮活跃PID1取消及ready绑定、第21/22轮已过测试均未重跑。

复用第20轮已封定镜像 `sha256:82b96bd4406654154e29b4717feedc02c67542ac6d7deed146a81d5ddd230a2b`，491源内容摘要 `46b3e4c2cc32840b72a50a82ca54a480680c007ecad5c44078e76aee33b43a70`，未重建。26项本次关键源逐文件在容器内核hash，具体值见首批result.source；来源是原build source-map，不将后续共享树或新Windows temp实现追认到镜像。宿主Node24.19.0，容器Node24.13.0。

## 实际业务链

首批驱动 `393817e6435d48cfbbca8e0fbbcddf40c4c152ca423bb7112de325491f5c4cc3`，原参数先语法检查及零副作用--check，再--run。正式容器保留默认ENTRYPOINT/CMD，使用非root node、network none、capDrop ALL、no-new-privileges、只读根及正式seccomp `9264f168`；补读驱动逐对象核seccomp相等。未设置AppArmor，daemon实报空profile，不声称其保护。仅独占命名卷与私有tmpfs，无宿主目录/socket挂载，无privileged/SYS_ADMIN/SYS_PTRACE或sandbox降级。

- 正式初始化和默认文件观察器在同一运行容器内读取合成认证状态，启用的可选DWS插件经真实fake CLI子进程执行 `event +listen-im --kind group --events message --chat-id fixture-room --format ndjson --profile fixture-corp:fixture-user`，stderr精确ready后，认证Web `/api/channels` 实报listening/connected=true。
- 同一真实CLI调用 `chat +chat-messages --group fixture-room --start ... --end ... --order asc --page-all --page-limit 50 --format json`，fake按真实时间窗返回完整历史结果。历史消息 `history-r23` 经正式Host/官方Pi进入容器loopback脚本模型，模型仅提交 `channel_triage_submit`，随后在原SQLite真实查询到source.routed及triage.state=committed、needsHandling=false。
- 在真实监听stdout管道依次追加foreign会话、同原时间/文本/作者/消息ID的历史重复、以及 `live-r23`。实时消息同样通过正式分诊提交。最终SQLite来源2、triage2，均version1/committed/routed；历史重复没有增源或改版，foreign没有来源。tasks=0、notifications=0，两个decision.reply均null。不是只以ready/已接纳/局部idle判完成。
- 真实认证Web的会话/messages投影可见这两条消息。模型仅有两次分诊请求，消息ID分别history/live，没有Router任务工具或业务执行。8条实际fake CLI调用含两次完整历史读取及一次监听，没有send/upload/recall。ingress真实持久backfillThroughAt、consumedAt和consumedMessageId=live-r23。

所有账号、消息及模型密钥均为本独占卷内合成夹具；没有读取宿主DWS账号/凭据，未外连厂商。数据表只用DatabaseSync(readOnly:true)+PRAGMA query_only查询，没有直接写DB、补造完成marker或重放快照命令。本项为fake集成，不证明真实厂商认证/补拉、真实模型、浏览器新交互或Windows生产scope。

## 首批失败与最小补验

首批容器内exercise自然0、业务pass=true，宿主随后 `docker stop -t -1` 正常SIGTERM；正式容器ExitCode0/Running=false/Pid0/OOMKilled=false。父driver自然1、pass=false：停后辅助容器把原数据卷只读挂载后，SQLite WAL模式查询需要旁置SHM，实际报 `unable to open database file`。这是收尾读夹具失败，首批result/log原样保留，不改成整批自然0，也未重跑已完成业务。

补读驱动 `d4df5acca7747103ec46458e7ed51775e6cbaeb979ecf6f64d5b887618d3b973` 在同一精确停态containerId/owner/image及卷唯一引用约束下，先--check再--run，自然0/pass=true。原卷仍readonly；仅复制停态tasks.sqlite及存在的tasks.sqlite-wal到辅助容器独占/tmp，再以readOnly:true/query_only查副本，允许SQLite仅在副本旁生成SHM；没有用immutable忽略WAL。该终态原卷WAL实际缺席，未丢弃现存WAL。原DB复制前字节=副本字节，清理前又独立读原卷hash，均659456B、SHA `c37a6b1200cfd37c5110812551ab7fefd6793e87ea9da0ac91a1e6f8d77fd87b`，前后WAL均缺席。副本随辅助容器销毁，不入Git。

补读核回来源2/triage2及两个静默决定；fake监听pid198留一条SIGTERM终态，正式 `.host.lock/owner.json` 缺席，ingress停态paused=true。真实容器ID `9d9ebd387c01bac1ff3f5cca52f56857213b88d7240e0df00cd9cb5c8c620f71`。精确清理脚本先--check，再核原卷摘要不变，非force删除本轮容器/卷；独立inspect核主容器、seed/readback/identity辅助名及卷均缺席。最终镜像保留，没有在途Docker/模型/Native操作。

## 证据与集中登记

证据位于 `round-23/`；没有新增正式注册或测试源码变化，不重复AST库存。库存仍5468、SHA `95ee7523f851e141a9f50f7e2af58f053a8e77a3351bc0045da36aa8e76f4183`。matrix新增round_23与3条业务行至289，SHA `12b952321d425aca7e723be32ff54f5152a6070bfe5876770ab120ed9ca7bafc`；旧列/失败全部保留，首批父driver失败、实际监听入站PASS、停态补读PASS分列，不拼成一次全绿执行。原owned-cleanup行仅登记本轮精确资源清理。无全绿report.md。

| 证据 | SHA256 |
| --- | --- |
| docker-fake-ingress-result.json | c54a6378f09c193e269ec3d68eac79f3113467882133d610c71a24d3a924231e |
| docker-fake-ingress.log | 760ff58a7d6e6a76fb3f6337bf85407415daee71e8e26a71dd45a2dfab301b2f |
| docker-fake-ingress-stderr.log | f4f2c79269f00a1151e9c93527d965b8edca19054968270c320940d0e4e90dcc |
| docker-fake-ingress-readback-result.json | ac738647db09f0b3f68f424856ee84d7a48c177b11f9e0431e6f5690990d37ee |
| docker-fake-ingress-readback.log | 6c191c714703800777ce9918b7df9ac5d263b63245ac9750e073bd76bc5de34b |
| docker-fake-ingress-readback-stderr.log | cc85ed3ff1b6bb61112132dd5e3ca7a6d367ba82df483a939919a6f3df8d8eb5 |
| docker-owned-cleanup.json | 1494bffc5f6fe704e8173aff020ec63afabdf9e4340a24f2ab9bf940ce6eaf88 |

两份stderr只有Node SQLite ExperimentalWarning，首批父driver报错另保在其result.error。第20轮最终Docker证据支持独立build/PID1/ready结论，非本轮可替代中间附件，继续保留；本轮七份均支撑实际业务、原FAIL或最终终态，未删除必要证据。

## 剩余边界

本轮关闭fake实际监听、历史补拉与入站余项，不关闭真实厂商集成或SG11/SG12总体。新Windows temp/env实现的准确前审、Native setter对直接target/后代400/800投影、真实受限scope/有效权限/差量撤权、原Job耐久ACK/Resume/mandatory cleanup及完整pending负ACK/join/seal unknown/CloseHandle attempted仍未验；最终相关主组、guards、集中Review、敏感/Skill核验与原PR交付仍待。唯一goal由Lead单写。
