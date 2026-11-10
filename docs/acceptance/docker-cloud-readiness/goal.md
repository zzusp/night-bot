# Docker 云端运行准备

## 目标与完成条件

拉取最新已合并源码，在本地构建并实际运行Docker应用，梳理配置、记忆、Skill、日志、任务和会话的挂载与环境变量，为云端运行准备。用户追加要求仅保留无头浏览器；原检出其他会话的改动不得触碰。

## 当前结论

**本地准备和仅无头浏览器验证完成；镜像未推送、云端未运行。**

- 基线：`origin/main=7e32ff172e06000ef5f7a947fb02162da0553ae8`，最终fetch仍相同。
- 分支：`worktree-docker-cloud-prep-20261110`，独立worktree；不合并或修改原检出的脏工作区。
- 产品差量：Dockerfile仅增加Playwright原生 `--only-shell` 安装参数；其余为文档与验收。
- 最终镜像：`night-bot:cloud-headless-7e32ff1`，ID `sha256:b5ccab6759d1b19e94659398da3dd537c1036134794f11369dd50ba8ede6eac3`，Linux amd64，本地未压缩约1.31 GB。
- 比完整浏览器基线减小431 MB（24.8%）；真实无头浏览器API和截图CLI通过。
- 默认入口、Web HTTP认证/安全反例、实际消息回复、同卷重启/防重及正常排空通过。测试容器与专属卷已清理，保留最终镜像。

## 子目标矩阵

| 子目标 | 状态 | 证据入口 |
| --- | --- | --- |
| 获取最新代码、隔离原工作区 | 完成 | round-1.md |
| Docker引擎恢复与完整镜像基线 | 完成 | round-1.md |
| 只保留无头浏览器、构建和实跑API/CLI | 完成 | round-2.md / round-2/runtime.json |
| 默认应用运行、Web认证和真实消息回复 | 完成 | round-2/runtime.json |
| 同卷持久化、防重、正常停机 | 完成 | round-2/runtime.json |
| 挂载目录、环境变量、云端配方 | 完成 | ../../ops/docker-deployment.md |
| 镜像推送与云端运行 | 目标信息缺失，未执行 | round-2.md 未验项 |

## 决策与边界

使用新专属容器/卷及本地脚本模型，不复制真实账号、业务数据或私有Skill，不挂载Docker socket。当前产品默认full，父容器限制不冒充应用workspace隔离；ask/auto、真实厂商、完整任务工具/归档恢复、产品UI和其他架构另报未验。

默认Debian源TLS失败后使用已有runbook允许的显式HTTPS镜像源，没有绕过证书或包签名检查。仅删除冗余完整Chromium，保留headless shell及系统库；不承诺headed、显式Chrome/Edge channel或扩展。

## 证据与后续条件

第1轮保留完整浏览器基线结论，第2轮为当前有效证据。统一见 [matrix.csv](matrix.csv)、[round-2.md](round-2.md) 及其JSON/图片。后续复跑脚本在scripts/，必须先运行--check，再向新的round-N结果路径运行，不覆盖历史证据。

继续推送和云端运行需提供：镜像仓库/命名空间与可见性、云主机/CPU架构/访问方式，以及新安装还是迁移现有实例。正式镜像必须从合并后源码和匹配锁文件构建发布，云端再做自检和业务验收；本地候选镜像不冒充正式发布产物。
