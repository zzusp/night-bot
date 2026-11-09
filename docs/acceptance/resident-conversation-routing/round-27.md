# 第 27 轮：Pi 命令复用、真实排空反例修复与 setter 前置拒绝

## 范围与版本

沿原 worktree / `worktree-resident-conversation-routing` / 原 PR，HEAD `6d79b0a0279d3f94f2d72d21f51ab1d654b0f509` 加未提交共享协作树。Tests 只修改五个原测试文件及本轮证据/库存/矩阵，不修改生产实现、goal、spec 或来源 manifest，不 Git 写入。本轮不是最终同版全库回归，SG11/SG12 仍 ACTIVE；唯一目标仍为 [goal.md](goal.md)。

实际环境是 Windows 11 x64 / Node v24.19.0 / Pi SDK 1.5.0。真实命令由默认 Host 经原工具调度、受控 shell 和 durable Job 执行；可信测试操作者显式选择 full，只写本次隔离业务目录。这证明普通 OS 账号执行链，不证明 ask/auto 的 OS 限制、管理员权限、LPAC 或 ConPTY。ask 新增拒绝/取消场景未实际启动命令。没有真实模型 API、渠道外发、CI、合并、部署、新 Native 探针、宿主策略/权限修改或旧失败现场恢复。

每批命令、Node 实际退出码、完整 sourceBefore/sourceAfter、逐名结果、原日志 hash 和最终附件映射集中在 [batch-index.json](round-27/batch-index.json)。所有十批起止 pin 相同、无源码漂移；不同批的源码/测试版本分别绑定，不能用当前文件 SHA 追认早期结果。父采集器自然 0 只表示已收集，以下 Node 1 均按失败保留。

| 批次 | Node | PASS/FAIL/SKIP | 关键受验版本（前缀；完整值见附件） | 结果 |
| --- | --- | --- | --- | --- |
| contracts-initial | 1 | 1/1/0 | bash041e / pwsh ef85 / test95b2 | 旧退出码文案断言失配 |
| contracts-fixed | 0 | 2/0/0 | bash041e / pwsh ef85 / test8e9a | 原两注册通过，含尾窗边界 |
| host-first | 1 | 2/1/0 | bash041e / jobs deee / test39bc | 真实前后台通过；持有准备时工具 body 提前结算 |
| host-fixed | 0 | 1/0/0 | bash11e0 / jobs b6ec / test39bc | 同原注册三种 hold 模式修复复验 |
| host-final | 1 | 1/1/0 | bash11e0 / jobs b6ec / test9053 | 四种 hold 模式通过；ask 未接既定 actor 撤销错误 |
| approval-final | 0 | 1/0/0 | bash11e0 / jobs b6ec / test1f03 | 精确接取消合同后，未批准/拒绝/取消均零命令效果 |
| wait-final | 0 | 4/0/0 | jobs b6ec / tests b430、8dcf | 无 timer wait、owner、abort、journal/unknown 守卫 |
| promotion-final | 0 | 1/0/0 | bash11e0 / jobs b6ec / test0846 | 显式后台与真实超时 promotion、输出游标及一次执行 |
| setter-guard-initial | 1 | 2/3/0 | ACLf5c4 / test5567 | 三个旧“未 AUTO 仍接受”预期与新前置门不符 |
| setter-guard-final | 0 | 5/0/0 | ACLf5c4 / test8a20 | 原五注册迁接前置拒绝，正向边界保留 |

另有一次测试代码换行字面量生成错误：`contracts-final` 名称对应 Node 1 / 0PASS / `SyntaxError: Invalid or unexpected token`，受验测试 SHA 前缀 `772d37bf`，没有产生业务验证。临时 JSON SHA `c740b9e7507cb347a7d1327adda4aa709ec8b43ef2dcaadd58b210e5f54b5a2d`、log SHA `a9c731b8948b0cafab007136dd6d205ea31ed3c54c43b9fd1657bd16837f44ea`；准确路径/hash/ignored/非链接零副作用自检后删除，并独立核缺席。成功证据是 `contracts-fixed`，不是按文件名猜测的 final。此处保留失败结果，原无用语法附件已清理。

## Pi 官方命令合同

原 `test/pi-native-shell-tools.test.js` 两注册不改名、不新增。调用官方 `createBashToolDefinition` / `createPowerShellToolDefinition.execute`，operations.exec 仍进入 Night 原受控 shell/Job；不启用官方默认本地 exec，不把 SDK 收集的环境交给实际 shell。

