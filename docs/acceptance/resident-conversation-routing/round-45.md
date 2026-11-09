# 第45轮：full剩余问题与容器基础工具

## 结论与范围

用户本轮追加的显式 full 接线及容器基础工具范围已完成。Windows 新增 full 场景和受影响既有边界共17个不重复测试注册通过；容器真实任务、独立冷读和基础浏览器按镜像分版通过。默认仍 ask，未替实际安装切档；ask/auto、19be 和旧受限执行问题未恢复实施。长期 SG11/SG12 仍 ACTIVE，R44 FAIL 和旧 unknown 现场不改判、不删除。

本轮没有真实渠道发送、GitHub业务或厂商模型调用；模型为本地脚本/HTTP fixture，token用假值只比较boolean/hash。没有合并、部署或触发CI。默认entrypoint --check单独通过；实际容器业务走direct Host夹具，不宣称默认run常驻启动全链已验。

## 实际版本

受验为HEAD ca7bd0276ba4664a8614ce69fde47956f8c99f7e加未提交协作工作树，不能仅用HEAD代表。七生产源各实际批次稳定，最终容器冷读逐项核回；交付提交保存这些字节，提交/远端事实另由唯一goal回填。

| 文件 | SHA256 |
| --- | --- |
| `src/native-tools.js` | `0d8829c3713998b95b0f68fb224106d5cc1db1a9091c3e670dd19e8d013370c8` |
| `src/tool-permissions.js` | `a6fde5d9324fef25bc377f1c21f2fa9941efd25723aa5b3e2e295e63e54fc02b` |
| `src/native-working-directory.js` | `7d055ae7cc8aef5f0db39f7a853713948cf95d53a438b716b2386442f74d63cd` |
| `src/memory/private-fs.js` | `8b9bf149541e04204cc17e58dcce0b904d52b1045fe3ede9bd4ae550a7b6f621` |
| `src/memory/privacy.js` | `355243dd61e829d3c3e3ce1c2eda6f5abcf2282e16141d2232c9f9805ce48151` |
| `src/runtime/portable.js` | `53ed51fe3b2066bb7b71ef37495df86f7b164b60f753caff165e053f6087e96d` |
| `src/runtime/pi-business-path-bindings.js` | `51cfd71b714a0452a1ce7613dc1f26ed5b5528acf40a361f5616d3a2ed0ef276` |
| `Dockerfile` | `03fd3aeb1a2b339e5c1262b1acabdb69c56b469434415fa8f90719d99dd51318` |
| `package.json` | `810c075c2780b48f9cface408c9b4970a6c3299d5de99cec5f1c3d3055bbeb68` |
| `pnpm-lock.yaml` | `ba269662dcca351301db4a1cb12e8d4900a149ffce1212420beb745cab601e91` |

## 基线与修复

- bwe0v1ixj真实默认task基线自然1、0PASS/1FAIL：初始化ready、work/tmp成功；外部write为PERMISSION_CALL_UNBOUND，目标实际ENOENT。task completed/drained不抵业务失败。原materials edit/write仍拒绝、原文未变，未将静态full早退说成旧版动态可达漏洞。
- execute waterfall原在permission ALS外，single-session preflight看不到已准入exec。现仅将原waterfall纳入原ALS，不提前started、不松actor/call/参数/epoch；绑定修复会使full grant实际可达，故同步将canonical taskRoot的Host-owned写门置于full早退前，final fresh resolve仍复核。work/tmp和外部业务可写。
- b5cqvb7v3定位基线自然1、0PASS/2FAIL：cd为独立actor定位，首错NIGHT_WORK_OUTSIDE_INSTALL_ROOT；token本来就是真实task，githubTokenMatches=false。未冒称两项都是task cd。working_directory现按真实cd参数授权；官方prompt无工具exec的当前cwd存在性检查走窄Host metadata口，绑定live官方actor、精确cwd和取消/generation，不发业务read/list/write grant。
- 仅directory/changed增加external-absolute显式绑定，payload与标记原值严格相同；不随安装搬迁、不复制外部文件、不授权限。通用encode/header/domain/artifact保持原严格边界，运行时与离线维护共用strict decoder。全局放宽encode或未标记绝对路径兜底两案均排除。
- GITHUB_TOKEN仅从可信process环境，在绑定full bash/pwsh最终spawn边界注入；grep无额外注入、全局scrub未放宽。不进镜像ARG/ENV、配置、工具参数或Job描述。子孙按普通env继承；Linux私有单次launch文件短暂含env，消费后unlink。daemon可读容器env，主动echo仍可能进结果/Pi/spill，未承诺全面脱敏。
- 未新增full初始化分流、ACL算法、schema、业务owner或调度器，未改ask/auto。生命周期验证未发现需要另改生产的问题。

## Windows与严格持久边界

