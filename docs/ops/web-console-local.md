# 可选 Web 控制台本机运行

本页只说明安装、运行与排障；UI/UE 的唯一指导文档为仓库根目录的 [DESIGN.md](../../DESIGN.md)。

## 边界

Web 包位于 `packages/web-console`，使用 Node.js 24+，独立 pnpm 清单和锁文件。不需要安装 React/Vite 即可运行默认核心；Web 前端及插件均需显式配置启用。通用配置 CLI 复用该包 `server/security.js` 的纯网络参数校验，不启动 Web 服务，也不依赖前端运行库。聊天沿既有渠道接入，任务与渠道消息视图只读；认证安装操作者可通过 Host 受控 API 新增与编辑钉钉渠道配置、选择权限模式与处理单次审批，不由浏览器直接改任务账本或任意配置。

启用后的插件是可信 Host 代码，和 Bot 同进程生命周期，不宣称独立进程故障隔离。前端静态文件缺失时 `/api` 仍可用，页面返回明确 503；关闭浏览器不停止 Bot。禁用插件会关闭 Web 入站和该渠道投递，其他 Bot 功能继续运行。

默认服务监听 `127.0.0.1`，端口 3080，校验本机来源和同源请求。容器中仅在可信配置显式提供 `host: "0.0.0.0"` 及固定 `publicOrigin: "http://127.0.0.1:宿主端口"` 时允许容器内监听；宿主端口仍须只发布到 loopback，Host/Origin、令牌及 CSRF 校验保留，详见 [Docker 规程](docker-deployment.md)。缺少或不合法的 `publicOrigin` 会拒绝启动，不支持直接把默认实例改成任意地址。该扩展尚未完成容器实跑验收，也不包含公网、多用户账户、反向代理/TLS或厂商渠道上线验收。

## 安装和构建

在安装根执行（PowerShell 7）：

```powershell
pnpm install --frozen-lockfile
pnpm --dir packages/web-console install --frozen-lockfile
pnpm --dir packages/web-console build
```

首次安装独立 Web 依赖是必要步骤；不要整体链接另一个 worktree 的 node_modules。构建产物在该包 `dist/`，不入 Git。Bot 不启动前端开发服务器。

## 显式启用

已有安装优先使用通用配置 CLI。先只读查看，再执行零副作用检查，核对无误后保存同一组参数：

```powershell
node bin/night-bot-config.js data/config/config.json show
node bin/night-bot-config.js data/config/config.json web --enabled true --host 127.0.0.1 --port 3080 --channel-id local-web --sender-id YOUR_LOCAL_ACTOR --operator-name "本机操作者" --check
node bin/night-bot-config.js data/config/config.json web --enabled true --host 127.0.0.1 --port 3080 --channel-id local-web --sender-id YOUR_LOCAL_ACTOR --operator-name "本机操作者"
```

`YOUR_LOCAL_ACTOR` 使用本安装的操作者标识；已存在的 Web 实例沿用原 `channel-id` 与 `sender-id`，不创建另一份实例替换历史身份。CLI 拒绝原实例变更发送者，换身份须使用新渠道 ID。直接安装保持 `--host 127.0.0.1`，不因配置命令绕过同源、令牌或 CSRF 校验。容器的受控发布边界见上方 Docker 规程。

容器配置 CLI 已支持 `--public-origin`。在对应容器的安装根执行以下检查，再以同一参数去掉 `--check` 保存；示例容器端口为 3080，宿主 loopback 端口为 13080，实际端口映射仍按 Docker 规程设置：

```powershell
node bin/night-bot-config.js data/config/config.json web --enabled true --channel-id local-web --sender-id YOUR_LOCAL_ACTOR --host 0.0.0.0 --port 3080 --public-origin http://127.0.0.1:13080 --check
```

固定 `publicOrigin` 必须与浏览器实际使用的宿主 loopback 地址一致，不能用任意外部域名、凭据或 URL 路径。CLI 与 Web 插件共用网络参数校验；仅保存这些值不会发布 Docker 端口、验证容器内核或绕过应用沙箱。

保存仅更新安装目录受控 `data/config/` 下的配置文件，不热改运行态；结果中的 `changed` 表示配置差异，`checkOnly:true` 表示本次没有写入，`restartRequired` 表示应用该差异需要正常重启。`--check` 不创建配置锁或临时文件。不要把令牌、模型密钥或带凭据的 URL 作为参数。

