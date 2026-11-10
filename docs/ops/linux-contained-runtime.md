# Linux 隔离运行

## 范围

本规程用于 Linux 本机或受管测试机上的 Night Bot portable 安装。它只说明可实施的运行前置和验证顺序，不代表本仓库已经在你的内核、模型、DWS 账号或生产环境部署成功。默认先验证无插件核心；钉钉等外部渠道必须另行配置、授权和验收。

本规程的受限进程前置适用于显式 `permissionMode: ask` 与 `auto`。当前模型进程隐私实现要求在 Linux 解析到 `bwrap`。应用找不到可用 runner 时会以 `MEMORY_PROCESS_PRIVACY_UNAVAILABLE` 失败关闭，不自动改成无隔离执行。Native sandbox 还会按当前平台能力选择 bwrap/Landlock 等实现，但不能用其中一项的存在替代模型进程 privacy 的实际探针。

## 权限选择与受限验收

顶层配置使用 `permissionMode`，默认 `full`（显式 `ask` / `auto` 保持不变）；初始化可传 `--permission-mode ask|auto|full`。离线修改先运行 `node bin/night-bot-config.js data/config/config.json permissions --permission-mode ask --check`，检查后再去掉 `--check` 保存，并按 `restartRequired` 正常重启。认证 Web 可在线保存，但必须回读 Host 的实际模式。具体操作见[权限与审批](web-console-local.md#安装权限与单次审批)。

`ask` 将外部业务写入或更宽命令范围交人工逐次批准；`auto` 由当前 Pi 模型无工具审查，失败或不确定转人工，两者继续保留私有区与精确 scope 隔离。`full` 为缺省模式，也可由安装操作者选择，以当前 OS 账号直接访问，不提权，不承诺工作区或同账号 Host 私有文件隔离；容器/OS 原有限制仍有效。full 不是 bwrap 不可用时的回退，也不能抵扣本页受限执行验收。保存配置本身不证明外部目标操作成功或后端已可用，新权限真实结果以[当前目标](../acceptance/resident-conversation-routing/goal.md)为准。

## 支持前置

在目标安装根目录只读检查：

```sh
uname -a
command -v node
node --version
command -v pnpm
pnpm --version
command -v bwrap
bwrap --version
node bin/night-bot.js --help
```

要求 Node.js 24+、pnpm 11（以锁文件和当前项目工具链为准）、可执行的 bubblewrap、可用的 `/proc` 与 `/dev`，以及允许当前运行方式建立 bwrap 所需 namespace 的内核/宿主策略。不要猜测 root、容器或 user namespace 权限；以实际探针结果为准。若 `command -v bwrap` 或探针失败，停止在准备阶段并保留原错误。

使用不写业务数据的最小探针检查 bwrap 能否建立当前应用使用的基础边界：

```sh
bwrap --ro-bind / / --dev /dev --unshare-pid --proc /proc --die-with-parent -- true
status=$?
if [ "$status" -ne 0 ]; then
  echo "bwrap probe failed: $status" >&2
  exit "$status"
fi
```

该探针只证明本机可以启动一次基础 bwrap，不证明任意 shell、后台作业、文件工具、模型 provider 或外部网络都已验收。应用仍会在真实工具调用前执行自身路径、环境、workspace 和隐私守卫。

### 进程范围所有权单独验证

bwrap 的路径/namespace 隐私与完整进程范围所有权是不同边界。当前 `linux-scope` 还要求实际私有 bootstrap/libc execve 可用，以及当前用户的 `systemd-run --user --scope` 和 `systemctl --user` 能建立、查询和回收真实 transient scope；仅安装命令或基础 bwrap 探针通过不够。深探测不满足时，当前实现明确警告并选择较弱的 `fallback`：逃离进程组或直接父链的后代，不保证被终止或阻止 `waitForExit()` 结算。

验证必须观察真实工具调用所在进程的实际选择，并结合业务终态与范围 drain；不要预跑独立 probe、注入 provider 或只凭一个 `linux-scope` 字符串宣称排空。当前受限 Docker 六例已在封定镜像上取得业务 PASS，但三个 worker 的实际选择全部为 `fallback`，不能称强所有权验收通过，也不外推到其它宿主。准确源码和结果见[当前目标](../acceptance/resident-conversation-routing/goal.md)。需要由目标环境提供上述真实用户 manager/范围能力；不能通过添加容器特权、扩大 capabilities、挂载整宿主或更改宿主安全策略将本轮结果改称通过。

## 安装与配置

使用独立安装目录和独立 `data/`，不要把多个实例的运行数据、SQLite、WAL、日志或临时目录混用：

```sh
pnpm install --frozen-lockfile
pnpm check
```

只在目标配置不存在的全新安装中初始化；初始化会创建目录和配置，不会验证模型、账号或外发权限：

```sh
pnpm init:assistant --actor YOUR_LOCAL_ACTOR --provider openai --model YOUR_MODEL --key-env OPENAI_API_KEY
```

审核 `data/config/config.json` 时保持 `shell: "bash"`、loopback `resident.host` 和本实例空闲端口；`channelPlugins` 保持空数组或所有示例项 `enabled:false`。密钥只通过配置引用的环境变量或受支持的凭据机制提供，不写命令行、仓库、日志或验收材料。业务工作和交付文件默认位于 `data/workspaces/`，秘密、日志、缓存和 temp 继续分桶保存。外部业务路径须按下述模式取得本次操作的准确授权，不将外部文件自动迁入安装目录。

配置解析检查不启动应用、不连接 DWS：

```sh
node --input-type=module -e "import { loadConfig } from './src/config.js'; await loadConfig(process.argv[1]); console.log('CONFIG_OK')" "$(pwd)/data/config/config.json"
```

## 无插件运行与验证

先执行无插件的最小任务，再考虑外部渠道。使用受管入口启动，避免直接绕过 launcher：

```sh
pnpm start "$(pwd)/data/config/config.json"
```

另一个终端只读检查 loopback 健康状态和任务终态；`status:ok`、进程存活、listener ready 或模型的一句成功说明都不能代替 `task_result`、实际文件、Pi journal、效果收据和排空证据。shell、`grep`、后台 job 等路径必须在当前 Linux 宿主实际执行并核对工作区边界、失败关闭和终态 drain；不以 Windows 或旧 DSH 记录外推。

优先使用项目已有分组验证，不把条件不满足的跨平台用例改成通过：

```sh
pnpm test:runtime
pnpm test:routing
pnpm test:containment
```

这些命令是代码/合同验证，不等于当前部署已完成真实模型或真实渠道验收。需要迁移既有 Night Bot 数据时，先停机排空并使用脚本的零副作用检查；当前迁移入口支持 `scripts/migrate-resident-router.mjs --check --config <CONFIG>`，检查未通过不得执行写入。不要导入旧 DSH 数据。

冷启动中确定的 `ROUTER_BATCH_UNSETTLED` 会保留任务服务 `recover()` 的 `degraded` 结果和现有恢复告警；入口仍在不代表原批次已结。续办只由受信 Host 集成按[原批次续办合同](../CHANNELS.md#已接纳未结批次的显式续办)绑定原失败 checkpoint，不新增操作者 HTTP/CLI，不直调 SDK，不重跑任务/业务输入或改写 journal、DB、通知收据；其它恢复错误继续失败关闭。[第八轮报告](../acceptance/resident-conversation-routing/round-8.md)已有 Windows/loopback 脚本模型下的续办与原安装普通交接恢复结果，均按各组受验指纹成立；这些结果不证明 Linux 已部署或本页 bwrap/内核/shell/job 已在 Linux 实跑，目标 Linux 宿主仍须独立验证。

## 可选渠道与账号前置

核心无插件任务通过后，才在私有配置中显式启用渠道。DWS 是可选插件，不是 Linux 核心运行前提；必须使用显式 `profile`、获准群列表和职责配置，先 `listen:false`、`writesAuthorized:false` 验证配置，再按授权分别打开监听和发送。Linux `accountMode:"private"` 只隔离 Night Bot 管理的配置/keychain 目录，不等于不同 OS 安全主体；`system` 复用当前用户的外部 CLI 登录态。

真实渠道验收必须来自真实订阅/历史补读，核对唯一来源、唯一事项/执行 session、群内文本和附件实际 readback/receipt、精确自身回声过滤、同完成事件的无工具复盘、IPC 排空和冷恢复不重放。fake、SDK/HTTP 注入、`acceptHistoryMessage`、健康状态或 send accepted 不可替代这些终态。Linux runbook 不提供登录、发送、部署或生产授权。

## 停机、备份与回退

正常停机使用 Ctrl+C，并等待 Host 排空、launcher 退出和日志写入完成；不要删除仍被运行中的 SQLite WAL、Pi journal、task workspace、临时文件或通知收据。关闭若报错，保留现场并独立检查资源与 owner；已证 Host/application 异常关闭短路风险未在本轮修复，不能从正常退出推断错误路径也已排空或安全解锁。升级前按 [数据布局](../DATA-LAYOUT.md) 备份，默认排除 secrets、日志、cache 和 temp；备份可能包含私有来源、任务文件和 Pi 历史，不是脱敏包，也不能恢复外部发送效果或授权。

回退必须停机后恢复同一升级前代码、锁文件、配置和数据快照，不能只回退 Git、只替换 SQLite，或把新版 Pi journal 与旧账本混用。路径、实例和 digest 不一致时保留阻断现场，重新执行 `--check`；不删除 unknown、WAL 或效果证据来“清理”失败。

Linux 上的 bwrap 探针、默认无插件任务和定向渠道验收分别记录；其中任一失败只报告对应边界，不扩大成整个 Night Bot 或所有平台均不可用。支持范围随源码和实际内核证据更新，不通过关闭 sandbox、放宽工作区或复制凭据来通过检查。
