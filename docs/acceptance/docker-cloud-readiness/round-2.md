# Docker 云端准备：第2轮

## 结论与版本

按用户要求仅保留 Chromium headless shell。镜像从1,738,343,747降至1,307,009,396 bytes，减少431,334,351 bytes（约431 MB / 24.8%）。无头浏览器API和截图CLI，以及真实默认容器入口、Web认证、消息处理、同卷重启和排空均通过。

**完成的是本地构建和验证。镜像未推送、云端未运行，未接入真实模型或钉钉账号。**

- 日期：本地2026-11-11；运行UTC `2026-11-10T16:11:18Z` 至 `16:11:44Z`。
- 工作分支：`worktree-docker-cloud-prep-20261110`。
- 基线：已合并main的 `7e32ff172e06000ef5f7a947fb02162da0553ae8`，最终fetch时仍相同。
- 产品差量：仅Dockerfile安装命令增加 `--only-shell`；其余应用源码、锁文件、包依赖、入口和安全策略未变。
- Dockerfile SHA-256：`119bd355f542f24143b87cac492c2809550f659c806fb051a589d82020618781`。
- 镜像：`night-bot:cloud-headless-7e32ff1`。
- Image ID：`sha256:b5ccab6759d1b19e94659398da3dd537c1036134794f11369dd50ba8ede6eac3`。
- 版本绑定：OCI revision标签记录基线7e32ff1，额外source-state标签为 `headless-only-worktree`，不能把revision标签单独当作“无未提交差量”的证明。受验产品差量及关键构建输入摘要见 `image.json`（原附件已按第3轮最终归档规则清理）。最终提交若只有文档/验收回填，不需要重跑已通过的产品验证；正式发布仍应基于合并后版本重建并记录发布digest。
- 环境：Docker26.0.0 / Linux amd64 / UID1000 / Node24.13.0 / Playwright1.65.0 / headless Chromium158.0.8127.18。

## 方案与兼容范围

固定版本的实际 `playwright install --help` 确认支持only-shell。默认安装同时带完整Chromium和headless shell；no-shell只去掉shell、仍保留完整浏览器；only-shell符合本次服务器只要无头浏览器的要求，因此只改一个原生安装参数，没有增加定制删除或降级机制。

支持已实跑的默认 `chromium.launch()` 与 `playwright screenshot --browser chromium`。不提供headed浏览器、完整Chromium或Chrome/Edge channel；显式 `channel: 'chromium'`、扩展等能力不由本轮证明。既有可选外部Edge资源读取器本就要求部署环境另装msedge，原镜像也未内置，不改造该独立接入。

## 实跑结果

| 用例 | 结果与必要证据 |
| --- | --- |
| 镜像重建与体积 | PASS；沿既有HTTPS镜像源参数构建exit0；本地未压缩Size为1,307,009,396 bytes，非registry压缩传输量 |
| 无完整Chromium | PASS；/opt/playwright仅.links、chromium_headless_shell-1254和ffmpeg-1013；du约288 MiB，对比原701 MiB |
| 浏览器API | PASS；真实容器data/workspaces cwd中启动chromium，导航本地HTTP页，JS计算和DOM读回42，生成1280×720 PNG |
| 截图CLI | PASS；真实playwright screenshot CLI导航同一本地页面并截图；PNG为9460 bytes、1280×720；已实际查看图片，标题及42均可见 |
| 新卷零写自检 | PASS；UID1000/temp0700，--check前后全卷快照一致 |
| 父容器边界 | PASS；cap-drop ALL、no-new-privileges、固定seccomp、只读根、tmpfs和宿主127.0.0.1发布；没有IPC host或提权 |
| 默认应用入口 | PASS；未覆盖默认CMD/tini/entrypoint；未显式传权限ENV，Host报告full |
| Web认证和安全反例 | PASS；登录后设置读取200；未认证401、错误Origin403、缺CSRF写请求403 |
| 实际消息业务终态 | PASS；POST202后真实Pi调用本地脚本模型1次，HTTP读回用户和assistant共2条消息，没有停在已接纳 |
| 首次排空停机 | PASS；stop -t -1后exit0/PID0/OOM false，安装锁缺席，tasks.sqlite及Pi journal存在 |
| 已有卷零写自检 | PASS；停机后自检前后全卷目录及文件摘要一致 |
| 同卷重启与防重 | PASS；instanceId/actor/权限/token/chat/2条消息保留；旧cookie401；相同requestId再提交202、额外模型调用0、消息不增加 |
| 最终停机与清理 | PASS；再次exit0/PID0；删除本次容器和卷，独立ps/volume ls确认无本次前缀残留 |

