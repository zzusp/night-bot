# 参考资料

本站从现有文档中整理安装、配置和使用路径。更细的命令参数、接口合同与维护步骤继续保留在代码仓库，避免维护两份完整手册。下面的链接会打开 GitHub。

## 安装与运维

- [Windows 本机运行](https://github.com/zzusp/night-bot/blob/main/docs/ops/windows-local-runtime.md)
- [macOS 本机运行](https://github.com/zzusp/night-bot/blob/main/docs/ops/mac-local-runtime.md)
- [Linux 受限运行前置条件](https://github.com/zzusp/night-bot/blob/main/docs/ops/linux-contained-runtime.md)
- [Web 安装与排障](https://github.com/zzusp/night-bot/blob/main/docs/ops/web-console-local.md)
- [统一配置 CLI](https://github.com/zzusp/night-bot/blob/main/docs/ops/shared-settings.md)
- [Docker 部署](https://github.com/zzusp/night-bot/blob/main/docs/ops/docker-deployment.md)
- [Kubernetes 部署](https://github.com/zzusp/night-bot/blob/main/docs/ops/kubernetes-deployment.md)

## 使用与扩展

- [Web 使用手册](https://github.com/zzusp/night-bot/blob/main/docs/manual/web-console.md)
- [报错反馈手册](https://github.com/zzusp/night-bot/blob/main/docs/manual/error-feedback.md)
- [任务模型](https://github.com/zzusp/night-bot/blob/main/docs/SINGLE-TASK.md)
- [长期记忆](https://github.com/zzusp/night-bot/blob/main/docs/MEMORY.md)
- [自进化](https://github.com/zzusp/night-bot/blob/main/docs/SELF-EVOLUTION.md)
- [运行时与排期](https://github.com/zzusp/night-bot/blob/main/docs/RUNTIME.md)
- [渠道协议](https://github.com/zzusp/night-bot/blob/main/docs/CHANNELS.md)
- [渠道插件](https://github.com/zzusp/night-bot/blob/main/docs/CHANNEL-PLUGINS.md)
- [HTTP API](https://github.com/zzusp/night-bot/blob/main/docs/HTTP-ROUTES.md)

## 数据与许可

- [数据布局](https://github.com/zzusp/night-bot/blob/main/docs/DATA-LAYOUT.md)
- [任务归档、备份与恢复](https://github.com/zzusp/night-bot/blob/main/docs/TASK-ARCHIVE.md)
- [第三方来源与许可](https://github.com/zzusp/night-bot/blob/main/THIRD_PARTY.md)

::: warning 阅读历史说明时
Night Bot 按启动进程的操作系统账号权限直接执行，不提权，也不提供 Bot 工作区或进程隔离。不再提供配置档位、人工审批或自动审批。旧安装里的 `permissionMode` 保留在原文件中供回退，但当前版本不读取该值；旧审批不会恢复或自动重放。操作系统、容器、渠道认证、工具调用绑定和业务授权边界仍有效。 旧手册中的权限模式说明属于历史记录。
:::

发现文档与当前代码不一致，可以[提交 Issue](https://github.com/zzusp/night-bot/issues)，并注明所用版本与不含密钥的复现信息。
