# 会话上下文与目标边界验收

## 范围和受验源码

本轮交付长期指令独立加载、现有账本任务/回复投影及严格 Pi 进度查询、两角色原生摘要与 Router 目标范围约束。环境 Windows 11、Node 24.19.0、pnpm 11.25.0、锁定 Pi 1.5.0；隔离 Host/SQLite/Pi、本地脚本模型及假渠道，不接触真实运行安装、厂商或业务消息。

开工基线 b3cdb95，最终已整合主线 `98648cd84130f069bd4c52add10dacf2ba095f58`，分支 `worktree-conversation-context`。最终专项对应尚未提交工作树，20 个源码/测试文件逐项 SHA256 见 source-state.json，汇总指纹 `ad69c0f4e0b11665192ab2080074e803a67a3b54b52d8b26528f798e664066a3`。其生成规则也保存在该文件。之后仅改验收/交付文档；中途用于基线对照的源码及临时诊断均已精确恢复，并独立核对指纹。

## 最终必要验证

```sh
node --experimental-test-module-mocks --test --test-concurrency=2 test/pi-conversation-context.test.js test/pi-standing-instructions.test.js test/pi-background-candidate.test.js test/pi-background-host.test.js test/pi-persistent-triage.test.js test/pi-router-native-compaction.test.js
pnpm check
git diff --check
```

最终六文件结果：`tests 29 / pass 29 / fail 0 / cancelled 0 / skipped 0`，耗时约 311 秒。必要证据如下：

- 任务索引分页包含当前活动及直接相关终态档案，不带完整 request/requirements，不越会话。回复查询按当前 SQLite 读取 prepared→delivered、预览/全文及游标，不输出发送 token。真实 Router 的 progress 查询得到已提交 task_result 活动，查询前后 leaseEpoch/runSequence 不增加；错租约返回当前执行历史 unavailable。
- 冷恢复后引用旧来源，通过真实 resident_reply_query 读到完整已送达原正文，假渠道累计仍仅发送一次。查询没有重发、唤醒或重建任务。
- 长期指令 CRUD、冷恢复、个人隔离、其他作者改写拒绝、一次例外不改规则、删除后两角色空列表均通过。混合主体只映射准确来源；分诊覆盖同轮 steer，Router 覆盖同持久会话后续批次，不将后者冒称同轮 steer。
- 真实 Router 请求已包含目标必需/可选验证边界；原生候选摘要请求包含待确认/已同意、顺序及既往明确要求的来源引用。断言证明提示确实接入，不证明真实模型在任意自然语言场景都会正确决策。
- 两角色手动、阈值自动及 overflow 保持身份、原 journal 前缀和单次接纳；cold 不重放。overflow 可能将当前 custom input 摘要掉，缺失时只补当前 admitted packet 原文的只读引用，不重新 enqueue/deliver。
- 真实后台候选采纳、冷恢复和 no-replay 通过；取消/迟到结果不改 live journal，角色摘要失败只取消、不回退通用摘要。候选使用独立 UUID、无业务工具，仅纯角色扩展。
- 源码守卫通过：保留模块 190、已退役 10、生产 import 文件 457、外部 SDK import 0、旧 orchestrator 定义 0；相对导入闭合、HTTP 路由保留，派生 notices 不变。diff 格式检查通过。

## 其他运行结果和反证

此前任务 runtime 回归：162 项中 150 通过、0 失败、12 跳过，约 1226 秒。12 项明确要求 Linux portable model-process privacy namespace，Windows 保持 fail-closed。该运行对应开发中间工作树，早于最终源指纹和用户最后补充规则，仅为补充证据，不当作最终源码全量通过。

用户明确要求不自行追加长流程验收后，停止尚未结束的完整 `pnpm test`，不宣称全量通过，也不重新启动。中止前输出曾出现两项邻接失败，仅复核已出现的具体失败：

1. 可选 DWS unresolved-error 冷回填：初次输出包含隔离 ingress 文件 rename 的 EPERM，定向复核通过（1 项）。没有修改渠道生产实现；不能据此宣称已修复 Windows 并发文件问题。
2. 显式来源引用的中立附件交付：定向复核仍在 `original public business marker failed before sending` 超时。将当前工作树已修改的全部 tracked src 文件临时换成 HEAD=98648cd 内容、保留原测试断言再跑同一用例，也复现同一超时；随后精确恢复本轮源码并移除临时诊断。该邻接验收根因未收敛，不将其称为通过或已修复，也不据此扩大本任务为渠道交付排障。没有降低授权/收据/送达断言。

本轮结论：本任务最终必要专项及源码守卫通过；全默认未完成，已知邻接用例有基线同现的未收敛超时，故不生成“全绿” report.md。矩阵保留此边界。

## 设计与上线边界

- Router 只安排用户目标必需步骤和最小充分验证；可选复测/长流程先询问且不阻塞主线、不提前创建或启动。用户同意后按顺序补充，部署后复测先部署。有效且适用、可核实来源的既往明确要求可直接执行；一般经验和模型建议不能升格为要求，当前修订/取消优先。
- 聊天维护入口只管理原作者个人 standing instruction；元数据支持 actor/conversation/bot 不等于新增三类管理 API。安装/会话级规则仍走现有受信资源/配置。
- 无新依赖、环境变量、SQLite schema 或状态库；不迁移旧记忆，不改运行数据。正常升级仍按运维排空、更新已合并代码再重启。带新 scope 元数据的记录不能让旧代码任意改写；回滚须使用匹配代码/数据。
- 未测真实厂商摘要语义、真实延迟或真实消息送达，不声称提速。原生 retry 设置保留，未复用 SDK 私有逐次 summarization retry callbacks。Linux 隔离专项及额外长流程未追加。
- 本地运行实例、根检出与其他会话资源未动；未部署、未合并、未手动触发 CI。PR/提交事实在交付回复回查，不循环将文档自身 SHA 写进文档。

## 证据归档

本报告及 matrix.csv 保存必要文字证据和结果。最终原始 targeted-final.log、guards-final.log、runtime-final.log、adjacent-final.log、adjacent-baseline.log 留在本地忽略目录，不进入 Git；本报告不依赖外部读者访问这些日志即可判断结果。其他本任务中间测试日志和临时诊断在归档后清理。未创建历史轮次，未删除既有其他任务证据。