旧预期 `[exit code: 3]` 改为 Pi 1.5 的完整准确正文 `output\n[stderr]\nwarning\n\nCommand exited with code 3`，保留真实 exitCode=3、cwd、signal、executionEnv、禁 dshEnv 及 executor 单次调用断言。两工具各验证空输出、空输出非零9、2002行尾2000行、60000 ASCII 尾51200字节、18000个三字节字符尾17066字/51198字节且无替代字符，以及原 truncated/spillPath 保留。空成功正文为 `(no output)`；`piOutput` 与正文准确绑定。

[contracts-fixed.log](round-27/command-contracts-fixed.log) 原两注册 2PASS。它绑定 bash `041e8279...`；后续 bash11e0 的修改针对停机/准备错误 join，不将此旧批写成新源码全量通过。

## 默认 Host、真实失败与修复

[host-first.log](round-27/command-host-first.log) 两条实际写入分别通过：前台文件字节 `FULL_PROCESS_DONE`、exitCode0、piOutput `(no output)`；后台 ready 前不返回，ready 后 producer 仍 running，仅通过原业务 finish 文件放行后到 completed，最终文件相同。后台 DTO 没有 exitCode、exit_code 或 wall_time。

同批原取消注册将受控准备持有 120ms，超过该次 timeoutMs=40。background-abort 的 body/turn/cancel 均 pending；foreground-abort 和 preparation-timeout 的 body 已结算、Job 仍 stopping，但 turn/cancel 仍 pending。故实际证据只证明工具 body 早返，不证明 lease 已释放。finally 只放行原准备并接回原运行/取消/Job 终态，starts=0、业务文件缺席，没有停止 Host 或手动放模型 hold 代替排空。

产品负责人修复共用 bash stop：kill 后 `jobs.wait(id, undefined, owner)` 等真实耐久终态再 remove；NativeJobs 只对 undefined timeout 不设 timer，保原有限参数验证。后台 ready.error 同样先 join 同一 Job 的真实终态并 remove，再抛原准备错误。

host-fixed 同一 test39bc 原注册三模式 1PASS。随后 [host-final.log](round-27/command-host-final.log) 的 test9053 增加 background-prepare-error：真实 receipts 的 settled commit 被持有时 body/turn/cancel 均未结算；放行原 commit 后原准备错误保留、Job 移除。四模式完整注册 PASS；该批 ask 注册 FAIL 不能被这一个 PASS 覆盖。

## ask 取消合同与真实超时 promotion

ask 原注册先出现 `PI_OFFICIAL_ACTOR_NOT_LIVE`，来自 OfficialAgentFactory 预建 cancellationError：cancel 后 active() 继续访问就抛同一撤销错误。它不证明命令 producer 执行失败。测试只在 decision=cancel 且准确同 code 时接回；其它错误仍失败，不改产品 guard。原 write/read/edit、批准和拒绝断言保留，增加真实 pwsh 参数的 permission_scope、actor/toolName/command/不同 callId 绑定：pending、operator reject、actor cancel 三阶段实际 shell.execute 均0、业务文件始终 `untouched`，请求终态分别 rejected/cancelled。

[approval-final.log](round-27/command-approval-final.log) 绑定 test `1f03a5a697b0348eb4e0fa59597637a16366b0e659b46caae91df24c6e950151`，1PASS。之后 approval-wire 因后台场景增量变为 `0846e9626a10af63587f066cd9f85bd4f9e35646efb83ed0dfa8fade79300e76`，不追认该新文件整组已验。

[promotion-final.log](round-27/command-promotion-final.log) 沿原后台注册、真实默认 Host 执行；timeoutMs=3000，命令等自己的业务 gate。工具返回 kind=promoted，不伪造 exitCode/exit_code，原 Job 仍 running、effect 尚不存在。只放行原 gate 后 `jobs.wait(undefined, owner)` 到 completed。两次真实 `job_output` 分别为 `PROMOTED_OUTPUT` 和 `(no new output)`；最终 effect 精确 `PROMOTED_ONCE`，同 Job 的 registered/settled receipts 各1。原显式后台正常终态同注册仍通过；这是一次 producer 和输出游标证据，不是重新执行命令读取结果。

## 无 timer wait 与 unknown 保留

[wait-final.log](round-27/command-wait-final.log) 精确四个原注册 4PASS：

