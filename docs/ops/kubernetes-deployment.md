# Kubernetes 单实例部署

适用于新安装；已有实例先核对数据和停机方案，不覆盖其配置或 PVC。镜像构建、环境变量和数据桶继续以 [Docker 规程](docker-deployment.md) 为准；本页处理 Kubernetes 的差异。通用模板为 [kubernetes-deployment.json](kubernetes-deployment.json)，实际目标和 Secret 引用放受忽略的 `docs/tmp/`，不得提交 kubeconfig、凭据值或私有安装配置。

## 支持边界

- 本轮目标为 Kubernetes 1.29、Linux amd64；镜像必须来自已合并源码，固定 registry digest，不在集群重建。
- `RuntimeDefault` 与 Docker 固定 seccomp **不是同一策略**。当前模板只覆盖操作者选择的 `full`，不保证 `ask/auto` 的 bwrap 可用；禁止失败后改为 Unconfined、privileged 或加 SYS_ADMIN。本配置不能当作受限模式的替代验收。
- `full` 是容器当前 UID 1000 的应用无隔离访问，不是 root、宿主机完全访问或应用 workspace 隔离。父容器仍只读根、drop ALL、no-new-privileges，不挂宿主目录、Docker socket 或 Kubernetes API token。
- 单副本 + `Recreate` + 独占 RWO PVC；禁止手动同时挂给另一运行实例。备份/恢复按 [数据布局](../DATA-LAYOUT.md) 和 [任务档案](../TASK-ARCHIVE.md) 离线一致要求，不把 PVC 快照或镜像直接当作一致备份。
- 退出宽限为 300 秒；超过后 Kubernetes 可能 SIGKILL。它不等于 Docker `stop -t -1`，更新前须停止新业务并确认实际 drain，保留退出异常、WAL、unknown 和锁证据。
- Web 仅 `ClusterIP` 和本地 port-forward，无公网 Ingress/NodePort。当前准确 loopback publicOrigin、登录 token、Host/Origin、CSRF 检查保持不变。

## 挂载与环境

PVC 默认申请 20Gi。仅首次初始化 Job 使用 fsGroup 提供的组写权限，由 initContainer 在 PVC 下创建属于 UID 1000 的 `runtime-data/` 和 `runtime-data/temp/`，均为 0700；只对本次新目录设权限，不修复未知已有目录。主容器通过 subPath 将前者挂到 `/opt/night-bot/data`。文件系统须通过模板检查；不把未经验证的 NFS/共享网络文件系统用作 SQLite 盘。

**业务 Deployment 不设置 fsGroup 或 fsGroupChangePolicy。** 首次空卷初始化才使用它们。目标 CSI 实测在再次挂载时将 0700 改为 2770，`OnRootMismatch` 未阻止递归修改；入口正确拒绝了异常目录。后续 Pod 依靠已经创建的 UID/GID 1000 目录，不触发卷级权限重写。预检失败后不能原样重挂带 fsGroup 的已初始化卷；先核实状态，已初始化的预检副本同样去掉这两个字段，绝不修复未知已有业务目录。

- PVC：配置 `config/config.json`、私有 Skills `config/skills`、记忆 `memory`、状态/普通会话 `state`、任务档案 `workspaces/tasks`、附件 `attachments`、业务日报 `work-logs` 均在同一 data 根下。
- `secrets` 在 PVC 内保存应用自行产生的私有材料。Kubernetes Secret 通过明确的 secretKeyRef 注入环境，不写进 ConfigMap；两者不是同一种存储。普通备份默认排除 secrets/logs/cache/runtime/temp。
- `/tmp` 是 64Mi 内存 emptyDir，`/dev/shm` 是 256Mi 内存 emptyDir；Pod 删除后消失，并计入容器/Pod 内存预算。长期产物不能写到这里。
- ConfigMap 保存 `NIGHT_BOT_ACTOR_ID`、显式权限模式和 `NIGHT_BOT_WEB_*`。这些导入项在每次启动写回已保存配置；删除 ENV 不会自动撤销旧的持久配置，Web/CLI 修改也可能被 ENV 覆盖。
- 模板将模型 Secret 放到 `NIGHT_BOT_MODEL_API_KEY`，**尚未绑定模型 provider**。必须由操作者确认 provider、model、API 协议和准确 base URL，再设置 `NIGHT_BOT_MODEL_PROVIDER`、`NIGHT_BOT_MODEL`、`NIGHT_BOT_MODEL_API`、`NIGHT_BOT_MODEL_BASE_URL` 和 `NIGHT_BOT_MODEL_KEY_ENV`，其中 KEY_ENV 为 `NIGHT_BOT_MODEL_API_KEY`。信息不全时不要猜 endpoint 或把 key 指向内置默认服务。
- 若需要 GitHub CLI，可额外以 secretKeyRef 注入 `GITHUB_TOKEN`；这不会自动授权任何仓库写入，也不替代调用批准。