也可在现有私有配置中**追加**下列插件目录及实例，保留已有配置，不覆盖它们；与上方 CLI 使用同一实例标识：

```json
{
  "channelPluginDirs": ["packages"],
  "channelPlugins": [
    {
      "type": "web-console",
      "channelId": "local-web",
      "enabled": true,
      "config": {
        "senderId": "operator",
        "operatorName": "本机操作者",
        "port": 3080
      }
    }
  ]
}
```

目录相对 `installRoot`，其中每个子目录通过 `night-channel.json` 发现。`senderId` 是该实例的稳定身份，由服务端配置；更改它会改变来源身份，不用于临时切用户。Web 令牌持有者能查看本安装的任务和渠道信息，只给该安装的操作者使用。

按既有 [Windows 运行手册](windows-local-runtime.md) 启动 Bot；本插件会记录页面 URL 和访问令牌**文件路径**，不会记录令牌内容。地址必须使用日志中的 `http://127.0.0.1:3080`（或配置端口），不能换成 `localhost`，否则严格 Host 校验会拒绝。

令牌位于 `data/secrets/web-console-<channelId哈希>/access-token`，仅在本机读取后输入登录页。不要把令牌写入源码、环境变量、URL、截图、PR 或聊天。会话 cookie 为 HttpOnly/SameSite Strict，12 小时过期；所有写 API 校验 CSRF。重启会使浏览器会话失效，但令牌及业务回执保留。

消息首答按 Host 接收时间到本条消息及版本的最早可靠送达回执计时，包含任务结果，不依赖 `replyPurpose`。升级后历史回执直接按新口径只读计算，无需改账本、补标用途或重新发送；附件可通过精确来源版本绑定和回复前已提交的任务快照，读取共同任务回复及历史归档；不把当前任务新补入的来源套到旧回复。只有明确无需处理且无需回复时显示无需回复，缺回执按真实处置显示等待处理、等待回复或历史不足，已有发送则沿真实投递状态显示。后续正常部署时需同时更新服务端源码并重新构建 Web，按既有规程正常重启；仅刷新浏览器不会更新旧服务端计算。

独立接纳和回复账本在 `data/state/web-console-<channelId哈希>/delivery.sqlite`。它只记录 Web 渠道事务，不替代任务 SQLite 或 Pi 会话。升级保留整个 data；备份和恢复遵守已有离线一致性及默认排除 secrets 的规则。

## Web 钉钉渠道新增与编辑

认证安装操作者可在「渠道」页新增群聊或私聊配置，并通过卡片编辑已保存配置。新增时填写唯一渠道标识、会话类型、按 ID/名称的单目标、外发授权及可选显示名称/职责；无需填写 profile。Host 只经可选插件解析 Bot 运行环境当前登录账号：全列表必须恰有一个 `isCurrent:true`，该账号所属组织恰有一个 `isOrgCurrent:true` 且为同一账号；其他组织各自的当前账号不构成歧义。未登录、无全局当前标记或上述标记歧义/不一致时拒绝保存，不回退到首项、最近项、浏览器、环境变量或默认账号。名称解析和账号绑定在正常重启后的既有可选插件流程完成，不在 Web 中登录厂商账号。账户模式固定为 `system`，不接受秘密、环境变量、任意 `binding` 或 `executable`。

接入依赖中的 `contact +search-user` 当前按 DWS v1.0.63（`4cd5d053`）的 composite 响应解析：外层须为 `ok:true`、`outcome:"success"`，`data` 内含 `count` 与 `users`，计数须与用户数组一致；失败、部分或不完整结果拒绝。此结构仅用于该查询；`profile list`、`contact user get-self` 等原子命令保持各自原始响应合同，不全局解包 `data`，不回退接受缺少外层成功状态的裸 `users` 响应。`chat conversation-info` 使用 MCP 原子响应，要求 `success:true`，从 `result.conversationInfo` 读取身份，继续严格校验会话 ID、群聊/私聊种类与绑定漂移；不把裸 `result` 或 contact 的 `data` 当作该身份结构，失败或不完整结果拒绝。响应适配不代表当前渠道已接入，仍须在正常重启后核实账号、目标绑定与监听终态。

