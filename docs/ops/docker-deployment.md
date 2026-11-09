# Docker 隔离部署

## 范围与支持状态

直接安装仍按 [Linux](linux-contained-runtime.md) 或 [Windows](windows-local-runtime.md) 规程执行。Docker 为新增部署方式，以下命令使用 PowerShell 7、容器内运行 Linux；镜像构建声明支持 `linux/amd64` 与 `linux/arm64`，不支持 Windows containers 或 Alpine/musl。本页的已审 seccomp 差量及机制实证仅覆盖 `linux/amd64`；不能用它宣称 arm64 运行已通过，也不将 amd64 规则复制为未经审查的 arm64 放行。

镜像固定 Node.js `24.13.0` 的 manifest digest、pnpm `11.25.0` 和官方 DWS CLI `v1.0.67`。Bot/Web 各按自身锁文件安装，Web 静态资源在镜像内构建，插件不默认启用。DWS 二进制和 LICENSE/NOTICE 均核 SHA-256，许可保留于 `/usr/local/share/licenses/dws/`。安装 DWS 不表示已加载渠道、登录或获得外发授权。

**Docker daemon ready、源码核查、镜像定义和基础探针均不能代替 build、实际任务、隔离与业务验收。** 当前结果以[唯一目标](../acceptance/resident-conversation-routing/goal.md)最新轮次为准；未完成的真实模型、登录、厂商交付和 Web 浏览器验证独立报告。

本次实施与验收范围为操作者明确选择的 `full`；`ask`/`auto` 合同及历史结果保留，但受限执行尚未完成、本次不交付。下方示例显式选择 `full`，不改变产品默认 `ask`，也不隐式修改未提供模式参数的已有实例。

## 沙箱与运行前置

受限 `ask`/`auto` 档的模型进程隐私使用真实 bwrap，容器不替代应用沙箱。所有档位入口均检查非 root 与受控卷；受限档另检查当前应用基础 bwrap profile，失败返回 `NIGHT_DOCKER_BWRAP_UNAVAILABLE`，不进入应用、不自动切为 `full`。显式 `full` 不执行该应用 bwrap 前置，也不承诺应用层进程隔离；父容器约束仍保持。镜像移除 bwrap setuid 位，不依赖提权。

目标 Docker Engine 26 的内建 `seccomp=builtin` 已实测阻断本应用 bwrap。生产启动明确传入下述固定本地策略，不再把已证失败的 builtin 当作最终路线，也不继承 daemon 可能已有的 `unconfined` 设置。宿主 user namespace、AppArmor、内核和运行模式仍可能阻断 bwrap；策略加载成功不代表这些条件或当前应用已通过。失败保留具体 errno/原始错误，不自动扩大规则。

本页始终保留非 root、`--cap-drop=ALL`、`no-new-privileges` 和只读根。不得修改 daemon 或加 `--privileged`、`SYS_ADMIN`、Docker socket、整宿主挂载、`seccomp=unconfined`、关闭 AppArmor 或关闭应用沙箱来通过检查。不要为验收安装 WSL/系统组件、重启机器或改动其他实例。

### 固定 seccomp 资产与精确差量

Moby 官方 annotated tag `v26.0.0`（tag object `008fecccdeb62da47dbf77d6266458e26e1d5424`）指向 commit `8b79278316b532d396048bc8c2fa015a85d53a53`；下列基线、LICENSE 与 NOTICE 均按该 commit 的原文核摘要，来源链接固定到该 commit。

以下文件随本规程发布，均不含账号、个人路径或诊断私有值：

| 本地资产 | 来源与 SHA-256 |
| --- | --- |
| [docker-seccomp-baseline.json](docker-seccomp-baseline.json) | 官方 Moby `v26.0.0/profiles/seccomp/default.json` 原字节；`9c1025c88ccaa517b648da571961838744ea2137f176bfe6a48b21294cae9c76` |
| [docker-bwrap-seccomp.json](docker-bwrap-seccomp.json) | 上述官方 31 条规则原义不变，仅追加 13 条 amd64 规则；`9264f1689d786e212fcfc1dc63eed5d08a2be4c236a252d5676f43f40691201f` |
| [docker-seccomp-license.txt](docker-seccomp-license.txt) | 官方完整 Apache-2.0 LICENSE 原字节；`7c87873291f289713ac5df48b1f2010eb6963752bbd6b530416ab99fc37914a8` |
| [docker-seccomp-notice.txt](docker-seccomp-notice.txt) | 官方完整 NOTICE 后附 Night Bot 修改声明；`b794129ac4d9aae11b95157bc84079783d9388b864774369287bea4cfff8b8f6` |

正式策略与已审诊断策略 `6a493f7e05bbb4fa4db0908225b2dc0afb917c63e649037b1f49bb78b3c1801e` 的过滤对象完全一致；只规范为 LF，并在第一条新增规则的 `comment` 保留修改声明。上游 NOTICE 原文 SHA-256 为 `b40ec5b16182103ef1cd69d42a21c98369e35bd483b3973902da4807c0755446`，修改部分与官方许可分开标明。默认仍为 `SCMP_ACT_ERRNO`/errno 1，`archMap` 和原有 capability 条件未变；cap-drop ALL 不会因保留官方条件规则而获得 capability。

