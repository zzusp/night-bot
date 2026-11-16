# Router 进度追问验证

## 结论

本次 Router 规则修复的四个真实模型案例通过，包含“提及绑定操作者的进度追问”和“原任务会话仍在运行”。实质答复经假渠道发送、回读为 `delivered`，来源达到 `consumed`，未新增任务、变更任务目标或重启业务执行。一级分诊、实际渠道配置及 Host 权限/结清实现未改动。

全量路由回归不是全绿：150 项中 149 通过，1 项既有人工答复完成状态断言失败；未修改的 Router 源码也复现相同失败。最新主线附带的摘要测试有 2 项通过、1 项受 Windows 文件 symlink 权限阻断。没有将这些结果计为通过。

## 实际源码

- 初始修复与全量路由回归：`0a2aa75a927eddf244dc5c305b227d5be6f46b70` 加本分支未提交修改。
- 四场景集中真实模型及 77 项相关回归：`bfcc3a3c2bb667c0919a90ea5921519344bbdb6e` 加相同 Router 修改。
- 随后整合主线：`fe97ee69abbf1dc4cee653573656721a3e925099`。新增生产变化仅涉及执行记录摘要读取及 Web 展示，不改 Router 工具/规则；补跑项目检查及摘要测试，没有把此前模型结果冒充该提交的全量实跑。
- 最终工作树的生产修改仅为 `src/channels/resident-router-business.js`。其 SHA-256 始终为 `cbb76e1b113f885e721f8bb56a42ec09f28b157fa748e1c6d4c9d072df06b7dc`。
- 受验脚本 `scripts/verify-model.mjs` SHA-256：`f08aa6fac202948635d7a222855a6a21c10e3f357e9f54a43e9da4c2787682ab`。提交前仅将脚本 CRLF 规范为 LF 以通过暂存差异检查，逻辑不变；最终文件 SHA-256：`45fc231e5fc611e68c66e49839f008117121fc2d71e370de64baf0dafa2412a0`。
- 其余修改为 README、渠道/运维说明与本验收目录。Node.js `24.19.0`，pnpm `11.25.0`，Windows 11，独立 `worktree-router-progress-followup`。后续提交号由 Git/PR 记录，不将未提交版本只记作 HEAD。

## 问题与取舍

现场首次承接通知已有送达收据；Router 随后仅因原文提及操作者而提交 `not-assigned`，来源被消费，未产生实质进度答复。这能排除“首次消息没送达”和“仍在等 Router 消费”两种解释。用户已确认本条应由 Bot 处理，一级分诊正确。

旧 Router 规则强调不能仅因提及操作者就推断新交办，却没有明确区分已有事项的后续追问；settle 描述还容易把查询答复误读成必须追加任务动作。修复保持独立语义判断，同时补齐已有事项查询、实质回复和 `handled-inline` 的路径。

比较的方向：修改分诊不能解决已正确分诊后的误判；全面禁用 `not-assigned` 会误接确实交给他人的事项；本次选择仅修 Router 的语义规则和工具说明。没有新增字符串分类器、审查模型、调度机制或权限例外。

## 真实模型与业务终态

Router 使用当前安装选中的实际模型，继续经过项目默认 Host/Pi 链；分诊与执行器采用本地脚本端点，外发为注册的假渠道。仅发送虚构身份、职责和任务，不复制实际会话、凭据、技能或业务材料。凭据只在内存复用，不写入证据。

执行命令（将配置路径替换为本机已授权安装配置）：

```sh
node docs/acceptance/router-progress-followup/scripts/verify-model.mjs --config <installation-config> --check
node docs/acceptance/router-progress-followup/scripts/verify-model.mjs --config <installation-config> --output docs/acceptance/router-progress-followup/round-1/final-model.json
```

`--check` 实际输出：`networkRequests=0, temporaryRootsCreated=0, realChannelMessages=0, modelConfigured=true, credentialAvailable=true`。

完整虚构证据见 [final-model.json](round-1/final-model.json)，时间 `2026-11-16T10:55:57.912Z` 至 `10:58:07.522Z`：

| 案例 | 模型实际动作与可观察结果 |
| --- | --- |
| `progress`：`@协作员(协作员) 进度如何`，此前已有承接首答 | `task_query(full) → router_reply → router_settle`；回复候选核对完成、代码包未构建/未上线、条件未就绪；`handled-inline`、`consumed`、1 条 `delivered` 实质回复 |
| `third-party`：明确要求其他同事处理另一项目且助手不参与 | 只结清来源，0 条 Router 回复，未创建/修改任务；无首答的来源不要求账本保留 noTaskDisposition，证据中 outcome 为 null |
| `evidence-gap`：追问线上验收是否全通过 | 先查原任务，明确不能确认、没有线上验收证据，1 条 `delivered` 回复；没有虚构验收通过 |
| `running-progress`：原任务同会话仍持有活动租约时再次追问 | `startedWithRunningExecution=true`；查询后答复正在核对及最新已知限制，`handled-inline`、`consumed`、1 条 `delivered` 回复；模型第一次 reply 调用被拒绝后修正成功，未放松 Host 校验、未重复发送 |

