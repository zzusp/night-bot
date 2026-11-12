# 第一轮：编辑、撤回与持久化回归

## 结论与源码

本地相关验证通过；真实渠道恢复仍待已合并版本部署，不把 fake DWS 或端口可用当作现场通过。

- 日期：2026-11-12，Windows 11、Node.js 24.19.0、pnpm 11.25.0。
- 受验代码：`8591e336649ae08b697b4cf1903f84e3b2c6f1e6`，已整合 main `485f100489ef8ca64d595166cef3ba0a7ec413ea`（性能 PR #76）。验证结束时 src/packages/test 无未提交修改；之后只更新验收文档。未提交的部署路径替换临时脚本不属于运行代码。
- 原故障：同一消息 ID、作者及会话的正文被编辑，插件仍提交 version=1，碰撞冻结输入。原账号另一渠道正常、精确详情可读，且仅替换正文即可重建旧/新指纹，排除整体宕机与整体历史读取权限缺失。不公开真实消息、身份、配置或私有路径。

## 最终有效验证

| 检查 | 实跑结果 | 证明范围 |
| --- | --- | --- |
| `node --experimental-test-module-mocks --test --test-reporter=tap --test-concurrency=1 test/pi-channel-plugin.test.js test/pi-router-ledger.test.js test/pi-triage.test.js test/pi-resident-router-flow.test.js` | 102 PASS，0 FAIL，0 SKIP，exit 0，1145437 ms | 真实 Host/Pi/SQLite、本地模型端点及 fake DWS；编辑精确回读、并发去重、迟到事件、失败保留暂缓、冷补拉，群/单聊 recall、墓碑、原子撤权、在途分诊与原回执守卫 |
| `node --experimental-test-module-mocks --test --test-name-pattern='initialized default CLI' test/pi-runtime-data.test.js` | 1 PASS，0 FAIL，exit 0 | 真实 launcher/worker、任务 completed+drained、正常退出 0；观察到两个实际进程，DWS 启动次数 0，DWS 插件/runner/bridge/adapter 模块加载数均 0 |
| 同文件 `--test-name-pattern='new Night Bot data restores\|initializer creates\|credential values\|Windows 原子'` | 4 PASS，0 FAIL，exit 0 | A→B 恢复、Pi 历史续办、原配置不覆盖、凭据边界、真实 Windows 共享锁下短暂占用成功及持续占用保留旧字节并报错；无 `.write-*` 残留 |
| `node --test test/dws-adapter.test.js test/dws-bridge.test.js` | 102 PASS，0 FAIL，0 SKIP，exit 0 | 原适配器及桥接回归；此后这些运行文件未再修改，未无意义重复跑 |
| `pnpm check` | exit 0 | 190 保留、10 退休、3 排除、59 适配；425 production/runtime 文件、202 literal bare imports；外部 SDK imports/旧编排定义均 0 |
| `git diff --check`、暂存区及 `git ls-files` 检查 | 通过 | 无空白错误，无运行数据、凭据或私有 Skill 引入 |

编辑/撤回专项覆盖：v1 原文留存与 v2 新来源；canonical 读取失败或换会话/作者拒绝；旧事件不能回退；明确撤回使全部旧版本失去后续授权；重复 recall、未知消息先 recall、旧正文与冷恢复不能复活；context→source 中断及 context 提交前中断沿原 pendingRecalls 补齐；旧正文成功消费不能清除未提交 recall；完整空页不能吞掉已知暂缓消息。未知发送仍走原独立 readback，不自动补发或回滚外部效果。

## 本轮失败与修正

1. Windows 原子替换反复出现真实 EPERM。先以不授删除共享的内核句柄重现失败，再修正既有 atomicWrite，仅重试同一已写入/fsync 的临时文件 rename。持续占用仍失败并保留原目标，不降级非原子写、不改路径或权限。具体现场占用进程未识别。
2. 旧账本夹具直接 claim 当前合同要求初始化的任务，13 项出现 TASK_WORKSPACE_NOT_READY。复用已有 initializeMemoryTaskWorkspace，实际创建目录并执行 begin/finish 事务；未放松生产 guard。整文件独立 24 PASS，随后纳入最终 102 PASS。
3. 较早六文件组合在默认 CLI shutdown ownership-retained 后未自然退出，已停止本会话测试，不能算通过。整合最新 main 后该用例独立真实运行 1 PASS、任务排空、进程正常退出 0；其后尚未执行的数据用例以四项组合补齐。未将被停止的组合计为通过，也未强行释放 Host 所有权。

## 边界与后续

- 没有执行全量 pnpm test / runtime / containment；性能 PR 的既有全量运行时失败不在本轮修复范围，参见其 round-2，不冒称全量绿。
- 未主动发送真实测试消息；真实编辑冲突的恢复、供应商订阅 ready 与实际接收水位在第二轮部署后核验。离线期间未收到明确 recall 的缺项仍失败关闭，不推断为撤回。
- 本轮部署前只读发现旧监督器已退出，其日志记载 stopped/code=0/signal=null；当前任务 7/7 completed+drained、SQLite quick_check=ok、原 v1 与 deferred 均在。本会话未发本轮停机请求，不补造 IPC 请求或退出计时。
- 无数据库迁移或旧数据覆盖。升级保留同一 data；旧版不认识新修订/墓碑时，应先停用渠道并保留状态，不删除元数据迁就旧版；本地按既有用户选择不创建备份，不承诺无损格式回退。
