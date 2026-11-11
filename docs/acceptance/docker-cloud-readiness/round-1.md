# Docker 云端准备：第1轮

## 结论与版本

最新已合并代码的本地 Docker 构建、默认入口和 Web HTTP 冒烟通过。镜像推送、云端运行和真实厂商业务未执行。本轮是用户要求缩减浏览器之前的完整 Chromium + headless shell 基线；精简结果另记第2轮，不覆盖本轮结论。

- 本地日期：2026-11-11；实际运行 UTC `2026-11-10T16:01:16Z` 至 `16:01:39Z`。
- 源码：`origin/main=7e32ff172e06000ef5f7a947fb02162da0553ae8`，收尾 fetch 时仍相同。
- 分支：`worktree-docker-cloud-prep-20261110`。原检出落后111个提交且有其他会话改动，本次另建 worktree，没有修改原检出。
- 镜像：`night-bot:cloud-check-7e32ff1`。
- Image ID：`sha256:09cce054aaa9bf5dc1eaad2f865ed8a91e4e8e2190f3c3f3d9e34a27c678f93b`。
- 环境：Docker client/server 26.0.0，Linux amd64，容器 Node v24.13.0、UID 1000。
- 源码绑定：镜像从新工作树构建。构建后第一轮复核 `git diff --exit-code 7e32ff1 -- Dockerfile .dockerignore package.json pnpm-lock.yaml pnpm-workspace.yaml config.example.json LICENSE THIRD_PARTY.md licenses bin src packages scripts/docker-entrypoint.sh` 返回0，当时变更仅为本任务文档和验收文件。后续 Dockerfile 的 headless-only 修改不追认为本轮受验源码。

## 实跑结果

| 用例 | 结果与证据 |
| --- | --- |
| Docker 引擎恢复 | 初始 API 500，后端内部引擎 no route to host；重启 Desktop 后 API、启动容器均正常，未删既有镜像或卷 |
| 镜像构建 | 默认 Debian 源首次 TLS 握手失败、APT exit100；按既有 runbook 显式使用清华两个 HTTPS build args 后 build exit0，未关闭 TLS或包签名校验 |
| 镜像打包边界 | 镜像 data 仅空 temp，Web dist index存在，无宿主 .git/.env/.claude；使用现有源码白名单 |
| 新卷零写自检 | data/temp UID1000、0700；默认 --check前后全卷目录元数据及文件摘要一致，仍仅temp |
| 默认入口运行 | 未覆盖 ENTRYPOINT/CMD；未设置权限环境变量，真实Host返回 full |
| 父容器边界 | 只读根、cap-drop ALL、no-new-privileges、tmpfs、固定 seccomp；端口仅127.0.0.1 |
| Web认证及真实设置读取 | 登录后 /api/settings 200，/api/permissions返回full |
| 安全反例 | 未认证401、错误Origin403、缺CSRF写请求403 |
| 实际消息处理 | /api/chat 202之后实际Pi请求本地脚本模型1次，读回用户和assistant共2条消息；没有停在accepted |
| 排空停机 | docker stop -t -1后exit0/PID0/OOM false，安装锁缺席；tasks.sqlite和Pi journal存在 |
| 已有卷零写自检 | 停机后全卷文件摘要和目录快照在独立--check前后完全一致 |
| 同卷重启、防重 | instanceId/actor/权限/token/chat/2条消息保留，旧cookie401；相同requestId再提交202，新增模型请求0、消息不增加 |
| 最终停机/清理 | 再次exit0/PID0；删除本次容器和卷，独立docker ps/volume ls确认该前缀无残留；保留镜像 |

本轮原始 `round-1/runtime.json` 已在最终归档时清理，必要结果和镜像身份保留在本文；最新完整附件见第3轮，原第2轮结果保留于其报告。seccomp SHA-256 为 `9264f1689d786e212fcfc1dc63eed5d08a2be4c236a252d5676f43f40691201f`。

full是应用无隔离档；父容器的约束不等于仍有应用bwrap/workspace围栏。本轮没有宣称卷内同账号私有文件隔离成立。

## 体积基线

本地未压缩Size为1,738,343,747 bytes，约1.74 GB；未推送registry，压缩传输大小未知。

- docker history：浏览器及系统库安装层约1.04 GB，生产node_modules层约240 MB，DWS二进制层约60.7 MB。
- du：/opt/playwright为701 MiB，完整Chromium413 MiB、headless shell283 MiB、ffmpeg5.1 MiB；node_modules占296 MiB磁盘块。
- 应用src约2.7 MiB，packages约5.0 MiB；配置、记忆、私有Skill、任务和会话没有打进镜像。
- history是分层字节数，du是文件系统磁盘块用量，两者不能直接相加比较。

## 证据与边界

复跑驱动在 scripts/verify-runtime.mjs。执行前已先运行node语法检查与驱动--check；实际驱动exit0。它使用唯一前缀专属容器/卷和仅容器内可达的脚本模型，成功后清理自己的资源，不使用真实账号。

未执行：ask/auto受限模式、完整任务工具/作业生命周期、浏览器UI/截图CLI、真实学习写入、归档恢复、arm64、Windows bind mount。路径归属来自当前源码和文档核对，不由普通会话结果推断全部业务能力通过。

云端缺镜像仓库/命名空间/可见性、主机/CPU架构/访问方式，以及新安装还是迁移既有实例的选择；未推镜像、创建发布tag、部署、触发CI或复制账号。

本轮无生产代码修改，未再跑无关全量pnpm测试。下一轮仅保留无头浏览器时，需重新构建并验证API/截图CLI及默认容器入口。

## 最终归档说明

本轮报告与结果保留。旧完整浏览器镜像tag和本轮中间JSON已清理，最终仅保留第2轮headless镜像及必要证据；未清理其他会话镜像或共享构建缓存。

## 第3轮续验后的附件归档

2026-11-11：继续完成正式镜像推送与生产基础运行后，仅保留第3轮最终JSON/截图。第2轮runtime.json/image.json/browser.png已清理，本轮历史结果、镜像身份及必要文字证据不变；最新原始附件见第3轮，不能用其结果追认历史运行。