差量适用于已审 Debian bubblewrap `0.8.0-2+deb12u1` 调用路径，每条均为 `SCMP_ACT_ALLOW` 且 `includes.arches=["amd64"]`。`mount` 参数为 `(source,target,fstype,flags,data)`；下表 P 只表示非 NULL 指针，不表示固定字符串或路径。所有 mount 的 target 均为 P。

| 新增规则 | 精确数值与 NULL 形状 |
| --- | --- |
| clone | arg0 = `805437457`（NEWNS + NEWUSER + NEWPID + SIGCHLD） |
| mount：递归 slave 传播 | flags = `573440`；source/fstype/data = `0/0/0` |
| mount：基础 tmpfs 类 | flags = `6`；source/fstype/data = `P/P/0` |
| mount：带选项 tmpfs 类 | flags = `6`；source/fstype/data = `P/P/P` |
| mount：首次 newroot bind | flags = `3236810752`；source/fstype/data = `P/0/0` |
| mount：普通递归 bind | flags = `53248`；source/fstype/data = `P/0/0` |
| mount：bind-remount | `(flags & 18446744073707451378) == 36898`；source/fstype/data = `P/0/0` |
| mount：proc 类 | flags = `14`；source/fstype/data = `P/P/0` |
| mount：devpts 类 | flags = `10`；source/fstype/data = `P/P/P` |
| mount：旧根递归 private 传播 | flags = `311296`；source/fstype/data = `P/0/0` |
| pivot_root | arg0/arg1 = `P/P` |
| umount2 | arg0 = P；arg1 = `2`（MNT_DETACH） |
| unshare | arg0 = `268435456`（仅 CLONE_NEWUSER） |

bind-remount 的可变位只为 `{1,4,8,1024,2048,2097152}`，保留 bwrap 从 mountinfo 继承的 readonly/noexec/atime 等标志。64 位 mask 必须保留精确整数，禁止经 JavaScript 不安全 Number 或不保证 uint64 的 JSON 工具解析后重写。未新增无条件 mount、setns、任意 namespace 组合或新 mount API；原 clone3 的 ENOSYS 回退不变。classic seccomp 不读取路径、fstype 或 data 字符串，也不能验证两个路径是否相等；此策略不声称只允许 tmpfs/proc/devpts。受限 `ask`/`auto` 档的路径、传播和业务读写边界仍由独立 user/mount namespace、外层无宿主业务挂载、cap-drop 与应用 bwrap/Host 隐私层共同落实；该应用隔离说明不适用于显式 `full`。

策略由宿主 Docker CLI 读取并交给 daemon，不是业务 bind mount，不写入 data、不复制到镜像。`.dockerignore` 继续排除 docs；不要为读取策略挂载仓库、安装根或 Docker socket。基线、内核或 bwrap 版本变化时，先核实际差异和拒绝证据，不沿用“旧版本通过”结论。

已有 Host-only PASS 仅绑定旧 `29687f6e` 镜像、`88a295c0` 源图与已审过滤规则；其结果明确 `currentSourceApplicationVerified=false`、`realVendorExecuted=false`。它支持此最小机制组合，不代替最新 Dockerfile（含 data/temp）与当前应用源码的 build、默认核心/配置、受控卷及登录前 waiting-auth 验收。

## 构建与零业务自检

固定 slim 基础镜像实测未安装 `ca-certificates`，两个构建 stage 先从该 Node 24.13.0 的内置 Mozilla 公共根生成临时 PEM，仅以 APT 的 `Acquire::https::CAInfo` 引导同一官方 `deb.debian.org` 源的 HTTPS 更新和安装；显式保留 `Verify-Peer=true`，不修改原 `Signed-By` 或 Debian 签名规则。安装 Debian `ca-certificates` 后删除临时 PEM，后续使用系统 CA，不保留替代信任配置。首次 HTTP 503 构建失败不是 sandbox 失败；修复是否通过以新的实际 build 终态为准。

先核对真实工作树，不把 HEAD 当作未提交源码唯一标识。开发验收可从工作树构建；正式发布必须基于已合并、已通过检查的源码和匹配锁文件。本规程不授权部署、真实发送或触发 CI。

若默认源的网络路径不可用，可显式传入 Debian 官方镜像列表中的 HTTPS 地址，例如 `docker build --build-arg DEBIAN_ARCHIVE_URL=https://mirrors.tuna.tsinghua.edu.cn/debian --build-arg DEBIAN_SECURITY_URL=https://mirrors.tuna.tsinghua.edu.cn/debian-security --tag night-bot:sg12 .`。两个 stage 使用相同参数，保留原 suites、components、Signed-By、InRelease 与包摘要校验；不自动切换源，不接受带凭据、query 或 fragment 的地址。参数是公开构建配置，禁止放代理密钥。网络 HTTP 200 仅证明可达，实际 APT 验签与镜像构建仍须完成。