`POST /api/channels/dingtalk` 只接收 `{channelId, conversationType, targetKind, target, name?, prompt?, writesAuthorized?}`，会话类型为 `chat-room` / `chat`，目标方式为 `id` / `name`。它沿现有同源 cookie、Host/Origin 和 CSRF 校验，由持有本安装锁的 Host 在配置锁内原子保存，只新增、不覆盖，不从 live Web 派生离线 CLI 或绕过锁。非受控安装或保存端口不可用时返回 503 `CHANNEL_CONFIGURATION_UNAVAILABLE`，不会静默改写其它配置。

编辑使用认证 `GET /api/channels/dingtalk/:encodedId`，只回 `{channelId,version,name,prompt,conversationType,targetKind,target,writesAuthorized}`；名称与职责缺省为空串。`PATCH` 同路径，完整正文仅 `{expectedVersion,name,prompt,conversationType,targetKind,target,writesAuthorized?}`，ID 只取路径；`expectedVersion` 为 GET 的 64 位小写 SHA256，Host 在原配置锁内对保存整 row 做 CAS，不能覆盖新版本。账号继承已保存 canonical，不选择 OS 当前账号；浏览器不读写 profile、binding、env 或秘密。target/name trim，空 name 清除显示名；prompt 保留原字符串和换行，不 trim；专用详情保持原 ID/名称目标表达，不因内部绑定解析自动改成另一种填写方式。

PATCH 成功回 `{ok:true,changed,restartRequired,liveApplied,channel,detail}`；detail 与 GET 同型，`channel.savedVersion === detail.version`。允许 `changed:false`，仍以实际保存、加载与激活状态报告，不机械要求发生变化或待重启。版本过期为 409 `DINGTALK_CHANNEL_VERSION_CONFLICT`，保留原草稿，只在明确点击重新加载后换入新版本；目标仍有未决依赖为 409 `DINGTALK_CHANNEL_SWITCH_BLOCKED`，保留草稿并先处理旧依赖。未找到为 404 `DINGTALK_CHANNEL_NOT_FOUND`，输入拒绝为 400 `DINGTALK_CHANNEL_REQUEST_INVALID` / `DINGTALK_CONFIG_INVALID`。沿原同源、认证、CSRF 与配置关闭排空，不新增编辑绕锁端口。

名称/职责及同一实际目标编辑保留 binding、ingress 游标、deferred 和外发配置；真实身份切换按插件私有存储隔离新旧身份，新目标外发关闭，旧任务、会话、Pi、SQLite 与冻结投递不迁移或重定向。保存时与旧 Host 排空后的冷启激活点都检查旧未决依赖，不以健康、暂停或 idle 代替，不清 unknown、不重放旧动作。职责可能参与后续任务推理，不承诺只影响新任务。

列表 `savedVersion` / `runningVersion` 分别报告保存与当前加载版本；不同则待重启，相同只证明已加载，钉钉 `liveApplied` 还要求真实绑定激活完成。`runningConnectionState`、`runningErrorCode`、可选 `runningConnected` 及加载后的 `runningName` / `runningConversationType` 独立报告当前插件状态，不用保存配置的待重启状态盖掉旧插件健康。冷启被未决依赖阻止时为 `connectionState:error` / `errorCode:DINGTALK_CHANNEL_SWITCH_BLOCKED` / `liveApplied:false`；不能将重复重启当作解除依赖，保存版本一致也不能声称新目标已接入。

新增固定 `enabled:true`、`listen:true`，`writesAuthorized` 缺省为 false；显式布尔值映射到 `dingtalk_writes_authorized`，拒绝字符串、数字或 null。编辑遗漏该字段保留原值，明确 true/false 则授权或撤销；目标表达或会话类型变更与开启授权不能同次提交，请先保存目标，再重新编辑授权。授权包括正常回复、通知和附件及已排队未发送通知，保存后正常重启才应用；关闭不撤回既有发送。成功回执含 `restartRequired:true`、`liveApplied:false`。GET 渠道安全行能读回已保存未加载的渠道，显示 `pending-restart` / `connected:false`，不返回 profile、目标、绑定或凭据。钉钉行的 `writesAuthorized` 仅报告已保存配置的外发授权，不能视为当前可发送；已有渠道可能已获外发授权，不因新渠道默认关闭而改写它们。按现有运行手册正常排空并重启才应用新增配置，不把保存、真实接入、发送验收混为一体。

