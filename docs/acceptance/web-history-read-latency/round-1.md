# 第一轮：历史读取提速

## 源码和结论

验证基于 origin/main `935785f64cecfd26d34f75278175de906c03e1fb` 加 worktree-web-api-latency 的未提交差异；涉及持久化读取、Web live 投影及配套测试/说明。提交前 API 再次核对 main 未变化。主检出的既有脏源码未修改。

性能修复及受影响安全契约验证通过。完整回归不全绿：Web 有原版同样复现的 Router 失败；runtime 有多项失败且整组未正常退出，不声称全量通过。合并/部署结果以 PR 的后续自包含记录为准，本报告不将尚未发生的部署写成通过。

## 实现

- 每次仍检查受控路径并读实际字节；仅对路径、codec、物理字节完全相同的完整已提交快照复用解析结果。32 MiB 原始字节 LRU，返回独立副本，关闭清空。
- live 保留准确的官方 pending call 绑定，只投影临时增量；未调整轮询频率，不缓存脱敏后的 Web 正文，每次用当前秘密集合脱敏。
- 冷读、增长中的日志及预算外日志仍完整严格解码；没有修改 writer、离线维护、业务授权和未知效果防重放。

## 已执行验证

| 验证 | 实际结果 |
| --- | --- |
| `node --test test/pi-maintenance-journal.test.js test/pi-routed-journal.test.js` | 13 PASS，0 fail/skip；覆盖完整提交、同大小并恢复 mtime 的篡改、warm 后物理尾、链接/缺失/路由变化、新提交、副本隔离和取消。 |
| `node --test packages/web-console/test/session-view.test.js packages/web-console/test/live-output.test.js` | 初次 39 PASS；新增块位置/重复 ID 测试后 live 文件 11 PASS。计数重叠，不相加。 |
| `pnpm check` | 三项 guard 通过：190 retained / 10 retired / 60 adapted；446 production/runtime JS，external SDK imports 0。 |
| `pnpm --dir packages/web-console build` | 类型检查及 Vite 构建通过；既有 637.20 kB JS 大 chunk 警告保留。 |
| `pnpm --dir packages/web-console test` | 298 项：295 PASS / 1 FAIL / 2 SKIP。真实 Host HTTP 的已提交 Pi 历史、任务进度、当前秘密刷新及失败关闭均 PASS。 |
| 原版 Web Router 同用例反证 | `persistent idle Router retains committed business history across messages` 在未修改发行同样报 `ROUTER_BATCH_UNSETTLED`；修复版同错误。 |
| `pnpm test:runtime` | 完整组未正常退出，停止本任务运行器前已输出 95 PASS / 14 FAIL_OR_CANCELLED / 11 SKIP；这是输出行统计，不是完整终态汇总。未跑过的技能文件独立补跑 7 PASS；收尾故障及 PDF 文件两项在新旧版独立均 PASS。整组收尾阻断未收敛，不能据单项通过追认为整组通过。 |
| runtime 原版反证 | 人工答复 retry 用例在原版/修复版均于同一断言 `0 !== 1`；未知效果 hold 用例原版同样触发既定 20000ms 超时。其余失败未逐项完成基线对照，保留盲点，不统称全部是旧问题。 |

跳过项沿用平台与夹具的既有 skip；未扩大应用沙箱或调整测试预算。未修改与性能无关的业务测试/代码来消除失败。

## 真实历史 HTTP 最终对照

复用 [compare.mjs](scripts/compare.mjs)，分别加载未修改发行与修复工作树的真实 Web 插件和 Pi persistence。输入为同一份本机既有 18,565,975 字节日志，只读并核对前后 SHA256 相同；没有复制业务正文/身份/秘密入库，没有启动业务 Host、模型或渠道发送。轻接口探测由独立 Worker 客户端发起，避免服务端事件循环暂停导致同线程计时失真。登录、页面入口及构建资源可用；每次测试后 logout、关闭插件并清理隔离目录。

在完整回归进程结束后复测，毫秒：

| 指标 | 原版 | 修复 |
| --- | --- | --- |
| 冷读 HTTP | 296 | 296 |
| 无增量 HTTP，5 次 | 248 / 270 / 1266 / 1453 / 1269 | 92 / 78 / 124 / 214 / 393 |
| 无增量中位数 | 1266 | 124 |
| readNative（冷读 + 5 次） | 261 / 227 / 228 / 1138 / 1322 / 1157 | 259 / 71 / 53 / 79 / 75 / 295 |
| 轻接口请求（含冷读期间） | 301 / 217 / 237 / 1238 / 36 / 1360 / 39 / 1182 | 304 / 50 / 45 / 89 / 188 / 21 / 302 |
| 轻接口最大值 | 1360 | 304 |

每次 checkpoint 请求均 0 新增；两版使用相同环境秘密集合及各自临时 Web 令牌。这里只证明受影响插件 API 的改善，不证明持续增长的大历史完全无阻塞。冷读未提速，快照克隆、Web 投影及 GC 仍有成本。

## 边界和反证

先前同快照对照中，旧/新跨块脱敏只差十几毫秒，不能解释真实秒级排队；没有删掉脱敏求速度。runtime 14 项失败/取消和整组收尾仍是显式遗留，不被性能 PASS 掩盖。真实厂商发送、其他操作系统和沙箱未在本轮验收；既有未知后台作业、业务等待未解除或重放。

本轮不保存私有 journal、正文、cookie、令牌或原始业务输出。宿主的临时执行输出仅作当次排障；本报告包含最终数值和必要失败摘要，交付后清理本任务的 ad-hoc 文件和进程，保留此报告、matrix 和通用验收脚本。
