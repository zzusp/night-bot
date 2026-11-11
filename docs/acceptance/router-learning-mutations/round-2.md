# 正式部署与真实 Router 验收：第2轮

## 结论与源码版本

PR #57 已合并并完成生产部署。真实模型经认证 Web 输入执行记忆、学习 Skill 的新增、更新、删除，**6 项持久化动作通过**；每项均有正式 Pi 工具收据 `ok=true,persisted=true`，并独立回读存储、完整原话和作者绑定。测试记忆、Skill 状态及派生目录已删除，原有其他记录哈希保持，新增任务为 0。

**整体不记全绿**：Skill 更新的 Web 最终回复仍为 `unknown / WEB_DELIVERY_SCOPE_INVALID`；Web 清单将 Router 创建的活动 Skill 显示为 `unsupported`。两项均独立记录，未改写历史收据、重复发送或放松权限。CRUD 的真实提交不代表最终答复可靠送达或 Web 展示正确。

- 日期：2026-11-11；终态核验 `2026-11-11T06:56:32.066Z`。
- PR：https://github.com/zzusp/night-bot/pull/57；`MERGED`，合并时间 `2026-11-11T06:29:55Z`。
- 生产源码：已合并 `8c90fc1913638101c2e0bd89462ff1de5280993c`。
- 正式 manifest：`sha256:5b3fc52dbf2688079e709d871d870a8997d9d0ea3148f987be8c19577692111a`。
- 镜像 config：`sha256:46a93dec9bc38c0d1de9a2491ea9b03d62b73300cc56df0267cc6d5ff7b076da`；Linux amd64，OCI revision 与上述合并 SHA 一致。
- 发布记录分支 `worktree-router-learning-release-20261111`；本轮工作树仅验收文档增量，未改运行源码、依赖、锁文件或部署模板。最后 fetch 时 HEAD 与 origin/main 为 0/0。后续文档提交不冒充镜像源码。

## 发布与运行验证

| 项目 | 实际结果 |
| --- | --- |
| 正式构建/发布 | 从已合并源码构建一次，沿既有正式 registry 推送；独立 `docker manifest inspect --verbose` 核对 manifest/config/本地镜像与 OCI revision，生产按 digest 拉取 |
| 本地镜像实跑 | 既有 verify-runtime.mjs 先 `--check` 再执行；默认入口预检、只读根/非root/能力限制、无头浏览器 API/CLI、认证 Web/模型消息、排空、同卷恢复通过；使用隔离卷和脚本模型，不冒充真实模型 |
| 暂停/排空 | 经原生版本绑定 ingress API 暂停接纳并回读 liveApplied；任务/执行/group 未排空数、未终态 operation、prepared/starting/unknown 发送、pending inbox/triage 均为 0；正常缩容0，等待旧 Pod 退出 |
| 离线一致性 | 新镜像独占原 PVC；入口 `--check` 通过，Host 锁缺席、WAL 无非空尾，SQLite quick_check=ok；49份 Pi journal 共7,350,598字节，以 runtimePaths+portablePaths 严格 requireComplete 解码，2个已有任务检查原生身份 |
| 默认安装备份 | 新独立受控2Gi备份PVC，UID1000；原生 backupData 生成145文件、14,552,149字节，manifest逐文件大小/哈希回读一致；排除 secrets/cache/logs/temp/runtime，包含的状态/记忆/工作区仍是私有业务数据，不入Git；未执行恢复演练，不声称完整凭据备份或已验证恢复 |
| 生产实际版本 | 实际 imageID 与正式 manifest 一致；5个关键源码文件 SHA256 与本地合并源码逐一匹配；单Pod Ready、restart0 |
| 配置/权限保持 | 更新仅替换应用/init镜像并恢复副本数；逐项比较 Pod 模板确认 ENV/Secret引用、挂载与安全设置不变，Web token哈希保持；full权限模式未改，不声称保留workspace沙箱 |
| 认证与接纳 | 真实认证读取通过；未登录401，缺CSRF的写请求403且未接纳；原生恢复接纳后独立等到 receiving/listening，无渠道错误 |
| 资源收尾 | 两个本轮临时 Job 按 UID/标签检查后删除，并独立查询不存在；保留原生产卷及含默认备份的独立PVC，不删除持久备份 |

