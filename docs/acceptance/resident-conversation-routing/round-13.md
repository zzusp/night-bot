# 第 13 轮：容器终态与私有资源证明

## 范围与版本

沿原 worktree/分支/PR，HEAD 为 `6d79b0a0279d3f94f2d72d21f51ab1d654b0f509`，包含未提交的协作修改；每批绑定实际源码 pin，不能由 HEAD、随后整文件 SHA 或另一个镜像追认。SG11/SG12 仍 ACTIVE。无 Git 写入、真实模型 API、真实渠道发送、CI、合并或部署。以下结果均为合成夹具；证据路径相对本报告所在目录。

本阶段结束后才进入 Core 四源关停包与 Platform 范围投影包，它们不在本轮 PASS 内。通过且未受影响的旧 runtime/Web/credentials/restart/权限/flow 不整批重跑。

## 结果总表

| 证据前缀（round-13/） | 实际终态 | 结论与边界 |
| --- | --- | --- |
| docker-image-check-observed | 旧像容器0，但持久卷出现 DWS/Node cache | 零写 FAIL，不能用 PREFLIGHT_OK 抹除 |
| docker-application | 任务 completed/idle，关闭未自然完成，driver/container1 | 业务阶段成立；整注册 FAIL，精确 SIGTERM 无效后仅原 PID102 SIGKILL |
| docker-close-recovery-attempt-4 | 同旧像/原卷，正式入口冷启及关闭自然0 | 原 task Pi 全文 hash 不变、issuedTools=[]；不追认前次关闭 |
| docker-build-checked-attempt-3 | 构建自然0，491源无漂移 | 新像 c343；不是应用业务验收 |
| docker-image-check-fixed | 新像默认 ask 自检自然0 | fresh 树/权限/UID/GID/mtime不变，无配置、未启应用、无默认 DWS 探测 |
| docker-restored-check | 四边界符合预期、检查前后树含 hash/mtime不变 | 缺temp拒绝、显式准备后通过、0755及symlink拒绝 |
| lpac-job-configuration | 2PASS，Node自然0，5源无漂移 | return-zero/throw保准确句柄；脚本接缝，无native child/Profile |
| private-job-proof | 11PASS，Node自然0，9源无漂移 | 原4资源注册+新5根注册及2子项；真实Pi持久化，不是原生ACL |
| private-job-proof-count-binding | 唯一受影响注册1PASS，自然0，9源无漂移 | 结构有效3-root/3-object proof对count2 descriptor；其它原10项未重跑 |

## 容器业务、关闭与冷恢复

业务镜像固定 `sha256:0c6c6f8c665a222d64390252df473b22b2cae9cfc09cbd133f73c509dbc9575c`，原专属卷 `night-bot-sg12-data-0c6c6f8c-r13`。均保留非root node、cap-drop ALL、no-new-privileges、只读根、独立tmpfs、network none和正式seccomp `9264f1689d786e212fcfc1dc63eed5d08a2be4c236a252d5676f43f40691201f`；没有privileged/SYS_ADMIN/unconfined、docker socket/整个宿主目录挂载或宿主策略修改。

旧自检实际生成 `/cache/dws/runtime-context/...` 和 `/temp/node-compile-cache/...`，`docker-image-check-observed.json` SHA `d784c57fe6acee17fba3ae8dd9a079854e539d85b450ffd8d78f9a74255644b3` 保留FAIL。Core入口修为 `def816be0b4bbf669a8a9178000355fd98527bd1e7ac2213e404089d79b8f8ad`：首个Node前禁compile cache，默认不探可选DWS，只读验证现存temp canonical/同UID/0700/RWX，不mkdir/chmod/chown。

原业务已通过正式入口、真实认证HTTP（401/foreign Origin403/坏CSRF403）、Chat→triage→Router→唯一task Pi的write/bash/read/task_result。`container-business-r13` 已completed/idle、drained=true、runSequence1、结果 `CONTAINER_BUSINESS_R13_COMPLETE`；独立实读 `work/direct.txt=CONTAINER_DIRECT_R13`、`work/shell.txt=CONTAINER_SHELL_R13`、`tmp/task.txt=CONTAINER_TMP_R13`。结果 `docker-application-result.json` SHA `e396f2141e101c71344fe954953c5384e700ebf150c9c9ae7e54845cda0eb9fd` 仍为pass=false、phase=restart、hostClosed=false、modelClosed=true、exit1。

