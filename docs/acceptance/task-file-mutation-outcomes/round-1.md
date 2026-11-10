# 文件工具写入前失败验收：第 1 轮

## 结论

本次修复专项通过：可证明未开始写入的 Pi 文件错误保留原始反馈，允许独立修正调用；已开始写入或真实未知的效果继续防重放。扩展运行时套件未全绿，不能据此宣称全量回归通过或已部署。

## 实际受验版本

- 日期：2026-11-10；Windows 11，Node.js v24.19.0，pnpm 11.25.0，官方 Pi coding-agent 1.5.0。
- 分支：`feature/public-marker-delivery-recovery`；HEAD：`b9a7bd2a61f0c31d0f8e03457431dace8c976617`。
- 验证对象是该 HEAD 上的未提交工作树。开工时已有 Web 首答、渠道关联、观察分页等改动；本次保留这些改动，没有暂存、提交、推送、触发 CI、部署或修改线上任务账本。
- 下面的实现文件在相关套件、定点复验之间没有变化；调用身份测试仅补用仓库既定的 Windows 双倍期限 helper，不改变 Linux 期限和业务断言。

| 文件 | SHA-256 |
|---|---|
| `src/pi-file-tools.js` | `0cc8af5ee399380350419b0f034121d3a7ac51ebc4fd36975e4141ee5339414d` |
| `src/pi-file-tool-registration.js` | `31622780ade2418c967b166e5aefa9b642972fdea4a72eec52e44a09abffb410` |
| `src/tasks/single-session.js` | `3a19b91e671559e4f431fb5ca490bea65dc320908c01a26292473abb273a3d28` |
| `src/tasks/effect-reconciliation.js` | `d3010f74466832f43f4e2aec3e749ce0dc9bbb0aab509ae15affdd1ac630fdc4` |
| `test/pi-file-tool-registration.test.js` | `b4f146eb5365a0a09f388327fbfe9fe764db16e35a39b8be13498025b22c4c68` |
| `test/pi-single-task.test.js` | `477d42c4e34ac6e6e621ff062b194ad184eb0810d0c9f98cb601aab82509cd12` |
| `test/pi-task-effect-reconciliation.test.js` | `a3ce3030c093b036a6d837c6c15f3df1ee0fdb419cc6db458362db2ad3aaf4a4` |
| `test/pi-task-effect-call-identity.test.js` | `21c9e77aea93e2e8c16947454bb6d70d5d170a6df1661ad44a23207fb30e15b5` |

## 改动和证据

- `src/pi-file-tools.js:141`：每个精确注册的执行使用私有状态，在进入 `fs.writeText` 前标记开始，并在实际执行结束后记录完成。仅未进入写入的已结束调用可提供证明。
- `src/pi-file-tool-registration.js:31`：证明绑定实际 actor、工具定义、当前注册和原执行身份；克隆执行、同名自定义定义、已卸载注册均不能继承。
- `src/tasks/single-session.js:135`：受信写入前失败提交 `isError: true, effect: not-started`，原错误返回 Pi；不按错误文案推断无效果，取消和未知作业仍阻断。
- `src/tasks/effect-reconciliation.js:38`：运行时复原和对账共用严格结果校验；旧版普通错误不自动结清，已结清失败不能再次对账，成功与未开始写入的矛盾组合拒绝。
- README 和 Windows 运维说明同步记录新行为、旧任务不自动解锁及旧版不识别新增收据字段的回滚边界。方案见 `docs/spec/task-file-mutation-outcomes.md`。

只读现场复现：将保留脚本字节交给官方 Pi 编辑实现，注入拒绝写入的 operations；替换文本出现两次，错误为 `Found 2 occurrences ... The text must be unique`，写入回调次数为 0。未修改原脚本、原 journal 或 SQLite，也未把此复现补造为旧任务的正式无效果收据。

真实 Host 专项：写入含两处相同片段的隔离文件 → 读取 → 模糊编辑失败 → 原错误送回模型且文件不变 → 再读取并使用唯一上下文编辑成功 → wait → 关闭并重新启动 Host → 显式续办原任务并读回 → completed。最终保持同一个 task/session，3 条意图、2 条成功结果、1 条 `not-started` 失败结果；没有重放旧调用。

