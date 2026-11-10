# 原事项恢复与真实完成：第 5 轮

## 结论与受验版本

用户在本机部署后再次要求原事项继续。本轮复用安装中已有的认证操作者入口，结清升级前遗留的单条 edit 误锁，保留可能有局部效果及 noReplay，然后沿原 task/session 独立续办。原事项已到达 `completed`、`drained=true`，完成记录绑定 requirementRevision 2；正文及一份冻结报告均已实际送达。

运行源码仍为 PR [#33](https://github.com/zzusp/night-bot/pull/33) 的 merge `1d976a2cd9d7b7f66ae83cf7ae44e2e12bfde115`，发布工作树 tracked 内容干净。本轮没有新增生产代码、恢复接口或再次部署；`worktree-task-file-mutation-deployment` 只补充文档与脱敏证据。主检出的已有改动未提交、切换或回退。

第 4 轮当时保留旧未知意图的结论不改写。本轮以用户后续明确要求继续为依据恢复该事项，不将一次平台部署视为自动重放所有旧任务的授权。

## 恢复路径与边界

- 部署修复只改变之后能够证明未开始写入的失败记账，不补造旧调用的边界证明；这解释了部署后原事项仍被同一条旧意图拦住。
- 先执行本任务恢复助手的 `--check` 零副作用预检，再通过已有 `bin/night-bot-effects.js` 的 `inspect`、`close`、`new-action` 调用运行中的 Host。没有直接修改 SQLite 或 journal，没有创建第二个 Host 或替换执行会话。
- 原调用按 `closed-with-possible-partial-effects` 结清，正式证据留在任务归档的 Host-owned materials 中。它不代表发布成功或没有副作用；历史调用保留且禁止重放。
- 新动作要求先读取现状和已有发布记录，再做独立修正及剩余工作。一个 Router 可以管理多个事项；仅同一事项的补充或“继续”复用该事项执行会话，不同事项保持独立。
- 外部业务由 Night Bot 原事项按其既有授权继续；本 CLI 没有直接操作外部仓库或服务，也没有额外发送渠道测试消息。

## 真实终态及独立核验

终态观察于 `2026-11-10T10:02:10.786Z` 返回；随后以只读命令核对完成记录、归档文件及送达状态，最终脱敏证据见 [recovery-proof.json](round-5/recovery-proof.json)。

| 检查 | 结果 |
| --- | --- |
| 任务及执行会话身份 | 原 task/session 均保持；未创建替代执行会话 |
| 实际执行终态 | completed，drained=true，完成记录 requirementRevision=2、controlRevision=3 |
| 严格日志读回 | 使用实际安装版本的 decodePiJournal，requireComplete=true，并显式传入 portablePaths；物理字节全部提交 |
| 旧调用关闭 | verifyTaskEffectClosures 验证原调用、分支、排空、持久关闭记录；证据文件哈希匹配；原 invocation 仍只有一次 |
| 效果账目 | 107 条意图、106 条结果及 1 条旧关闭；105 条成功、1 条 not-started 写前失败，未结清数量为 0 |
| 真实续办 | 旧关闭之后新增 62 条意图和 62 条结果，不止于授权或调度 |
| 冻结报告 | producer 绑定原执行会话及本轮需求版本；实际文件与描述符 SHA-256、长度一致 |
| 正常业务交付 | 同需求版本正文与报告两条通知均 delivered；不是仅排队或已接纳 |
| 应用健康 | resident HTTP 200，status=ok，recoveryIssueCount=0 |

历史 `lastDecision` 仍保留关闭旧尝试时的 wait 文案；本轮业务终态依据需求版本匹配的 `completion`、任务状态、实际排空及送达记录判断，不以该旧快照覆盖当前结果。

## 业务证据范围

原执行会话已保留实际运行版本、两个目标服务健康、流水线成功及两类真实 HTTP 下载验证材料。本轮只读核对这些材料，并独立核验两份实际 XLSX 的字节哈希、ZIP CRC、OOXML 表头/数据行数；候选浏览器保存文件与 HTTP 文件逐单元格相同。结果身份集合及冻结结果匹配、登录会话注销验证记录通过，冻结报告实际字节哈希与 Host 描述符一致。

不把归档摘要替代全部现场操作：本 CLI 没有再次登录外部系统、重发下载或重跑业务部署。结果弹窗的真实浏览器保存和完整业务生成流程没有覆盖；候选浏览器下载与两类 HTTP 下载通过，不等于这些未执行场景通过。实际业务文件、地址、账号、任务/会话标识、完整日志和凭据均不复制进 Git。

本轮没有生产代码变化，不重复跑第 3 轮 112 项或第 4 轮安装专项。人工待答独立失败、完整 runtime 与 Linux containment 的原结论保持；没有以本轮原事项成功宣称全量运行时通过。

## 文档与清理

同步 `docs/ops/windows-local-runtime.md` 的既有操作者工具及按事项复用执行会话说明；同批更新 matrix 历史列和唯一目标文档。仅保留本轮脱敏最终证据及历史 round 报告，恢复助手、提案、操作者说明和已结束的观察脚本在最终核对后清理。任务正式证据和业务归档保留；仍托管本机实例的 launcher 保留，不清理其它会话资源。