启动未ready的初判被真实任务反证，阻塞在业务后的关闭。核精确containerId/image/owner、PID102 argv/PPid17/starttime4692256、已完成任务及工件后，两次分别先--check：SIGTERM后同进程CPU仍增长，再仅SIGKILL该PID。没有按名杀/tree kill/docker stop，未删卷/WAL/lock。`docker-application-controlled-terminal-forced.json` SHA `181e75b459f924effbb64c2708522df74b383e0d0780fc7f1e87e1ac5e6d2968` 明确naturalShutdown=false。

原脚本模型无视成功settle回执、无限再发settle：2036次模型请求，2029次settle；raw Router观察首个成功后大量PERMISSION_CALL_INACTIVE。该诊断来自原卷journal只读工具输出，没有单独raw JSON/strict seal或观察时全文hash。fixture无限轮因素成立；活跃异常推理中Host关闭是否及时abort仍是独立产品盲点，idle冷恢复通过不排除它。本轮没有CPU profile/SIGUSR1/ptrace。

最小冷恢复只复用原卷，不再创建/执行task。模型在当前Router user批次后的对应成功tool result才结束轮次，历史任意成功不能跳过新批；tool-free handoff按实际schema返回JSON。attempt1的Promise路径及attempt2漏传prior在source阶段失败，未启应用/模型；attempt3 handoff fixture无效导致boot失败，不归产品。最终 `docker-close-recovery-attempt-4-result.json` SHA `2bcfa3636a27cca905e0e782dbdb24fb0c93ff46108793e033df90be2cc64db5`：同instance `night-34eba487-9d28-4617-85f7-dafe27049afe`、模型请求1、issuedTools=[]、hostClosed/modelClosed=true、containerExit0/running=false/Pid0。task Pi前后均为 `14335305bbffdc83aa29735624c4cbb8d8852bb33f0dde576b3cea0e1c6a12c6`。前三次失败保留，不覆盖。

## 新镜像零写验证

491个白名单源码条目封包前后及逐条bytes SHA一致，不含data/node_modules/.env/accounts/private skills。封完即释放Core/Platform源窗。首次PAX stdin被当Dockerfile；第二次gzip已识别context但BuildKit frontend报no http response from session；第三次从同封包逐hash还原的独立目录构建自然0。不改TLS、签名、代理值、daemon或sandbox。

原tar SHA `318b5f5bf622e6a830d005a5167bc9fe9ff4099acf4bfec1ba77f86023ec5d51` 绑定 `docker-build-checked-input.json`（SHA `1350ddcb6bf383eef538d45fbcd68cd746259dbfb2b2734e6977610930216444`）。压缩派生与原491源映射见 `docker-build-checked-input-gzip.json`：gzip SHA `5589bb6b284b4b0d25d4afa490483c5b2b7cd61f0991e2ae3f30abb0cb3b8290`。解压后的目录逐文件/集合一致性在 `docker-build-checked-attempt-3-source-map.json` 和清理前校验驱动中再次检查，不只依赖sourceBoundToSealedContext布尔值。

- 新像 `sha256:c34333f096fc1ffa807b812acfe064b9832942a754053dd5fd4be75041d82813`，tag `night-bot:sg12-check-def816be-r13-a3`，Linux/amd64/user node。
- build result SHA `020a3c53d548f87afe083053688fe7cd7e92d65e42b39badb3946769443f1a0d`，source-map SHA `72ddc771351c60def5a43e7fed7bd6a29b80363d50bd355ae471fa0b94e4ebdc`，491源sourceChanged=[]、applicationRuntimeValidated=false。
- Fresh result SHA `b2c6b0ecbd7e46be8819e9c3dc996cb71a479716f479f4dd5f3b62b537e10092`。前后仅data根及空temp，UID/GID1000、0700、mtime相同，无配置。
- Restore result SHA `a6c689676410cd999d7f2277f3b403db87db54ec96b0e34cf2795a8e58b637a4`。递归比路径/type/uid/gid/mode/mtime/文件SHA，symlink只读目标不follow。missing:1/ENOENT；显式privateDirectory后prepared:0；0755/alias:1/NIGHT_DOCKER_TEMP_UNSAFE，四项unchanged=true。最后temp恢复真实0700目录。

这里只关闭自检零写缺口。新像未跑应用/模型业务，不能拼入旧像结果；封包中旧Windows源不代表后续Windows源已验。

## Pi私有证明与脚本Job配置