重复 ID 返回 409 `DINGTALK_CHANNEL_EXISTS`，输入错误返回 400，均保留草稿且不覆盖已有配置。账号校验在配置写入前完成：未登录、无当前账号或当前账号歧义分别返回 409 `DINGTALK_AUTH_REQUIRED` / `DINGTALK_CURRENT_PROFILE_NOT_FOUND` / `DINGTALK_CURRENT_PROFILE_AMBIGUOUS`，不触发 Web 登录失效；命令不可用或查询失败返回相应 503，响应异常返回相应 502，均明确拒绝并保留草稿。500、断线或不完整成功响应按写结果未知处理，页面只读按原渠道标识核对；GET 同 ID 存在不能证明本次账号/目标已写入，缺席也不解锁重发。不要自动重发 POST、自动换 ID 或通过删除锁处理未知结果。认证换代清除表单并使旧异步回执失效；聊天草稿容器不因此重建。新增与编辑可保存外发授权配置，不实现热加载、删除/启停或真实厂商代发按钮。编辑 500、断网或不完整成功回执同样按未知锁定，只读 GET 比较准确字段与版本；仅新版本与提交字段逐项一致可确认当前保存配置一致，版本未变或字段不符继续只读，不判定原提交未发生，不重发 PATCH。

## 安装权限与单次审批

配置仅使用顶层 `permissionMode`，取值 `ask` / `auto` / `full`，缺省为 `full`；示例配置显式写 `"permissionMode": "full"`。初始化可传 `--permission-mode ask|auto|full`，通用配置 CLI 使用同名参数。它不是旧组件预设名，也不读取 Host 环境变量来代替模式或单次授权。

在安装根先检查，再保存同一组参数：

```powershell
node bin/night-bot-config.js data/config/config.json permissions --permission-mode ask --check
node bin/night-bot-config.js data/config/config.json permissions --permission-mode ask
```

CLI 保存后按原运行手册正常重启才应用配置，不在运行期间手工改文件冒充热切换。`full` 必须显式选择，不作为沙箱不可用时的回退；它按当前系统账号真实访问，不提权，进程不再隔离，同账号可访问的凭据与 Host 私有文件不能宣称受进程隔离保护。`ask` / `auto` 保留私有区、任务元数据等独立边界；批准命令只授予准确动作的受控范围，不把外部目标批准解释为撤销全部隔离。Windows 受限命令仍取决于真实后端，不因配置存在而成为已验收能力。

Web「权限与审批」使用 `GET /api/permissions` 读取当前 Host `mode`、`options`、`protection` 和 `requests`。`protection` 是 Host 实际报告的 `status/backend/description`：`not-attested` 不能推为已隔离，`unavailable` 明确不可用，`full` 的 `unconfined/direct` 明确进程不隔离；页面不启动探针或由模式猜测后端。可选档位和保护说明不替代各平台真实执行验收。

`PUT /api/permissions` 的正文为 `{mode}`，持久保存成功后切换当前 Host；`POST /api/permissions/requests/:id` 的正文包含 `decision`（`allow` / `reject` / `revoke`）。两者仅允许已认证安装操作者，沿同源 cookie、Host/Origin 与 CSRF 校验，返回与 GET 相同的完整视图；普通任务或群消息不能调用这些入口改变权限。Web 保存不要求另一次 CLI 重启，不能将 CLI 的 `restartRequired` 混作 Web 响应。 权限面板绑定当前认证会话；CSRF 只读同步到新会话时重建该面板，清除旧审批详情、未提交选择与反馈，使旧在途响应失效，不改变原聊天草稿容器。

审批只展示 Host 生成的 `display.summary/target/cwd/command/parametersDigest` 及声明的身份、状态和时间字段；审批必要的业务目标、cwd 与命令使用专用路径保留投影，以便操作者核对准确业务路径，同时仍隐藏 token、JSON 敏感字段、raw args/env 和未知字段。普通会话的路径默认隐藏规则不变，前端不解析原始命令。请求绑定 actor、task/conversation、call、参数摘要、cwd 和范围；模式变更、撤销或过期不允许借旧请求执行。每项 `revocable` 由 Host 计算，仅同一 live exec、同一权限 epoch、未取消且尚未消费效果的授权可撤销；前端只有收到 `true` 才提供撤销操作。`revoke` 先同步撤销私有 grant，再持久记为 `cancelled`，不回滚已发生效果；模式保存也取消旧未消费授权。已消费、调用结束、过期或冷恢复旧项不可撤销，409 后不重试原决定；其它失败先 GET 核当前状态，页面不会自动重发 PUT/POST。

