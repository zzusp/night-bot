# 第 2 轮：修复旧代误拦和回发参数冲突

2026-11-27，Windows 11，Node.js 24.19.0，pnpm 11.25.0。基线 `e0a3925cadbb0679aeca8d29b7fc86665dc13933`，最终定向实跑时为 `worktree-uat-file-effects` 未提交工作树；`git diff -- src packages | git hash-object --stdin` 为 `0ba14daa19e33c22fc6801b81ef1c35e1d049ebc`。测试使用合成文件、脚本模型及模拟渠道，未操作真实业务原件。

- 上一已发布版的回发工具同时收到 `reportedFiles` 和旧 `completionEventId`，Host 返回 `TASK_DELIVERY_COMPLETION_MISMATCH`；本次只有正文通知，不曾提交文件给厂商。另核实那次请求者不是原任务作者，修复不放宽这一限制。入库已选对工具，但返回 `ROUTER_PRIOR_SESSION_EFFECT_UNKNOWN`。严格回读相关旧代已提交日志，没有该任务的旧导入调用，知识库也无写入回执；当时的恢复记录把待投递事件所涉任务也列入候选。
- 最终 `node --test --test-concurrency=2 test/pi-router-attachment-capability.test.js test/router-preexecution-proof.test.js test/pi-router-investigation-handoff.test.js test/pi-session-parallelism.test.js`：12 通过，0 失败或跳过。模拟换代后同会话原作者回发得到单个可回读附件，原件字节一致；自然话入库成功，第二模拟渠道按同一 ID/版本读到同一 SHA-256 的字节。核对无重开、不重复发送、异作者和越界拒绝、原件归档可封存、篡改作者拒绝，以及真正重叠的未知调用和仅排队的旧附件仍不得重放。
- 另有适配器及旧副作用证明 14 通过、1 跳过（Windows 无创建文件软链接权限）；对齐旧私聊能力断言后，实际 Host 调用模拟 DWS 进程接口，校验单一绑定对端、有 `--file` 且无 `--group`，取得模拟接纳回执，不算真厂商送达。旧版换代夹具首跑失败于本机 tar 临时路径；在独立 ASCII 路径复验原测试通过。两项复验后仅改了模型说明，未改这些路径的执行代码。
- 完整 `pnpm test:routing` 第二次运行在最终说明和并行夹具修正前：258 通过、1 超时取消、0 断言失败。超时证据显示四次调用都在守卫报 `undefined.some`，没有进入读写；夹具返回 Promise，与主线生产同步 `admission.current()` 合同不符。按真实同步合同修正后，最终定向验证保留并通过双读并发、写屏障及容量断言；未第三次重跑完整组。上次全组的旧提示词断言也已按现合同更新，保留真实排查调度及原执行会话断言。
- 最终 `pnpm check`、`git diff --check` 通过：480 个运行时 JS，外部 SDK 导入为 0。

发布不替代业务验收。仍需在明确获准的真实私聊中，用同一认证原作者生成合成原件、索取和入库；下载文件并对原 SHA-256，另一正式接入渠道按固定版本读回再对 SHA-256。钉钉客户端简洁回复和字面量实显也未复验。原有业务请求不重放。