`lpac-job-configuration-result.json` SHA `96834986c793ad0b3312d316615f44a3ee78cb525521cd2213182d2c450f93ad`，log `d258e340c65195a515a8edee3bcb2e89f2723d5428e0f035b4790285004b2039`，test `873f1ad773f603d604a64914b0c69364d8da2e6b493d7877ee8aa36b72db2a5f`。两种Job配置失败保exact allocated handle；无真实child/Profile/ACL。结果落盘后旧Python包装器GBK打印错误退出1，Node自身自然0；二者分列，不为编码重跑。

私有证明批走真实官方Pi工具→NativeJobs→Pi journal append/commit/query；descriptor/SD为脚本夹具。result SHA `7e11b9e4752199b2f6d69a69b36cf7fc8550dc7b4f9e8497597eb277c5bed8a8`，log `67ebd7f3a723a779217509a071d1662624d8be61c9ec8ed161c876a9fa017486`；test `b185e6382226b7f113b34cdb7a661aeb25b34fd34105f175f29a7977cb5cc3cd`，ledger `5c0c65404ddc02bdf7bb2aa44035996998e0dc72232506a2bfdccae75e1d88d4`，NativeJobs `b8d4e3757d9e3e45f8ee2899a5318999b72625eedaf9540aa4d93bf03c054962`，contracts `e9a7a9c7b32026d0753c3879d2b802ebfde8da42a5517e46b17d0dd738ee80cd`，完整9源见result。

覆盖同seq/tail、真实commit前无ACK/后续效果、ACK等于真实entryId、公开Jobs/工具结果/模型请求无proof；额外字段/Name/SID/count拒绝；commit真失败保uncertain/no-replay；released来源保原锚及借用闭包；缺锚和存在锚但错FileID拒绝；live committed writer与无writer cold一致；自有Pi文件实际追加uncommitted tail后查询拒绝且读不改文件，finally仅撤回自己追加字节。

Review发现原count变体roots仍2先被schema挡住，不能证明ledger count绑定。仅改为结构有效3-root/3-object proof对原count2 descriptor，保其它负例。定点result SHA `e3791d72b4f3f6369ab751ae130ce0897289c06e2780c230a48a4f52f7bc686e`，log `af94ded4a0bab89691ef43402e22090d9524d8adf67e2d60e4d92576ed4aa5b7`，test `0ec74a5f06191ffc239462414035e8d07d9f0a8c0cc6b454de3d6e1421d96021`。唯一注册自然0/1PASS，9pin无漂移；Review内存逆换精确恢复原b185全文，其余10项字节未变，不能称新11项全跑。nativeExecuted/profileCreated均false；后续contracts readRoots/cwd整文件变化未追认。

## 库存与矩阵

先前静态补登5414→5433：19补登、22旧名/嵌套映射、9项复用严格逐名且registration SHA相同的历史PASS、10项NO_OBSERVED_RESULT；两条旧SG12登录未知不由同文件通过覆盖。本阶段补2个Job配置根注册、5个private proof根注册及2子项，共9项到5442；13个逐完整名称结果绑定本轮实际test/log/source，所有原registration_sha256及失败身份保留。

原AST提取器只解析520文件、5184当前注册、未解析0；结合历史精确映射后未登记0。静态完整性不代表5184项执行通过，也不覆盖后续新增。库存SHA `6194b9b9fce5f0aebf895ace9bf11d82a9e4aea36628389649044a73a7b53f00`。matrix新增round_13列、旧列保留；无本轮动作项记NOT_RERUN_ROUND_13。

## 清理与下一阶段

先--check核最终build0/image、491还原文件集合/逐hash、tar/gzip关系，再仅删本次 `docs/tmp/sg12-def816be-context.tar`、`.tar.gz`、`docs/tmp/sg12-build-context-def816be`，独立确认缺席。封包本体已清理，仅保manifest/source-map，不能作为仍可打开的附件引用。清理记录SHA `e0fb50e2dc56f3759c5da87b99cae531ccaeada6c180ff17b21397744ec42031`。未执行的inspector preload已删，无profile产物。失败结果/必要日志保留，未泛化清理其它轮次证据。

原业务卷、新像检查卷/终态容器尚保留，不称全部资源已回收。当前无Tests在途执行。下一阶段先消费Core四源关停包，验活跃推理中断、durable pending、open-close和维护失败因果；Platform范围投影、parent proof协议及失败资源收口按必要增量另验。Windows LPAC/精确scope/原Job持久ACK/Resume/ordinary/ConPTY完整生产链、新像应用/宿主浏览器/可选DWS waiting-auth与fake自动接入、routing/domain/containment余组及最终同版guard未完成。full不抵受限档，fake不抵厂商实测，不写全绿report.md。