准确argv、UTC、TAP和source起止集合见链接原输出。均Node/包装自然0、0FAIL/CANCEL/SKIP、stderr空，分批分版，不拼为最终测试文件一次全跑。

| 最终有效覆盖 | 原运行、版本与结果 | 证据 |
| --- | --- | --- |
| 真实默认task文件/cd/材料最终目标；另task可信token | blr5aqt1d，04:16:28.968335–04:17:12.424003Z，2PASS；test57b0820e/fixture1a4988dc，492源聚合0238d7b5ce426fbc9392eee617a5328a8c5392edcade1cc67589c00791695ca2 | [任务](round-45/windows-task.txt) |
| 真write已commit但render单次故障的unknown冷恢复；staged-fsync取消及full→ask epoch | b6umjczmb原4PASS中的3项，04:20:19.652633–04:21:01.461727Z；testfa851b41/fixture1a4988dc，492聚合c459e8e40460281f85555a50400b061b598f514565d8aca00937b3722a6903a2 | [生命周期](round-45/windows-lifecycle.txt) |
| 真实运行中模型abort、父/子/孙终止、Job结算及冷不重启 | b4g5xog6x，04:27:38.647801–04:27:51.419482Z，1PASS；testf7326d51/fixtureec683ac7，492聚合2f7354350e6487355eb63a194994fb36f8bd9bcf3650ac591c04c68e6e3803a5 | [最终取消](round-45/windows-cancel-abort.txt) |
| 新full外部cwd真实backup/restore冷读 + 既有cwd4/portable3/maintenance3 | baec3wj1a，04:23:46.935320–04:24:11.364153Z，11PASS；testd29e8406/fixture1a4988dc，495聚合cc8b8504de9b28588d2fd70988f6d07b85d47d3e848e5fcf0694d343ea827bac | [严格路径回归](round-45/portable-maintenance.txt) |

2+3+1+11=17个不重复注册，其中7个新增full、10个既有受影响回归。16步真实task验证work/tmp/external物理内容；own/foreign材料direct及真实Windows junction最终目标拒写、原文保持；外部cd后relative write、grep Found1、pwsh实际cwd与回task成功，正式task_result已commit且completed/drained。独立token task的githubTokenMatches/otherSecretAbsent均true，Pi/请求/Job无sentinel。

原b6取消项在join前手动释放模型hold，只作为进程/Job部分证据，不作完整模型取消证明。Review指出后fixture透传真实callOptions.signal，b4先证明第二模型请求pending且未abort，正常cancel/join前不release，真实signal结束等待，pendingModelAborted=true。三PID均ESRCH、Job registered1/settled1/producerReported、task cancelled/drained、迟到效果缺席，cold无模型/producer重启；只重跑此项，旧另3项保持。

unknown场景物理文件已提交、intent1/result0、内容/mtime不变，coldModelCalls0且unknown保留；不取消/伪结算/清场重跑。staging两项用独立actor，真实write/sync后持点，取消或切档后目标及临时文件均缺席，不冒称默认task。外部cwd用现有backupData/restoreData到另一安装根，Pi原bytes/entries、外部绝对引用和外部文件保持；非directory伪external标记拒绝。既有10项覆盖canonical/归属/取消/owner退休/官方prompt、未标记迁移拒绝、伪缺sidecar、未提交尾/篡改/错误header与显式codec。

最终两测试源：approval f7326d51c7a3c3e44ef863ef644c297f131d2e53f1aa63433f37a92b35d26f93，fixture ec683ac7d3e36c39eac7a9da1219e26edaad71465c5fb79401edba0577958d37。早期注册和最终来源的精确前缀/差量复核、原工具ID及完整原始SHA见[阶段末审查](review.md)第2265行起；不把旧证据改绑成最终全文版本重跑。

## 容器实跑与限制