```powershell
git branch --show-current
git status --short
$seccomp = (Resolve-Path 'docs/ops/docker-bwrap-seccomp.json').Path
$seccompExpected = '9264f1689d786e212fcfc1dc63eed5d08a2be4c236a252d5676f43f40691201f'
if ((Get-FileHash -Algorithm SHA256 $seccomp).Hash.ToLowerInvariant() -ne $seccompExpected) { throw 'Seccomp asset hash mismatch' }
docker version
docker build --tag night-bot:sg12 .
docker volume create night-bot-data
$common = @(
  '--cap-drop=ALL', '--security-opt=no-new-privileges',
  "--security-opt=seccomp=$seccomp", '--read-only',
  '--tmpfs', '/tmp:rw,nosuid,nodev,size=64m,mode=1777',
  '--mount', 'type=volume,source=night-bot-data,target=/opt/night-bot/data'
)
docker run --rm --network none --name night-bot-check @common -e NIGHT_BOT_PERMISSION_MODE=full night-bot:sg12 --check
```

只用本实例专属命名卷，不复用其他实例的 SQLite、Pi journal、技能或账号。镜像内 `data` 及空的 `data/temp` 为 UID/GID `1000:1000`、权限 `0700`，确保工具版本自检时 `TMPDIR` 已存在；Docker 初始化新卷，入口只接受同 UID 的真实目录，不替外部共享目录 chown/chmod。不要用 `--user root` 或 `volume-nocopy` 绕过所有权约束。

`--check` 不初始化或保存配置、不创建 data 子目录、不向卷写入编译或工具缓存、不登录、不连接模型/渠道或发送消息。它只读核查卷与 `data/temp` 均为同 UID、规范路径下的真实目录，且 `data/temp` 权限精确为 `0700` 并可读写进入；缺失或不安全即失败，不自动 mkdir/chmod/chown。仅该自检分支在首个 Node 进程前设置 `NODE_DISABLE_COMPILE_CACHE=1`，检查 Node/pnpm 版本；`ask`/`auto` 另检查 bwrap 版本并跑一次临时 namespace 探针，显式 `full` 不跑该探针。默认自检不调用可选 DWS CLI；镜像内 DWS 的固定发行资产及摘要在构建时核验，不将其 CLI 版本探测作为核心启动前置。正常 `run` 的缓存、HOME 与插件环境导入不受该自检设置影响。有效档位先取显式非空 `NIGHT_BOT_PERMISSION_MODE`，否则读取已有配置，缺省为 `ask`。Docker 的卷初始化不属于入口检查。`NIGHT_DOCKER_PREFLIGHT_OK` 只证明对应档位的这些前置，`full` 自检成功不证明受限档可用；失败不继续登录或启动业务，也不删除 unknown/WAL/历史来重试。

### 内置工具与基础无头访问

镜像保留 Debian `git` 并安装 `gh`；根生产依赖固定 Playwright `1.65.0`，构建期安装 Chromium 及系统库，浏览器放在镜像层 `/opt/playwright`，不是持久卷下载缓存。`/usr/local/bin/playwright` 已接入 PATH。基础工具/浏览器实证绑定镜像 ID `e3677dda58c0`，版本为 git `2.39.5`、gh `2.23.0`、Playwright `1.65.0`、Chromium `158.0.8127.18`；真实业务 cwd 下 API/CLI 的本地页导航、JavaScript/DOM 与物理截图通过。最终镜像 `e1a5708cb893`（本轮重建的 `night-bot:sg11-full-tools-03fd3aeb`）复用同一构建的浏览器层，未在该镜像重跑浏览器；该可变 tag 不作为旧镜像的固定身份。分版证据统一见[第45轮](../acceptance/resident-conversation-routing/round-45.md)，不据基础工具探针宣称默认应用 `run` 全链或真实 GitHub 业务通过。

在已存在任务的 `work/` 内，可直接使用 CLI；以下 URL 仅为示例，实际页面仍需业务授权和容器网络可达，本轮实跑使用的是容器本地页：

```sh
playwright --version
playwright screenshot --browser chromium https://example.com/ ./page.png
```

从任意业务 cwd 使用 JS API 时，应从 `/opt/night-bot/node_modules/playwright/index.mjs` 绝对路径导入 `chromium`，不承诺 bare `import 'playwright'` 能跨目录解析。临时浏览器 profile 使用既有 `TMPDIR=/opt/night-bot/data/temp`。默认 `chromiumSandbox:false` 会加入 `--no-sandbox`；这里不承诺浏览器自身 OS 隔离，也不能将父容器约束称为 Chromium sandbox 已启用。上述实跑保持 UID 1000、cap-drop、no-new-privileges、固定 seccomp、只读根，未加 `--ipc=host` 或提权参数。

## 一次配置环境参数