- `native jobs wait abort detaches without cancelling producer`：undefined 同步调用不创建 timer；有限1000创建原 timer；事件循环一次后仍未结算。abort 只脱等待不杀 producer；有限2ms仍返回 running；null/0/-1/NaN/Infinity 仍拒绝，undefined 最后仅在原 done 后 completed。
- `owned job ids enforce session access and owner disposal drains production`：undefined wait 不绕 owner；错误 owner 仍拒绝。
- `throwing teardown cancellation reports orphan uncertainty and never replays producer`：undefined wait 可以返回 failed，但 producer 未 done / drainUncertain 时 remove 仍拒绝 `NIGHT_JOB_PRODUCER_DRAIN_UNCERTAIN` 并保记录。terminal 状态不能替代真实排空。
- `official job terminal commit failure keeps outcome uncertain and never publishes success`：实际官方 session/local journal 的 commit 失败后，已挂和后续 undefined wait 都拒绝 `NIGHT_JOB_JOURNAL_UNCERTAIN`，remove 仍拒绝、状态 stopping，不发布成功或 replay producer。

## setter 安全门：只证明改动前拒绝

Core 在原冻结责任层加 `assertFileSetterBaseline`：DACL 必须 AUTO_INHERITED0x400 且无 REQ0x100；label 必须 AUTO_INHERITED0x800 且无 REQ0x200。覆盖 scoped access/label/release 与 owned file-kind1；不清实际 control，不改完整比较器，不由文件反例推广 registry。

[setter-guard-real-input.json](round-27/setter-guard-real-input.json) 用第26轮真实 originalObjects 离线输入生产冻结器：原 raw SHA `896664128bf13f9995d142ea2b6f07e7cd02b54333adaa0b70880b53d5901496`；三个原 control 为0x9804/0x8804/0x8804；inheritanceCalls=0、nativeCalls=0、输入字节不变。只读取已存在 ignored raw，不加载 Native API，不接触真实失败目录。legacyTreeSupported=false，restorationProved=false。

[setter-guard-final.log](round-27/setter-guard-final.log) 原五注册 5PASS；此前2PASS/3FAIL是旧预期仍接受未 AUTO 树。迁接后在继承 callback 前拒绝，保稳定 AUTO 正向、共享两 SID 完整回收、不相关 ACE、防 protected 传播、组件独立和 Low 非 label 字段断言。DACL 稳定0x8414/0x8c14、label 稳定0x8804/0x8c04均按实际组件判断，不要求无关组件的 AUTO。protected 缺400仍拒绝，稳定0x9c14保原正向。owned file-kind1 在 mapMask 前同因拒绝。没有新增正式注册。

第26轮 Native 的 root control400差异及后代候选多保3个原显式 ACE，均未被本轮拒绝门证明可恢复；旧 c32/08f 失败根和私有 raw 原样保留。矩阵 Native 行的 round_26 FAIL 保留，round_27 写未重跑/离线拒绝，不标 Native PASS。

## 库存、证据与边界

只对五个测试文件复用现成 AST 扫描器，90个当前声明全部静态解析，与原 `(file, case_name, occurrence)` 一致；全库存5468身份及历史 registration_sha256 全保持。90行更新当前源码/行号，15个原注册按准确完整 PASS 名更新各自证据/受验测试 SHA；其它历史证据不被同文件的 PASS 覆盖。当前源码不等于历史受验版本。

- 库存 SHA：`5128a32fe30163e60837c84f4a6ec498b725c1e27b2d0afd85a5380df639aa32`。
- 矩阵291→293行，只补 Pi 命令输出/默认 Host 两个业务行，旧行旧列逐字节恢复 SHA `495999ff536e52b6911d01a2f37ea195417f31f8776aede210ea8ba7f7d689b6`；新矩阵 SHA `38266be01a3dc54001b7a6ea7b62d2affb8ec02e06ba01a48128ff671c2e0041`。
- 最终附件的逐文件 SHA 在 batch-index；必要的真实反例及最终复验日志保留于 round-27。初始文案失配、语法失败、三模式中间复验和旧 AUTO 预期失败的结果/版本/hash由本报告及 batch-index 自包含保留，中间日志不再作为附件依赖。
- 本轮 ignored scratch 在最终证据落盘核对后按精确路径/hash清理；不清第26轮 Native 现场、私有原 SD、其它会话证据或任何运行中资源。既有轮次报告不删除，不全局清 Temp，不上传或发布敏感证据。

本轮定向验证结束；没有 report.md 全绿声明。未验证 Windows 新 PAI 正向创建/setter恢复、受限 Profile/temp、Low有效权限、ACK/Resume及 ConPTY 真实IO/resize/close；纯协议/离线结果不能替代这些 OS 资格。Linux Docker、macOS真实执行端和最终同版整体验收仍待原任务后续；文件/search无产品变更，不新增 ls 或重复无关测试。交 Lead/Review 核本轮证据后，由 Lead 维护唯一 goal；Tests 不提交、不 push、不更新 PR。
