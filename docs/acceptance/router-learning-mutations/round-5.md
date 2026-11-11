# 第 5 轮：本地部署与两条旧记忆更新

## 范围与结论

用户要求本地部署，并更新 `preferences/editor-development-project6-reference`、`preferences/report-documents-on-request`；随后明确授权先合并 PR #59。本轮已完成合并、正常排空升级、两条记忆受控维护，以及冷重启后的磁盘与真实 Web 接口验收。

按本地操作者既定选择未创建备份；保留安装数据、凭据及其他会话工作。没有手工编辑运行记忆 Markdown、SQLite 或 Pi journal，没有主动发送真实渠道消息、重放历史失败消息或部署远程环境。

## 受验版本与工作树

- PR #59：`MERGED`，`mergedAt=2026-11-11T10:37:28Z`，合并提交 `f37e76d3bd7d43cbe1d498cb1e0aa05d070d9494`。
- 本地核心发行及可选 Web 插件均绑定上述提交；独立发行检出 `git status --porcelain` 为空，依赖独立安装，不复用主检出的 node_modules。
- 实现来自 `c0714a8`，与第 4 轮受验的记忆实现一致。本轮没有生产源码、schema、权限模式或环境变量改动；已有安装的显式 full 选择保持不变。
- 文档收口分支 `worktree-router-context-memory-local` 已快进对齐后续主线 `0a1eafc065a7468d6a55e6fa5a890c151b39be10`。它不是本地发行版本，不声称同期其他 PR 已部署。原主检出源码及其他会话改动未动。
- Windows 11、Node.js 24.19.0、pnpm 11.25.0。代码回归复用第 4 轮最终结果，不重复执行无改动测试。

## 实跑与证据

### 1. 发行准备、正常排空与启动

新发行在首次 checkout 前固定 `core.autocrlf=false`、`core.symlinks=false`，再签出已合并提交。`pnpm install --frozen-lockfile`、Web `tsc --noEmit && vite build`、`pnpm check` 均通过，来源/hash/import 守卫保持；Web 构建仅有既有大 chunk 警告。

通过安装已有监督器的 `--stop` 请求正常 IPC 停机，等待旧 supervisor、launcher 和实际服务退出。排空后 `--check` 返回 `PASS`、`effects:0`、端口 `19198/3080` 可用，随后 `--run` 正常启动。没有用强杀、删除锁或删除恢复标记替代排空。

最终独立读取 metadata 和 Windows 实际进程：supervisor `95156`、launcher `99756`、服务 `82496`，核心命令行来自选定发行；metadata release 为上述完整提交。

```json
{"health":{"status":"ok","transport":"channels","modelMode":"real","recoveryIssueCount":0},"webHttpStatus":200}
```

既有两项 DWS 渠道状态只读回查为 `listening`；Web 状态为 enabled/unknown。没有为验收额外发送消息；`/health` 的兼容 `inboundConfigured:false` 字段不代替插件渠道状态判断。

### 2. 核心与可选插件版本错配的处理

第一次切换核心后，记忆详情已能回读新正文，但列表强制刷新返回 `HTTP 200`、`stale:true`、`EVOLUTION_CACHE_REFRESH_FAILED`，仍显示旧条目版本。原因是 `channelPluginDirs` 仍指向旧发行 packages，旧 Web inventory 不认识 context v2；核心入口切换不会同步修改插件目录。

复用新版 `updateConfig`：先 `checkOnly:true`，结合 `discoverChannelPlugins` 确认新入口且无重复类型，检查配置字节不变，返回 `effects:0`。正常停机后用同一受控事务精确替换旧 packages 目录；验证除 `channelPluginDirs` 外所有配置字段不变，不追加第二份同类型插件。随后重新自检、正常启动并复验。没有删缓存、锁或放宽读取围栏掩盖错误。