在安装内已被 Git 忽略的 `data/secrets/docker.env` 准备私有 env 文件，只给安装操作者读取。以下均为键名/占位示例，真实值只在本机填写，不进入源码、镜像 build ARG/ENV、命令历史或验收材料。

```dotenv
NIGHT_BOT_ACTOR_ID=local-operator
NIGHT_BOT_PERMISSION_MODE=full
NIGHT_BOT_MODEL_PROVIDER=openai
NIGHT_BOT_MODEL=YOUR_MODEL
NIGHT_BOT_MODEL_KEY_ENV=OPENAI_API_KEY
OPENAI_API_KEY=REPLACE_LOCALLY
```

自定义兼容模型端点另设 `NIGHT_BOT_MODEL_BASE_URL=https://your-model-endpoint.example/v1` 和匹配 Pi provider 的 `NIGHT_BOT_MODEL_API`。URL 不得包含用户名、密码或密钥 query。`NIGHT_BOT_MODEL_KEY_ENV` 是密钥环境变量的名字，不是密钥本身；CLI 只保存引用。

首次必须提供 `NIGHT_BOT_ACTOR_ID`，调用既有 init 创建实例和入站起点。已有卷不重新初始化 actor、instanceId 或起点，只将显式模型参数交给通用 model CLI，先 `--check` 后保存；未提供的参数保留原值。入口不把配置保存称为在线生效，修改运行中的配置仍按对应 CLI 的 `restartRequired`/在线控制合同处理。

### 权限环境映射与容器层级

`NIGHT_BOT_PERMISSION_MODE` 是容器配置入口，唯一取值为 `ask`（请求批准）、`auto`（帮我批准）、`full`（完全访问）。新实例缺省为 `ask`。首次运行时入口将选定值作为显式 `--permission-mode` 交给 init；已有实例仅在提供非空该环境参数时，执行 `night-bot-config CONFIG permissions --permission-mode VALUE --check` 再保存同一命令，持久化到顶层 `permissionMode`。未提供时保留已有配置，旧配置缺该键时按 `ask`。Host 和通用 CLI 不静默读取此环境变量代替函数参数；`--check` 只校验，不保存选择。

- `ask`/`auto` 均按现有 seccomp/bwrap 受限路线运行。范围外业务写应进入审批，获批调用须获得与 actor、call、参数及范围绑定的实际精确访问；不能一概路径拒绝，也不能自动扩大范围。`ask` 将待审批动作交给人；`auto` 由无工具 Pi 模型评审，判断不确定或评审失败转人工批准。受限档失败不自动切 `full`。
- `full` 只能由有权操作者显式选择，任务模型和普通渠道发送者不能切档。它使用容器内当前 OS 账号（本镜像 UID/GID `1000:1000`）的访问能力，不提升为 root 或管理员；仍受父容器只读根、专属卷/tmpfs、cap-drop、no-new-privileges 与固定 seccomp 约束。
- `full` 下应用不再承诺 workspace 围栏，也不承诺隔离同账号可读的 Host 私有文件（如卷内凭据、原始记忆、其他任务历史）；不能将父容器边界称为仍保留应用 bwrap 隔离。任务档案元数据等仍由 Host 管理，但该业务归属不是 `full` 下的 OS 隐私保证。默认业务工作和保留产物仍在 `data/workspaces/`。

只为确有需求且理解上述访问范围的安装选择 `full`，不新增宿主挂载或更改已审策略。各档分别验证；`full` 成功不能抵替 `ask`/`auto` 隔离验收，也不能据旧受限结果宣称本版三档已验收。

Docker daemon 管理者可读取容器环境，env 文件与 daemon 权限均属于秘密边界。不要采集完整 `docker inspect`、`env` 或进程环境。HOME、DWS 配置/keychain、cache/temp 为镜像内部固定接线，用户无需另传 `DWS_*`，也不支持把这些目录改到受控 data 外。

### GitHub token 的运行时注入

需要 `gh` 环境认证时，由操作者通过秘密管理器或受控宿主会话提供 `GITHUB_TOKEN`，按下方启动命令只传 `-e GITHUB_TOKEN`，不在命令中写 token 值；不使用 GitHub 时去掉该选项。环境认证无需 `gh auth login`。镜像没有 token build ARG/ENV，入口不将 token 保存到应用配置，也不把它放进工具参数或持久 Job 描述。

Host 仅在已授权、绑定显式 `full` 的 bash/pwsh 最终 spawn 边界，从可信进程环境直接注入 `GITHUB_TOKEN`；这些 shell 启动的子孙进程仍按正常环境继承。`grep` 工具没有额外注入，不能据此推断其他后代绝不会包含 token；全局秘密清理规则不放宽。最终镜像 `e1a5708cb893` 的真实默认 task 已通过 bash/token、正式 task_result、Job `completed`/`producerReported` 与 task `completed/drained` 验证，独立冷读确认原执行及镜像七源一致。此结果来自独立默认 `--check` 后的 direct Host 夹具，不覆盖默认 `run` 全链；无真实 GitHub 或厂商调用，不宣称全部 `full` 通过，证据统一见[第45轮](../acceptance/resident-conversation-routing/round-45.md)。

