# 本地部署与安装验收：第 4 轮

## 结论与版本

PR [#33](https://github.com/zzusp/night-bot/pull/33) 已于 2026-11-10T08:48:37Z 合并；本地安装现运行精确 merge `1d976a2cd9d7b7f66ae83cf7ae44e2e12bfde115`，替换 `568fd2813e2d553741a76b0c76bbfffb869891f8`。正常 IPC 排空、切换及原双渠道恢复完成，部署目录的 3 项纠错/安全回归和源码守卫通过。

实例保留部署前的 `degraded`、`recoveryIssueCount=1`；原外部效果待核实任务和告警没有自动解除。人工待答独立失败仍以第 3 轮为最近实跑结论，本轮没有修复或重跑，不宣称全量 runtime 全绿。

受验对象是安装目录内干净的精确合并树，不是主检出的脏工作树。第 3 轮之后的主线增量仅为上一部署任务的文档；本轮四实现、四测试及根/Web 依赖清单和锁文件与第 3 轮所验源码相同，八文件实际 SHA-256 与最终结果见 [deployment-proof.json](round-4/deployment-proof.json)。本轮之后的验收文档提交与运行源码版本分开，不因回填文档重新部署。

## 部署与真实终态

- 按 Windows/Web runbook，先构建合并版本、执行 `--check` 零副作用预检，再通过原 supervisor 管道发正常停机。没有强退、手工删锁、移动数据、改配置或升级权限；旧三个运行进程均退出且原所有权释放。
- 根及 Web 依赖相对原发布未变，安装端沿用原依赖；构建端独立执行 `pnpm --dir packages/web-console install --frozen-lockfile`、`pnpm --dir packages/web-console build`。TypeScript 与 Vite 通过，296 modules；单 chunk 超过 500 kB 为非阻断提示，未改打包策略。
- 在同一受控发布工作树切换至 merge 后部署新静态文件，再沿原受管入口启动。保留原数据目录和既有认证映射；已有外部凭据来源仍是原安装例外，没有复制凭据、改外部仓库或声称秘密路径已统一。
- 真实 Web 首页及其 CSS/JS 共 3 文件经 HTTP 回读，SHA-256 与该 merge 的构建及部署文件一致。独立核对新版 supervisor/launcher/worker 存活，launcher/worker 命令行指向实际发布目录，3080 与 19198 均由该 worker 在 loopback 监听。
- 认证渠道 API 回读原两个渠道均 `connected=true`、`listening`、无运行错误、无需重启；两个 ingress 均未暂停、无 deferred，`recoveryFromAt` 已清除，补拉完成水位推进。没有新消息，消费水位保持不变。
- SQLite 18 来源、14 通知、5 任务、0 执行记录逐记录哈希与停机前一致，14 通知仍 delivered；18 条 messageFacts 及驻留 groups/tasks/alerts 哈希一致，`quick_check=ok`，配置字节哈希不变。没有发送测试渠道消息、重放通知或重新执行原业务发布。

## 连续计时

从正常停机请求直到 Web、resident HTTP 可用且原两个渠道实际恢复，使用同一 `performance.now()` 连续计时；250 ms 轮询、单次 HTTP 必要超时 2 秒，无整体截断。

| 指标 | 耗时 |
| --- | ---: |
| 正常停机并释放所有权 | 0.181 秒 |
| 切换及启动前检查 | 1.257 秒 |
| 启动和原渠道恢复 | 18.179 秒 |
| **完整部署重启** | **19.617 秒** |

现场时间为 2026-11-10 16:54:41.499 至 16:55:01.117（+08:00）。这是本次观测，不是稳定耗时上限，也不据此计算受控性能提升比例。

## 部署后行为验证

在实际发布目录运行，不改现有安装配置，不调用真实模型或渠道；夹具使用隔离目录和本地脚本模型：

```powershell
node --experimental-test-module-mocks --test --test-concurrency=1 --test-name-pattern='a pre-write Pi edit error preserves its original result|a real filesystem write followed by a lost response|an explicit verified source requesting identical unknown effects' test/pi-single-task.test.js test/pi-file-tool-registration.test.js test/pi-task-effect-call-identity.test.js
pnpm check
```

- 3 PASS、0 FAIL、0 CANCELLED、0 SKIP，约 50118 ms：多匹配原错回传→唯一上下文修正→原 task/session 冷续办完成；真实写入后丢失响应不得声明未开始；真实未知效果在未对账前仍禁止重放。
- 安装目录 `pnpm check` 退出 0，source/hash、production-import、Native runtime 守卫通过；各覆盖 404 文件，外部 SDK import=0。
- 第 3 轮 112 项与本轮源码逐项绑定，本轮没有重复跑整组。未重跑完整 runtime、routing、Linux containment 或全量 UI 浏览器场景；Web 构建及真实资源回读不能替代完整浏览器验收。

## 记录与清理

保留全部 round 历史、matrix 历史及本轮脱敏最终 JSON，不保留业务数据库、完整会话、凭据、私人哈希映射或原始日志。收尾仅清理本任务不再使用的助手、基线和测试中间产物；仍托管现有实例的本任务 launcher 留在忽略目录，不删除旧任务仍使用或属于其它会话的资源。主检出的分支、文件和已有改动没有被切换或提交。
