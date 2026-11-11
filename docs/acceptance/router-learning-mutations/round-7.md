# 第 7 轮：本地七条轻量记忆与学习 Skill 更新

## 范围与结论

按用户明确选择，合并 PR #64、正常升级本地安装，受控更新现有 7 条记忆，并重建 3 个已有学习 Skill。磁盘和真实认证 Web 回读全部通过：记忆均只有 Summary、Why、How to apply 三段，无推测；Skill 适用条件进入 description，正文不再重复任务编号、通用权限声明、版本行或 Applicability。

七条正文总长度从 3839 减至 943 字符，减少约 75%；来源证据仍在元数据或原任务 review。没有主动发送真实渠道消息、处理历史 unknown、部署远程环境或创建备份。

## 受验版本与工作树

- PR #64 为 MERGED，合并时间 `2026-11-11T12:25:55Z`，提交 `76c6f75072a6a60ce06a6d5329223d08cdd7f442`。
- 核心入口、唯一 packages 插件目录和运行 metadata 均绑定该已合并提交；独立发行的 `git status --porcelain` 为空。首次检出前固定 autocrlf/symlinks，独立安装依赖，未复用主检出的 node_modules。
- `git diff --name-only f5575f7f883b095df27227dfe1bccc4d4fb472fc HEAD -- src test` 为空，第 6 轮最终 52 项相关回归适用于本次发行，不重复跑未改代码。
- 本轮文档收口在 `worktree-memory-lightweight-local`，以最新 origin/main 的上述提交为基线。验收时工作树仅有本轮公共文档变化和忽略的临时维护驱动；原主检出源码和其他会话工作未动。
- Windows 11、Node.js 24.19.0、pnpm 11.25.0；没有本轮生产源码、schema、权限模式或环境变量改动。

## 发行与运行终态

`pnpm install --frozen-lockfile`、Web `tsc --noEmit && vite build` 和 `pnpm check` 通过；424 runtime JS、0 external SDK imports，来源/hash/import 守卫保持。Web 仅有大 chunk 构建警告。

停机前确认本次启动环境的密钥引用可用，不输出密钥。通过原监督器的正常 IPC 停止旧 f37e76d 实例，并等待 supervisor 95156、launcher 99756、服务 82496 实际退出；metadata 由监督器清理。未强杀、删锁或删除恢复标记。

离线维护后，新发行监督器 `--check` 返回 PASS、effects=0，端口 19198/3080 可用；随后正常启动。独立 Windows 进程回读为 supervisor 50500、launcher 54404、服务 63164，核心命令行均指向新发行；Web 插件发现入口也来自相同版本。

```json
{"health":{"status":"ok","transport":"channels","recoveryIssueCount":0},"webStatus":200,"scopeRevision":17}
```

既有两项 DWS 渠道只读回查均为 listening/connected，liveApplied=true、restartRequired=false、errorCode=null。Web 插件 connected=true，但 connectionState 为 unknown，不将其改述为 listening。没有额外渠道测试发送；健康检查不代替真实消息送达证明。

## 七条受控维护

维护前逐条核对原认证消息/引用版本，或 SQLite 完成事件、任务会话、review 和 evidenceIds；新正文不把历史推测当事实。在线与排空后的零副作用检查均通过，记忆/配置字节未变，初始摘要一致。

离线获取 Host 锁，使用生产 `updateConfig` 精确替换唯一插件目录，再通过 `MarkdownMemoryStore.remember` 逐条事务更新；逐条绑定 expectedRevision、scopeRevision、当前维护来源和提交前来源重验，不手编记忆 Markdown、SQLite 或 journal。

| 记忆内容 | 条目版本 | 正文字符数前→后 |
| --- | --- | --- |
| 文件验证与渠道送达分开 | 1→2 | 248→114 |
| 多附件逐项核验 | 1→2 | 311→117 |
| 依赖任务启动前验证 | 1→2 | 348→122 |
| 文档可读性与送达分开 | 1→2 | 302→120 |
| 运行版本与下载产物核验 | 1→2 | 377→152 |
| 编辑器开发的 Project 参考 | 2→3 | 1164→186 |
| 按要求提供报告文档 | 3→4 | 1089→132 |

