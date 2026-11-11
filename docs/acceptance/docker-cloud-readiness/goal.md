# Docker 云端运行准备

> 状态：COMPLETED
> Goal ID：docker-cloud-readiness
> 最近维护：2026-11-11T08:06:54+08:00
> 权威目标：goal.md

## 总目标

获取最新已合并源码，实际构建/运行仅无头浏览器镜像，梳理配置、记忆、Skills、日志、任务和会话的挂载及环境变量。用户后续授权推送指定公司仓库，并在指定生产 Kubernetes 项目中新建工作负载、复用其准备的 Secret。保护原检出的其他会话改动，不迁移既有业务数据或账号。

## 完成条件

- 合并后正式镜像在本地与指定云端实跑，持久化、浏览器及认证边界有真实终态证据。
- data挂载与容器环境变量有可执行说明；模型与本地一致并实际回复，GitHub环境令牌可认证读取。
- DWS独立登录、指定测试群接入和用户提示词已核验，真实收发及自然人引用回复分别记录通过或明确阻断；未验项不冒充通过。

## 范围与约束

只操作已授权的新生产实例与唯一测试群，保护原脏工作区、本地Bot和其他群。不复制既有账号/业务数据，不公开私有目标、提示词或凭据；不因提示词新增集群、数据库或OSS权限。ask/auto、活动任务排空、归档恢复等未验边界单列，不扩展为本轮实施。

## 当前结论

**正式镜像和生产基础运行已通过；第4轮已按用户新增授权复用本地模型并取得真实可见回复，容器 GitHub 环境变量认证/当前仓库读取也通过。第5轮 DWS 独立登录已成功，唯一测试渠道已在线，用户提示词已原文保存并回读一致；自动测试通知的厂商回读和云端接收处理通过。第6轮自然人消息已取得云端confirmed送达收据与厂商引用核验；本次约定范围完成，历史未覆盖的其他平台/工具边界仍保留。**

- 应用源码：已合并 `0e18f7704652e88b0fe315b0c14030b1bab06c15`（含 PR #48）。从干净新 worktree 重建正式镜像，来源标签不再是 pre-merge 候选。
- 镜像 config ID：`sha256:4ef61c06f27fd666345ca9cf1887b2fc23ec95d8dba729e8d01b59b2bf0f9509`。
- 发布 manifest digest：`sha256:9cc2ba4f6c26ff13674b9a5051e882c3be6818dde8062acd252d26cf0af9c4b5`；仓库回读匹配，生产实际 imageID 相同。
- 镜像仍为 Linux amd64、1,307,009,396 bytes；压缩层合计 462,065,273 bytes。仅 headless shell，无完整 Chromium。
- 部署分支：`worktree-k3s-cloud-runtime-20261111`；本轮新增/修改仅部署模板、文档和验收，不改运行时源码、依赖或入口。
- Kubernetes 1.29：Deployment 1/1 Ready、Recreate、新独占 20Gi RWO PVC、ClusterIP，无公网入口。UID/GID 1000、RuntimeDefault、只读根、drop ALL、禁止提权和无 API token 挂载均核验。
- 公司目标、kubeconfig 入口及实际 Secret 引用只在受忽略的 `docs/tmp/k3s-cloud-runtime/`；不进入通用源码或公开 PR。该目录保留后续 DWS 授权与测试所需的私有部署检查点，无凭据值副本。

## sub goal matrix

