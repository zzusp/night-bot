# 文件工具底层准入与核验排空：第 4 轮

## 结论

代码修复及相关场景回归通过；本轮尚未发布、结清真实旧效果或续办真实业务任务，不能据此宣布原任务已恢复。旧原始工具错误只留下通用未知效果码，无法从当前文件推定原操作成功或未开始，继续保留可能部分效果及 no-replay。

## 受验版本与范围

- 2026-11-13，Windows 11、Node.js v24.19.0、pnpm 11.25.0。
- 分支 `worktree-file-effect-recovery`；整组测试基于 `5a7a40e` 加本轮未提交工作树。最终整合主线 `315e1a60f7aa89ad7b52fa015acc53da91dc906b`，该增量仅改两份 Web 测试；四份实现源码指纹不变。
- 原主检出及其他会话改动未修改；没有复制凭据、私有技能或业务数据。

| 实现 | SHA-256 |
| --- | --- |
| src/native-fs-local.js | 483b6d241feae153ee422a8dc5615105aa108b884bf646fec2be500a45cf88e0 |
| src/pi-file-tools.js | ad617829676f70ac5e9583312c42bc79b4bcda0e7da81f2488b63eb6b856ea58 |
| src/tasks/effect-reconciliation.js | 5ba4cc399bcc11c68673f2807ef8861651b78a121543abef0d700af9d6d78252 |
| src/tasks/single-session.js | e9a28c60ada7398e65005cfb05ded5c68815134575454aaad7a1535ec8290e6f |

## 根因与修复

1. 原适配器在 `fs.writeText` 前标记开始，而底层原子锁内仍会拒绝未观察覆盖、陈旧版本及非普通文件。真实注册工具在修复前复现：原始覆盖错误存在、文件不变，但未开始证明为 false。现在由底层在任何目录/暂存/发布前保留私有失败身份，精确已结束的 Pi 执行才可使用；不按错误字段放行。
2. 核验旧未知调用会产生新输入和模型/工具记录，使原排空切点过期；原实现仅在未知意图与本租约一致时写排空证明，后续核验没有新证明。现在每个实际排空的核验 owner 记录自身证明；读者必须同时验证原 producer 证明与新 owner 切点，不冒充旧 owner，也不跳过严格 journal 解码。

## 实跑与反证

完整相关组：

```powershell
node --experimental-test-module-mocks --test --test-concurrency=1 test/pi-file-tool-registration.test.js test/pi-file-tools.test.js test/pi-file-mutation-preflight.test.js test/pi-native-filesystem.test.js test/pi-official-fs-observation.test.js test/pi-single-task.test.js test/pi-task-effect-reconciliation.test.js test/pi-task-effect-reconciliation-e2e.test.js test/pi-task-invocation-identity.test.js test/pi-task-effect-call-identity.test.js
```

整组 131 项：130 PASS、1 FAIL、0 SKIP/CANCELLED。唯一失败是负例已改为伪造同名拒绝文案，断言仍匹配旧的 response-lost 文案；实现的真实写入、未开始证明为 false 等断言均通过。同步负例的精确文案断言后，完整注册文件工具文件定点复验 14/14 PASS，约 69 秒；其余 117 项的受验源码和测试均未变化，不重复跑。最终相关场景全部通过，不把整组原失败改写成整组零失败。

- 真实 Host：先读不存在文件，外部写入后工具覆盖被拒；再读后发生外部版本变化，陈旧写入被拒；两次原错误回传、各自 not-started 失败收据，重新读取后独立写入成功；冷启动不重放，原 task/session 继续并完成。
- 注册反例：真实文件已经写入后抛出带 `FS_NOT_OBSERVED`、`effect:not-started` 的同名伪造错误，未开始证明仍为 false，保留文件和未知效果。
- 真实 Host：未知效果后冷启动，原任务只读对话读回保留结果并实际回复；核验 owner 新排空切点可 inspect，旧 producer 证明和原具体调用均保留，效果执行次数始终为 1；可信结清及离线闭合校验通过。
- 反例：只有新 owner 证明但缺原 producer 证明、未接纳 owner 绑定、scope/分支/调用篡改、最新排空后新增业务内容、活 actor、未知作业、矛盾结果及非法链接继续拒绝。
- `pnpm check` PASS：源码/许可证、440 生产导入、440 原生运行时文件，外部 DSH SDK 导入数为 0；`git diff --check` PASS。

## 未执行与后续

未重跑无关全量 runtime/routing 或 Linux containment，不声明其通过。尚未触发 CI、创建发布镜像、合并或重启当前安装；真实任务只做受控只读 inspect，仍返回旧切点过期。

发布必须基于已合并源码。获本机发布授权后按 runbook 平滑停止/重启，不创建本地备份；原任务先经只读对话产生实际新排空，再由操作者使用正式 inspect/close 结清为可能部分效果，最后由 Router 在原授权范围续办并核对真实业务执行，不直接写 SQLite/journal。
