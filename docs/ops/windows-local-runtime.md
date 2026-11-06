# Windows 本机隔离运行

## 范围

使用 Windows 11、PowerShell 7、Node.js 24+ 和 pnpm。这里的隔离部署用于本机验收，不替换已有安装，不注册开机服务，不发送渠道消息。运行时使用源码 ESM 入口，项目没有独立的 `build` 脚本。

已有 `scripts/deploy-local.ps1` 属于历史 DSH 安装流程，不适用于当前 Night Bot。代码升级只更新代码与依赖，保留各安装自己的 `data/`；不搬运账号文件、业务数据或旧 DSH 历史。

## 只读检查

在目标安装目录运行，先确认分支和已有改动：

```powershell
Get-Location
git status --short --branch
node --version
pnpm --version
Get-NetTCPConnection -State Listen | Where-Object LocalPort -eq 19198 | Select-Object LocalAddress,LocalPort,OwningProcess
```

端口被其他实例占用时，给本次配置选一个空闲 loopback 端口；不要终止未知进程。检查现有 `data/config/config.json` 是否存在，不输出其正文。已存在时不重新初始化。

## 安装与配置

```powershell
pnpm install --frozen-lockfile
pnpm check
```

仅在全新安装且目标配置不存在时初始化：

```powershell
pnpm init:assistant --actor YOUR_LOCAL_ACTOR --provider openai --model YOUR_MODEL --key-env OPENAI_API_KEY
```

初始化拒绝覆盖已有配置。审核安装内 `data/config/config.json`：`installRoot` 为 `../..`，`shell` 为 `pwsh`，`resident.host` 为 `127.0.0.1`，本机验收端口可用 `19198`，`channelPlugins` 为 `[]`。不要把配置、凭据或任务产物加入 Git。

Codex 使用 `openai-codex` provider 与固定 Pi SDK 实际支持的模型；模型名从官方 catalog 选择。当前代理环境下的本机验收使用该 profile 的 `transport: "sse"`。应用与 SDK 的 undici 均固定在 8.12.3，并显式使用 CONNECT，避免 SDK 导入后覆盖代理 dispatcher。

## 认证

只读列出官方认证状态，不读取凭据正文：

```powershell
node bin/night-bot-auth.js data/config/config.json list
```

只有状态确实缺失且需要授权时，才由使用者本人完成官方流程：

```powershell
node bin/night-bot-auth.js data/config/config.json login openai-codex
```

API Key profile 使用声明的 `apiKeyEnv` 引用。可通过既有环境或 `night-bot-auth ... set-ref NAME` 的隐藏输入配置；不把密钥写入命令行、日志、源码或验收报告。配置文件只含变量名不代表已经具备可用密钥，必须分别记录配置可解析与真实 API 调用结果。不要为补齐引用搜索其他秘密文件。

## 启动与停止

```powershell
node bin/night-bot-run.js data/config/config.json
```

受管入口将服务日志追加到 `data/logs/service.log`，并把子进程临时目录和缓存指向安装内 `data/temp`、`data/cache`。在另一终端检查：

```powershell
Invoke-RestMethod http://127.0.0.1:19198/health | Select-Object status,modelMode,recoveryIssueCount,inboundConfigured,outboundAuthorized
```

前台停止使用 Ctrl+C，等待 launcher 正常退出。Node 父进程托管时，必须保留 IPC 通道并发送 `{type:'night-bot-shutdown'}`；launcher 会转发给服务，等现有关闭路径排空后退出。Windows 的 `Stop-Process` 或 `child.kill('SIGTERM')` 是强制终止，不能当成优雅排空证据。本机验收的临时监督器仅管理它自己启动的实例，不是正式 Windows 服务管理器。

不要清理仍被进程使用的数据、SQLite WAL、会话或临时文件。

## 真实验收

通过本机 HTTP 创建明确授权的有限任务，例如仅在任务 `work/` 中写入标记、读回并提交完成。必须观察任务 `completed`、正式 `task_result`、实际文件和官方 Pi journal；健康响应或模型的一句成功说明不足以证明任务完成。

本轮可复用核验入口：

```powershell
node docs/acceptance/pi-native-retirement-local/scripts/verify-live-task.mjs . TASK_ID http://127.0.0.1:19198
```

该脚本只适用于约定的标记文件验收任务。冷重启后比较同一任务、文件 SHA-256、journal SHA-256 和工具调用次数；不得重新创建任务代替持久性检查。

## 平台限制

- Windows 本轮已验证官方文件工具的受控任务执行；不据此宣称任意插件、shell 或系统路径统一隔离。
- 安装模式的模型子进程隐私 namespace 当前只有 Linux 实现。Windows 缺少该能力时继续 `MEMORY_PROCESS_PRIVACY_UNAVAILABLE` 失败关闭；依赖它的真实 shell、后台作业和打包检索成功路径单独列为未覆盖，不关闭 sandbox 迁就测试。
- 目录 junction 可用于真实 reparse-point 边界验证；普通文件 symlink 在没有权限时不能声称已覆盖。
- POSIX `chmod` 位不能证明 Windows DACL 隐私。Linux `/proc/self/fd` 启动协议、POSIX 权限和内核隔离结果不移作 Windows 认证。
- DWS 是可选渠道，本机核心验收不加载它。真实渠道验收单独授权，钉钉仅使用约定测试群。