完整分组结果见 `runtime.json`（原附件已按第3轮最终归档规则清理），最终浏览器证据见 `browser.png`（原附件已按第3轮最终归档规则清理）。图片是本轮无敏感数据的本地夹具页面，不是Night Bot产品UI截图。

full是应用无隔离档，不保证同账号可读的凭据/记忆/其他任务私密文件隔离。父容器仍有上述约束，但它们不是应用bwrap或Chromium自身sandbox已启用的证明。没有借本轮full通过外推ask/auto。

## 本轮命令与源码状态

```powershell
node --check docs/acceptance/docker-cloud-readiness/scripts/verify-runtime.mjs
node docs/acceptance/docker-cloud-readiness/scripts/verify-runtime.mjs --image night-bot:cloud-headless-7e32ff1 --check
node docs/acceptance/docker-cloud-readiness/scripts/verify-runtime.mjs --image night-bot:cloud-headless-7e32ff1 --output docs/acceptance/docker-cloud-readiness/round-2/runtime.json
```

语法、自检、实际驱动均exit0。驱动要求新结果路径，拒绝覆盖历史证据；新轮次使用round-N目录。它仅创建/删除自己唯一前缀的资源；失败保留资源供诊断。

实际Docker build使用runbook中已有的两个显式清华HTTPS参数，保留TLS/签名检查。产品源码与基线的差量仅Dockerfile这一行，另有本次README、数据目录说明、Docker运维及验收文件。没有变更包依赖/锁文件或业务运行实现，因此没有重跑无关的pnpm全量测试。云端sh配方另以bash -n检查语法，未在云端执行。

## 交付与未验项

- 挂载和环境变量清单集中于 [Docker运维](../../ops/docker-deployment.md)，包含唯一data卷、持久桶/备份排除项、角色ENV、ENV覆盖已保存配置、云端Linux启动与SSH转发。
- 普通/分诊/Router会话与任务执行会话分开说明；work-logs是持久业务日报，不与logs混为一桶；SQLite运行时权威和task.json派生性质不变。
- 真实厂商调用0；未验真实模型、DWS登录/发送、完整任务工具和Job生命周期、真实业务归档恢复、学习写入、产品浏览器UI和arm64/Windows bind mount。
- 缺云端主机/架构/访问方式、镜像仓库/命名空间/可见性，以及新安装还是迁移现有data的选择。未推镜像、部署、合并或触发CI。
- 正式发布只使用合并后源码与锁文件；本地候选镜像不冒充正式发布产物。回滚本次浏览器精简仅需回退Dockerfile安装参数并重建，不移动或重写data。

## 收尾归档

保留本报告、round-1.md、matrix.csv、当前脚本和第2轮必要的runtime.json/image.json/browser.png。第1轮原始JSON和临时iid文件在最终报告落盘核对后清理，原轮报告保留必要文字结果。仅清理本次创建的旧完整浏览器镜像tag、测试容器和卷；保留最终headless镜像，不清理其他会话镜像或共享构建缓存。

## 第3轮续验后的附件归档

2026-11-11：继续完成正式镜像推送与生产基础运行后，仅保留第3轮最终JSON/截图。第2轮runtime.json/image.json/browser.png已清理，本轮历史结果、镜像身份及必要文字证据不变；最新原始附件见第3轮，不能用其结果追认历史运行。
