# macOS 本机运行

## 已验证范围与限制

2026-11-10 在 macOS Ventura 13.7.8 / Intel x86_64、Node.js 24.15.0、pnpm 11.25.0 上实跑。锁定依赖安装、原生安装脚本、Web 类型检查与生产构建、真实启动器和 HTTP、Web 登录/静态资源、无命令任务与正常关闭可用。模型只使用 loopback 脚本端点，不证明真实厂商模型或钉钉可用。

**本机尚未通过完整运行验收。** 默认 `ask` 的真实 `bash` 探针没有取得成功执行证明，任务返回 `TASK_EFFECT_UNCERTAIN_NO_REPLAY`、已排空并保留 blocked 结果；不得重复执行或修改账本将其结清。当前进程隐私层仅在 Linux 获取 bwrap，不能将 macOS 的测试跳过视为隔离通过。32 轮续办在原有 120 秒业务期限内未完成，定向复验亦失败，并出现清理失败。各批结果、失败原件与最终矩阵见 [Mac 验收](../acceptance/mac-local-runtime/matrix.csv)，不以本文概述代替分版证据。

`full` 要求安装操作者明确选择，按当前 OS 账号权限执行、不提权且不隔离进程；本轮未替实际安装切档，也未用它抵扣默认模式失败。`auto` 同样不能补足缺失的 OS 隔离后端。

## 安装、构建与初始化

在真实仓库目录执行 Bash 命令，不从 `/tmp`、`/var` 等别名目录初始化安装。需要另指定安装根时，使用物理绝对路径，不放宽安装目录的符号链接检查。

```bash
pnpm install --frozen-lockfile
pnpm --dir packages/web-console install --frozen-lockfile
pnpm --dir packages/web-console build
pnpm init:assistant --actor YOUR_OWN_ID --provider openai --model YOUR_MODEL --key-env OPENAI_API_KEY
```

已有 `data/config/config.json` 时不要再次初始化或覆盖它；初始化拒绝覆盖。密钥由所引用的环境变量或凭据服务提供，不在命令参数、日志或文档中放密钥正文。代码升级保留整个 `data/`，不能删除安装锁或未知效果现场。

核心无独立构建步骤，由 Node 直接执行 JavaScript；Web 构建产物在 `packages/web-console/dist/`。

## 启动与可选 Web

```bash
pnpm start data/config/config.json
```

在另一个终端只读验证：

```bash
curl --fail http://127.0.0.1:18998/health
```

日志在安装根 `data/logs/service.log`。端口被占用时选择空闲端口，不杀其他服务。正常退出使用启动终端的 Ctrl+C，等待管理启动器及子服务完成关闭；HTTP 已不可访问不单独证明任务和作业已排空。

Web 默认不启用。需要时在离线配置上先检查，再保存相同参数，之后正常重启：

```bash
node bin/night-bot-config.js data/config/config.json web --enabled true --host 127.0.0.1 --port 3080 --channel-id local-web --sender-id YOUR_OWN_ID --check
node bin/night-bot-config.js data/config/config.json web --enabled true --host 127.0.0.1 --port 3080 --channel-id local-web --sender-id YOUR_OWN_ID
```

使用 `http://127.0.0.1:3080`，令牌只在本机从日志所指文件读取后输入页面；不要贴进聊天、URL 或截图。已有 Web 实例沿用原标识。认证、CSRF 和配置生效边界见 [Web 运维](web-console-local.md)。

## 验证命令

```bash
pnpm test
pnpm test:runtime
pnpm test:routing
pnpm test:containment
pnpm --dir packages/web-console test
pnpm check
```

统一测试入口 `scripts/test-pi.mjs` 在 macOS 将传给测试子进程的 `TMPDIR` 解析为真实路径，避免系统 `/var` → `/private/var` 别名使临时安装夹具触发 `NIGHT_INSTALL_ROOT_ALIAS_UNSAFE`；生产安装检查不变。直接调用 Node 测试时显式使用物理临时目录：

```bash
TMPDIR="$(node -p 'require("node:fs").realpathSync(require("node:os").tmpdir())')" \
  node --experimental-test-module-mocks --test test/pi-wire.test.js
```

跨轮可复用的真实服务探针为 `docs/acceptance/mac-local-runtime/scripts/smoke.mjs`，从仓库根执行；它创建独立且 Git 忽略的 `data/workspaces/mac-runtime-*` 安装，使用动态 loopback 端口，核验 Web 与普通任务，再独立探测默认命令，最后正常关闭。命令未获成功执行证明时脚本退出非零，未知任务现场保留。它不使用真实凭据、不调用厂商，也不自动重试未知效果。
