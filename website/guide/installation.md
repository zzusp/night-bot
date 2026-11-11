# 安装

Night Bot 当前从源码安装。根包不是 npm 发布包；部署需要完整代码、锁文件和 workspace 配置，不能只复制 `src/`。

## 准备环境

- Node.js **24 或更高版本**。
- pnpm **11.25.0**，与仓库 `packageManager` 一致。
- Git 和可用的模型服务；真实模型 ID、API 协议与凭据由操作者提供。
- 独立安装目录与数据目录，不与另一实例共享 SQLite、会话或凭据。

核心由 Node 直接运行 JavaScript，没有独立的核心构建步骤。Web 是可选包，有自己的依赖与构建。核心安装不需要 DWS CLI；只有启用钉钉渠道才需要准备 DWS。

## 源码安装

```sh
git clone https://github.com/zzusp/night-bot.git
cd night-bot
pnpm install --frozen-lockfile
pnpm init:assistant --actor YOUR_OWN_ID --provider openai --model YOUR_MODEL --key-env OPENAI_API_KEY
```

默认权限是 `full`，其风险见[权限与安全](./security)。需要显式选择其他模式时，在初始化命令中增加 `--permission-mode ask` 或 `--permission-mode auto`。这些配置会被尊重，但受限执行尚未完成交付验收；后端不可用时拒绝执行，不自动退回 `full`。

自定义模型路由可在初始化时追加 `--base-url` 与 `--api`。协议和模型 ID 必须匹配你的服务，不能把配置校验通过当作真实调用通过。完整字段见[统一配置说明](https://github.com/zzusp/night-bot/blob/main/docs/ops/shared-settings.md)。

已有 `data/config/config.json` 时不要重新初始化或覆盖，改用[配置命令](./configuration)。初始化使用独占创建，拒绝覆盖已有文件。

## 按平台准备

| 平台 | 开始前阅读 | 注意事项 |
| --- | --- | --- |
| Linux | [Linux 运行前置](https://github.com/zzusp/night-bot/blob/main/docs/ops/linux-contained-runtime.md) | `ask` / `auto` 的受限执行需要实际可用的隔离后端，安装了 bubblewrap 不等于验证通过。 |
| Windows | [Windows 本机运行](https://github.com/zzusp/night-bot/blob/main/docs/ops/windows-local-runtime.md) | 按手册准备 PowerShell 等工具；受限执行与撤权仍有未完成项。 |
| macOS | [macOS 本机运行](https://github.com/zzusp/night-bot/blob/main/docs/ops/mac-local-runtime.md) | 已验证安装、服务及部分无命令任务；命令执行和长轮次续办仍有未通过项。 |
| 容器 | [部署指南](./deployment) | 容器约束不等于应用沙箱；模型与渠道仍需单独验证。 |

平台测试结果不能互相替代。部分历史手册描述的是当时的权限默认值；当前新安装默认 `full`，已有显式 `ask` / `auto` 不被覆盖。

## 保留数据再升级

应用数据位于安装根下的 `data/`，业务产物默认在 `data/workspaces/`。升级前按平台手册正常停机、完成备份，再更新代码与匹配依赖；启用 Web 时重新构建对应版本的 Web 产物。

不要删除安装锁、未知结果记录或私有数据来“修复”升级。普通停机目录不是已验证的可迁移备份，跨路径恢复见[任务备份与恢复](https://github.com/zzusp/night-bot/blob/main/docs/TASK-ARCHIVE.md)。
