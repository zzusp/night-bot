# Kubernetes 容器运行决策

## 目标与现状

用户已授权在指定生产项目中新建工作负载，复用指定的凭据 Secret。现有 Docker 配方依赖宿主固定 seccomp 文件，不能原样映射为 Pod 参数。本次只增加部署模板和运维说明，不改变应用权限、模型执行或历史合同；公司目标、凭据入口和私有渲染结果放受忽略的 `docs/tmp/`，不进入通用仓库。

## 选择与排除

1. 独立 Linux Docker：已有验收，但不满足本次 Kubernetes 工作负载目标。
2. Kubernetes `Localhost` seccomp：接近 Docker 精确策略，但要求节点预置文件；本次没有修改节点安全基线的授权，不采用。
3. Kubernetes `RuntimeDefault`：采用运行时原生过滤，明确为不同平台合同。先以目标镜像、专属 PVC 和原入口 `--check` 实跑，再验证 Web、浏览器与持久化。只覆盖当前产品 `full`，不能外推 `ask/auto` 的 bwrap 路径可用；失败不放宽为 Unconfined 或提权。

## 最小实现

- 使用已合并源码重建的不可变镜像；单副本 `Recreate`，新建独占 20Gi RWO PVC。
- UID/GID 1000；仅首次空卷初始化 Job 使用 fsGroup 1000，业务 Deployment 不携带卷级 fsGroup，避免 CSI 再次挂载递归改变私有模式。非 root initContainer 在专属 PVC 下新建 `runtime-data`，主容器以 subPath 挂为 `/opt/night-bot/data`。新目录为 0700，已有异常目录拒绝启动，不递归 chown 或修复共享内容。
- initContainer 检查实际文件系统，未验证的网络文件系统拒绝作为 SQLite 存储。预检 Job 派生自同一 Pod 模板，确认预检终态后才启动应用。
- 保留只读根、drop ALL、禁止提权、不挂宿主路径/套接字、不自动挂载 Kubernetes API token；tmp/shm 使用有上限的内存 emptyDir。
- Web 仅 ClusterIP + loopback port-forward。HTTP 探针显式携带正确 Host，不绕过同源检查，不新增公网 Ingress。
- API key 通过 secretKeyRef 放入独立变量。未知 provider/endpoint/model 时，不将其绑定到内置默认外部 provider，不发送真实模型或渠道测试。基础运行和模型可用性分别报告。
- 退出宽限为 300 秒，不等于 Docker 无限排空。升级前停止接纳并确认实际 drain；超时强杀不算安全退出。

## 验证与回滚

先服务端 dry-run，再创建 PVC/预检 Job，读回 Job 终态、实际目录权限和零写自检；最后创建 Deployment/Service/ConfigMap，验证真实镜像、Web 认证及拒绝反例、浏览器和同卷重启。只清理本次一次性 Job/测试产物，不删生产 PVC。

回滚先正常停止本次工作负载并保留 PVC，再更新为匹配版本；不靠删安装锁或重放 task.json 恢复。数据向后兼容未验证时先离线一致备份，不盲目降版。
