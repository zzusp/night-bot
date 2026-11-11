# Docker 云端准备：第3轮

## 结论与版本

正式镜像已从合并源码重建并推送；用户授权的生产项目中新建单副本工作负载，实际 Web、认证反例、无头浏览器与同卷重建通过。**真实模型路由缺失，不能报告整体 Bot 已完成业务验收。** 本轮未发送真实模型请求或渠道消息。

- 日期：本地 2026-11-11。正式镜像本地运行 UTC `2026-11-10T16:56:24Z` 至 `16:56:48Z`；最终云端验收 `2026-11-10T17:15:00Z`。
- 应用源码：`origin/main=0e18f7704652e88b0fe315b0c14030b1bab06c15`，已包含 PR #48；新分支 `worktree-k3s-cloud-runtime-20261111`。原检出与旧已合并分支未修改。
- 受验工作树：运行时源码、依赖、锁文件和 Dockerfile 与该已合并版本一致；只有本轮部署配置、文档和证据增量。后续文档提交不冒充应用镜像源码。
- 正式本地镜像 `night-bot:release-0e18f77`；config ID `sha256:4ef61c06f27fd666345ca9cf1887b2fc23ec95d8dba729e8d01b59b2bf0f9509`。
- 发布 manifest digest `sha256:9cc2ba4f6c26ff13674b9a5051e882c3be6818dde8062acd252d26cf0af9c4b5`。远端 manifest 回读的 config digest 与本地 ID 一致，生产实际 imageID 与发布 manifest 相同。
- 新旧 headless 镜像 RootFS 层逐项完全相同，仅正式来源标签改变；镜像 1,307,009,396 bytes，压缩层合计 462,065,273 bytes。来源/输入摘要见 [image.json](round-3/image.json)。不覆盖已有候选 tag 或 latest。
- 本地 Docker 26.0.0；生产 API Kubernetes 1.29；容器 Linux amd64、Node 24.13.0、pnpm 11.25.0、Chromium 158.0.8127.18。

实际公司仓库、项目、Secret 名称、凭据入口和生产资源身份不写入公共记录；私有操作配置保留在受忽略的 `docs/tmp/k3s-cloud-runtime/`。未复制 kubeconfig、Secret 值、私有 Skills 或旧业务数据进源码/镜像。

## 实跑结果

| 用例 | 结果与证据 |
| --- | --- |
| 合并后正式构建 | PASS；按既有两个显式 HTTPS Debian build args 构建 exit0，TLS/签名和 frozen lockfile 保留 |
| 正式镜像本地全冒烟 | PASS；原默认 CMD/tini/入口；脚本 Pi 请求1次、读回2条消息；未认证401、错误Origin403、缺CSRF403；同卷重启与重复请求不增调用；两次正常停机 exit0/PID0、锁释放 |
| 浏览器与打包边界 | PASS；RootFS 与第2轮受验 headless 相同，本轮 API/截图CLI 再实跑；本地 PNG 9460 bytes、1280×720，无完整 Chromium |
| 仓库推送 | PASS；新 release tag 推送成功，独立 manifest inspect 回读摘要/平台/config，未仅凭 push 回执判断 |
| Kubernetes 服务端自检 | PASS；创建前逐对象 server dry-run，不改 context、不修改集群 RBAC/节点，不覆盖既有目标对象 |
| 专属 PVC/首次初始化 | PASS；20Gi RWO、Bound、实际 ext-family 文件系统；UID1000 创建私有 data/temp。未改已有业务 PVC |
| 原入口零写自检 | PASS；真实目标镜像与 PVC，入口 --check 成功，前后完整 data 文件/目录摘要一致，仍仅有原 temp；mode full，temp0700 |
| Kubernetes 安全状态 | PASS；实际 /proc 显示 NoNewPrivs=1、CapEff=0、Seccomp=2；根挂载ro；UID/GID1000。Pod显式 RuntimeDefault、无API token自动挂载和宿主挂载 |
| 云端 Web | PASS；真实登录/settings200、权限full；未认证401、错误Origin403、缺CSRF403，负例未创建任务 |
| 云端浏览器 | PASS；真实 API 导航本地HTTP页并读回42，截图CLI成功；API/CLI PNG均8517 bytes、1280×720；只使用本次 temp 夹具并清理 |
| 生产同卷重建 | PASS；Recreate 正常替换新Pod，最终1/1 Ready、重启计数0、imageID匹配；instance/config/token/chat保留，旧cookie401，data/temp/secrets仍0700 |
| 凭据引用 | PASS；指定现有 Secret 通过明确 secretKeyRef 注入模型独立变量和GITHUB_TOKEN；只核对非空，不输出值、不修改Secret。未绑定未知模型路由 |

