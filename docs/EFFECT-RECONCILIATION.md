# 未知外部效果对账

默认单任务执行会话在效果 intent 已提交、结果无法确定时停止；恢复不会重放。
Host 只有在实际 Pi 推理、工具体、已注册进程及作业全部排空后，才写入
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
继续必须走另一次明确的可信 Host 控制操作。即使控制修订变化，原工具名和
参数摘要也永久禁止重放。此入口不提供自动继续、补发或重新执行。

实际默认 Host 与本地 HTTP/CLI 测试见 pi-task-effect-reconciliation-e2e 和
pi-effect-operator-http；来源、篡改、范围、分支、提交切点和链接反例见
pi-task-effect-reconciliation。平台内核隔离和真实厂商读回须分别验收。
