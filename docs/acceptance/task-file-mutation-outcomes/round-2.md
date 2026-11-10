# 最新主线隔离分支验收：第 2 轮

## 结论

本 PR 的 112 项直接相关回归全部通过，0 FAIL、0 CANCELLED、0 SKIP；项目源码、生产导入和原生运行时守卫通过。原问题修复前后对照确认：同一个多匹配编辑纠错场景在原实现中变成 `blocked`，本次实现可返回原错误、修正并在同一任务完成冷续办。

扩展运行时仍有人工待答基线失败，不能宣称全量 runtime 全绿。该用例与编辑错误误升级是不同路径；本轮保留事实，不扩大修改人工申请模块。

## 实际受验源码

- 日期：2026-11-10；Windows 11，Node.js v24.19.0，pnpm 11.25.0，官方 Pi coding-agent 1.5.0。
- 最新主线 base：`585e1c767ee7d45b6422ff43e5d288489c06f697`；分支：`worktree-task-file-mutation-outcomes`。
- 从 fetch 后的 `origin/main` 创建独立 worktree，仅迁入本次 4 个实现文件、4 个测试文件、README 自己新增段落、Windows 运维新增节及本任务方案/验收记录；未混入原工作树的 Web、首答、渠道及分页改动。
- 实跑针对该 base 上的未提交工作树；依赖用 `pnpm install --frozen-lockfile` 独立安装，根 `node_modules` 为本 worktree 实体目录，没有整体链接主检出，未复制环境文件、账号、凭据、业务数据或私有 Skills。
- 本轮准备提交时再次 fetch，`origin/main` 仍与上述 base 一致。本轮以下 8 个文件与第 1 轮最终版本逐项 SHA-256 相同；其余主线上游变化已实际纳入本轮执行环境。

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

## 实跑结果

### 本次修复专项

```powershell
node --experimental-test-module-mocks --test --test-concurrency=1 test/pi-file-tool-registration.test.js test/pi-file-tools.test.js test/pi-file-mutation-preflight.test.js test/pi-single-task.test.js test/pi-task-effect-reconciliation.test.js test/pi-task-effect-reconciliation-e2e.test.js test/pi-task-invocation-identity.test.js test/pi-task-effect-call-identity.test.js
```

112 PASS、0 FAIL、0 CANCELLED、0 SKIP，退出码 0，约 344152 ms。包含：

- 多处匹配时原文件不变，原 Pi 错误返回模型；读取后唯一上下文修正成功。
- 失败结果为 `isError: true, effect: not-started`，不是成功；冷启动不重放，显式继续仍用原 task/session 并最终 completed。
- 已开始写入后丢失响应不可声明未开始；取消、未知作业、同名替换、伪造执行及防重入保持原保护。
- 已结清失败不可重复对账；矛盾结果校验拒绝。

### 直接修复前后对照

保留同一 `test/pi-single-task.test.js:178`，用临时 Node load hook 仅将 4 个实现模块替换为 base 中的原版源码，日志确认全部四个模块被加载为原版；没有改磁盘上的源码或历史账本。

原版实测在 `test/pi-single-task.test.js:189` 失败：`actual: blocked`，`expected: wait`。这个断言位于多匹配编辑之后、纠正执行结束位置，直接证明旧平台把可修正的编辑错误锁为未知效果。新版同用例包含原错回传、修正、关闭/重启、原任务续办的完整路径，在上面 112 项中通过。

### 守卫与扩展复验

- `pnpm check`：PASS。源码哈希/署源、生产导入与原生运行时检查通过；生产导入检查覆盖 404 文件，外部 DSH SDK 导入数 0。
- 第 1 轮三个 runtime 失败项在最新主线隔离环境定点复验：3 项中 2 PASS、1 FAIL，退出码 1。报告冷恢复和真实进程 resume 通过；人工待答仍失败。
- `test/task-session-human-native.test.js:327`：`assert.ok(request)`，未生成待答记录。用同样临时 loader 仅移除本次 4 个实现增量后，最新 base 上仍在同一断言失败（0 PASS、1 FAIL）。这是当前主线已有的独立失败，未在本 PR 修复。
- 第 1 轮完整 `pnpm test:runtime` 为 148 PASS、3 FAIL、12 SKIP，本轮不重写该历史结果，也未再跑完整 runtime。12 个 Linux namespace 跳过项仍不能据此声称通过。
- `git diff --check` 通过；无相关源码改动后不重复验证。

## 交付边界

- 本轮目标为提交本次修复 PR，不合并、不部署、不重启现有安装、不真实外发、不重跑外部业务发布、不自动解除旧未知状态。
- 旧版未知意图没有新边界证明时不补造失败终态；继续须既有可信 Host 对账和独立授权。
- 新收据的 `effect` 字段为严格 schema 增量，旧版不认识；产生该收据后回滚需要匹配代码和离线数据备份，不删字段或修改原收据。
- 临时原版 loader 和隔离测试的中间产物均在本轮结束后清理，只保留文字结果与源码哈希。原工作树、分支和其他会话的文件没有被切换、提交或清理。
- 第 1 轮原工作树与本轮隔离分支的状态分别保留；后续以本轮 PR 分支证据为最新判断入口。
