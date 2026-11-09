# 第46轮：Web 新增与编辑钉钉渠道

## 结论与范围

新增/编辑实现与约定代码验证已完成：运行 Host 锁内保存、无需填写 profile、固定账号/渠道标识、完整字段编辑、版本冲突与未知回执只读核对、同身份保水位及新身份隔离。最终编辑4项、相关回归5项、浏览器15项、Web server19项均通过；三源码守卫通过。不是同版全量测试，准确分版见下表。

真实本地指定测试群已正常冷启并确认 listening/connected/liveApplied，原首次监听下界保持、full 未改变、外发关闭。真实名称/职责单次PATCH保存并正常IPC重启应用已通过。用户随后刷新原授权模型凭据；单次Pi真实推理返回预期文本，旧401不改判。服务已正常重启加载新凭据，未重发原消息，也不以模型连通性代替Web消息回复或渠道发送验收。

本轮无真实群/私聊发送、CI、合并、正式部署；未改其它安装、账号默认值或系统安全策略。真实私聊只读接入没有执行，群→私聊身份切换仅隔离 Host/fake DWS 验证。ask/auto、19be、R44 FAIL及旧unknown保留，长期目标仍ACTIVE，不生成总体全绿report。

## 实际版本与取舍

受验分支 `worktree-resident-conversation-routing`，HEAD `2db2aa7c27c9f1ced506de7740c6aac4b757119c` 加未提交协作工作树。各批源/测试/资产SHA以原件成对pin为准，不能仅用HEAD代表。受验源码已保存到代码提交6145f9483d76e7fa1f5a9d91da3af9154b156ead并独立核远端一致；随后仅文档回填交付事实，与受验代码分开，不为文档自身SHA循环提交。验收前已fetch目标分支，base `eca0df5ed127d8b043ba087291bfb1426d0ca5d6` 在HEAD内，无整合需求；PR2当时OPEN/mergedAt=null/MERGEABLE。

原渠道页只读，离线CLI需安装锁；Web不spawn离线CLI或绕锁。编辑采用既有决策快照 [Web渠道配置决定](../../spec/web-dingtalk-channel-create.md)：直接改row会混binding/游标；只允许名称/职责不能满足完整目标编辑；最终固定channelId/canonical账号，按真实身份隔离并在保存/cold双查旧依赖。没有删除、热加载、外发授权入口、schema变更或新调度器。唯一UI合同仍为根DESIGN.md。

| 关键实现 | 行为 |
| --- | --- |
| `src/host.js:65`、`src/host.js:143` | 专用白名单GET/PATCH、canonical账号、CAS、原安装锁和配置调用排空 |
| `src/channels/plugins/dingtalk-storage.js:26` | 真实缺席与损坏binding严格区分；同身份保水位、新身份独立namespace，旧记录不删不迁 |
| `packages/dingtalk-core/task-session-service.js:1707`、`src/channels/service.js:39` | 短hold跨旧任务/来源/Router/投递/提醒/在途检查与绑定发布；提交前scope重核 |
| `packages/dingtalk-core/platform-schedule.js:39`、`packages/dingtalk-core/store.js:659` | 原调度链按group在途与未settled耐久枚举，不漏native建立前半提交提醒 |
| `packages/web-console/server/views.js:79`、`packages/web-console/src/ChannelsPage.tsx:23` | 保存、运行版本和binding激活分别表达；unknown不自动重发，冲突显式重载，IME与迟到认证回执隔离 |
| `src/channels/plugins/dingtalk-binding.js:41`、`src/channels/router-lifecycle.js:25` | 真实CLI叶子结构校验；Router只过滤本次精确native取消，保join/持久化失败 |

## 实跑结果

原命令、完整输出、时间及pin集中在下列证据，不复制第二份流水账。库存当前5515数据行/22字段，本轮新增23个AST身份，旧5492身份/registration hash保留；68个逐case PASS是各版本证据映射，包含重跑/旧注册，不能相加为当前同版全图通过。