scope revision 为 10→17；条目 ID、createdAt、原 provenance、最原始 originSource 及上一正文保持。两条来源型记忆改用 context v3，原 subject/evidence 不变；五条任务经验使用三段正文，来源继续关联原完成事件和 review。个人偏好未扩大为全局规则，项目资料仍按场景适用。

中途维护脚本在首条事务已提交后，将旧记录缺失的 origins 与 Store 正常归一化的空数组作严格比较，错误地报断言失败。独立回读确认仅该条变为版本 2、scope 为 11，配置目录已切换；没有将整个操作当作未执行或盲目重放。修正临时驱动的空集合断言后，重新执行零副作用检查，显式识别并核验这条已提交操作，仅续办剩余 6 条。最终首条仍是版本 2，总 scope 为 17，无重复递增。生产代码未因此修改或放宽校验。

原 evolution/state.json 字节哈希保持，5 个 review、3 项 Skill 的任务来源、支持关系和版本仍保留；独立 migration.json 收据哈希保持。现有 Skill 派生文件由新 Host 正常启动重建，未手改私有模板或 state。

## 真实 Web 与 Skill 回读

未登录 `/api/evolution` 返回 401。通过本地 token 登录后，强制刷新记忆和 Skill 列表：cache.stale=false、无 error；7 条记忆均 applied，版本与表中一致。逐条请求当前 revision 的详情，正文/context、originSource 与磁盘/维护审计哈希对应，previous 存在，comparison 为 available 且 added/removed 均非零，无正文脱敏替换。

3 个现有 learned Skill 均 applied，原 revision 1 保持。逐个核对磁盘 frontmatter description 精确等于 state.applicability，Web 正文与磁盘去掉内部撤销 marker 后完全一致，四项冗余行均不存在。taskIds、supports 和原 review 仍在；模型实际 provider description 的合同复用第 6 轮默认 provider 回归，不把此处 Web 回读说成新的真实模型识别率测试。

两次临时操作登录均在 finally 中正常 logout（HTTP 200）。本轮为真实安装的认证 HTTP/磁盘验收，没有额外浏览器视觉验收。

## 证据与边界

私有审计保留在安装 `data/logs/`，不将业务 URL、身份、七条正文、Skill 私有内容或运行配置提交 Git：

| 文件 | SHA-256 |
| --- | --- |
| lightweight-memory-20261111.json | 5e585bf283ad4bd45dc998cf5806c3932f1db85507b05da9645737e61827cf8a |
| lightweight-memory-web-20261111.json | 65666f7e569bc43a5f0f2c49a82f1b7664363c817720293ad304a131402d135f |

前者完成于 2026-11-11T12:37:54.075Z，后者完成于 12:41:21.469Z，既有渠道只读状态在 12:42:41.610Z 补齐。正常启动的 stdout/stderr 日志保留在同一私有日志目录。

- 第 6 轮相关回归 52 PASS / 0 FAIL / 0 skipped；本轮发行构建、守卫及实际安装验收通过。未重跑完整 test/runtime/routing/containment，历史完整 routing 的 15 个同基线失败仍保留，不声称完整套件全绿。
- 七条内容由明确授权的操作者整理，不冒充真实 Router 模型本次重新生成；未额外测未来任意上下文的提炼质量或 Skill 普遍识别率。
- 按本地约定未备份，也未删除旧备份。context v3 写入后，不能无匹配数据快照直接退回不支持此格式的旧程序。
- 本轮临时维护/验收驱动、PR 草稿及清理驱动共 4 个文件，已按摘要自检后统一清理，独立回查均不存在；未提交私有脚本。当前运行发行、既有旧发行与必要私有日志保留。