反例：真实 PrivateFileSystem 已写入文件后再抛出响应丢失错误，未写入证明为 false；既有未知效果、未知作业、精确调用防重入和对账重启用例仍按原规则阻断/保留。

## 实跑结果

### 直接相关套件

```powershell
node --experimental-test-module-mocks --test --test-concurrency=1 test/pi-file-tool-registration.test.js test/pi-file-tools.test.js test/pi-file-mutation-preflight.test.js test/pi-single-task.test.js test/pi-task-effect-reconciliation.test.js test/pi-task-effect-reconciliation-e2e.test.js test/pi-task-invocation-identity.test.js test/pi-task-effect-call-identity.test.js
```

- 整组 112 项：111 PASS、0 FAIL、1 CANCELLED。取消项是原调用身份反例在 Windows 用原始 20 秒期限超时；同文件其他集成用例已使用 `nativeTestTimeout`。
- 将该项接入既定 helper 后，仅定点复验该失败项：1 PASS、0 FAIL，实际业务 23253 ms；保留原断言。其余 111 项源码和实现未变化，不重复跑。
- 新增的编辑错误回传、纠正、冷续办、精确能力边界、写后响应丢失、重复对账拒绝及矛盾收据拒绝均通过。
- 首次新夹具试图在同一 scope 二次注册 `edit`，被真实 registry 的 `Duplicate tool edit` 拒绝；修正夹具为校验自定义定义和实际卸载后不再持有能力，整组上述相关用例已通过。未为夹具放宽生产注册限制。

### 项目守卫

`pnpm check`：PASS。源码哈希/许可证计账、生产导入及原生运行时检查均通过；生产导入检查覆盖 400 文件，外部 DSH SDK 导入数为 0。`git diff --check` 通过。

### 扩展运行时套件

`pnpm test:runtime`：163 项，148 PASS、3 FAIL、12 SKIP、0 CANCELLED，退出码 1。原失败保留：

1. `test/fixed-topics-native.test.js:264`：`native due all report shares final delivery and recovers attachments after cold restart`，`Timed out: scheduled report prepared after native cold restore`。同一实现单项复验 PASS，未查明稳定失败根因，不能抹去整组原失败。
2. `test/task-session-human-native.test.js:327`：`assert.ok(request)`，实际未生成待答记录。同环境单项仍失败。通过临时 Node load hook 仅把本次四个实现文件换为 HEAD 源码、保留其余工作树，打印确认四个模块都确实被替换后，仍在同一断言失败。说明该当前工作树基线问题并非本次修复引入；没有扩大范围修改人工待答模块。
3. `test/task-session-persistence-native.test.js:263`：resume 子进程达到原 30 秒 Windows 期限后被终止，stdout/stderr 均为空。整组结束后保持原期限单项复验 PASS，实际用例约 6915 ms。未查明该次超时根因，保留整组原失败。

12 个 SKIP 均为项目已声明需要 Linux 进程隐私 namespace 的前后台进程、取消、作业终态和冷恢复场景；Windows 保持失败关闭，没有换 full 模式抵扣。未运行独立 Linux containment 全套，不声称其通过。

## 边界与清理

- 没有真实外发、外部业务发布、CI 或安装重启。原在线任务只读核对后仍保留原未知效果状态；本次源码修复没有解除旧任务，更没有重复发布。
- 旧版丢失原始失败信息的意图不能自动补造新证明。若继续该原任务，仍需既有可信 Host 对账和独立的新动作授权；本轮没有新增或绕过操作者入口。
- 临时原版加载钩子已删除；本次持久化整组及单项复验的 34 个明确夹具目录，经 `--check` 检查限定根、真实路径和实际创建窗口后清理。这里只保留文字证据摘要，不保留完整私有会话、SQLite、脚本正文或大二进制。
- 没有复制私有 Skills、凭据或业务数据，暂存区为空；原有非本次工作树变更保留。
