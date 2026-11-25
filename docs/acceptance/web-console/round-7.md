# 第七轮：执行记录去重、Pi 实时订阅与正文复核

2026-11-25，Windows 11、Node 24、Chromium。受验版本：`worktree-task-execution-duplicate-messages`，基线 `e0c4f256fc4d6fbb2c588a2f507af6857da6f54c`，代码未提交。将 `src/`、`packages/web-console/`、`test/fixtures/` 下相对 HEAD 的变更和新增文件按路径排序、逐文件计算 SHA-256，再对清单取 SHA-256：`c3cdef78e41b5b2cecc97e6a9cd143a88b85e60b7f8e996c6131e6b6a1b4f236`。

- **浏览器 22 项通过**：真实 EventSource 下，任务详情和 Router 均收到临时快照，健康连接观察 3.1 秒无历史 HTTP 请求，断线期间写入的记录在重连后用原游标补齐。650 行夹具用真实滚轮测试同一条记录只有一个用户气泡，相同正文但不同 ID 的记录仍分别显示。提交等待、前后分页、滚动位置、正文撤权和 HTTP fallback 回归通过。受保护正文的浏览器用例使用真实 SSE 连接和独立的 HTTP 权限夹具：收到 409 立即清除旧正文，不等重取响应。
- **相关接口和 Host 6 项通过**：真实 Pi 任务在提交前 SSE 可见临时文字，提交后沿旧游标补读同一正式记录；读取和关闭 Web 不改写日志、不追加模型请求。真实 Router 的 SSE 不发送独立记忆正文，且在正文锁被夹具阻挡时仍发首次快照与心跳；独立 HTTP 续页在正文改变时因旧授权返回 409。注销使已打开的 Router 流收到 401 失效帧并关闭。其余覆盖旧轻查询、正文更改撤权、到期与单锁。
- **Pi 临时工具 10 项、Web 构建和 `pnpm check` 通过**；检查中另有现存的大 JS bundle 构建提示。慢连接的人工网络压测、UAT 反代和真实流量性能未验证。
- **性能样本**：前一阶段用同一隔离 HTTP 夹具比较有正文凭证的空刷新，各四次，中位数约 1.41 秒 → 0.65 秒。最终串行接口回归的四次约 0.82–1.24 秒，均只取一次记忆锁，未携带凭证时没有取该锁。两组时延不能代替 UAT p95；SSE 的浏览器证据是消除无正文场景的固定历史请求，不是线上时延对比。

较大并行接口组实跑 120 通过、2 失败、1 取消，未报全绿。Router 测试初次因夹具帧分隔符出现语法错误，修正后最终真实接口组通过；排空测试并行超时、串行通过。复盘测试期望 3 次模型请求，实测 4 次；用只读 Node 加载钩子恢复所有已修改的 JS 到 HEAD 版本，基线同样为 4 次。此前 Windows 记忆并发写测试报 `NIGHT_DATA_IN_USE`，在基线存储实现也已复现。未为这两项修改断言、超时或生产锁。

复验命令：`pnpm --dir packages/web-console build`；`pnpm --dir packages/web-console test:browser execution-live-output.spec.ts execution-scroll.spec.ts transcript-first-paint.spec.ts`；`node --test test/pi-shell-live-output.test.js`。接口组以 `--test-concurrency=1 --test-name-pattern` 运行 `session-host.test.js`、`resource-tool-content-runtime.test.js`、`resource-tool-content.test.js`、`server.test.js` 中的真实任务、真实 Router、旧轻查询、正文撤权、零新增单锁和批量授权六项。

没有提交、推送或部署。UAT 原偶发页面报错缺少现场时间和错误码，仍未定位。中间截图、失败 trace 和浏览器临时目录在本轮收尾清理；结果以上述文字为准。
