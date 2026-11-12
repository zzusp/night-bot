# Markdown 分层记忆验证记录

基线：`2e25d6657c1add403f544622866cf357f09d0a2e`（包含 PR #78、#79）。
环境：Linux，Node.js 24.22.1，pnpm 11.25.0；测试使用临时合成数据及本地模型端点。

## 实现范围

- 同一 Bot 公共 Markdown 库：总索引 → 分类索引 → 单条正文 → 按需来源摘录。
- 总目录和分类目录均使用标题、相对链接、一句话摘要；普通读取和索引检索不扫描正文。
- public `memory_read` 无 topic 读总索引，只有 topic 读分类索引，有 topic/key 才读单条；
  `includeSources:true` 显式打开该条来源文件。`memory_search` 默认检索索引，fulltext 必须显式选择。
- Skill 目录和支持关系检查只读索引 key。修订、遗忘、候选、来源归因、适用对象及过期控制保留。
- 写入仍使用跨进程租约、持久 redo、fsync/原子替换；读取恢复已提交事务后再访问选定层。
- 文件名支持长 Unicode、大小写及 Windows 保留名称，Markdown 链接可解析到真实文件。
- Web 保留 PR #78 的分页缓存，仅适配索引与选中详情，没有新增核心 Web 数据库或清单。
- 复盘收集已提交 completion 的 evidence/limitations，版本匹配才补充 request/objective。
  保留输入哈希和裁剪覆盖信息。三段内容可以更完整，但不生成没有来源的原因或事实。
- 旧布局必须使用[离线迁移流程](../MEMORY-MIGRATION.md)。默认检查无写入，apply 先备份，
  保留旧原件和防重/遗忘收据，支持显式崩溃续跑，拒绝活动 Host、路径别名、坏哈希及未知冲突。
  旧布局或未完成迁移使必需的 memory 服务拒绝启动，不由可选 reflection 服务兜底。

## 测试结果

各组存在重叠，不能直接相加。

| 检查 | 结果 |
| --- | --- |
| `pnpm install --frozen-lockfile` | 通过，锁文件未修改 |
| `NIGHT_BOT_TEST_CONCURRENCY=2 pnpm test` | 1612 通过，0 失败，23 跳过；随后源码/导入/Pi 守卫通过 |
| `NIGHT_BOT_TEST_CONCURRENCY=2 pnpm test:routing` | 93/93 通过 |
| `node --test packages/web-console/test/*.test.js` | 240/240 通过 |
| 记忆、迁移、官方源、复盘、evolution 联合定向测试 | 最后重跑 119/119 通过 |
| `test/pi-memory-store.test.js` + `test/pi-memory-layered-migration.test.js` | 38/38 通过，其中迁移 16 项 |
| memory wire/progressive 启动检查 | 22/22 通过 |
| `test/native-memory-privacy-kernel.test.js` | 8/8 通过 |
| `pnpm check`、`git diff --check` | 通过 |
| `NIGHT_BOT_TEST_CONCURRENCY=2 pnpm test:runtime` | 158 通过，4 个既有失败，见下 |
| `pnpm test:containment` | 20 通过，2 个既有失败，见下 |

全量默认运行中补充了测试和最后的启动/快照校验；相关最终文件均再次跑过上述定向测试，
Web 全套亦重跑通过。没有把新增测试数量混入较早开始的全量计数。

### 基线同样失败的检查

在独立干净的 `2e25d66` 检出上使用相同定向命令确认，未改相关生产代码或放宽权限断言：

- `task-session-execution-provider-recovery-native.test.js:160`：一次 provider 失败的人类复核场景中，
  `question.reviewFailures` 为 undefined，调用 `.at(-1)` 失败。
- `task-session-service-native.test.js:203` 的三个来源补充场景：`taskTurns` 为 1，断言期望 2。
  clean baseline 与本分支同样 4/4 失败。
- `native-shell-env-kernel-wire.test.js:22` 的 portable true/false 两项：shell 环境/凭据过滤结果
  与测试预期不符，干净基线相同。未为通过测试修改执行模式、环境注入或 sandbox。

因此不能宣称全部运行时和 containment 检查全绿。这些基线问题需要单独处理。

## 已验证的关键边界

实际文件读取观测证明：根读取不打开分类、正文、来源或候选；分类读取只打开指定分类；
单条读取只开选中正文；显式来源读取只开对应来源。还覆盖不相关正文损坏不阻塞目标读取、
超过 50 条的 Web 完整目录、过期和适用对象、并发写入、修订冲突、遗忘及崩溃恢复。

迁移覆盖默认 CLI 无副作用（字节、mtime、mode 不变）、完整 metadata/context/previous 保留、
备份字节校验、真实子进程强退和死亡租约恢复、完成后再遗忘不复活、目标/备份篡改拒绝，
以及最长 Unicode 标签。深层符号链接、source 目录、memory 根祖先和 redo 目标均有拒绝回归。

Linux 读取采用锚定目录句柄的 no-follow 校验；写入仍是租约加路径祖先检查，不能宣称能抵抗
同一 OS 账号下恶意并发改动文件树的程序。Windows 只有便携路径设计和 Linux 合成测试，
未进行 Windows 真实执行、真实模型质量验收或生产数据迁移。未推送、合并、部署或触发远程 CI。