Docker daemon 管理者可读取容器 env。Linux 私有单次 launch 文件会短暂承载 env，消费后删除，因此不能承诺 token 绝对不落盘。目标程序若主动打印 token，stdout/stderr 可进入工具结果、Pi 历史及 spill，没有通用自动脱敏保证；不要 echo token、打印完整环境或用 `gh auth token` 将真值输出到日志/验收材料。

## 可选钉钉与多渠道

需要钉钉时，在同一 env 文件中加入已知的明确 profile 和单一目标，字段由可选插件解释；未配置 `DINGTALK_*` 时入口不加载其 CLI，不改既有渠道：

```dotenv
DINGTALK_CHANNEL_ID=team-room
DINGTALK_ENABLED=true
DINGTALK_PROFILE=YOUR_CORP_ID:YOUR_USER_ID
DINGTALK_ACCOUNT_MODE=system
DINGTALK_CONVERSATION_TYPE=chat-room
DINGTALK_GROUP_NAME=YOUR_EXACT_GROUP_NAME
DINGTALK_NAME=YOUR_CHANNEL_NAME
DINGTALK_PROMPT=YOUR_CHANNEL_RESPONSIBILITY
DINGTALK_LISTEN=true
DINGTALK_WRITES_AUTHORIZED=false
```

示例 `DINGTALK_WRITES_AUTHORIZED=false` 保持不外发；需要 Bot 回复时，由有权操作者在启动参数中明确设为 `true`，登录本身不授予外发权限。

群 ID 可用 `DINGTALK_GROUP_ID`；私聊改为 `DINGTALK_CONVERSATION_TYPE=chat`，仅用 `DINGTALK_USER_ID` 或 `DINGTALK_USER_NAME` 选择该会话。不要混入群和私聊目标。profile 与后续登录必须同一账号/组织，禁止选第一组织、最近组织或用名称变化迁移目标。

多渠道只设 `DINGTALK_CHANNELS_JSON`，不与其他 `DINGTALK_*` 混用。值为完整实例数组，每项 `{type:"dingtalk-dws",channelId,enabled,config:{dingtalk_*}}`，独立稳定 channelId 绑定一个群或私聊；每项显式 `config.dingtalk_account_mode:"system"`。入口不重新解析 vendor JSON、拼 ID 或合并同类型渠道。

入口在 Host 启动前执行真实专用命令 `node bin/night-bot-dingtalk.js CONFIG env --check`，再同命令去掉 `--check` 保存，只有配置导入，没有 DWS 调用。真实认证、目标解析和持久绑定归运行期插件，零命中、多候选、身份/目标变化或权限错误明确阻断，不当作普通等待登录。渠道停启补拉保留原游标、来源版本、去重及 unknown-send 合同，不重置起点。

`system` 模式在本容器内使用专属受控目录，与宿主个人账号无关：

- `HOME=/opt/night-bot/data/secrets/dws-system`
- `DWS_CONFIG_DIR=/opt/night-bot/data/secrets/dws-system/config`
- `DWS_KEYCHAIN_DIR=/opt/night-bot/data/secrets/dws-system/keychain`

因此容器普通 `dws auth login` 与插件读取相同登录存储。Linux 插件本身默认 `private`，本规程明确选 `system`；不要省略该设置再误以为公共登录能被每渠道私有目录读取。自选 `private` 需各渠道私有目录独立登录，不复制/导出已有账号。多个 channel/profile 可以共享容器自己的 system 存储，但各渠道绑定仍独立核对，不能串用组织或 actor。

官方 Linux keychain 使用文件 DEK 和 AES-256-GCM，密钥与密文都在私有卷，不宣称独立 OS 密钥环保护。整个卷与 Docker 管理权都要保护。

## 可选 Web 宿主访问

不配置 Web 环境参数时保留既有配置，不默认开启。需要本机浏览器访问时，在同一 env 文件加入：

```dotenv
NIGHT_BOT_WEB_ENABLED=true
NIGHT_BOT_WEB_HOST=0.0.0.0
NIGHT_BOT_WEB_PORT=3080
NIGHT_BOT_WEB_PUBLIC_ORIGIN=http://127.0.0.1:3080
NIGHT_BOT_WEB_CHANNEL_ID=local-web
NIGHT_BOT_WEB_SENDER_ID=local-operator
NIGHT_BOT_WEB_OPERATOR_NAME=Local operator
```

入口只将这些参数交给既有 `night-bot-config CONFIG web --enabled ... --host ... --public-origin ...`，先检查再保存。默认 bind 仍是 loopback；`0.0.0.0` 只用于显式容器发布，必须同时给出准确的 loopback `publicOrigin`，不放宽 token/cookie、CSRF、Host/Origin 校验。HTTP 核心 resident 端口继续 loopback，不发布其控制 API。

