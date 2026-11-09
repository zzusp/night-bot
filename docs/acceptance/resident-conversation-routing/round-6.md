# 第六轮：指定群真实闭环与必要修复

## 范围与结论

- 本轮对应唯一 [goal.md](goal.md) 的 SG9。结论为 **BLOCKED_ORIGINAL_OWNER_DRAIN_PROOF_MISSING**；本地根因修复的定向验证已完成，不代表真实闭环通过。SG8 及第1–5轮历史保持，不跑全量，不将分批结果合称同版全绿。
- 真人消息已由真实平台接入并持久化，分诊和 Router 创建唯一事项；首次执行 `find` 留下未知效果，未完成文件、群内文本/附件、持久复盘或回声验收。原请求不再等待真人输入，不能要求重发或另建任务。
- 原实例经正式 IPC 停机，自然 exit 1；三个原进程不存在、19298 无监听已独立核过。停机已落实，正常业务排空未获证明。修复后没有重启现场、重放调用或新建业务实例。
- 严格完整解码确认原 session 没有 `owner-drained` / `owner-drained-inputs`；现有正式效果核对必须有覆盖原意图的真实 producer 排空证明。新空 registry、PID 已消失、冷恢复 SQL drained 或新只读 marker 都不能补成旧证明。原 source/task/session/unknown 完整保留，不删账、不直接改状态、不伪造 receipt。

## 授权、身份与隔离

- Tests 是唯一真实执行者；只使用明确指定 profile、本 worktree 的专用实例和 Night Bot Test 群。未操作其他安装、群、私聊、全局账号或生产；未提交、push、合并、部署或触发 CI。Git/原 PR 由 Lead 整合。
- 对原 profile 实际执行 `contact user get-self`；正式身份等值核验使用同 profile `auth status --readonly`，userId/corpId 严格一致。使用返回的自身完整名字 aisearch，再按该 userId 唯一匹配 openDingTalkId，与群成员原生 openDingtalkId 等值。成员完整读取用户 1 / 机器人 1，complete=true、hasMore=false、failedCount=0。未从后缀、群主或展示名猜身份。
- 首次成员投影漏了原生大小写不同的 openDingtalkId，第二次只读查询修正投影；memberDingtalkId 与企业 userId 不等，未混用。更早普通 auth status 不追认为零写 readonly 核验。
- 唯一配置为 Git 忽略的 `data/workspaces/resident-router-sg8-instance/data/secrets/config.json`。具体 profile、群、平台身份和连接信息不入 Git。owner/Web 为原生 channel principal，assistant 为已核平台 openId；仅一个群，enabled/listen/writesAuthorized=true，directChats/operatorNotifications=false。
- ingressEpoch 为 `2026-11-06T17:57:44.948Z`（2026-11-07 01:57:44+08:00），未倒退。Windows system 模式复用系统保护的 DWS 登录，不宣称独立应用数据等于独立第三方账号；没有复制登录或切全局 profile。
- 模型仅从唯一获授权 ai_api.yml 读取必要连接；密钥只在进程内读取并以环境引用传入，没有写入配置、参数、文档、业务消息或 Git。原实例日志密钥扫描为 false；没有读取邻接秘密。后续修复验证仅为 loopback 脚本模型/本地 fixture，没有新真实模型或 DWS 调用。

## 真实监听、来源与首次执行

