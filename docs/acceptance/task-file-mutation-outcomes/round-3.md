# 最新恢复逻辑整合验收：第 3 轮

## 结论

整合最新主线的会话索引和 Pi 日志读取优化后，本次文件纠错专项 112 PASS、0 FAIL、0 CANCELLED、0 SKIP，源码守卫通过。人工待答独立用例仍在原断言失败，完整运行时不作全绿声明。

## 实际受验源码

- 日期：2026-11-10；Windows 11、Node.js v24.19.0、pnpm 11.25.0、官方 Pi coding-agent 1.5.0。
- 分支：`worktree-task-file-mutation-outcomes`；base/HEAD：`ee5becc4affbc7b6ad4e301481953f466b0057d6`，执行结束时独立核对仍与 `origin/main` 一致。
- 受验对象为该 base 上本次未提交工作树，不以 HEAD 单独代表最终源码。4 个实现文件及 4 个测试文件的 SHA-256 与 [第 2 轮表格](round-2.md#实际受验源码) 逐项相同。
- 第 2 轮后主线前移，涉及 `src/native-workspace.js` 和 `src/pi-session-persistence.js` 的冷启动枚举/读取路径，因此先快进整合，再重跑涉及恢复的直接相关套件；没有改动上游恢复实现或放宽检查。README 与 Windows 运维新增段落均保留上游内容。
- 继续使用独立安装的冻结依赖；本轮上游未改变 package.json 或 pnpm-lock.yaml。未复制主检出运行态、凭据、业务数据或私有 Skills。

## 实跑结果

### 文件纠错、恢复和防重放

```powershell
node --experimental-test-module-mocks --test --test-concurrency=1 test/pi-file-tool-registration.test.js test/pi-file-tools.test.js test/pi-file-mutation-preflight.test.js test/pi-single-task.test.js test/pi-task-effect-reconciliation.test.js test/pi-task-effect-reconciliation-e2e.test.js test/pi-task-invocation-identity.test.js test/pi-task-effect-call-identity.test.js
```

112 PASS、0 FAIL、0 CANCELLED、0 SKIP，退出码 0，约 300458 ms。

- 多匹配编辑错误原文返回模型，失败时原文件不变；读取后使用唯一上下文修正成功。
- 失败结清为 `isError: true, effect: not-started`；关闭/重启后不重放，显式继续原 task/session 最终 completed。
- 仅精确注册且已排空执行获得未写入证明；克隆执行、同名定义、已卸载注册拒绝。
- 真实文件已写入后丢失响应不可声明未开始；取消、权限/版本检查、未知效果禁止重放、原调用身份去重与严格对账回归通过。
- 已结清失败不能重复对账，矛盾收据拒绝。
- 同一个编辑用例原实现 `blocked !== wait` 的直接红绿对照已在第 2 轮实跑；本轮未重跑旧实现，不把历史对照冒充本轮新执行。

### 已知人工待答失败

```powershell
node --experimental-test-module-mocks --test --test-concurrency=1 --test-name-pattern='an original official task tool result cannot bypass human waiting and survives same-session reply' test/task-session-human-native.test.js
```

0 PASS、1 FAIL，退出码 1。`test/task-session-human-native.test.js:327` 的 `assert.ok(request)` 仍为 `actual: undefined`，未生成待答记录；本轮没有修复该路径。第 2 轮移除本次四个实现增量后的同断言失败证据保留在原报告中，本轮未重新运行基线替换。

### 项目守卫

`pnpm check`：PASS，退出码 0。生产导入/运行时检查各覆盖 404 文件，外部 DSH SDK 导入数 0；保留署源、源码哈希与原生运行时守卫。提交前空白检查亦通过。

组合后台命令最终退出码为 1，原因是上述人工待答用例失败；专项与守卫分别为 0，不能把组合失败掩盖为整组通过。

## 范围与交付

- 仅提交本次实现、测试、README/运维说明与方案/验收记录，不包含原主检出其他会话改动。
- 第 1 轮完整 runtime 的 148 PASS、3 FAIL、12 SKIP 以及第 2 轮失败项复验保留；本轮未再跑完整 runtime、报告冷恢复和独立进程 resume 定点项。Linux namespace/containment 未运行，不以 Windows 专项替代。
- 未合并、未部署、未重启现有安装、未真实外发、未重跑外部业务发布、未自动解除旧任务未知状态；旧意图对账与回滚边界仍按方案及运维说明执行。
- 各轮文字结果与 matrix 历史保留，收尾仅清理本 worktree 本任务的临时测试产物与 PR 草稿，不处理原主检出的业务数据。