Docker 必须仅发布宿主 loopback，例如 `--publish 127.0.0.1:3080:3080`。若宿主用 13080、容器仍 3080，则改为 `--publish 127.0.0.1:13080:3080` 和 `NIGHT_BOT_WEB_PUBLIC_ORIGIN=http://127.0.0.1:13080`；浏览器只打开该准确地址。不用 `localhost`、公网 bind、host networking 或未验代理。只给 Docker `-p`、内部服务仍监听 `127.0.0.1` 的组合不能工作。

Web 的 token 文件由插件生成，服务日志只应显示文件路径；按 [Web 规程](web-console-local.md)私下读取并输入登录页，不把 token 写到 URL、env、截图、报告或聊天。Web 资源存在和 TCP 可达不等于登录、真实 Host 数据、工具事件或记忆/Skill 展示通过，均需真实页面验收。

## 启动同一容器后交互登录

前置自检通过、env 文件准备完毕后，直接启动应用。下面示例假定操作者已在宿主会话安全设置 `GITHUB_TOKEN`，只按键名注入；不需要 GitHub 时去掉 `-e GITHUB_TOKEN`。示例包含可选 Web 的 loopback 发布；未启用 Web 时省略 `--publish`。

```powershell
$envFile = (Resolve-Path 'data/secrets/docker.env').Path
docker run --detach --name night-bot @common --env-file $envFile -e GITHUB_TOKEN --publish 127.0.0.1:3080:3080 night-bot:sg12
docker logs night-bot
docker exec -it night-bot dws auth login --device
```

正常 `run` 直接 exec 既有 launcher，tini 处理容器进程回收；没有 setup/sleep、手工 JSON、登录后重建容器或切换 run 模式。未登录只令钉钉插件进入可观察的 `waiting-auth`，通用 Bot/Web 仍运行；在**同一容器**交互完成 `--device` 登录后，插件观察认证就绪并自动解析、绑定、接入。既有登录态则直接走认证/绑定核查，无需重复登录。第20轮本地 fake CLI 已沿默认入口验证同容器认证等待、忽略 lastUsed、lastLogin 变化后精确绑定 ready；该轮监听关闭且 connected=false，真实交互登录、订阅与厂商业务仍单独验收，不以 fake 绑定通过替代。

第23轮在同一封定镜像 `82b96bd4` 中补齐本地fake集成：真实fake CLI监听达到listening/connected，完整历史补拉及NDJSON live均进入正式Pi分诊并持久committed，重复/外会话不增源，无任务或外发通知。停机后容器自然0/PID0、监听单次SIGTERM、安装锁缺席；停态DB/WAL按原卷只读、独占副本query_only复核，没有以immutable忽略WAL。首批收尾驱动的只读SQLite失败与补读自然0分开保留，不重跑业务。证据绑定该镜像及原源封包，不追认真实交互登录、厂商或新Windows实现；见[第23轮验收](../acceptance/resident-conversation-routing/round-23.md)。

`--device` 为官方 headless 登录方式；由操作者在交互终端授权，不收集登录码、token 或原始认证响应。权限、目标歧义、既有绑定不符及其他异常不能吞成无限等待。已落盘的 Web 认证 `GET /api/channels` 为每项提供 `channelId/type/enabled/connectionState/errorCode`，以及可选 `connected`；`connectionState` 来自插件状态白名单，未识别值为 `unknown`。等待登录为 `connectionState:"waiting-auth"`、`errorCode:"CHANNEL_AUTH_REQUIRED"`；适配器错误为 `connectionState:"error"`、`errorCode:"CHANNEL_ADAPTER_ERROR"`。不公开内部原始 `lastError` 或供应商响应；该 HTTP 投影的运行验证仍以 Tests 实测为准。

未启用 Web 时，服务日志提供 `DINGTALK_CHANNEL_WAITING_AUTH {channelId}` 和 `DINGTALK_CHANNEL_BOUND {channelId,conversationType}`，不含账号、目标或秘密。BOUND 只证明绑定已完成，不代表监听、补拉或业务送达；listener ready、健康状态和 send accepted 同样不代替实际接纳、结果与效果收据。

```powershell
docker exec night-bot node bin/night-bot-config.js /opt/night-bot/data/config/config.json show
docker exec night-bot node bin/night-bot-dingtalk.js /opt/night-bot/data/config/config.json list
docker exec night-bot tail -n 80 /opt/night-bot/data/logs/service.log
```

这些是有界只读诊断，不打印密钥；读取日志仍需保护业务隐私。env 文件仅在 Docker 创建容器时读入，编辑宿主文件不会改变现有容器环境。后续更改环境配置需正常排空停机后重建本实例容器、保留同一卷；**首次 DWS 登录不需要此步骤**。CLI 参数不混入 env，离线配置操作遇运行 Host 锁不得绕过；可用的在线配置路径以专用 CLI 实际合同为准。

## 持久化、停机、升级与隐私

