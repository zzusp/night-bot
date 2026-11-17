## 问题与结果

让一级分诊与 Router 使用精简必载指令、现有账本索引/查询及 Pi 原生角色摘要。长期行为要求与普通偏好/背景分开；已回复内容按当前送达账本核对，避免重复承接。追加用户明确的目标边界：仅安排目标必需步骤和必要验证，额外复测或长流程验收先询问，不阻塞主线；有可核实且仍适用的既往明确要求时直接执行。

本 PR 完成代码、本地必要验证与文档；不代表运行安装已更新，未部署、未合并、未发送真实消息。

## 实现

- `src/memory/service.js:48`、`src/memory/store.js:204`：复用共享 MarkdownMemoryStore 的 standing-instructions 分类，正文带作者适用范围、版本、准确 appliesToSourceIds；聊天入口仅原作者可维护。普通记忆/候选/任务复盘不能提升为指令。每个请求刷新，命令不重放，普通索引不重复注入。
- `src/channels/conversation-context.js:15`、`src/channels/resident-router-business.js:183`：现有 SQLite 任务/通知账本只读投影，默认 10 项、最多 100 项；任务索引不内联完整要求，回复区分 prepared/unknown/delivered，完整正文用 notificationId 读取。没有第二份业务状态库。
- `src/channels/router-progress.js:7`：progress 经严格已提交原生 journal、task identity 和当前需求/控制/租约边界，使用 Pi 官方投影；不唤醒任务，读取期间修订变化拒绝结果，不把模型陈述当独立证据。
- `src/runtime/pi-role-compaction.js:14`：手动、阈值、overflow 与后台候选使用同一角色说明和公开 compact helper。保留预算、原生历史/近期窗口、提交、取消/freshness、owner 及 no-replay。overflow 吞入当前 custom input 后，仅在原文不可见时提供当前 admitted packet 的只读引用，不重复接纳。
- `src/channels/resident-router-business.js:237`：部署仅做部署本身必要状态确认，未要求不追加业务复测；开发不自动扩展长流程。可选项询问与主线并行，用户同意后按顺序纳入；摘要保留确认状态和既往要求的来源，不能把建议变成要求。完整调度权不等于可扩大用户目标。

## 关键实现

`src/memory/service.js:62`
```js
          const appliesToSourceIds=instructionSources(row.instructionScope,subjects)
          if(!appliesToSourceIds.length)continue
          const saved=await this.store.read(scope,{topic:STANDING_TOPIC,key:row.key,includeSources:false}),entry=saved.entries[0]
          if(saved.revision!==index.revision||!entry||entry.revision!==row.revision||!isDeepStrictEqual(entry.instructionScope,row.instructionScope))throw failure('MEMORY_INSTRUCTION_CHANGED')
          standingInstructions.push({instructionId:entry.id,key:entry.key,revision:entry.revision,appliesToSourceIds,text:entry.text})
```
指令正文按认证来源匹配；读取发生并发修订时失败，不把个人规则扩大到整批。

`src/channels/router-progress.js:10`
```js
 if(!persistence||!await persistence.stat(task.sessionId))return {...base,coverage:'unavailable',reason:'TASK_NATIVE_HISTORY_UNAVAILABLE',activities:[]}
 const native=await persistence.readNative(task.sessionId,{requireComplete:true})
 if(!native.audit.some(row=>row.domain==='task'&&row.kind==='identity'&&row.payload.taskId===task.taskId&&row.payload.sessionId===task.sessionId))fail('ROUTER_TASK_NATIVE_IDENTITY_INVALID')
 const branch=native.entries,projection=native.context.projection
 const boundary=branch.findIndex(entry=>entry.type==='custom_message'&&entry.customType==='night.business-input'&&entry.details?.source?.kind==='task-input'&&sameRun(entry.details.source.taskSession,task))
 if(boundary<0)return {...base,coverage:'unavailable',reason:'TASK_CURRENT_RUN_HISTORY_UNAVAILABLE',activities:[]}
```
没有当前执行边界时明确 unavailable；损坏或未提交尾部仍由原严格解码拒绝，不宽松回读。

## 验证

- [x] 六文件相关专项 `node --experimental-test-module-mocks --test --test-concurrency=2` → 29 pass、0 fail、0 skipped（约 311 秒）。覆盖真实 Host/Pi 查询/冷恢复、指令 CRUD/作者隔离、分诊同轮 steer、Router 同会话后续批次、两角色手动/自动/overflow、后台采纳/取消/失败无通用回退；完整文件列表和命令在验收记录。
- [x] 真实请求断言 → Router 目标范围规则及摘要确认状态/既往要求来源确实进入本地模型请求。仅证明接线，不声称真实模型语义评估通过。
- [x] `pnpm check`、`git diff --check` → 源/hash/import/原生守卫及格式通过；保留模块 190、生产 import 文件 457、外部 SDK import 0。
- [x] 中间工作树 `pnpm test:runtime` → 150 pass、0 fail，另 12 个 Linux 进程隐私场景跳过。该轮早于最终源码指纹，仅作补充，不代替最终源码验证。
- [x] 已出现的可选 DWS unresolved-error 冷回填定向复核 → 1 pass；初次 EPERM 未修改实现，不能宣称修复 Windows 文件竞争。
- [ ] 完整默认回归：用户明确不要自行追加长流程后已停止，未重新启动，不宣称全量通过。
- [ ] 显式来源引用附件交付邻接用例：定向复核仍在发送前标记等待超时；HEAD=98648cd 基线源码也复现同一超时，根因未收敛。本 PR 不删/放宽原断言，不扩大为渠道交付排障。
- [ ] 真实厂商摘要质量/耗时、真实渠道及 Linux 专属隔离：未执行，也未部署当前安装。

验收与反证：`docs/acceptance/conversation-context/round-1.md`、`matrix.csv`。最终 20 个源码/测试文件哈希见 `source-state.json`，基线 `98648cd84130f069bd4c52add10dacf2ba095f58`，受验工作树指纹 `ad69c0f4e0b11665192ab2080074e803a67a3b54b52d8b26528f798e664066a3`。本地原始日志被忽略、不提交；报告已自包含必要结果和文字证据。

## 风险与边界

无新依赖、环境变量、SQLite schema 或运行数据迁移。actor/conversation/bot 是存储类型，不是新增三类管理 API；聊天只管理当前原作者个人规则，安装及会话规则沿用受信资源/配置。新 instructionScope 记录不应交给旧程序改写，回滚保持匹配代码/数据，缺少匹配快照不声称无损回滚。

权限、依赖与副作用收据不改变；模型建议不是授权。SDK retry 设置仍传入公开 compact helper，但不保证私有逐次摘要重试事件同默认内部实现一致。脚本模型不能证明任意真实模型摘要质量或提速。

README、渠道/记忆/后台压缩文档与 Windows runbook 已同步。未修改根检出或运行实例，不触发真实发送、合并、部署或 CI；本 PR 不涉及现有唯一 CI workflow 的触发路径，提交标记 skip ci。

🤖 Generated with [Claude Code](https://claude.com/claude-code)
