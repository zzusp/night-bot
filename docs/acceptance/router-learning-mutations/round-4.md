# Web 修复正式部署与真实验收：第4轮

## 结论与版本

按用户“合并部署验证”授权，PR #58 已合并、正式镜像已发布并部署到既有生产实例。真实模型通过认证 Web 完成记忆及 Skill 的新增、更新、删除，6项均有正式 Pi 持久化工具收据，六条 Router 最终回复均只发送一次、可靠送达且可在 Web HTTP 账本读取。三条 Skill 最终回复实际采用空 recipientActorIds、无顶层 actorId、无引用，覆盖本次修复触发条件。

新增和更新的 Router Skill 在 Web 清单均显示 applied，正文为对应当前版本；活动数由原2项变3项，删除后回到2项，清单及派生目录均移除测试项。测试记忆和 Skill 已删除，其他记忆/Skill规范化内容哈希保持，新增任务0。第2轮两项Web失败已通过本轮真实业务复验；历史失败报告和矩阵列不覆写。

- 日期：2026-11-11；最终业务审计时间 `2026-11-11T07:57:19.876Z`。
- PR：https://github.com/zzusp/night-bot/pull/58，独立回查 MERGED；合并时间 `2026-11-11T07:41:12Z`。
- 合并源码：`46a64f5a1c41448018c603552db52a4140b5b7a1`。
- 正式 tag：`headless-46a64f5a1c41`；Linux amd64。
- 正式 manifest：`sha256:3d7c79f07765ba57751f60ed3fd18643f52e15c7f1146b100b6e601930042573`。
- 镜像 config：`sha256:42169615f04dec06a9d3517655178c70a88d6c4d7c7542d4ef25989452ef9afe`。
- 发布分支 `worktree-router-web-release-20261111` 基于上述最新 origin/main。构建/部署时未提交内容仅目标文档，Docker 上下文排除 docs；运行源码和锁文件为合并版本。后续仅验收/运维文档增量，不冒充镜像源码。

## 发布、离线备份与部署

| 检查 | 结果与证据 |
| --- | --- |
| 正式产物 | 本机既有受信 Docker Linux 发布环境构建，OCI revision和source-state标签绑定已合并源码；同一镜像实跑后推送，独立 manifest inspect 核对远端manifest/config及本地image ID，不在集群重新构建 |
| 同镜像实跑 | 既有 verify-runtime.mjs 先 --check，再隔离执行；预检零写、UID1000/temp0700、只读根/cap-drop/no-new-privileges/固定seccomp、浏览器API和CLI、Web认证及401/403、脚本模型可见回复、真实排空/正常退出、同卷身份/token/历史保持和无重复推理通过；本地容器与卷均独立检查不存在 |
| 原生暂停及排空 | 使用当前savedVersion和confirm，经原生接纳接口暂停唯一启用DWS渠道；独立回查paused。tasks/executions/groups/operations/新增在途通知/inbox/triage均0。历史unknown单列为1、发送次数1，未伪装已排空或删除 |
| 正常停机 | UID/resourceVersion前置条件缩容0，等待原Pod实际删除；仅此后挂载原卷到一次性离线Job，未让两个运行Host共写 |
| 离线一致性 | 新正式镜像入口--check通过；Host锁缺席、无非空WAL、SQLite quick_check=ok；62份Pi journal共8,048,760字节经runtimePaths+portablePaths严格requireComplete解码，2份现存任务原生历史身份核对通过 |
| 默认备份 | 复用既有独立备份PVC，在新目的目录生成158文件、15,915,223字节；manifest逐文件大小/哈希回读一致，排除secrets/cache/logs/temp/runtime。保留上一轮备份，不覆盖；备份仍含私有业务状态，不进Git，未测试恢复 |
| 部署与隔离 | 按registry digest更新应用/init镜像并恢复单副本，独立核对实际imageID一致、Ready/restart0；剔除镜像字段后Pod模板逐项相同，ENV/secret引用、挂载和安全配置未改变 |
| 源码与认证 | 运行中两处修复源码SHA256与本地合并源码逐文件相同；认证Web读取正常，未登录401、缺CSRF403；token哈希不变 |
| 配置与接纳 | 原生恢复接纳后另行读取直到receiving/listening且无错误；最终完整持久配置hash与发布前相同，未覆盖另一会话此前渠道提示词或权限配置 |
| 资源清理 | 一次性离线Job按UID/标签核对后删除，独立查询同release标签Job为0；生产卷和两轮备份保留 |