唯一持久卷 `/opt/night-bot/data` 保存配置、私有 skills、账号、SQLite/Pi journal、memory、workspaces 和附件；cache/logs/runtime/temp 分桶存在，但不是普通备份保留项。业务工作和保留产物默认在 `data/workspaces/`；范围外业务目标依所选权限档位及精确批准处理，不改变应用状态、账号与任务档案的 Host 归属。系统目录和临时 OS 机制不是额外业务工作区。

`.dockerignore` 为源码白名单；Dockerfile 不 `COPY . .`。私有 Skill 正文、脚本、参考和素材按既有装载合同放安装 data，不进入镜像/Git。不要复制宿主账号、整个旧安装、worktree 或 node_modules；升级镜像不覆盖卷内技能。

正常停机等待应用排空。Router 先中断当前官方 Pi 推理，再等待全部在途 work、真实资源排空和提交后释放 owner；待投递输入及 unknown 保留，推理中断不表示任务自动完成。不要让 Docker 超时强杀代替 drain：

```powershell
docker stop -t -1 night-bot
docker inspect --format '{{.State.Status}} {{.State.ExitCode}}' night-bot
```

退出码须结合 owner/进程真实 drain 核对；关闭异常保留日志、WAL、journal、unknown 和恢复阻断，不删除仍被运行工作使用的文件。第16/17轮镜像 `be1ffc45` 已验证 harness 内正式 CLI 的活动请求取消、精确确认批和同卷冷启无任务工具重放；第20轮镜像 `82b96bd4` 另沿未经覆盖的默认 CMD/tini/PID1 执行实际 `docker stop -t -1`，活动 Pi HTTP 请求断连，launcher/容器自然退出0、PID归零、OOM=false、安装锁缺席，非 root/cap-drop ALL/no-new-privileges/只读根/network none及固定 seccomp 保持。首批当前 Docker CLI 拒绝 `--timeout`，上例采用已实测的 `-t -1`；首批失败保留，不作应用停机失败或强杀成功解释。证据各绑原491源封包，不追认后续源码、生产或 Windows Native。第20轮已含 Host `2f7b8047` / Application `72e47641` / NativeJobs `deee4fd4`；第19轮的异常关闭分版专项仍单列，正常停机不替代故障时继续 join、聚合原错及保 root/锁规则，unknown Job 不能靠 remove 或重启清除。见[渠道异常关闭合同](../CHANNELS.md#异常关闭)及[当前验收检查点](../acceptance/resident-conversation-routing/goal.md#当前检查点)。离线一致性、默认排除 secrets/logs/cache/runtime/temp、受控路径及恢复持有效果遵守 [数据布局](../DATA-LAYOUT.md) 和 [任务档案](../TASK-ARCHIVE.md)。Docker 镜像、`docker export`、只复制 SQLite 都不是 data 备份；镜像不包含命名卷。

普通备份不含 DWS 登录态/密钥，恢复后重新登录。显式私有完整卷快照包含源消息、文件、Pi 历史、DWS DEK 与密文，是高敏感离线材料，不能当脱敏包或上传 Git/镜像。备份/恢复必须排空停机且没有其他容器写同一卷，不自动外发、不重放历史命令；回退要匹配原代码、锁文件及整份一致数据，不只换镜像 tag。

恢复卷可能不含被排除的 `temp`，非空卷不会从新镜像补复制该目录。恢复后先在同一专属卷离线重建这一临时目录，再运行 `--check`；不要让只读自检隐式修改卷。沿用上文 `$common` 的非 root、只读根和安全参数，执行：

```powershell
docker run --rm --network none @common --entrypoint node night-bot:sg12 --input-type=module -e 'import {privateDirectory} from "./src/runtime/files.js"; await privateDirectory("/opt/night-bot/data/temp")'
docker run --rm --network none @common night-bot:sg12 --check
```

此初始化仅创建/收紧本卷 `data/temp`，不启动 Host、不连接模型或渠道、不恢复任何业务效果；目录若是符号链接或权限不足则报错，不切换到卷外目录。现有卷的所有权要求与新卷一致。该恢复场景与新卷 copy-up 必须分别验证。

## 验收执行者需观察的终态

1. build 成功，Node/pnpm 版本与构建固定的 DWS 发行资产、摘要匹配来源；镜像不含私有 data/技能/密钥或宿主 node_modules，Web dist 存在但默认未启用。默认 `--check` 不执行 DWS CLI。
2. 核宿主传入的正式 `docker-bwrap-seccomp.json` 摘要与容器实际加载过滤对象，原官方 31 条 + 13 条精确差量、UID/GID 1000、cap-drop ALL、no-new-privileges 和只读根保持；新卷 copy-up 的 data/temp 0700、恢复卷缺 temp 的失败关闭及离线补建后自检分别实测。对照入口 `--check` 前后卷内容：fresh 专属卷应仍只有原有空 `temp`，已有卷/恢复卷不得新增或改写原内容，包括 Node 编译缓存和 DWS runtime-context；仅退出 0/PREFLIGHT_OK 不能证明零写。复用已过 raw 机制证据，不重跑同一原语；当前应用失败仍记录具体 errno/syscall，不继承 daemon unconfined 或提权。
3. 在受限 `ask`/`auto` 下，真正 Host/Pi 默认任务在受控 work/tmp 写出结果，并验证 secrets/raw memory/其他任务 session 和材料的隐私隔离；范围外业务写进入审批，获批调用实际获得仅该范围的访问。显式 `full` 独立验证容器内 OS 账号访问，不作上述应用隔离承诺，也不抵替受限验收。各档 shell/管道/后台作业完成、取消和 drain 均核实际终态。
4. 本地隔离模型与 fake DWS 验默认 env、多渠道及 waiting-auth→同容器登录态出现→自动接入；断言通用 Bot/Web 未被未登录钉钉阻塞，其他错误不误归认证等待。
5. 浏览器从宿主 127.0.0.1 发布端口登录真实 Web，实际 Host 数据可读，错误 Origin/CSRF/未授权读取被拒绝；不以静态页和端口开放代替验收。
6. 停机再起同一卷，实例、直接来源/版本/actor、渠道绑定、Pi 历史和投递账本保留，无重复发送/重放/身份混淆。真实模型、真实认证/厂商交付另报，不从 fake 外推。

## 官方来源

- [Playwright 1.65.0 浏览器安装](https://github.com/microsoft/playwright/blob/v1.65.0/docs/src/browsers.md)与[Chromium 启动实现](https://github.com/microsoft/playwright/blob/v1.65.0/packages/playwright-core/src/server/chromium/chromium.ts)：镜像浏览器路径及默认 `chromiumSandbox:false` 行为。
- [GitHub CLI 环境认证](https://cli.github.com/manual/gh_help_environment)：`GH_TOKEN` 优先于 `GITHUB_TOKEN`；本文运行时示例仅注入后者，不要求落盘登录。

- [DWS v1.0.67 发行](https://github.com/DingTalk-Real-AI/dingtalk-workspace-cli/releases/tag/v1.0.67)、[固定版安装脚本](https://github.com/DingTalk-Real-AI/dingtalk-workspace-cli/blob/v1.0.67/scripts/install.sh)和[登录说明](https://github.com/DingTalk-Real-AI/dingtalk-workspace-cli#readme)：固定资产、glibc 和 headless 登录。
- [Linux keychain](https://github.com/DingTalk-Real-AI/dingtalk-workspace-cli/blob/v1.0.67/internal/keychain/keychain_linux.go)和[DEK](https://github.com/DingTalk-Real-AI/dingtalk-workspace-cli/blob/v1.0.67/internal/keychain/file_dek.go)：持久化与加密边界。
- [Docker seccomp](https://docs.docker.com/engine/security/seccomp/)、[Moby v26.0.0 官方基线](https://github.com/moby/moby/blob/8b79278316b532d396048bc8c2fa015a85d53a53/profiles/seccomp/default.json)、[原生成源码](https://github.com/moby/moby/blob/8b79278316b532d396048bc8c2fa015a85d53a53/profiles/seccomp/default_linux.go)、[LICENSE](https://github.com/moby/moby/blob/8b79278316b532d396048bc8c2fa015a85d53a53/LICENSE) 和 [NOTICE](https://github.com/moby/moby/blob/8b79278316b532d396048bc8c2fa015a85d53a53/NOTICE)：固定官方基线、原许可及声明。
- [bubblewrap v0.8.0 固定源码](https://github.com/containers/bubblewrap/tree/4ab175fe6d3a4053444b04d805a6d686f53455b9)和[Debian 0.8.0-2+deb12u1](https://sources.debian.org/src/bubblewrap/0.8.0-2%2Bdeb12u1/)：本 argv 必经调用及数值/NULL 形状的来源；本页不分发或执行其下载源码。
- [CLI v26.0.0 参数处理](https://github.com/docker/cli/blob/v26.0.0/cli/command/container/opts.go)和[Engine 内建常量](https://github.com/moby/moby/blob/v26.0.0/daemon/config/config.go)：`builtin` 为内建默认策略名，`default` 会被当作文件路径；本规程实际启动使用显式本地固定策略，不修改 daemon。
- [Node 镜像元数据](https://hub.docker.com/v2/repositories/library/node/tags/24.13.0-bookworm-slim)：基础镜像 tag 与固定 manifest digest。
- [Node 24.13.0 TLS 公共根](https://nodejs.org/download/release/v24.13.0/docs/api/tls.html#tlsrootcertificates)和 [Debian bookworm APT HTTPS](https://manpages.debian.org/bookworm/apt/apt-transport-https.1.en.html)：固定内置 PEM 根、CAInfo 与 TLS 默认校验。

- [Node 24.13.0 编译缓存](https://nodejs.org/download/release/v24.13.0/docs/api/module.html#moduleenablecompilecacheoptions)：`NODE_DISABLE_COMPILE_CACHE=1` 禁用调用该 API 的 Node/pnpm 编译缓存；仅用于入口自检分支，不改变正常运行的缓存设置。