| 范围 | 原件与结果 | 实际证明和限制 |
| --- | --- | --- |
| 最终Host编辑 | [host-channel-edit.txt](round-46/host-channel-edit.txt):207，bnqqq7wnn，`node --test test/pi-channel-edit.test.js`，4PASS/0FAIL/CANCEL/SKIP，自然0，73.778s；17源成对稳定 | 真实Host/HTTP/SQLite/配置锁；白名单/CAS/unknown、metadata零厂商IO、同身份水位、新身份隔离、双门禁、真实准入race、提醒、未绑定纠错、坏binding拒绝。模型及厂商IO为fixture |
| 最终既有回归 | [host-channels.txt](round-46/host-channels.txt):791，bxyrkvzl4，5PASS/自然0，78.902s；22源成对稳定 | 默认无渠道组合、永久unknown冷恢复、真实Pi精确native取消、平台actual due的superseded两分支。不是全量runtime/routing |
| 最终浏览器 | [browser-channels-edit.txt](round-46/browser-channels-edit.txt)，bra9eff8x，15PASS/自然0，47.8s；29输入/3资产成对稳定 | 真实浏览器/生产HTTP鉴权、字段/IME、双页CAS、断线回查、认证换代、390px浅深色及局部axe AA；不加载Host/taskservice/Router/storage或真实DWS |
| Web server回归 | [host-channel-edit.txt](round-46/host-channel-edit.txt)内b4ijlhitg，19PASS/自然0，2.081s | 新DTO断言修正后实际执行，当前test cebb80fc；无独立成对pin，不用旧05ae结果追认新断言 |
| 前端构建 | [web-build.txt](round-46/web-build.txt)，实际tsc --noEmit和Vite构建完成 | 构建没有独立起始pin，不补造；最终浏览器实际绑定产物JS2252d5f3/CSSac983620/HTMLd15a3185 |
| 最终源码守卫 | [source-guards-final.txt](round-46/source-guards-final.txt)末节complete channel-edit，三个EXIT0，31输入前后稳定 | 190 retained/10 retired/57 adapted；395 production/193 bare imports；外部SDK0、旧编排定义0。三个derived entry只更新既有sha/adaptation，保上游hash/notices |
| 真实解析与监听 | [real-channel-resolve.txt](round-46/real-channel-resolve.txt)、后述真实验收 | 同saved账号只读完整解析PASS且config/binding/ingress未写；最终冷启observe另行证明实际监听，二者不互代 |