部署期间另一已授权会话在配置hash核验窗口释放后通过原生接口独立更新了渠道提示词；该更新不是本任务操作或证据，也没有覆盖本轮镜像/权限/接纳状态。最终接纳状态由本会话独立读取，不引用对方回执代替验证。

## 真实模型增改删

Web 采用每操作者单一当前会话，未另建渠道或绕过 singleton 守卫。六条消息使用唯一验收主题/键和固定 requestId，只维护本次测试对象。完整输入不是特定授权句首，Router 自行选择维护工具；未直接写生产 SQLite/Markdown/state 造结果。

| 动作 | 持久化及独立回读 |
| --- | --- |
| 记忆新增 | 主题 release-verification，键 router-learning-8c90fc1；“青松”规则，entry revision 1 |
| 记忆更新 | 原键更新为“海棠”，entry revision 2；无第二条记忆 |
| 记忆删除 | 原键不存在；其余记忆内容和来源保持 |
| Skill新增 | release-router-learning-8c90fc1，revision 1、origin=router、active；正式 SKILL.md 包含“核对完成”检查步骤 |
| Skill更新 | 同一键 revision 2；正式文件加入“复验通过”检查步骤，来源绑定本次更新原话 |
| Skill删除 | 单调墓碑 revision 3；权威state无该Skill、SKILL.md及其目录均不存在 |

六个对应 Pi mutation 收据全部成功，无工具错误；各次 source version=1，sourceId、作者hash及完整原话quoteSha256匹配，记忆正文逐字对应当前原话。无空任务；已有任务数2保持，新建0。测试自己的记忆和 Skill 已清除；原有其他记忆和 Skill 的规范化内容哈希前后一致。审计、忘记指纹和Skill墓碑按产品合同保留，不删除它们冒充没有发生过测试。

## 未通过项与边界

1. **Web最终回复送达 FAIL**：Skill更新实际已提交 revision 2，但最终 Router 回复报 `WEB_DELIVERY_SCOPE_INVALID`，发送1次后保持unknown，回读同错误。一级分诊承接消息已送达，不把该承接消息当成最终成功确认。`src/channels/service.js:177` 只从 payload.actorId 构造单聊 senderId；本次冻结 Router reply 含 sourceRef.actorId、显式空 recipientActorIds，却没有顶层actorId，最终被 `packages/web-console/server/ledger.js:94` 的认证归属检查拒绝。未改传输权限、不补造收据、不重发；该unknown审计仍保留，需要独立修复Web回复身份映射和合法收口后再验。
2. **Web Skill展示 FAIL**：更新后 `/api/evolution?refresh=1` 将该Skill标为unsupported，实际mutation/state/文件成功。`packages/web-console/server/evolution-inventory.js:98` 仍只认experience supports；Router直接学习使用当前认证来源，core provider与正文读取已使用learnedSkillSupported。展示层需要同步判定后再验，本轮不修改或发布旁支Web修复。
3. 第1轮完整 Router 套件的 DWS receipt flags 基线失败仍保留；本轮未修改该实现或重复跑本地回归全集。不将历史通过项当本轮重跑。
4. 本轮真实模型只验证这六个具体输入，不证明任意语义判断正确；未发送真实钉钉测试消息，不自动回填或重放用户历史漏存消息，不声称钉钉记忆/Skill原生往返已验。
5. 未执行CI、全仓测试、备份恢复、额外权限模式或跨平台验收。验收结果集中于本轮报告和 [脱敏证据](round-2-evidence.json)，未创建全绿report.md。