此前发行准备还曾遭遇 Windows CRLF 导致原始字节守卫失败，以及归档覆盖检出导致链接目录异常。两份错误状态均未被强行放行；最终重新独立检出后构建/守卫和干净状态通过。下次升级要求已同步到 Windows runbook。

### 3. 两条记忆的内容与受控事务

先严格解码各自原 Router Pi journal，要求全提交、显式 portable 路径语义，并与 SQLite 当前来源的作者、版本、文本、会话和引用逐项核对。当前 CLI 操作者的明确维护请求是新操作来源，原渠道消息仅作历史证据；不伪装成新的人类渠道消息，不重用旧写入 ID。

复用生产 `buildRouterMemory` 和 `MarkdownMemoryStore.remember`，先零副作用检查，再以 `expectedRevision`、`scopeRevision`、来源重验及 scope lease 提交。scope revision `8→10`，两条结果：

| 记忆 | 版本 | 内容与适用范围 |
| --- | --- | --- |
| editor-development-project6-reference | 1→2 | 明确编辑器开发应查看的 Project 地址和协作/发版背景；区分用户要求与引用公告，保留当前迭代条件。按 context 场景适用，不扩展为所有项目的默认规则；未独立核验当前看板状态。 |
| report-documents-on-request | 2→3 | 向原提出者汇报时，未要求文档就用消息说明结果，不额外附报告。明确要求的文档、约定成果和其他必要附件仍交付，内部证据及代码文档继续维护；当前明确要求优先。仅 actor 个人偏好，不推广为全局规则。 |

两条均为 context v2，原消息放 Evidence，无额外假设；行动建议不提供业务执行权限。没有复制整段无关业务报告。条目 ID、createdAt、原 provenance/origins、最原始来源保留，previous 保留上次正文；其他 5 条记忆逐项回读不变。

冷重启后的独立只读进程再次通过生产解码器核验身份、版本、subject、正文/context/originSource 哈希及其他主题条目哈希，scope 仍为 10。私有审计保留在安装 `data/logs/`，未将原消息、业务 URL、身份、凭据或运行记忆提交 Git。

### 4. 真实认证 Web 回读

修正插件路径并重启后，未登录 `/api/evolution` 返回 401。使用仅进程内读取的本地 token 登录后执行 `GET /api/evolution?kind=memory&limit=50&refresh=1`：

```json
{"cache":{"updatedAt":"2026-11-11T11:06:51.271Z","stale":false,"refreshing":false},"total":7}
```

列表无 error；两条状态均为 `applied`，版本分别 2、3。分别请求 `/api/evolution/items/<id>?revision=<current>`，正文 SHA-256 与磁盘及事务回执一致，previous 存在，comparison 包含 added 行：

| 记忆 | 新正文 SHA-256 |
| --- | --- |
| editor-development-project6-reference | f2b4c60c36f2deaa68d85ee63ac87a76e2fbe30fb859eb86be00d26d26e7e2e3 |
| report-documents-on-request | d47ac7f16d44eebf1a2c1704a823e62e8b3e5f33752e17855c20ec6fe90b942e |

临时操作者会话已在 finally 中正常 logout（HTTP 200）。这些是本地真实安装的 API 结果，不是仅静态构建或夹具自报；没有宣称已做浏览器视觉验收。

## 边界与保留项

- 第 4 轮相关 61 项回归通过；完整 routing 的 15 个同基线失败原样保留。本轮未重跑完整 test/runtime/routing/containment，不将其标记全绿。
- 本次更新由明确授权的操作者维护，不冒充真实 Router 模型重新生成；没有额外验证真实模型对未来任意上下文的提炼质量。
- 本地未创建备份，也未删除既有备份。新 context v2 已写入，没有匹配数据快照时，不承诺可以无损退回旧程序。
- 运行数据与私有审计留在忽略的安装目录；任务临时驱动和从未启用的错误发行准备目录不作为交付物，收尾按本次归属统一清理。既有旧发行和当前运行发行保留。