本地完整结果见 [local-runtime.json](round-3/local-runtime.json)，云端脱敏终态见 [cloud-runtime.json](round-3/cloud-runtime.json)。[browser.png](round-3/browser.png) 是无敏感信息的本地夹具页，不是产品 UI 截图。云端临时截图只验证 PNG/尺寸，不宣称视觉/UI 验收。

## 关键失败与修复

1. 集群级 StorageClass/Node 读取被 RBAC 拒绝；没有请求扩大权限。依据目标 namespace 中已有存储类名与拉取凭据建立新卷，以实际调度、拉取、fs/进程检查取得必要事实。没有把 namespace 范围的 can-i get=yes 当成集群读取许可。
2. 首次私有预检驱动的内嵌换行转义错误导致脚本 SyntaxError，尚未调用原入口；修正并先编译检查生成脚本，未降低入口标准。
3. 复挂带 fsGroup 的 PVC 时，根目录实际为 uid0/gid1000/0777，原 data/temp 从0700变为2770；OnRootMismatch未避免递归改写，入口按合同拒绝。只对本任务确认 UID1000、仅空temp且无业务文件的目录恢复0700。生产模板不带fsGroup，首次空卷初始化才使用；最终预检和重建均保持0700。没有递归chown、root init或放宽0700检查。
4. kubectl 1.29 的 rollout restart 不支持 --dry-run；验证驱动改为相同 restart annotation 的 patch，先 server dry-run 再实际 patch。此前未发生重建；最终新Pod和持久状态已独立核验。
5. 归档官方文档与上游源码的网络读取失败；没有拿引用充当已读证据。字段由实际1.29 API自检和Pod运行验证；节点 runtime 具体版本未查明。

这些排障与集中复验属于同一轮，没有按单次失败新增轮次。

## 未完成与不外推项

- 指定 Secret 只有两个凭据键，没有 provider、准确 base URL、model 或协议。模型 key 只放在独立环境变量，未关联内置默认 OpenAI 路由；默认所需凭据缺席，不能把 Readiness 当成模型可用。后续补全明确配置，再做真实可见回复验收。本轮真实模型调用0、真实渠道发送0。
- Kubernetes 使用 RuntimeDefault，不是原 Docker 固定 seccomp；full 是应用无隔离档，不声称保留 workspace/bwrap 围栏，也不声称 Chromium 自身 sandbox 启用。ask/auto 未验证，不以full替代其containment验收。
- 云端重建时任务板为空；没有证明活动任务取消/排空、长任务超300秒退出、异常关机恢复、全工具或业务归档恢复。300秒宽限不等于Docker无限排空。
- 未执行真实钉钉、产品浏览器UI、arm64、Windows bind mount或从旧实例迁移。公网域名/Ingress/TLS反代不在当前Web支持合同内。
- 本轮没有运行时源码修改；没有重复跑无关pnpm全量测试、触发CI、合并本轮PR或改变其他项目。应用已部署版本来自先前已合并源码，新增运维记录的PR状态另以本轮gh回读为准。

## 操作入口与归档

本地正式镜像先执行既有 `scripts/verify-runtime.mjs --image night-bot:release-0e18f77 --check`，再以新 round-3 路径实跑。生产的私有驱动同样先 `--check`，再逐阶段创建；通用重现步骤见 [Kubernetes 规程](../../ops/kubernetes-deployment.md)，不在公开文档中保留实际目标或认证参数。

最终保留本轮 local-runtime.json、cloud-runtime.json、image.json、browser.png，以及历史报告和matrix历史列。只清理本次一次性预检/诊断Job、已不用的探针代码和旧轮附件；生产PVC/Deployment/Service/ConfigMap、最终镜像与后续模型配置所需的私有安装检查点保留。旧轮报告的附件引用注明清理状态，历史结果不变；没有创建全绿report.md。