阶段末窄审 [review.md:2320](review.md#r46-web新增与编辑钉钉渠道阶段末窄审2026-11-09) 已独立核最终17源、四项及追加五项原件，未发现受审增量剩余确认问题；不把“未发现”扩大为全系统无缺陷。源码未改后不重复build/测试。

## 失败、修复与未收敛项

- 首次真实冷启确为error/CHANNEL_ADAPTER_ERROR、binding与consumer缺席，原FAIL见[real-channel-observe-failed.txt](round-46/real-channel-observe-failed.txt)。先修contact成功envelope的data.count/users，再修conversation-info的success/result.conversationInfo，两精确叶子按真实CLI1.0.63返回和精确schema验证，不全局unwrap、不保旧裸fixture回退；原解析失败与结构证据保留。
- runner超时原先发送终止请求即拒绝，Host可能过早释放锁；现在等待真实child/pipe close。原超时测试2PASS/1FAIL、一次cancelled保留，最终真实受控进程单项1PASS证明PID活时调用/Host未结算，退出后锁释放、配置/水位未写，原超时原因保留。
- Router关闭曾把其本次interrupt引发的Pi native signal.reason作为失败。真实prepare红回归明确精确reason身份后，只在Router running组过滤本次false→true的reason；factory不改，PAUSED/join/持久化异常仍失败。原bo036为6PASS/1FAIL，unknown更早水位等待超时；bs3单项和最终五项通过，但旧水位超时未复现/根因未收敛，不能反推“水位bug已修”或猜EPERM。
- 编辑真实race暴露成功Web动作漏source.routed，按原冻结operation/来源稳定标记修复；retryMessage跨await的source.acceptHistory纳入提交前scope guard。旧结果/drained仍放行，未放宽未决门禁。原夹具改冻结query失败的3PASS/1FAIL如实保留。
- 新增后错目标未绑定不能要求旧resolve成功才能纠正。采用首次独立身份、固定账号/外发false、channel全scope门禁；hold含候选新目标新业务。损坏null文件红回归原为期望INVALID却实际SWITCH_BLOCKED，修后shared strict read覆盖Host/cold/历史枚举，原四注册验证null/false/0/[]/{}与cold错inline拒绝不覆盖，结清旧依赖后才真实cold激活。
- 浏览器两次准备问题（grep未选中；pnpm.CMD管道/编码）保留为准备失败，不冒称产品FAIL或PASS；修准确调用后最终15通过。源行尾和Host真实NUL已在唯一写者责任内修复，最终源NUL0/LF、strict源码diffcheck通过。原始输出包含CRLF及失败diff空白行，归档字节不改，证据diffcheck只对该原始格式临时排除行尾空白，不修改Git全局配置。

## 真实本地验收

仅本任务独立ignored安装和指定测试群；core19198/Web3082，其它实例不动。新增已通过正式Web单次POST保存，未再新增同群；首次真实cold FAIL保留，随后最终受验源正常IPC冷启。

- 旧后台bzcy8e5sc正常IPC自然0，三PID与metadata独立核缺席；新bnr8kne69的service45872下仅一个+listen-im PID102068。CIM只查该进程树，--kind=group、群target及canonical账号比较全true，不打印原值；同saved profile event status按该PID关联，不操作共享bus的其它consumer。[生命周期与归属](round-46/local-service-lifecycle.txt)。
- 最终observe bdh6edf0n自然0/5.1s，16输入无漂移，生产Web listing显示listening/connected/liveApplied=true、保存/运行版本相等；耐久binding账号/群/类型/actor匹配，firstStartedAt仍2026-11-09T06:30:40.490Z，full/writesfalse，POST0/无消息发送。
- 本地metadata编辑 bphzyxo4t，2026-11-09 17:28:20–17:28:23+08:00：唯一PATCH1/POST0、明确200，完整配置读盘只差约定name/prompt；binding/完整ingress原字节未变。saved为cd1c670b、running为8d5595b2，pending-restart/liveApplied=false准确保留。见[real-channel-edit.txt](round-46/real-channel-edit.txt)。
- 编辑后正常IPC停旧实例，bnr8kne69自然exit0，旧supervisor/launcher/service/consumer及metadata均独立核缺席。相同allowlist先--check后--run后台bubg74ujb：supervisor78128/launcher6616/service16076，唯一直属DWS consumer107932；Main独立CIM与保存配置内存比较group/目标/账号全真，不输出原值。
- 最后只读bio48b78s，2026-11-09 17:38:30–17:38:34+08:00：observe/subscription双自然0，16输入稳定，POST0/PATCH0；savedVersion=runningVersion=cd1c670bb205b9d2affb1486448fd88271a8aecfc81d99ac7209c9097921f133，listening/connected/liveApplied=true、restartRequired=false、promptConfigured=true。binding身份和firstStartedAt保持2026-11-09T06:30:40.490Z（14:30:40.490+08:00），full/system/目标/listen/writesfalse不变。
- 同saved profile只读status关联PID107932到唯一active订阅，profile两身份/source/event匹配，received0/dropped0。status不返回群规则，该部分由Main独立CIM证明。完整原件[real-channel-edited-observe.txt](round-46/real-channel-edited-observe.txt)，4869B/SHA256 acb2e09af45d1c89bbb743ab4f37639762f4e010377d21b8b23421a4e73591e4。Main全文回读并亲看最终界面；这只证明指定群配置/绑定/订阅与冷启激活。

用户随后明确“重试下模型凭据，我刚更新”。2026-11-09 17:46:37.532–17:46:40.755+08:00沿原授权来源、原模型/endpoint，用项目现有Pi provider执行单次无工具推理，stopReason=stop、精确预期文本匹配、无错误、秘密源字节保持，真实401阻断已解除。没有寻找其它账号或来源，没有重发原accepted消息；旧消息未取得新增回复验收，TRIAGE_NO_DISPOSITION不清理。见[model-credential-retry.txt](round-46/model-credential-retry.txt)。

为加载新凭据，bubg74ujb正常IPC退出0且四PID/metadata独立核缺席；同allowlist先--check后--run后台bgdl2dc0h，supervisor51584/launcher98852/service66600/consumer62272。独立CIM与认证生产Web GET确认账号/目标匹配、HTTP200、保存/运行同cd1c670b、listening/connected/liveApplied=true、职责已配置、full/writesfalse。该后台和安装保留供用户查看，不增加消息重试或外发。

## 归档与清理

本轮所有文字FAIL/PASS及matrix历史保留。旧候选/前批浅深截图已由最终browser-channels-edit五图替代，前批文字结果不变；最终真实截图只保留edit-pending（72311B/882e1247）和edited-connected（71588B/17fb7307）两图，PNG ignored且未跟踪。Tests先--check再精确清理verify-web-channel.mjs、旧real-night-bot-test-pending.png及real-night-bot-test-connected.png，Main独立核缺席；旧证据内附件引用仅代表当时状态，附件已清理，原文字结果保留。一次性模型helper同样在归档后清理；实际运行supervisor仍参与用户预览，不清理。config、凭据、绑定、SQL/Pi及私有Skill/业务材料均不入Git。

本轮实现、约定验证、清理与Git交付已完成；代码提交6145f9483d76e7fa1f5a9d91da3af9154b156ead带[skip ci]，已推原功能分支并更新原PR2。独立gh回读number2/OPEN/mergedAt=null/MERGEABLE，base refactor/pi-native-retirement←head worktree-resident-conversation-routing，远端头精确匹配且正文逐字等已检查文件，代码提交Actions run数0/statusCheckRollup为空。矩阵344行/新增16场景及round_46列，原328行历史列逐字节保持；真实模型首错保FAIL、用户更新后单次推理另列PASS，不追认消息回复。最终交付事实集中于唯一goal；无CI/merge/deploy/真实发送，本轮不再追加工作。
