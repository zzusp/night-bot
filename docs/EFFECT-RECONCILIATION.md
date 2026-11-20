# 未知外部效果对账

单任务执行会话在效果 intent 已提交、结果无法确定时，仍可接收新输入并只读核验；
原调用不会重放。Host 只有在实际 Pi 推理、工具体、已注册进程及作业全部排空后，才写入
`task/owner-drained`。证明范围为 `registered-owned-provider-ranges`，不是
任意外部系统、脱管进程或操作系统内核退出的证明。

## 操作者入口

便携安装、已配置 `resident.taskSessions.webActorId` 的运行中服务提供：

```sh
node bin/night-bot-effects.js CONFIG inspect TASK_ID INTENT_ENTRY_ID
node bin/night-bot-effects.js CONFIG close PROPOSAL.json --operator-text-file NOTE.txt
```

也可用 `--operator-text-file -` 从标准输入读取说明。命令只连接本地服务，
不启动 Host、模型或渠道。它读取安装私密目录中的独立能力凭据；不要把该
文件放进 proposal、说明或任务材料。无凭据或仅有 loopback/Host/Origin
身份不能操作。legacy 安装缺少所需进程隐私边界，该入口返回
`EFFECT_OPERATOR_PRIVACY_UNAVAILABLE`，不降级开放。凭据默认排除于备份。

