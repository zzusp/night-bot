# Docker 云端运行准备

## 目标与完成条件

获取最新已合并源码，实际构建/运行仅无头浏览器镜像，梳理配置、记忆、Skills、日志、任务和会话的挂载及环境变量。用户后续授权推送指定公司仓库，并在指定生产 Kubernetes 项目中新建工作负载、复用其准备的 Secret。保护原检出的其他会话改动，不迁移既有业务数据或账号。

## 当前结论

**正式镜像和生产基础运行已通过；第4轮已按用户新增授权复用本地模型并取得真实可见回复，容器 GitHub 环境变量认证/当前仓库读取也通过。DWS 设备登录进程已结束且仍无有效登录态；唯一测试群收发尚未执行，整体交付仍受阻。**

- 应用源码：已合并 `0e18f7704652e88b0fe315b0c14030b1bab06c15`（含 PR #48）。从干净新 worktree 重建正式镜像，来源标签不再是 pre-merge 候选。
- 镜像 config ID：`sha256:4ef61c06f27fd666345ca9cf1887b2fc23ec95d8dba729e8d01b59b2bf0f9509`。
- 发布 manifest digest：`sha256:9cc2ba4f6c26ff13674b9a5051e882c3be6818dde8062acd252d26cf0af9c4b5`；仓库回读匹配，生产实际 imageID 相同。
- 镜像仍为 Linux amd64、1,307,009,396 bytes；压缩层合计 462,065,273 bytes。仅 headless shell，无完整 Chromium。
- 部署分支：`worktree-k3s-cloud-runtime-20261111`；本轮新增/修改仅部署模板、文档和验收，不改运行时源码、依赖或入口。
- Kubernetes 1.29：Deployment 1/1 Ready、Recreate、新独占 20Gi RWO PVC、ClusterIP，无公网入口。UID/GID 1000、RuntimeDefault、只读根、drop ALL、禁止提权和无 API token 挂载均核验。
- 公司目标、kubeconfig 入口及实际 Secret 引用只在受忽略的 `docs/tmp/k3s-cloud-runtime/`；不进入通用源码或公开 PR。该目录保留后续 DWS 授权与测试所需的私有部署检查点，无凭据值副本。

## 子目标矩阵

| 子目标 | 状态 | 证据入口 |
| --- | --- | --- |
| 获取最新代码、保护原脏工作区 | 完成 | round-1.md / round-3.md |
| Docker 恢复、完整浏览器基线 | 完成 | round-1.md |
| 仅无头镜像、本地 API/CLI 与应用实跑 | 完成 | round-2.md / round-3/local-runtime.json |
| 挂载目录、环境变量和运维配方 | 完成 | ../../ops/docker-deployment.md / ../../ops/kubernetes-deployment.md |
| 合并后正式镜像构建、仓库推送及摘要回读 | 完成 | round-3.md |
| 生产 PVC/权限初始化与入口零写预检 | 完成 | round-3/cloud-runtime.json |
| 生产 Web、认证拒绝反例和浏览器实跑 | 完成 | round-3/cloud-runtime.json |
| 同卷重建、身份/config/token/chat 保留 | 完成 | round-3/cloud-runtime.json |
| 真实模型配置与回复验收 | 完成：按用户追加授权复用本地非秘密路由 | round-4/model-runtime.json |
| 容器 GitHub 环境变量与当前仓库读取 | 完成：真实认证、只读访问，无仓库写入 | round-4/github-access.json |
| DWS 云端独立登录及唯一测试群收发/回读 | 阻断：设备流 exit2、auth false、profiles0；未执行群测试 | round-4/dws-authentication.json |
| ask/auto、活动任务排空及归档恢复 | 未执行，不由基础运行证明 | round-3.md |

## 重要决策与当前检查点

1. 原准备分支 PR #48 已合并，未向已合并分支追加 push；后续部署记录使用新工作树。生产使用合并源码正式重建镜像，未将旧 pre-merge 镜像冒充正式发布。
2. RuntimeDefault 是新的 Kubernetes 平台子集合同，不冒充 Docker 固定 seccomp。没有修改节点、RBAC、现有 Secret 或其他工作负载，没有提权/放宽 seccomp。
3. 实际 CSI 在重挂载时把 0700 改成 2770，OnRootMismatch 未阻止改写。只在首次空卷初始化使用 fsGroup；业务 Pod 不再携带卷级 fsGroup。修复仅针对本次确认无业务文件的空目录，随后真实预检和重建均保持 0700。
4. 第3轮指定 Secret 只有凭据，故未猜模型地址。第4轮用户明确要求模型地址和型号与本地相同：只读取主安装的非秘密模型路由，以原生配置事务保存并安全重建，生产 key 仍引用既有 Secret，真实回复已可见。未搬账号/记忆/会话。
5. 用户追加授权 DWS 登录、复用本地测试群和 GitHub token 访问验证。GitHub 已成功；本次 DWS 设备流以 exit2 结束，回查仍未登录且无账号；具体失败原因未知，旧进程不再等待。恢复时须用户可完成身份确认，重新发起设备授权，再核对 profile 与本地测试群同组织后接入，仅验真实收发与读回。不得复制本地登录态、接入其他群或重放历史消息。

## 证据与保留边界

历史 round-1/2 与 matrix 列保留，基础运行证据为第3轮，用户追加的真实模型/GitHub/DWS 状态见第4轮。旧轮附件按归档规则清理并在原报告注明；最新 JSON/图片保留。生产 PVC、Deployment/Service/ConfigMap 和最终镜像保留，一次性 Job/探针临时文件在证据落盘核对后清理。未创建“全绿” report.md。