- 入口 `scripts/live-channel-instance.mjs` 沿真实 `bin/night-bot-run.js` 启动；只补可信 Host 的只读 health/工具结果观测及 Windows launcher IPC，不替换渠道、工具、模型或业务结果。首次入口 SHA 为 `5c94a4a58820ba52c37d4ab41caddb8c7bcb1f9bd89d450f3e1807aaa1d28844`。
- 首次运行绑定 HEAD `d27350972df888bf864186eabe64513c12460382` 加未提交工作树。原九项生产/公开配置与第五轮同指纹，另加该入口共十项起止稳定；不是只用 HEAD 代表受验代码。之后才交还 Core 修复写权。
- node --check、diff whitespace 与零副作用 --check 通过；自检为 effects=0 / identity=verified / groups=1 / credentialRead=false / network=false。配置落盘后另进程 loadConfig/范围回读与 Git 忽略已核。
- 2026-11-07 02:00:16+08:00：HTTP 19298 health=200/status ok/modelMode real/recoveryIssueCount 0；实际插件 listener=ready（01:59:44+08:00），backfill=ok（02:00:14+08:00），仅一个群，真人输入前 tools=0/errors=0。HTTP healthy 没有代替 SDK ready。
- 真人请求 marker 为 `SG9-LIVE-20261107-01`，要求创建 `sg9-live-check.txt`、写入两项指定内容并读回，在本群说明结果和附件交付。平台消息时间为 02:40:00.226+08:00，实际 SDK health 的 lastEventAt 为 02:40:00.718+08:00；同群持久消息 total=1，未自发自收或注入冒充真人。
- 唯一 taskId 为 `sg9-live-20261107-01`，唯一执行 session 为 `task-session-405bdad6-5215-4b76-a879-073a46d93d88`。来源 version=1，sourceId SHA 为 `89fca6bfa74a027337409a9ab55d7aaac690b3e8fd8ae9d0d685ced4b82ba5fb`，messageId SHA 为 `e3d7844bb2bada750e378bfba840876a9c2f52913c5e2245aa48620ab2fb1a1c`。
- 原平台接入后，02:40:13–29+08:00 实际依次成功执行 channel_triage_submit、resident_task_query、resident_task_plan、resident_router_settle。02:40:31.575+08:00 唯一任务的首工具为 `find({pattern:'work/sg9-live-check.txt'})`，返回 `TASK_EFFECT_UNCERTAIN_NO_REPLAY`；不是成功、未命中或完成。
- 停机时的 task.json 是派生事务快照，不是 SQLite 权威、恢复命令或重新调度输入。其 capturedAt=02:44:04.731+08:00，task active/drained=false；source.owner 与 task.owner 对齐，source.group 与 task.group 对齐，task.sourceRefs 和 source link 指向同一来源及 version=1，notifications=0、task_events=0。此投影只补已观测来源链，不回放。

## 原停机终态与正式恢复阻断

- 原后台 `b6l5gfeve`：supervisor 74016、launcher 42536、service 79160。按同入口 --check --stop 后执行 --stop，由 supervisor 给原 launcher 发送 `night-bot-shutdown` IPC；未强杀、未按进程名结束进程。
- 实际回执：SG9_STOP_CHECK_OK/effects=0、SG9_IPC_SHUTDOWN_SENT，随后 `SG9_LAUNCHER_EXIT=1; sourceStable=true; keyInPrivateLog=false`。私有 supervisor 的 closedAt=02:44:04.952+08:00、code=1、signal=null、ipcShutdownSent=true。phase=closed 只指受管进程已结束，不代表业务正常 drain。
- 原服务日志仅两行，唯一错误为 `Task service shutdown failed`；没有嵌套 errors/cause/closeObserver，因此停机最深错误证据不足，不能把 exit1 唯一归到 find 或 scope。observer 的最后 phase=running 是未执行最终 hook 的旧快照，不能用它判断仍存活。
- 对原 task Pi journal 用 `decodePiJournal(...,{codec:portablePaths(runtimePaths),requireComplete:true})` 严格读取，committedBytes=totalBytes=45111，SHA `ad7062f54993597bdc74d23a4c2b31a666d578240c3630e2fd46a7c92b5c9d15`。task 域全量仅 identity 与 find effect-intent，无 effect-result、owner-drained 或 owner-drained-inputs；最终独立复核字节和 SHA 未变。
- 实际 memory bindings 的 actor 与 task.owner 一致，binding.groupId 严格等于 metadata.memoryGroupId、不等于 business conversation groupId，channelType=chat-room。旧 scope 校验与该合同冲突；这证明旧校验对该映射会拒绝，但日志不足以追认其就是唯一 shutdown 深因。
- 已读现有 effects CLI/API 的 inspect→evidence→close→new-action。inspect 要求同 task/session/intent、完整 committed history、scope/cut 及原 owner-drained。SingleSession 在旧 unknown 时于重新创建 handle 前拒绝执行；SQL 冷恢复即便标 drained，也不生成旧 producer 证明。process ownership 的实际 provider handles 只在原进程内，现有实现没有跨进程补证能力。
- 因原证明缺失，本轮没有启动实例去撞写入口，也未执行现场 inspect/close/new-action；不把静态预期错误写成现场 API 实测。既有正式拒绝测试实际通过，见下表。恢复本事项需能验证原 producer 排空的有效证据或另行明确产品合同决定；当前授权下不能绕过 guard，所以原真实闭环保留 BLOCKED。

## 必要修复与本地实际结果

