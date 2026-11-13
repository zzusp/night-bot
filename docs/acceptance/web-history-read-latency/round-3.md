# 第三轮：实际部署与实时查询闭环

## 最终结论和版本

本次 Web 延迟修复、合并和本地部署完成。最终运行源码为 **`acc9c695389404c2f30f299f7f41e8615e01b17e`**（PR #135）；包含 #132 的轻量查询、#133 的严格快照复用、#134 的来源版本索引。最终鉴权接口、双历史、有效 light proof、并发 health、页面资源绑定和注销全部通过，本轮短样本未再出现首轮约 10 秒的停顿。不将短样本外推为长期延迟保证或完整业务验收。

- #134：候选 `0f331e258c95b6337c3b40ba5fffe2f849118fa3`，合并 `2eb0404a9e570ddeca1f3ca9afbd33b491e6413b`，树 `a49261681b2c08de7eae43644e358c12794da437` 与受测候选相同。
- #135：候选 `7776ce890efdb318a2819f385800e6fb8d5df5d9`，合并 `acc9c695389404c2f30f299f7f41e8615e01b17e`，树 `82d8e0cd0c9fe42bcb1f1158908e53773b133d08` 与受测候选相同。
- 核心和可选 Web 插件来自同一独立、干净的已合并发行；实际进程命令行、metadata、插件目录和两个 loopback 端口均独立核验。最终服务 PID 146464、launcher 132608、supervisor 68968。
- 依赖分别 frozen 安装，没有共享主检出 node_modules；最终发行三项源码 guard、Web 类型检查和生产构建通过，既有大 chunk 警告保留。
- 只精确替换插件目录；原安装 data、配置其余字段及原 full 模式保留，没有创建备份。原脏主检出未改动。
- 本次最终文档提交只归档结果和同字节验收脚本，不是再次部署或新的业务代码版本。

## 中间部署发现的真实接线问题

`2eb0404` 现场任务无增量 96–153ms，Router 64–80ms，并发 health 最大 218ms；但任务和 Router 的 24 次 light 查询均为 `historyChanged:true`。不以 200 记作轻量通道通过。

默认 `getSessionPersistence: () => ctx.sessionPersistence` 每次返回不同 Cordis 服务门面；底层 Pi `identity` 不变。以门面作 WeakMap 键会丢掉刚发出的 proof。真实 Host→原生 Pi→HTTP 新反例在原版失败（`true !== false`）；改为现有 `persistence.identity ?? persistence` 后 **1 PASS**，日志原字节、模型请求数及工具/todo/脱敏断言都保留。普通注入对象仍按对象身份隔离；没有延长 TTL、缓存公开历史、固定旧服务或删除字节/权限检查。

修复后 Web session-view/live **45 PASS、0 fail/skip**，覆盖秘密变化、凭证过期、实际字节改变、不同浏览器/持久化和工具配对。该回归绑定候选 `7776ce8`，其整树与最终运行 `acc9c69` 完全相同。核心 67 PASS / 1 Windows symlink EPERM 为上轮整合 `2eb0404` 的结果，未在此轮重复冒充新运行。

## 最终真实接口结果

脚本：[verify-local-web-performance.mjs](scripts/verify-local-web-performance.mjs)。参数为安装目录、现有任务、现有 Router conversation、预期发行 SHA，真实身份仅在本地传入。使用现有 token 登录，进行只读查询和注销；不创建任务、调用模型或发送渠道验收消息。

该脚本与本轮已执行脚本 SHA-256 相同：`69a66e2c96e6646a3a30b8113dbe06eb2157a238f8e824c18fe981cce438aaac`。以独立 Worker 测 health，不把同线程 timer 被阻塞期间漏采误当成低延迟。页面实际 JS 字节 SHA-256 与 metadata 指定发行的 dist 一致，HTML/JS 均 200；login/logout 200；overview `sectionErrors:{}`。

| 接口 | 本轮耗时 |
| --- | --- |
| `/api/session` | 3ms |
| `/api/overview` | 52ms |
| `/api/tasks` | 42ms |
| `/api/channels` | 19ms |
| `/api/recent-conversations` | 13ms |
| `/api/chat-current` | 15ms |
| `/api/settings` | 25ms |

| 实际历史 | 首次请求 | 5 次无增量 | 12 次有效 light | 同期 health |
| --- | --- | --- | --- | --- |
| 原任务 | 105ms | 145/196/128/113/110ms，中位数 128ms | 45–199ms，中位数 90ms；全部 `historyChanged:false` | 135 样本，中位数 5ms、p95 48ms、最大 192ms |
| 原 Router | 110ms | 80/108/70/78/81ms，中位数 80ms | 27–147ms，中位数 56ms；全部 `historyChanged:false` | 118 样本，中位数 7ms、p95 32ms、最大 210ms |

无增量历史始终空数组；light 使用最近一次 full 返回的 proof，空历史且全部有效。与首轮现场任务 10688ms / health 10109ms 对比，本轮最大分别为 196ms / 210ms；与中间发行的比较不能单独归因给稳定身份修复，因为缓存、系统负载和采样时点不同。

本轮两个真实会话 `live.active:false`，没有冒充真实模型正在流式输出或人工点击 UI 的验收；真实 Host 和 live 输出的集成回归另外保留。

## 探针修正与未隐藏的失败

- 早期探针把 light 的空历史数组误断言为 undefined，按既有正式契约修正为不含历史条目；正式接口代码和断言范围没有因此放宽。
- `acc9c69` 首次完整探针仍持有更早的 full proof，收到失效返回，未记通过；即时 full→light 的任务/Router 均返回 false。最终按页面使用最近 full 凭证的协议重跑，24 次有效；没有据此猜测旧凭证每次失效的原因或延长有效期。
- 首轮注销缺 JSON 请求体返回 415，已按原接口协议修正；最终真实注销 200。上述均是验收脚本问题，未当作服务崩溃或静默略过。

## 原任务、安全与遗留

- 重启前后仍 11 个任务、9 个已完成；两个未完成任务的 sessionId、要求版本及 drained 标记均与原账本一致，未换会话、重建任务、手改状态或重放旧调用。
- 实际 Web 仍分别显示 running / waiting；不能用 running 标签或重启接管认定业务已恢复成功。当前恢复告警为 `TASK_SESSION_DRAIN_FAILED` 与匿名化的 `BUSINESS_WAIT`，health `degraded`、2 条告警；没有解除未知效果保护或代答业务等待。
- 旧实例正常 IPC 关闭仍报既有 `Cannot read properties of undefined (reading 'plugins')` / `Host shutdown failed; ownership retained`。按用户允许中断的授权，核验精确 PID/父链/命令行、零业务子进程及业务端口关闭后才强制结束残留；随后独立确认旧进程、metadata 和诊断 9229 监听消失。不得记为正常排空通过。没有删除锁、WAL、journal 或未知作业收据。
- 第一轮完整 Web 295 PASS / 1 FAIL / 2 SKIP、完整 runtime 中断及部分未逐项对照失败，第二轮 Windows symlink EPERM 继续保留。本轮没有重跑完整组，不宣称全量全绿。
- 最终新 supervisor stderr 为空；未手动触发 CI、未发送真实渠道验收消息。历史轮次报告和矩阵保留；私有 CPU profile/身份/凭据/正文不提交，临时脚本仅按本任务资源范围清理，运行所需的发行和 supervisor 不删除。