inspect 返回当前绑定、原生 intent/call/input 身份和摘要、日志提交切点、
权限与渠道范围摘要以及排空时间。操作者须实际检查外部效果，再由可信
Host/操作者将证据存入任务的 `materials/runtime-evidence/effects/`。`ask` / `auto`
的任务内写入只开放 work/tmp，Host 证据目录不能通过普通业务路径审批获得。
显式 `full` 下的直接进程具有当前 OS 账号访问能力，不能再声称 OS 阻止其
修改同账号可写文件；证据仍须由操作者实际核实，不因磁盘文件存在而成为
授权或真实效果证明。模式说明见 [README](../README.md#工具权限)。文件名为原始 UTF-8 JSON 字节的
SHA-256 加 `.json`，拒绝软链接、硬链接、改变的字节或陈旧身份。

证据 JSON 的精确 schema 见 `evidenceSchema`（src/tasks/effect-reconciliation.js）：
`version:1`、`kind:task-effect-readback`，匹配 inspect 的 task/session/intent/
call/arguments/binding/scope 字段，排空后的 `observedAt`、实际读回 `summary`，
以及 `outcome:partial-or-unknown`、`noReplay:true`。最多提交八份证据。

proposal 只包含 inspect 的 `taskId`、`intentEntryId`、`intentDigest`、
`currentBinding`、`journalRevision`、`scopeDigest`，新增独立 `requestId`、
`evidenceRefs:[{path,sha256}]`、`outcome:closed-with-possible-partial-effects`、
`noReplay:true`。不接收调用者的 actor/source 或“成功/无效果”结论。
操作者说明由服务以配置的真实 webActorId 持久记录；该 source 不进入群分诊。

## 提交和恢复边界

对账连续持有任务 admission 和原生 writer：SQL prepare 挂起任务，提交精确
原生回执，再投影 SQL。原生回执已落盘而 SQL 失败时，重启只修复投影；
只有 prepare 而无原生回执时，保持挂起，须操作者重试同一提案。

结清只表示可能存在部分效果的失败尝试，不表示任务完成。任务保持暂停；
Router 可根据普通用户消息恢复原任务，不要求额外执行授权或调用 new-action。
旧具体调用按原生调用身份永久禁止重放；后续独立调用不因参数相同被禁止。
此结清入口自身不启动执行，调度仍由 Router 决定。

实际默认 Host 与本地 HTTP/CLI 测试见 pi-task-effect-reconciliation-e2e 和
pi-effect-operator-http；来源、篡改、范围、分支、提交切点和链接反例见
pi-task-effect-reconciliation。平台内核隔离和真实厂商读回须分别验收。

## 未知效果后的续办

工具提交 intent 后结果未知时，Host 保留 intent，并将错误交回当前 Pi 工具轮。新输入
仍进入原会话；模型可以推理、调用受控只读能力，并用 `task_result` 报告 `wait` 或
`blocked`。Host 保留未知效果代码、工具名及 `intentEntryId`，不允许重放旧调用、
执行受限副作用或把未知结果当成完成。缺失终态的作业不生成完成通知；当前轮提交结果后
仍按实际已接纳输入和内部通知规则收尾，不取消真实用户的待处理输入。

排空检查的是当前所有者实际使用的资源和提交，不是替旧作业补终态。仅有合法旧登记且
无保留资源的作业，不会单独阻止当前轮释放；实际无法排空、有保留资源、归属歧义或提交
失败仍保留保护。需要确认旧作业或解除效果限制时，才走下文的核验流程，升级不会代为结清。

## 只读核验后的排空切点

原未知调用可能已实际排空，而之后的只读对话又向同一 Pi journal 写入了新内容。不能复用旧切点忽略这些内容；也不能让新租约冒充原调用的执行者。

每轮仍有未知效果的核验执行在模型、工具、已注册进程及作业真实排空后，为自身绑定提交新的 `owner-drained`。inspect 和离线回执校验同时要求：目标调用原执行者的有效原始证明仍在当前分支；最新核验执行者的绑定来自实际耐久接纳的输入；两者作用域一致；最新切点后只有物理 commit 标记。没有原始证明、新增未知作业、分支变化及切点后的新增业务内容仍失败关闭。

旧任务返回 `TASK_EFFECT_DRAIN_CUT_CHANGED` 时，若原证明尚在且当前服务已包含此修复，可通过既有任务对话安排一次只读核对，等待回复与实际排空后重新 inspect。不要手工追加排空记录或把未完成的对话当作排空。新代码不追认旧 write 成功或未开始，仍只允许操作者经上述证据流程将其结清为可能部分效果的失败尝试。

## 丢失终态的原生 shell 作业

任务效果与原生作业分别对账。`effects close` 不会把一个仅有 registered 的后台作业变成已退出。无资源所有权收据的冷丢失 `pwsh`/`bash` 作业，可由可信本机操作者离线核验结清；有资源保留、损坏/非法收据或不完整日志仍拒绝，不适用于自动批量消警。

```powershell
node bin/night-bot-jobs.js CONFIG inspect TASK_ID JOB_ID
node bin/night-bot-jobs.js CONFIG close PROPOSAL.json NOTE.json --check
node bin/night-bot-jobs.js CONFIG close PROPOSAL.json NOTE.json
```

将 inspect 输出的 `proposal` 保存为提案。NOTE 使用以下结构；文件位于任务自己的 `work/` 下，摘要必须是实际只读核验后的 SHA-256：

```json
{
  "operatorText": "说明原调用、进程身份/核验范围、保留输出与未知部分；不得把进程不存在等同于成功",
  "producerAbsent": true,
  "partialEffectsPossible": true,
  "noReplay": true,
  "evidenceFiles": [{"path": "work/checks/readback.json", "sha256": "实际文件的64位sha256"}]
}
```

先核对原始调用、当前 OS 进程/父子身份、保留输出及可能的外部效果，确认原生产者已不在执行。退出码不可证明时保持未知，不能填写 producerReported、成功或无效果。`producerAbsent` 是操作者的带证据声明，不是原进程退出收据或 Host 排空证明；Host 不会只凭 PID 消失自动结清。

inspect 不运行模型或启动 Host；close 与自检要求停机，自检零写。close 实际持有安装 `.host.lock` 与原 Pi session writer，校验安装、任务/会话、任务版本、完整日志字节、原 registered 身份、当前分支及证据摘要，按哈希冻结操作者报告并追加 `job/reconciled`，保留原日志前缀与登记。重复完全相同请求幂等，不生成 settled、不填写 producerReported、不改 SQLite、drained 或输入 ACK。

收据结论固定为 `closed-with-possible-partial-effects`、`exitStatus:unknown`、`noReplay:true`。正常重启后仍由 Host 冷恢复原任务/原会话；新的输入向模型说明旧作业已人工核验、退出状态未知且禁止重放。后续独立调用按现有权限和业务目标处理，不新增全局授权门。升级须同步支持该 typed receipt 的代码；不能让旧发行读取新收据后继续执行，也不能删除收据回退。实际恢复以原会话的新推理/工具及业务终态为准，不以 CLI committed 或 running 标签当完成。

## 冷丢失 shell 缺少原执行者排空证明

仅对于原生直接 `bash` / `pwsh`，原证明因冷崩溃缺失时，可复用上一节已经完成的离线 `job/reconciled`。不能凭后续执行者的零计数追认旧生产者 join，也不能只凭 `jobs close` 解除效果阻断。

1. 先按上一节离线检查原生产者、保留输出和可能效果，运行 `jobs close --check`，再提交真实冷作业核验。已有合法收据不重复结清。
2. 正常启动，由原 Router/原任务会话安排只读核验，等待模型、工具、已注册进程和作业真正排空。不得手工追加 `owner-drained`。
3. 使用既有 `effects inspect`。Host 要求原 intent、admitted input、assistant call、唯一 shell 作业登记与关闭记录在同一分支，精确匹配 owner、工具名、call/rootCall、登记摘要及先后顺序。未决作业、保留资源、调用歧义、错误分支、未知收据和完整提交校验失败仍拒绝。
4. inspect 返回额外的 `coldJobReconciliation:{entryId,digest}`，明确引用操作者冷作业核验；`ownerDrainEntryId` 仍只引用最新核验执行者的真实排空。其作用域和输入必须匹配，排空切点后不得有新业务内容。
5. 操作者核对原冻结作业证据及实际效果，按原 schema 保存新的 effects 读回材料，再按原 proposal schema 执行 `effects close`。不要把 inspect 的额外字段直接加入 proposal；Host 重新推导并将其写进原生效果回执。在线与离线闭包验证共享精确关联规则，缺失/篡改冷作业引用都不通过。

关闭结论仍为可能部分效果、未知结果、永久禁重放；不会标记业务测试成功或自动唤醒任务。后续独立调用沿正常权限执行，不新增 task-wide 授权。其他工具及没有合法冷作业收据的 shell 仍必须保留原生产者证明。本路径只描述已注册范围，不能证明任意脱管外部进程或远端操作已结束。

新效果收据含新增 typed 字段，须先完成匹配代码的正常升级，不得把它交给旧发行继续运行或删回执回退。真实 Host/CLI 验证见 `test/pi-native-job-reconciliation.test.js`；精确关联、摘要和分支拒绝见 `test/pi-task-effect-reconciliation.test.js`。