| ID | 子目标 | 完成判据 | 状态 | 证据 |
| --- | --- | --- | --- | --- |
| SG1 | 获取最新代码、保护原脏工作区 | 新worktree基于最新合并源码，原检出未改 | 完成 | round-1.md / round-3.md |
| SG2 | Docker恢复、完整浏览器基线 | 真实构建及默认入口实跑 | 完成 | round-1.md |
| SG3 | 仅无头镜像、本地API/CLI与应用 | API导航/JS/截图CLI、Web及消息实跑 | 完成 | round-2.md / round-3/local-runtime.json |
| SG4 | 挂载目录、环境变量和运维配方 | data分桶、ENV与Secret规则可执行 | 完成 | ../../ops/docker-deployment.md / ../../ops/kubernetes-deployment.md |
| SG5 | 正式镜像构建、推送及摘要回读 | 合并源码/manifest/config/实际imageID匹配 | 完成 | round-3.md |
| SG6 | 生产PVC与入口预检 | 专属20Gi卷、UID/0700与--check零写 | 完成 | round-3/cloud-runtime.json |
| SG7 | 生产Web认证与浏览器 | 真实200与401/403反例、无头API/CLI | 完成 | round-3/cloud-runtime.json |
| SG8 | 同卷重建与持久化 | 身份/config/token/chat保留、旧cookie拒绝 | 完成 | round-3/cloud-runtime.json |
| SG9 | 真实模型配置与回复 | 非秘密路由与本地一致，真实可见回复 | 完成 | round-4/model-runtime.json |
| SG10 | GitHub环境变量访问 | 容器中真实认证及当前仓库只读访问 | 完成 | round-4/github-access.json |
| SG11 | DWS登录、唯一测试群与用户提示词 | 同组织真实登录、原生在线配置与全文回读 | 完成 | round-5/channel-runtime.json |
| SG12 | 自动通知收发与云端处理 | 单次发送、厂商/云端真实ID一致、processed | 完成 | round-5/group-smoke.json |
| SG13 | 自然人消息触发模型及引用回复 | 群成员消息进入云端，真实回复收据及厂商引用匹配 | 完成 | round-6/natural-reply.json |
| SG14 | 保留未覆盖边界 | 明确ask/auto、活动任务排空和归档恢复等未验范围 | 未覆盖，非本轮扩展 | round-3.md / round-5.md |

## 当前检查点

- 当前子目标：SG13
- 唯一下一步：无；本次已授权范围已核验完成，不追加其他平台、工具或服务验收。
- 未闭环项：本次约定范围无。DWS登录态跨Pod重建及第3轮其他未覆盖项未验，不由本轮通过外推。

## 重要决策

1. 原准备分支 PR #48 已合并，未向已合并分支追加 push；后续部署记录使用新工作树。生产使用合并源码正式重建镜像，未将旧 pre-merge 镜像冒充正式发布。
2. RuntimeDefault 是新的 Kubernetes 平台子集合同，不冒充 Docker 固定 seccomp。没有修改节点、RBAC、现有 Secret 或其他工作负载，没有提权/放宽 seccomp。
3. 实际 CSI 在重挂载时把 0700 改成 2770，OnRootMismatch 未阻止改写。只在首次空卷初始化使用 fsGroup；业务 Pod 不再携带卷级 fsGroup。修复仅针对本次确认无业务文件的空目录，随后真实预检和重建均保持 0700。
4. 第3轮指定 Secret 只有凭据，故未猜模型地址。第4轮用户明确要求模型地址和型号与本地相同：只读取主安装的非秘密模型路由，以原生配置事务保存并安全重建，生产 key 仍引用既有 Secret，真实回复已可见。未搬账号/记忆/会话。
5. 第4轮首次 DWS 登录失败后，用户明确要求重试；第5轮新设备流已成功，同组织真实账号/目标核对通过。通过官方已认证在线新增事务接入唯一测试群，无需重启；保留初始化禁用示例和所有既有渠道。新增起点由Host处理，不重放历史消息。
6. 用户新增渠道提示词仅保存在安装私有配置中，已独立全文回读一致；没有据此扩展集群、数据库或OSS权限。自动通知只发1次，厂商真实ID/正文与云端入站一致并最终processed，回复0、任务0。第6轮用户已发自然人消息，云端引用回复的真实送达收据与厂商消息/引用ID一致，9965ms确认送达、任务数0，已完成最后业务验收。

## 证据与保留边界

历史 round-1/2 与 matrix 列保留，基础运行证据为第3轮，用户追加的真实模型/GitHub结果见第4轮，DWS/渠道配置以第5轮为准，自然人引用回复与最终收口以第6轮为准。旧轮附件按归档规则清理并在原报告注明；最新 JSON/图片保留。生产 PVC、Deployment/Service/ConfigMap 和最终镜像保留，一次性 Job/探针临时文件在证据落盘核对后清理。未创建“全绿” report.md。