所有案例最终任务数均为 1，原 session 与 requirementRevision 不变，Router 收件箱为空。未出现 `task_plan` 或 resume/reopen/control/revise 等任务动作。冷重启后发送数及工具结果数均不增长：`coldRestartNoReplay=true`，`realChannelMessages=0`。

运行态夹具使用既有 `sendTaskDialogue`，在原任务只读对话的模型边界暂缓返回，实际核对 `drained=false`，当前进度来源结清后释放并等待任务排空；没有手改 SQLite 或伪造运行状态。这证明活动原会话下的查询/回复路径，不声称已运行真实发布。

## 回归与阻断

1. `pnpm check`：初始及两次主线整合后通过。最终输出为 190 retained modules、450 production/runtime JS files、relative imports closed、HTTP routes retained、externalSdkImports=0、legacyOrchestratorDefinitions=0。源码与验收脚本 `node --check`、`git diff --check` 通过。
2. `node --experimental-test-module-mocks --test --test-concurrency=1 test/pi-router-investigation-handoff.test.js test/pi-router-ledger.test.js test/pi-resident-router-flow.test.js test/pi-router-model-input.test.js`：在 `bfcc3a3` 加本次修改上 **77/77 PASS**，0 fail、0 skipped。覆盖 prepared/delivered 首答、同 session 续办、来源/会话隔离、真实任务动作收据、具体澄清、权限、取消、冷恢复与 no-replay。
3. `pnpm test:routing`：在 `0a2aa75` 加本次修改上 **149/150 PASS，1 FAIL**，0 skipped。失败为 `test/pi-resident-router.test.js:133`，用例 `conversation task questions default to operator Web intake and explicit requester preserves the original scope/session`；人工答复后期望 `completed`，实际 `active`。同一用例隔离复验仍失败。
4. 基线反证：在 `bfcc3a3` 使用 `node:module.registerHooks`，仅将 Router 模块替换为 `git show HEAD:src/channels/resident-router-business.js` 的未修改源码；记录其 SHA-256 为 `973fdc6c9ef6dc3da5083d2813363e87483cf6380d24eeeedb837a7ccf4b3c89`。同一用例再次在第 133 行出现 `active !== completed`。因此该失败不依赖本次 Router 文本修改；具体根因未在本任务展开，保留为既有问题，不降低断言或修改无关实现。
5. `node --experimental-test-module-mocks --test test/pi-live-digest.test.js`：在 `fe97ee6` 整合后 **2 PASS / 1 BLOCKED**。大文件同长度改写摘要和读取期间变化拒绝通过；文件 symlink 案例被本机 `EPERM: operation not permitted, symlink` 阻断，不能宣称该安全分支通过，未跳过或放松校验。
6. 未运行全量 `pnpm test`、`test:runtime`、`test:containment`；本次未变更推理循环、进程执行或 sandbox。未触发 CI、未合并、未部署实际 Bot、未补发群消息。

## 过程中的反证与夹具修正

- 修改前的独立真实模型运行没有复现现场静默结清；模型最终给出了送达回复，但调用过 task_action。早期夹具将所有 task_action 都当作重启，且未记录 kind，因而断言失败，不能据此声称复现原故障或证明该动作越权。后续记录 kind、允许沿原任务 supplement，仍禁止新建和无必要业务控制。
- 首次运行态夹具把初始等待问题再次提交到只读 dialogue，触发 `TASK_DIALOGUE_REPLY_ONLY` 并重复，已停止该次自建验收进程。修正为只读 wait/summary，且仅在当前追问来源消费后释放执行门，再实跑通过。没有修改生产代码适配错误夹具。
- 旧 baseline/candidate/running JSON、临时 baseline loader 和该次中止夹具的安装根属于中间产物；文字结论保留在本报告，收尾统一清理，仅保留最终 `final-model.json` 和可复用验证脚本。

## 生效边界

这是源码与隔离环境验证结果，不是当前实际 Bot 已升级。合并后按 Windows runbook 排空并正常升级才会加载新规则；不需要 schema/config 迁移。历史上已消费的来源不会自动恢复或补发，不使用错误续办入口重放它们。真实供应商消息发送与真实发布不在本轮授权范围。
