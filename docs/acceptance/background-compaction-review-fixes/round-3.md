# 空锁离线恢复与列表复验第 3 轮

## 范围与结论

2026-11-17 用户授权修复本地记忆/技能列表刷新故障，并允许数据量大时分批统计。本轮完成**运行态恢复**，没有修改生产源码或统计算法：正常 IPC 排空实例，在安装独占锁内精确处置已检查的空无 owner 复盘锁目录，再用同一已合并发行重启。

**列表刷新及分页验收通过。** 认证显式刷新返回 `status=ready`、`cache.stale=false`、无 cache error；73 项分两页 50＋23 读取，版本一致、无重复或漏项。核心健康、恢复和两条渠道复验通过。历史“调用次数”统计另有现行覆盖限制，仍标 partial，不将其混为完整历史。

## 根因与决策

`src/memory/reflection.js:97` 仍使用 `evolution/.lock` 发布复盘状态；`src/memory/shared-migration.js:62` 也使用该锁。`packages/web-console/server/evolution-inventory.js:37` 拒绝在该锁存在时读取，保护逻辑有真实写入方，不能忽略。

故障目录在本轮前已存在，为无 owner 空目录；无 pending 或布局迁移 marker。通用 `acquireLock` 在 mkdir 后写入 owner，仅 owner 可证明死亡时才自动回收；缺 owner 保持 `NIGHT_LOCK_UNCERTAIN`。无法确认这个具体目录形成于哪次中断，不编造崩溃归因。

比较三种处理：

1. Web 忽略目录：排除，会越过真实写锁。
2. 自动将无 owner 当过期锁：排除，不能区分正在发布 owner 与残留目录，不能放宽通用合同。
3. **获授权后离线精确恢复**：采用。正常停机确认进程退出，持安装独占锁，核对空目录身份及无待提交状态，只用非递归 rmdir 处置，不修改业务正文。

## 实跑结果

| 检查 | 结果 | 证据 |
| --- | --- | --- |
| 活 Host 拒绝维护 | PASS | --check 拒绝，零删除 |
| 正常排空 | PASS | IPC shutdown=true、exit code=0；实际进程全退出，无 resident/Web 监听 |
| 离线自检与精确恢复 | PASS | 先 --check，--apply 内持安装独占锁再次绑定目录指纹；rmdir 非递归，5 个记忆元数据文件哈希保持 |
| 原版本重启 | PASS | 08a9324a29d1256bcb8f2bc4228a999cdc1f1e57；发行干净、实际进程路径匹配，配置不变 |
| 认证列表显式刷新 | PASS | 73 项，fresh，无错误；相关请求约1.38秒，不作为性能基准 |
| 全列表分页 | PASS | 50＋23，73 个唯一 ID，同一 revision；memory42 / skill31 |
| 核心与渠道 | PASS | status=ok，恢复问题0、task alerts0；两个钉钉渠道 listening / receiving，无待重启 |
| 活锁/pending 保护回归 | PASS | 3/3，0 fail / 0 skipped；写者提交才读取，持久锁保持 busy 且不修改 |
| 历史调用统计完整度 | PARTIAL_EXISTING | sessionsRead65 / discovered72；SESSION_BYTE_LIMIT、SESSION_UNAVAILABLE 明示 |

关闭时间 `2026-11-17T05:11:30.010Z`，重启时间 `2026-11-17T05:13:09.196Z`，全部渠道及 fresh 核验时间 `2026-11-17T05:14:23.981Z`。包含维护及验收，不作为压缩性能或纯启动耗时。

## 范围边界

本轮恢复目标是列表刷新，当前清单73项完整。历史使用统计来自保留且严格已提交的日志，不等于全历史：现实现每批最多读两个会话，仍有单日志大小及不可读日志的覆盖限制。没有提高上限、跳过严格解码或伪造零次数；用户允许的进一步分批汇总是可选优化方向，不是本次空锁根因。

没有产品代码变化，不重复安装、构建或全项目测试；前两轮验证及未验边界保持。不发送人工消息，不创建或删除备份，不搬动记忆/业务数据。不增加无 owner 自动回收，不能据本次恢复宣称以后不会发生残留锁。

## 证据与清理

最终必要证据：[round-3/final-repair-evidence.txt](round-3/final-repair-evidence.txt)。matrix 保留前三轮历史；第1、2轮报告与关键结果保留，中间附件清理后注明。只清理本任务不再使用的临时脚本和已结束监督器输出，保留运行发行与正在使用的监督器输出。