Secret 改值后，现有 Pod 的环境不会更新，需要安全重建 Pod；修改 ConfigMap 后同样需要重建。PVC 中已经保存的 provider 也须同步核对，不能仅看 Deployment ENV。

## 新安装预检

以下为 PowerShell 7。先填写操作者自己的 kubeconfig、namespace、已发布镜像、获批 StorageClass 和现有拉取/模型 Secret；只改私有副本中的占位符，不改全局 kubectl context，不复制 Secret 值。

若 `kubectl` 报本机代理端口拒绝连接，先确认失败在本机代理而非集群。已核实控制面可直连时，可仅在该 kubectl 子进程环境移除 HTTP_PROXY/HTTPS_PROXY/ALL_PROXY（含小写形式），先用只读查询验证；不改系统代理、全局 kube context 或凭据，也不重复执行不确定是否已提交的写请求。

```powershell
$kube = '<YOUR_KUBECONFIG>'
$ns = '<YOUR_NAMESPACE>'
$file = 'docs/tmp/kubernetes-installation.json'
New-Item -ItemType Directory -Force 'docs/tmp' | Out-Null
if (Test-Path $file) { throw '先检查已有安装文件，不覆盖' }
Copy-Item 'docs/ops/kubernetes-deployment.json' $file
# 编辑私有副本，替换全部 REPLACE_WITH_*；保留镜像 @sha256、权限和挂载设置。
$m = Get-Content $file -Raw | ConvertFrom-Json -AsHashtable
if (($m | ConvertTo-Json -Depth 40) -match 'REPLACE_WITH_') { throw '仍有未填写参数' }
kubectl --kubeconfig $kube -n $ns create --dry-run=server -f $file -o name
if ($LASTEXITCODE -ne 0) { throw '服务端零副作用预检失败' }
```

检查资源名不存在，不覆盖已有安装。创建工作负载之前，先从同一 Pod 模板派生预检 Job：

```powershell
$pod = $m.items[3].spec.template.spec | ConvertTo-Json -Depth 40 | ConvertFrom-Json -AsHashtable
$pod.restartPolicy = 'Never'
# 仅第一次空卷初始化；已有卷的复检不得保留以下两个字段。
$pod.securityContext.fsGroup = 1000
$pod.securityContext.fsGroupChangePolicy = 'OnRootMismatch'
$c = $pod.containers[0]
foreach ($key in @('envFrom', 'ports', 'startupProbe', 'readinessProbe')) { $c.Remove($key) }
$c.env = @(@{ name = 'NIGHT_BOT_PERMISSION_MODE'; value = 'full' })
$c.args = @('--check')
$job = @{ apiVersion = 'batch/v1'; kind = 'Job'; metadata = @{ name = 'night-bot-preflight'; namespace = $ns }; spec = @{ backoffLimit = 0; template = @{ metadata = @{ labels = @{ 'app.kubernetes.io/name' = 'night-bot-preflight' } }; spec = $pod } } }
$preflight = @{ apiVersion = 'v1'; kind = 'List'; items = @($m.items[0], $job) }
$preflightFile = 'docs/tmp/kubernetes-preflight.json'
if (Test-Path $preflightFile) { throw '先检查已有预检文件，不覆盖' }
$preflight | ConvertTo-Json -Depth 50 | Set-Content $preflightFile
kubectl --kubeconfig $kube -n $ns create --dry-run=server -f $preflightFile -o name
if ($LASTEXITCODE -ne 0) { throw 'PVC/Job 预检失败' }
kubectl --kubeconfig $kube -n $ns create -f $preflightFile
if ($LASTEXITCODE -ne 0) { throw 'PVC/Job 创建失败，保留现场' }
kubectl --kubeconfig $kube -n $ns wait --for=condition=Complete job/night-bot-preflight --timeout=600s
if ($LASTEXITCODE -ne 0) { throw '预检未完成，不启动应用；检查 Job/Pod/events' }
kubectl --kubeconfig $kube -n $ns logs job/night-bot-preflight -c prepare-data
kubectl --kubeconfig $kube -n $ns logs job/night-bot-preflight -c night-bot
```

预检须核对实际 fs/UID/0700 和入口成功；需要证明“零写”时另做 `--check` 前后的完整 data 文件摘要/目录元数据对比，不能只凭 PREFLIGHT_OK。Job 的拉取失败、调度失败和 init 失败分别处理，不自动换权限档或跳过。

## 启动与访问