`auto` 使用当前配置的通用模型，经 Pi 作一次无工具审查，只处理 Host 判定需要批准的动作；无法确定或模型失败转人工，不复用或安装 DSH reviewer。已保存模式可冷恢复；原 pending 请求恢复为 cancelled，不重建等待、不重放动作。页面显示批准结果不证明工具完成，后端隔离、外部路径真实效果和恢复防重仍须按[唯一验收目标](../acceptance/resident-conversation-routing/goal.md)的对应版本核验，旧 Chat/learning 结果不追认为新权限通过。

## 升级、停用与诊断

- 正式升级基于已合并代码，并按既有运行手册停机/备份/升级；构建后带上该版本 `dist/`。此任务不执行正式部署。
- 停用：先运行 `node bin/night-bot-config.js data/config/config.json web --enabled false --channel-id local-web --check`，再以相同参数去掉 `--check` 保存；沿用实际渠道 ID，按运行手册正常重启。也可手工将该实例 `enabled` 改为 false。不要删除 data；待核实回执不自动重放。仅停止浏览器不需要重启 Bot。
- 停机排障：等待 Host 关闭终态；Web/HTTP 已停或框架清理已返回均不证明 Job/进程已排空。前置关闭失败仍会尝试后续清理并聚合原始错误，保留根依赖与安装锁；任务关闭失败时保留 resident runtime/store。无 journal 的临时 Job 同样需要确认运行中的 producer 已排空；取消抛错、排空未知或结局日志出错时，不能通过删除记录清除阻断。不要手删安装锁、重放原动作或强制退出制造关闭成功。
- 端口占用：选空闲的 `config.port`，不要终止无关进程。已有 token 文件/存储目录被链接、权限不符或结构异常时会失败关闭；不要通过放宽权限绕过。
- 渠道状态：`connectionState` 只显示 Host 白名单阶段，缺省为 `unknown`；`connected` 只来自适配器真实健康布尔值，不由 `enabled` 推导。等待认证仅返回 `CHANNEL_AUTH_REQUIRED`，适配器错误仅返回 `CHANNEL_ADAPTER_ERROR`；不把原始 `lastError`、路径、登录数据或配置透传页面。状态展示不替代真实连接、发送和回读验收。
- Web 登录和 `/health` 正常不证明模型可用。消息已接纳但迟迟未回复时，先用 `node bin/night-bot-config.js data/config/config.json show` 核对所选 provider/model，再用 `node bin/night-bot-auth.js data/config/config.json describe-ref YOUR_PROVIDER_CREDENTIAL_REF` 核对该 provider 实际引用的凭据来源/存在状态（替换为配置中的引用名；OAuth 可用同一 CLI 的 `list` 查看凭据描述）；凭据存在也不保证未过期或网关接受。缺凭据、401 或 `session_expired` 应按既有认证流程处理，不把 key 贴进浏览器或日志，不重发已接纳请求。元数据读取不构成模型连通实跑。
- 503 `WEB_ASSETS_NOT_BUILT`：在相同代码版本的独立包安装并构建。不要把这个错误解释为 Bot 未启动。
- 401：登录失效或 token 不符。403：检查是否用了日志中的 127.0.0.1 地址与同源页面。未知接纳/发送：查同 requestId 的回执，不新建请求重放。

同浏览器多标签重新登录导致 `CSRF_INVALID` 时，页面只读查询当前会话并同步 CSRF，保留草稿让操作者决定重试，不自动重放写请求。退出和重新登录按顺序完成，避免旧退出响应清除新 cookie。聊天最新接纳状态按 SQLite 写入顺序判定，不依赖随机请求 ID 或系统时钟先后；没有新增核心字段或 Web 数据库迁移。

概览五个区块独立返回结果，局部错误在 `sectionErrors` 标出；单一渠道 health 或会话读取异常不会使其他区块不可见。任务结果、时间线及补充留言采用显式展示字段投影，保留已获权的业务路径并隐藏标注的凭据；Bot 原始记录保持不变。