本次Kubernetes沿用RuntimeDefault及显式full模式。full为容器UID1000账号权限，不声称有应用workspace隔离、管理员权限或已验证ask/auto；本地固定seccomp实跑不能替代Kubernetes受限档验收。

## 六项真实业务与反证

全部请求使用本轮唯一键，沿现有canonical Web会话接纳，无额外空任务。模型选择并执行正式Router维护工具，不直接写SQLite/Markdown/state制造结果。每项都等当前来源被consumed、Router最终回复delivered，并核对HTTP里对应最终消息ID/正文可见；不把先到的分诊承接答复当完成。

| 动作 | 持久化和Web终态 |
| --- | --- |
| 记忆新增 | revision1，保存本轮“青松”标签；完整原话、source/version/actor hash/quote hash匹配；最终回复一次送达 |
| 记忆更新 | 同键revision2，“海棠”替换原标签，无第二条；最终回复一次送达 |
| 记忆删除 | 原键不存在，其他记忆保持；最终回复一次送达 |
| Skill新增 | origin=router、active、revision1；正式SKILL.md和显式Web正文含“核对完成”，清单applied，活动数3；空受众最终回复一次送达 |
| Skill更新 | 同键revision2，文件和Web正文含“复验通过”，清单applied，活动数3；空受众最终回复一次送达 |
| Skill删除 | 墓碑revision3，权威state无该Skill、派生目录和Web清单项不存在，活动数回2；空受众最终回复一次送达 |

独立按当前会话的严格Pi journal解码收集6份真实工具收据，全部ok/persisted，无工具错误；来源原话hash、actor和版本与数据库来源逐项比对。六条最终回复的冻结payload均仍无actorId，sourceRef绑定真实作者，recipientActorIds为空且不引用；HTTP最终消息实际可见，排除通过强制引用、补顶层作者或只验证承接消息绕开修复。

测试自己的记忆/Skill/state及文件已清除，正式审计、忘记指纹和Skill版本墓碑保留。原有记录规范化内容哈希与任务数保持。历史unknown的状态、payloadDigest和发送次数与部署前相同，未改写或重发；修复新回复不代表旧失败已补发或结清。

## 执行中问题与处理

- 首次构建在可变Dockerfile前端解析阶段报registry EOF，没有生成发布产物。改用上一轮可信成功日志中已核实的同一官方前端摘要并复用缓存，显式沿用官方Debian HTTPS镜像参数后构建成功；没有关闭摘要、TLS、APT签名或sandbox校验。实际参数补入Docker runbook。
- 部署后一次验证连接被本机已停止的代理拒绝，发生在kubectl连接前，未提交新业务或重复部署。先用只读查询证明可直连，再仅清除kubectl子进程代理环境，继续正常验收；未改系统代理、kube context或凭据。处理方式补入Kubernetes runbook。
- 临时驱动有一次远端代码语法错误，解析失败时未执行暂停；修正后重新先--check再操作，并以原生回读paused和排空证据为准。清理检查曾因Docker错误文本大小写断言失败，按真实文本修正后独立确认卷不存在；均不作为产品回归或成功部署证据。

## 边界与收口

正式发布和本轮两项Web业务修复验收通过。没有触发CI、发送真实钉钉测试消息、重放历史失败消息、改变权限模式或执行备份恢复。真实模型结论只覆盖这六个输入，不证明任意语义判断；第1/3轮DWS本地完整/扩展套件的既有或偶发失败保留，本轮没有代码变化或重跑这些完整套件。

脱敏终态集中见 [round-4-evidence.json](round-4-evidence.json)，矩阵保留第1/2/3轮并追加第4轮；PR正文已按最终事实回填并逐字回读核对为MERGED；本轮40份中间驱动、私有快照和PR草稿已先--check再统一清理，独立检查目录不存在，仅保留既有受忽略安装pointer，公开报告不引用临时附件。未删除历史报告，也不把保留的旧unknown记成已解决。
