# 快速开始

从一个独立安装开始，再选择需要的聊天渠道。Night Bot 是基于 Pi SDK 的个人助理 Agent 初始化套件，不要求安装 Pi CLI。

::: warning 先确认运行权限
新安装默认使用 `full`（完全访问）：工具按启动 Bot 的操作系统账号权限执行，不提供工作区或进程隔离，也不会自动取得管理员权限。同账号可读取的凭据和 Host 私有文件可能被任意 shell 访问。请先阅读[权限与安全](./security)，使用专用低权限账号，不要交给未信任的任务或插件。
:::

## 1. 安装并初始化

需要 Git、Node.js 24+、pnpm 11.25.0，以及可用的模型服务和凭据。在准备好的安装目录执行：

```sh
git clone https://github.com/zzusp/night-bot.git
cd night-bot
pnpm install --frozen-lockfile
pnpm init:assistant --actor YOUR_OWN_ID --provider openai --model YOUR_MODEL --key-env OPENAI_API_KEY
```

- `YOUR_OWN_ID`：本安装稳定的操作者标识，后续启用 Web 时沿用。
- `YOUR_MODEL`：服务商实际支持的模型 ID。
- `OPENAI_API_KEY`：密钥的环境变量名称，不是密钥正文。通过启动进程的环境或[凭据管理](./configuration)提供密钥，不要将密钥写入命令参数或提交到仓库。

初始化创建 `data/config/config.json` 和独立实例标识，不覆盖已有配置。初始化成功不代表模型调用或渠道身份验证成功。自定义 API 与平台准备见[安装](./installation)。

## 2. 启动核心

```sh
pnpm start data/config/config.json
```

在另一个终端检查：

```sh
curl http://127.0.0.1:18998/health
```

健康接口可响应，只证明服务可达。核心可以无界面运行，不默认启用 Web、钉钉或外发。无界面接入见[本机 HTTP 接口](https://github.com/zzusp/night-bot/blob/main/docs/HTTP-ROUTES.md)。

## 3. 启用可选 Web 控制台

先正常停止上一步启动的 Bot，等待关闭完成，再执行：

```sh
pnpm --dir packages/web-console install --frozen-lockfile
pnpm --dir packages/web-console build
node bin/night-bot-config.js data/config/config.json web --enabled true --host 127.0.0.1 --port 3080 --channel-id local-web --sender-id YOUR_OWN_ID --check
node bin/night-bot-config.js data/config/config.json web --enabled true --host 127.0.0.1 --port 3080 --channel-id local-web --sender-id YOUR_OWN_ID
pnpm start data/config/config.json
```

打开 `http://127.0.0.1:3080`，从启动日志指向的本机令牌文件读取访问令牌并登录。不要把令牌放进 URL、截图、聊天或源码。已有 Web 安装应沿用原渠道 ID 与操作者标识。

`--check` 只检查候选配置，不保存。保存后的重启要求以命令返回值为准；不要用手工改文件冒充热更新。

## 4. 试一个小任务

在 Web 中输入一个不需要外发或修改文件的小问题，例如“请解释你当前能做什么，以及哪些工具需要额外配置”。核对实际回复和执行记录，再逐步验证文件、命令及渠道能力。

“已接纳”不等于任务完成；健康检查、模型调用、工具执行、渠道发送需要分别确认。发送结果未知时先核对原请求，不重复发送。

下一步：[日常使用](./usage) · [模型与配置](./configuration) · [渠道接入](./channels)

::: tip 官网与控制台不同
本站是公开的静态介绍和文档站，不连接你的 Bot，也不提供登录、任务操作或凭据输入。实际控制台运行在你自己的安装环境中。
:::
