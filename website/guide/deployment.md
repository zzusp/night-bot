# 部署与运维

选择独立安装、专用运行账号与明确的数据边界。安装成功、健康接口可达、模型可用、真实任务完成与渠道送达需要分别验证。

## 本机运行

[快速开始](./getting-started)给出核心与可选 Web 的启动步骤。正式常驻运行、停机与诊断应按平台手册执行：

- [Linux 隔离运行前置](https://github.com/zzusp/night-bot/blob/main/docs/ops/linux-contained-runtime.md)
- [Windows 本机运行](https://github.com/zzusp/night-bot/blob/main/docs/ops/windows-local-runtime.md)
- [macOS 本机运行](https://github.com/zzusp/night-bot/blob/main/docs/ops/mac-local-runtime.md)

当前新安装默认 `full`，按启动账号权限直接运行，不提供应用工作区或进程隔离。受限 `ask` / `auto` 仍有未完成的交付验收；macOS 命令执行与长轮次续办也有未通过项，不应将某平台的安装通过外推为完整生产可用。

## Docker

仓库提供 Dockerfile 与[完整 Docker 部署规程](https://github.com/zzusp/night-bot/blob/main/docs/ops/docker-deployment.md)，包括构建、专属数据卷、离线配置、前置检查、启动与恢复。

镜像包括 Node、pnpm、固定版本 DWS、Git、GitHub CLI 和 Chromium headless shell。工具已包含不代表已登录、已获业务权限或已完成真实厂商验证；钉钉仍不默认启用。

遵循规程保留非 root、移除 capabilities、`no-new-privileges`、只读根与受控数据卷。不要通过特权容器、挂载 Docker socket、挂载整台宿主或关闭安全策略绕过失败。

`full` 不执行应用层受限沙箱前置，也不提供应用进程隔离；外层容器限制仍有效。`ask` / `auto` 需要目标环境实际支持隔离后端，容器不能替代它。文档中的已审 seccomp 差量只覆盖指定 amd64 路径，不自动适用于 arm64。

## Kubernetes

使用[现有 Kubernetes 部署说明](https://github.com/zzusp/night-bot/blob/main/docs/ops/kubernetes-deployment.md)及其配套清单，先核对安全上下文、持久卷、网络和目标节点条件。不要把清单可解析或容器就绪当作任务和外部渠道已验收。

## 网络边界

核心管理 HTTP 只监听 loopback。Web 面向本安装的单个操作者，使用令牌、会话、同源和 CSRF 校验，不应直接发布到公网。

容器内监听 Web 时还需固定 Origin，宿主发布端口仅绑定 loopback。具体参数遵循[Web 运维](https://github.com/zzusp/night-bot/blob/main/docs/ops/web-console-local.md)与容器规程，不自行移除校验来处理连接错误。

## 数据与备份

- `data/config/` 与 `data/secrets/`：私有配置及凭据。
- `data/workspaces/`：业务工作区与保留产物。
- `data/logs/`、缓存与临时目录：诊断或可重建数据，不纳入普通备份。
- `backups/`：备份目录，不提交到 Git。

每个任务有独立材料、工作文件、冻结输出与会话；共享 SQLite 仍是运行时权威，不能将任务 JSON 快照当作命令重放。

升级保留 `data/`。可迁移备份需要离线封存、完整性校验及受控路径检查，默认排除秘密；恢复保留效果暂停与交付防重门禁，不能直接恢复自动发送。参阅[数据布局](https://github.com/zzusp/night-bot/blob/main/docs/DATA-LAYOUT.md)与[任务备份与恢复](https://github.com/zzusp/night-bot/blob/main/docs/TASK-ARCHIVE.md)。

## 停机和异常处理

使用对应平台的正常关闭流程，等待 Host、任务、作业和子进程排空。HTTP 已停止不等于关闭完成。

遇到未知发送、执行结局不明或清理失败时，保留现场并只读核对原链路。不要手删安装锁、改写记录或自动重放动作，也不要终止无关进程来释放端口。