Core 单写修复：find 只在已有 private-fs 授权 regular-file 表上匹配，复用精确 minimatch@11.0.3、保留 dot/多层/基名匹配和枚举预算，不启动进程；grep 保留原进程隐私/排空边界。SingleSession 只豁免真实 native definition，不按名字扩白名单。scope 沿 Host 可信 metadata 映射，仍严格 owner/group。没有放宽 sandbox、效果收据或 no-replay。

首个 marker 修复把 preset generation scope 当作实际 actor，定向实跑发现反例；最终改为真实在册 actor + 原注册 scope 父链 + 当前 exact definition 三重匹配。现场旧 intent 不按新 marker 追认为已结算。

| 操作 ID | 范围与实际结果 | 关键耗时 / 版本 |
| --- | --- | --- |
| bh7eip84h | 搜索3条：2 PASS / 1 FAIL；自然 exit1。枚举预算、Windows grep 原 privacy 拒绝通过；find 合法匹配/隔离通过前置断言，但真实 definition+actor 的 marker 返回 false | 原 native-search `1116961b`；业务 5897.764 / 5022.9325 / 2364.7412 ms，Node 25083.4835 ms |
| bph57eyet | 4条：2 PASS / 1 FAIL / 1 CANCEL；自然 exit1，13产品+test共14项起止同。personal unknown 真实排空通过；Router room 的真实 owner-drained+inspect、foreign owner/group 拒绝及 recover 不重放通过；新增搜索用例轮询耗尽，旧创建用例30s取消 | room 18613.3146 ms、personal 7878.7814 ms、搜索 17609.3856 ms、旧创建 32499.1432 ms；Node 85742.5324 ms；test SHA `d0deaf69a6992550a7eb40e47421637228edb27375149f4eb55a84af98ab192f` |
| bzwi0jprx | 正式拒绝2条：2 PASS，自然 exit0。排空构造器拒绝 JSON 零计数，inspect 拒绝 missing owner attestation | 32.6539 / 209.1091 ms，Node 4660.7089 ms；没有现场模型或实例 |
| bhxlw9asg | 最终 marker 两条：1 PASS / 1 FAIL；自然 exit1，15项起止同。find 隐藏/多层/隔离及 copied definition、同id假actor反例通过；新增 SingleTask 仍耗尽固定轮询 | find 8490.043 ms，搜索 26801.6462 ms，Node 34299.2658 ms；native-search `729f6336`，test SHA `1aa9199e6bbb921f85b8b8c94663b12a76cdc188c22d99dddf8278eec45f1359` |
| btgj3dwfz | 仅复验新增搜索：1 PASS / 0 FAIL / 0 CANCEL / 0 SKIP，自然 exit0，五产品+test六项起止同。复用已有 service.whenIdle 等实际业务排空后，严格核 completed/drained、仅 write 一对 intent/result、实际文件读回与 personal scope=null | 16649.6467 ms，Node 23906.1219 ms；最终 test SHA 见下表 |

唯一命令入口均为 `node --test --test-name-pattern=...` 加对应现有测试文件，没有新测试框架。最终失败相关选择为 `native find matches`（pi-search-safety）与 `single task native searches`（pi-single-task）；正式拒绝选择为 `a drain receipt constructor requires` / `native reconciliation rejects missing owner attestation`（pi-task-effect-reconciliation）。各操作原宿主 output 可用上表 ID 定位，必要结论已在此自包含保留，不将完整日志/journal/业务数据复制入 Git。