## 正式执行历史与正文

聊天「对话」保留原接纳/回复账本；「执行过程」分为当前 Router 与关联任务组，分别只读官方 Pi 已提交上下文。关联任务来自认证 conversation 的 SQLite 持久记录，包含已完成/归档任务，Router 换代不清除关联；前端不从模型文字、消息链接或任意任务 ID 推断关联。任务组默认折叠，仅展开时读取，收起即卸载读组件。任务详情「执行记录」保持读取本任务执行会话。换代、压缩或分支后，不承诺每组当前投影包含原始全部历史，不把渠道账本拼成完整工具历史。

`GET /api/chat/:id` 返回权威 `taskIds` 与 `taskHistoryStatus`；`ready` 配 `[]` 才表示没有关联任务，`null/unavailable` 或读取失败不转为空列表。Router 使用 `/api/chat/:id/session`，Chat 内任务组使用 `/api/chat/:id/tasks/:taskId/session`，Host 校验任务属于该 Chat 的认证 conversation；未关联统一返回 404 `CHAT_TASK_NOT_FOUND`，不接受任意 session ID。任务详情仍用 `/api/tasks/:id/session`。执行界面沿既有 `stream=1` 连续流默认载入最近 200 条，通过 `checkpoint` 校验已授权前缀并增量追加或向前补读；分支、压缩或内容改写时拒绝拼接并要求重新获取。原 offset API 仍每页最多 50 项并绑定 `revision`，不跨版本拼接。工具结果必须与同一 session 内准确的调用及工具名配对，再按服务端稳定身份合并；孤立、重复 ID 或名称冲突的结果保留事件与状态，不猜测正文。只有调用而没有已提交结果时显示「等待结果」，不宣称正在执行。Host 对工具输入和结构化回执按工具、字段和类型投影；所有调用名称保留，未知工具及字段明确提示缺少展示契约，不透传其任意正文。系统指令、原始参数对象、权限/环境、凭据和私有元数据不公开；模型实际返回的可读 thinking 独立展示且默认折叠，签名和不可读推理不透传。

Web 受众是安装 token 认证后的单操作者，安装级任务/session API 提供任务检视权；Chat 专属入口另校验 conversation 关联，不向群成员发布。对同一任务严格已提交 journal，文件、命令、作业、工作目录、待办与网页工具经 exact call/name 配对后展示业务 text，包括错误正文，保留业务路径及网页地址；JSON 业务文件无需脱敏时不改写原空白。秘密继续脱敏，details、二进制和未知字段不透传。memory/skill 历史正文保持独立权限，不扩大 learning reader binding、scope、version 和 403/409 授权链。首段及续页使用同一投影，不通过续读恢复隐藏字段。

任务 session 响应新增 todos 展示投影：只选同一会话最新已提交 planning/todos 回执的事项文字、状态、时间和 opaque 来源，不新增核心状态或数据库表。未提交调用不影响清单，分页及压缩不丢失回执，任务终态不覆盖模型待办状态。前端共用 ExecutionHistory 卡片，撤权时一并隐藏。升级需同时更新服务端与 Web 构建，按正常运维规程应用；只刷新旧服务端页面不能获得新投影。

长正文使用同一授权入口下的 `/session/messages/:messageId`，按该条投影的 opaque ID、`revision` 和脱敏后 UTF-16 offset 分段读取，每段最多 16000；不接受任意路径、URL 或 session ID。页面显示记录来源及当前段范围，复制按钮只复制已展示段。网络恢复只重读服务端历史，不重放接纳或外部效果。

自进化列表由可选 Web 服务每五分钟采集完整元数据、从自己的带索引元数据文件缓存提供分页，不再每次进入或切换分类就扫描全量日志。文件位于 `data/cache/web-console-<channel hash>/evolution-<identity hash>.pages`，权限仅限安装账号；内容已脱敏，不含记忆／技能正文、私有匹配路径或凭据，且不写数据库或 Bot 底座统计。缓存按安装／来源目录、Web 渠道、操作者和令牌指纹隔离。缓存可重建，备份可排除；仅清理停止后的对应 Web 缓存，不删除记忆库或其锁／pending 文件。