PVC 已创建，后续只创建其余三个对象，避免覆盖存储：

```powershell
$workloadFile = 'docs/tmp/kubernetes-workload.json'
if (Test-Path $workloadFile) { throw '先检查已有部署文件，不覆盖' }
@{ apiVersion = 'v1'; kind = 'List'; items = @($m.items[1], $m.items[2], $m.items[3]) } | ConvertTo-Json -Depth 50 | Set-Content $workloadFile
kubectl --kubeconfig $kube -n $ns create --dry-run=server -f $workloadFile -o name
if ($LASTEXITCODE -ne 0) { throw '工作负载预检失败' }
kubectl --kubeconfig $kube -n $ns create -f $workloadFile
if ($LASTEXITCODE -ne 0) { throw '创建失败，核对部分成功对象，不盲目重跑' }
kubectl --kubeconfig $kube -n $ns rollout status deployment/night-bot --timeout=600s
kubectl --kubeconfig $kube -n $ns get pods -l app.kubernetes.io/name=night-bot
kubectl --kubeconfig $kube -n $ns port-forward --address 127.0.0.1 service/night-bot 3080:3080
```

浏览器访问 `http://127.0.0.1:3080`。改变本地端口时同步更改 publicOrigin 和探针 Host，再安全重建。登录 token 位于 PVC 的 `secrets/web-console-<channelId SHA256前16位>/access-token`，只通过有权操作者的私密终端取用；不要粘贴进聊天、验收报告或日志。不要输出完整 Pod ENV、Secret YAML 或 kubeconfig。

Readiness 只证明 Web 在响应，不能证明模型鉴权、回复、任务、钉钉或任意工具成功。安装验收至少核对真实 imageID/digest、认证读取和 401/403 反例、实际浏览器运行，以及正常排空后的同卷重建/身份及 token 保留。模型未确认时单列阻断，不伪造真实模型或厂商验收；允许仅 loopback 的本地脚本模型验证，但须恢复原设置、清理夹具并分别报告。

## 模型与可选渠道验收

复用既有安装时，只迁移获准的模型路由和必要 provider 目录元数据；不要整份复制 config、账号或凭据。将 provider 的 apiKeyEnv 指向云端 Secret 注入的变量，并核对 ENV 与已保存配置一致。复杂 provider 目录使用应用既有配置事务先 checkOnly 再保存，保留身份及其他配置；不能仅凭型号字符串认定协议、上下文或推理配置相同。真实验证须等到已提交、用户可见的 assistant 回复；实际模型验证与脚本模型验证分别记录。

可选 DWS 必须在容器内独立登录；不要复制本地登录态。以下命令会新建设备授权流程，需要操作者在官方页面完成人类身份确认：

```powershell
kubectl --kubeconfig $kube -n $ns exec deployment/night-bot -c night-bot -- dws auth login --device --recommend --format json
kubectl --kubeconfig $kube -n $ns exec deployment/night-bot -c night-bot -- dws auth status --format json
kubectl --kubeconfig $kube -n $ns exec deployment/night-bot -c night-bot -- dws profile list --format json
```

设备流失败或进程已结束时保留脱敏错误码/原因，不把旧码当作仍在等待，不循环重试。只有真实登录成功、当前 profile 明确，且群目标与该 profile 同组织，才继续可选插件的正式配置入口；遵守运行Host锁和新渠道起始水位，不直接伪造绑定/入站文件。只验证获准测试群，以云端来源、真实收据与厂商回读区分同群中的其他实例；监听在线或发送任务ID不等于完整收发成功。登录态持久化与群业务也须分别实测，未完成就单列阻断。

## 更新与回滚

只操作本次实例。先保存已用镜像摘要和 ConfigMap 版本，停止接纳新任务，核对 SQLite/会话/任务及实际 drain；必要时缩容至 0 后离线一致备份。新镜像和持久配置均完成预检后再更新 Deployment，独立回读实际镜像与业务终态。不要仅凭 rollout 成功报告任务完成。

失败时保留 PVC 和错误证据；正常停机后回退已验证且数据兼容的镜像，不删除安装锁强行启动、不重放 JSON 快照、不用两个 Pod 同时写库。清理一次性预检 Job 前核对其 UID/标签与最终证据；不执行 PVC 删除。

参考：[Kubernetes v1.29.2 Pod API 类型](https://github.com/kubernetes/kubernetes/blob/v1.29.2/staging/src/k8s.io/api/core/v1/types.go)、[Deployment 类型](https://github.com/kubernetes/kubernetes/blob/v1.29.2/staging/src/k8s.io/api/apps/v1/types.go)。字段须由目标版本 API 的服务端 dry-run 和实际 Pod 核验；引用不替代环境验收。