- 最终 find 通过：合法文件、隐藏目录与文件、多层基名、明确相对路径、未命中、foreign task/Host sessions/symlink 拒绝；没有 subprocess，0模型请求；copied definition 与相同 id 的假 actor 都不能取得只读标记。
- Windows grep 实际原边界返回 SEARCH_FAILED，message 保留 `MEMORY_PROCESS_PRIVACY_UNAVAILABLE`，一次 spawn 请求被原隐私守卫拒绝、0模型请求。它证明共享进程路径的当前 Windows 边界，不冒称已重放或捕获首次现场 find 的底层错误。
- 最终 SingleTask 成功前确实经过 native find、非空 work 的 Windows grep 拒绝、write 和 read；搜索不留 effect-intent，只有真实 write 一对 intent/result。不是只测 marker 谓词或 mock 收据。
- 新 Router room fixture 走真实渠道接入、triage、Router plan、唯一任务及本地故障工具；business ID 与认证 memory ID 不同仍有真实 owner-drained，正式 inspect 成功；foreign actor/group 拒绝，recover 不增加效果或请求。没有真实平台发送。
- 新增搜索用例最初复用旧 `until` 的500次轮询，未观测终态即超时；最终改用已有业务 whenIdle 后仍严格断言持久终态和证据，没有增加任务时限、减少断言或改产品。两次超时保留，不能把首次与修后轮询失败追认为通过。
- 旧 `chat and chat-room task creation binds the correct memory scope without creating a coordinator` 在原 Windows 30000ms deadline 取消，原输出没有指出业务循环、whenIdle 或 teardown 的具体取消位置，原因未收敛。该例只提交 task_result 并 settle/handoff，无 find/grep/未知效果；正常 dispose 在 !uncertain 时不进入本次 readEffectScope 分支，不能把 CANCEL 判成 scope 修复已通过或已证回归。没有改旧时限、复跑旧组或抹除取消。
- Lead 的最终 `pnpm check`/whitespace 操作 `bu0ci3mxz` 已独立读原输出：自然 exit0、13/13 源码起止同；194 retained/53 adapted、404 production/runtime JS、191 declared bare imports、0 externalSDK/旧编排、source verified5/旧格式removed9。native-search 起止均 `729f6336`；较早 `bcxh7bfdl` 仅覆盖 `1116961b`，不代替最终 guard。Tests 未重复运行 guard。

## 最终受验版本与入口

环境为 Windows 11、Node 24.19.0 / pnpm 11.25.0；HEAD 仍 d273509 加共享未提交工作树。未变的其余八项沿第五轮完整 SHA：config.example、config、channels/service、dingtalk-dws、task-session-service、resident-router-business、reflection、reflection-inference；本轮15项复验及13项最终 guard 均记录了这些真实字节。变化项与本轮测试/入口如下：

| 文件 | 最终 SHA-256 |
| --- | --- |
| src/native-tool-fs-search.js | 729f6336ba0266cc6f1d2f324d4f885627673786db3e9cedc174bd3330b09b70 |
| src/tasks/single-session.js | a141811f1ecabb6ddbef2adde684e50e0920488ac513bee7a4e3804d68c1f0da |
| src/tasks/effect-scope.js | 91673a8568ecd1dcfa16cc17a76d363526c8baa92ae22b58f29198beb6afeedf |
| package.json | 4fda002d0c72c4248d343abdc94cbca8e4f9132ef5e67e796ea4b706332c41dd |
| pnpm-lock.yaml | 833f4d06c3b458679a2f7b6b8c0d32d781e2bc5b3ccd6bd8a118ea70bc20a30b |
| test/pi-search-safety.test.js | 41b31407ba2361a2629670af19cea0c1b7c4a64f6ab179fda88afc7eca49060a |
| test/pi-single-task.test.js | 557fc43b45d2ae56d3a478b149bcead8bc5cd834440ec5c0405b9cb19c29b871 |
| scripts/live-channel-instance.mjs（本验收目录下） | 7556a9d470663ae507060865a513cfa8c23e152b2179869ad998df8a5a0afeeb |

- 受管入口现在纳入 native search、effect-scope、package/lock，连原项与自身共14项；只在原实例停止后扩充。该最终入口和最终修复没有用于真实实例重启，不能把首次真实运行绑到最终版本。
- 矩阵本轮只追加 round_6 与 SG9 必要行，原62条数据行及 round_1–round_5 精确保留；旧组默认 NOT_RERUN，汇总注明真实阻断/旧取消。未创建全绿 report.md。
- 原第1–5轮报告、矩阵历史与既有最终证据保留。本轮没有另存完整日志、截图、dump、单轮fixture；本地 fixture 沿现有 teardown，后台操作均已自然终态。私有原实例、配置和未知效果档案仍为恢复所需证据，保留且不入 Git，不当作中间产物清理。

## 交接与未完成项

本地必要修复及其定向实跑已交 Core/Review/Lead；Tests 不再启动实例或重复已通过用例。原真实事项仍未 completed/drained，没有冻结文件、实际群内文本/附件回读、durable delivery receipts、同 task/event 持久 review、精确平台回声或成功冷恢复/正常排空验收。上述均保留 BLOCKED/NOT_RUN，不用 fake 或本地新事项替代。Lead 接回本报告/矩阵、独立审查及活文档后完成授权内 Git/PR 整合；SG9 总目标不得标 PASS。