无缓存首次采集与已有缓存的到期刷新都合并并发请求。一次采集失败后最多再试三次，间隔 1、2、4 秒；安全路径、权限及格式错误直接停止。失败保留最后成功文件及时间，下轮五分钟继续；页面明确标记旧数据，手动「刷新记录」可立即采集。普通 GET 返回缓存，`refresh=1` 是认证操作者的显式采集；正文继续走独立版本绑定的实时授权入口。Web 停止清理定时器、取消重试退避并排空采集，不启动模型、不恢复或重放业务。 原子发布前会短暂暂停新分页，等待在途分页完成后关闭旧读句柄，兼容 Windows 文件替换；替换失败时只重新打开身份、大小与修改时间均匹配的旧文件。旧文件已被替换或不再安全时拒绝读取，不返回伪造的新快照。

复盘读模型为 `/api/tasks/:id/learning`。列表只含真实复盘及变更元数据；`applied` 以实际记忆来源或当前有效技能证据确认，候选和未应用记录独立标明。不可读返回 `unavailable` 与空缺数据，不伪造空列表。私有正文不随列表下发，仅 `/api/tasks/:id/learning/changes/:changeId?version=...` 按浏览器认证身份的实际 scope 校验；无权 403、版本不同 409。前端不为无权条目发正文请求，拒绝后不显示旧缓存正文，不提供记忆或技能写入入口。

## 渠道原始文件验收

在已授权的测试渠道发送小型 PDF/Word 附件，再让任务读取附件内未在指令中透露的校验码和数值。插件应下载原件，Host 在本任务 `materials/` 保留文件，正式模型材料视图包含 `file.name/mediaType/path/bytes/sha256`。核对原件长度和 SHA-256，并核对实际工具读取结果；不要把仅有 fileId、材料 unavailable、模型自行下载或任务 completed 当作端到端通过。

单资源上限 8 MiB；材料是只读输入。使用现有解析器时从受控路径读取，Python 应加 `-I`，不要在下载目录中启动解释器或执行附件。无需增加 DWS 账号或复制凭据。PNG/TXT/XLSX 保留原处理方式；PDF/Word 原件可达不保证环境安装了所有解析器。历史失败快照不自动重建；复验发送明确的新样本，不改旧账本。

群内交付另核对通知 delivered 和独立平台回读，结果正文避免暴露内部任务/会话/来源编号。unknown 通知只做原链路回读，不能重发或放宽外发门禁。

## 开发与隔离验收

```powershell
pnpm --dir packages/web-console test
pnpm --dir packages/web-console build
pnpm --dir packages/web-console test:browser
```

浏览器脚本使用本机 Edge、真实插件 HTTP 和显式隔离样例，自动关闭服务并清理临时数据；不需要真实 DWS 或模型凭据。若端口 3081 被占用，先确认是否本任务遗留，不杀其他服务。截图是样例验收证据，不是生产状态。

可手动运行 `node packages/web-console/test/preview.mjs --port=3082`；此脚本打印**仅测试**令牌，Ctrl+C 退出。演示脚本仅用于开发，不参与插件生产入口。

`pnpm --dir packages/web-console dev` 在 18999 提供 Vite 开发页，将 `/api` 代理到本机 3080 的可选插件。开发代理重写目标 Host/Origin，生产插件的同源规则保持不变。正式运行直接由插件托管构建产物。

### Router 学习维护后的回复与清单核对

Web 单聊最终回复即使显式 `recipientActorIds: []`，渠道封装也会在缺少显式 actor 时从 Host 冻结的 `sourceRef.actorId` 解析当前认证对端；来源必须属于同一 conversation 的 participants。该身份只用于单聊传输归属，不补引用、不提及，群聊路由不变，Web transport 的 sender/channel/conversation 校验不放松。

升级不会改写旧冻结 payload、digest 或 unknown 收据，也不自动重发。若旧回复在 Web 账本中不存在，映射修复后的只读回看仍不能证明已送达；保留 unknown 并按独立恢复流程核对，不能把“底层已持久化”或分诊承接答复当作最终成功确认。

学习 Skill 清单和核心 provider 共用支持判定：Router 来源有效的活动记录应为 applied；任务复盘记录仍依赖当前保留的 experience，坏来源仍 unsupported。手动刷新后核对状态、活动数与显式正文读取；删除后清单和派生目录都应消失。此检查不制造经验记录或增加使用次数，部署结果须另行验收。