- 基础工具/浏览器镜像e367：sha256:e3677dda58c04eb6c1320e58afe6e7c41dcd96122926fb90b146038b4aebcfa9。默认entrypoint --check真实通过；b0k3edfu4核git2.39.5、gh2.23.0、Playwright1.65.0，gh fixture auth内存比对true；UID1000/cap0/NNP/seccomp/temp0700。[工具输出](round-45/container-binaries.txt)。
- bpb9s3wud浏览器：04:10:05.182979–04:10:07.102107Z，自然0。Chromium158.0.8127.18访问localhost HTTP，JS=42、DOM断言；PATH CLI再次访问截图，共2请求。API/CLI两PNG同10466B/SHA256=05d5baeceeb1a77baa8300a35c6299305d08b185db264cd8ed065900d0e1996b，Main亲看，保留本地ignored[唯一图](round-45/browser.png)，不入Git。[浏览器实证](round-45/container-browser.txt)。
- 最终七源镜像e1a：sha256:e1a5708cb8934ae40eac0763b68617fce7d1b2fe43edd43e64bbd755c7a649fa。ba1bysr2f最终构建自然0，501个明示tracked inputs起止聚合ec9547769b215b576d3b1456010b5f2df6348f333523215cc0f8d5df897406bb。Playwright安装#24 CACHED；两镜像24层的前16层相同，浏览器未在e1a重跑，不冒称同版。可变tag night-bot:sg11-full-tools-03fd3aeb当前指e1a。[构建](round-45/container-build.txt)。
- bifysjlf6：04:41:55.254962–04:41:59.753884Z，自然0。e1a恢复原无副作用准备失败task，两次本地HTTP，真实bash/task_result成功，alerts=[]/error=null；githubTokenMatches/otherSecretAbsent/ghFixtureMatches全true，completed/drained，Pi/请求/Job无sentinel。[真实task](round-45/container-task.txt)。
- bk8qgegn0：04:43:43.935483–04:43:46.826104Z，自然0。独立readNative与SQLite只读SELECT：bash非error/exit0、Job registered1/settled1/completed/producerReported、task completed/drained、三bool及镜像七SHA等候选。不recover、不再调用模型/工具。[冷读](round-45/container-cold.txt)。保留实际SQLite ExperimentalWarning，不称空stderr。

均保持非root、network none、cap-drop ALL、NNP、只读根、固定seccomp和专属data卷，无privileged、Docker socket、ipc=host或宿主业务挂载。Playwright默认chromiumSandbox=false/--no-sandbox，文档明确披露；父容器边界不等于浏览器内部sandbox或full应用工作区围栏。

首轮构建b2srfcsll在Debian HTTPS握手失败、未到工具安装，自然1；按既有runbook公开TUNA HTTPS build args后成功，未关TLS/验签。容器内联脚本先有转义错误；direct Host夹具漏initialize:true得DYNAMIC_STORE_MISSING；补后HTTP0、UNSUPPORTED_REASONING_EFFORT，最终对照既有fixture补off/low声明后恢复原无副作用task取得结果。准备失败保留，不说生产或sandbox失败，不重放未知副作用。

## 守卫、审查与清理

[pnpm check原输出](round-45/source-guards.txt) bx3g5nqk1自然0：190 retained/10 retired/3 excluded/57 adapted；395 production files/193 bare imports；395 runtimeJS/externalSDK0/legacyDefinitions0/verified2/removed9。冻结安装通过、allowBuilds不变、entrypoint未改。该守卫调用无独立源码起止pin，不补造SOURCE_CHANGED=[]；七源由实际测试和镜像冷读另绑定。阶段末窄审已追加review.md:2265，无新增本增量阻断。

Tests对本次4个确切已停容器及专属volume先同参--check后非force删除，再独立核缺席；Main另只读核volume缺席、无容器引用。最终镜像保留。截图先同脚本check(effects0)再run，保一张final、删两张tmp及本脚本，Main独立核10466B/hash、ignore、原件/脚本缺席。新故障注入unknown档案和旧现场保留。公开文本仅必要本机路径脱敏、截图help或重复seccomp投影，变换与原始SHA各在文本头声明，不改业务结果。

## 再生成与未验边界

构建与容器加固参数按docs/ops/docker-deployment.md；公开源参数为DEBIAN_ARCHIVE_URL=https://mirrors.tuna.tsinghua.edu.cn/debian、DEBIAN_SECURITY_URL=https://mirrors.tuna.tsinghua.edu.cn/debian-security。浏览器从业务work cwd导入/opt/night-bot/node_modules/playwright/index.mjs，启动chromium访问本地HTTP页、断言DOM/JS并截图后关闭；PATH命令为playwright screenshot --browser chromium <已授权可达URL> ./page.png。精确本轮两请求、PNG字节与生成命令保留在浏览器结果；仅版本输出不算浏览通过。

不覆盖默认ask/auto containment、Linux strong-owner全部后代/macOS、全部工具/插件、公网厂商集成和默认run常驻全链，不抵扣R44。full为执行环境OS账号权限，不管理员提权、不保证同账号Host文件OS隔离；Native FS的Host-owned语义门不限制full shell直接OS访问。external-absolute是新显式审计变体，旧代码会拒读，回退须匹配代码与离线数据，不能删标记或改Pi字节。验收索引在matrix.csv的round_45及test-case-inventory.csv；本轮工程已闭，Git交付事实由唯一goal记录。

Git交付前独立核31个index blob逐项等工作文件。默认diff --cached --check把保留原TAP/工具输出的CRLF标为行尾空白；仅以本次命令临时core.whitespace=cr-at-eol复核自然0，未改原证据字节或永久Git配置。矩阵历史全部字段逐项保持，库存17项证据文件SHA/准确PASS行逐项核同，私有技能/运行数据/截图未暂存。
