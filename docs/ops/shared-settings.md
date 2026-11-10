# 同一配置服务：Web 与无 Web CLI

Web 表单不执行 shell 命令。Web API 与 CLI 调用同一套配置服务，复用验证、版本检查、配置锁、凭据存储及 Host 渠道生命周期。无 Web 时，Bot 的 resident 服务仍可运行；它不依赖 Web 渠道插件。

## 两种运行方式

- Bot 停止时：`night-bot-config` 管理全局/角色模型、权限默认值和 Web 监听配置；`night-bot-settings` 管理外观、凭据和新自定义渠道。`night-bot-settings` 的离线写入需要独占 Host 锁，不会启动模型、业务会话或插件。`night-bot-config` 保留只修改保存配置的行为，共用配置锁；正在运行时不会把它当作热生效。
- Bot 运行时：`night-bot-settings CONFIG ACTION --live` 使用已有 resident 的本机认证入口。无需 Web，也不创建第二个 Host。渠道编辑、启停、删除及钉钉新增/编辑必须使用此方式，保留任务依赖、绑定身份、未知效果、排空和回滚检查。
- 默认不使用 `--live`，避免连接失败后自动改磁盘。连接中断可能已经提交，CLI 报告不确定结果，不自动重试。先用只读命令核对。

`CONFIG` 指向该安装的 `data/config/config.json`。参数中的 JSON 文件只放非秘密配置。模型 Key、GitHub token 不接受命令行值，`secret ... replace --confirm` 从隐藏终端提示或一行标准输入读取；不回显密钥。OAuth 和任意命名凭据引用继续使用已有 `night-bot-auth`，共享 NativeCredentials/Pi authentication 服务。

```sh
# 停机配置，--check 不写文件、锁、目录或凭据。
node bin/night-bot-config.js CONFIG role-model --role triage --provider PROVIDER --model MODEL --reasoning-effort high --check
node bin/night-bot-settings.js CONFIG appearance --name 'My Bot' --icon moon
node bin/night-bot-settings.js CONFIG secret --kind model --action replace --confirm
node bin/night-bot-auth.js CONFIG set-ref MY_CHANNEL_TOKEN

# 没有 Web 界面，也可管理正在运行的 Bot。
node bin/night-bot-settings.js CONFIG show --live
node bin/night-bot-settings.js CONFIG plugins --live
node bin/night-bot-settings.js CONFIG appearance --name 'My Bot' --icon leaf --live
node bin/night-bot-settings.js CONFIG secret --kind github --action replace --confirm --live
node bin/night-bot-settings.js CONFIG permissions-set --mode full --live
node bin/night-bot-settings.js CONFIG channel-list --live
node bin/night-bot-settings.js CONFIG dingtalk-get --channel-id work-room --live
node bin/night-bot-settings.js CONFIG channel-save --json-file custom-channel.json --live
node bin/night-bot-settings.js CONFIG dingtalk-add --json-file dingtalk-new.json --live
node bin/night-bot-settings.js CONFIG dingtalk-edit --json-file dingtalk-edit.json --live
node bin/night-bot-settings.js CONFIG channel-enable --channel-id work-room --enabled false --expected-version VERSION --live
node bin/night-bot-settings.js CONFIG channel-remove --channel-id work-room --expected-version VERSION --confirm --live
```

`show` 返回外观、模型、角色模型和凭据状态，不返回密钥。`plugins` 返回插件声明的字段及可编辑配置。`channel-list` 只返回类型、标识、启用状态和渠道版本；删除、启停需要此版本。钉钉编辑需要 `dingtalk-get` 的版本及完整可编辑字段。外观、凭据、角色、自定义渠道、全局模型和 Web CLI 未指定版本时会先读取版本，然后按该版本保存；并发变化会拒绝，不覆盖新值。

自定义渠道 JSON 与 Web 表单一致：`type`、`channelId`、`enabled`、`config`、可选 `createOnly` 和 `expectedVersion`。`config` 只允许插件清单声明的非秘密字段；`credential-ref` 是引用名，不是密钥。停机只允许创建没有历史渠道记录的新实例；修改既有实例或复用历史标识需 `--live`。无生命周期支持的插件可能要求重启，或拒绝在线编辑，不能把磁盘写入声称为即时生效。

钉钉新增 JSON 与 Web 一致：`channelId`、`conversationType`（`chat`/`chat-room`）、`targetKind`（`id`/`name`）、`target`、可选 `name`、`prompt`、`writesAuthorized`。编辑另需 `expectedVersion`。切换目标时不允许同时授予写权限，仍需真实账户/目标绑定，保留旧渠道的补拉和任务边界。

新 CLI 也提供 `model`（`--provider --model --api --base-url --key-env`）、`role`（`--role --provider --model --reasoning-effort`）、`web`（`--enabled --host --port --public-origin --channel-id --sender-id --operator-name`）、`permissions-show`、`permission-respond --id REQUEST --decision allow|reject|revoke`。`permission-respond` 只作用于仍有效、绑定原调用的审批；离线不能重放批准。

## 同一路由的多个模型

Web「模型列表」和 `night-bot-settings model-list/model-entry` 共用同一配置服务，不另建 provider、密钥或模型注册表。`model-list` 返回安全目录、引用和配置版本；`model-entry` 修改已有 provider 下一个模型，不改变全局默认选择。真实模型 ID 由操作者提供，命令不会自动访问服务商发现目录或验证调用。

```sh
node bin/night-bot-settings.js CONFIG model-list --live
node bin/night-bot-settings.js CONFIG model-entry --action add --provider PROVIDER --model MODEL_ID --name '显示名称' --live --check
node bin/night-bot-settings.js CONFIG model-entry --action add --provider PROVIDER --model MODEL_ID --name '显示名称' --live
node bin/night-bot-settings.js CONFIG model-entry --action edit --provider PROVIDER --id MODEL_ID --model NEW_MODEL_ID --name '新显示名称' --live
node bin/night-bot-settings.js CONFIG model-entry --action remove --provider PROVIDER --id MODEL_ID --confirm --live
```

`--name ''` 清除显式别名；ID/显示名称以外的能力、上下文、兼容字段保留。官方 provider 没有显式模型列表时，首次编辑保留完整有效内置目录及已有 overrides，再持久化为显式列表，不因添加一项丢掉其余模型。已有显式列表按当前白名单维护，不自动扩为完整官方目录。删除须确认且至少保留一个模型。

默认、显式角色、legacy 任务配置和环境角色引用均受保护；有效持久任务默认选择也由现有 Host 核验。保存目录不会改变当前运行的会话，需按原流程正常重启。角色仍使用既有 `role` 命令及 `NIGHT_BOT_{TRIAGE,ROUTER,TASK}_{PROVIDER,MODEL,REASONING_EFFORT}`，不增加平行的环境配置源。`--check` 不写文件，API/CLI 均沿用 CAS、配置锁及结果未知不重试规则。

配置含 resident 时，删除或更改模型 ID 前须先保存明确的任务执行角色选择（或已有有效 task 环境覆盖）。这是为了避免旧任务默认配置入口在两个独立存储之间继续选回已移除模型；仅实时读取旧默认值不足以消除竞态。新增模型、修改显示名不需要这一步。网页会说明该限制；CLI 可先执行 `role --role task --provider PROVIDER --model KEPT_MODEL --reasoning-effort model-default --live`。

`--check` 支持外观、全局/角色模型、凭据、Web、自定义渠道及权限模式。它校验保存候选值，不承诺运行时一定可激活。钉钉绑定/切换、启停、删除及审批回应不支持 `--check`，会直接拒绝而不执行。

## 入口审计

| 配置 | Web | CLI | 共同实现和实际边界 |
| --- | --- | --- | --- |
| 外观 | `/api/settings/appearance` | `night-bot-settings appearance` | `operator.saveAppearance`，相同 CAS/校验 |
| 全局模型 | `/api/settings/model` | `night-bot-config model` / `night-bot-settings model` | `saveModelConfiguration`；Web 便利表单固定 `web-model` provider，新 CLI 可选择 provider |
| 路由内模型列表 | `/api/settings/model-catalog` GET/PUT | `night-bot-settings model-list/model-entry` | 共用安全目录投影和 `saveModelCatalogEntry`，ID/显示名增改删、引用保护、CAS，保存后正常重启 |
| 分诊/Router/执行模型 | `/api/settings/role-model` | `night-bot-config role-model` / `night-bot-settings role` | `saveRoleModelConfiguration` 和相同 Pi 能力校验 |
| 模型/GitHub Key | `/api/settings/secrets/*` | `night-bot-settings secret` | `operator.saveSecret`，确认、路由版本锁、环境只读、NativeCredentials |
| OAuth/任意引用 | 无对应 Web 表单 | `night-bot-auth` | Pi authentication/NativeCredentials；不是独立秘密存储 |
| 权限模式 | `/api/permissions` | `night-bot-settings permissions-set --live` / `night-bot-config permissions` | 在线 `toolPermissions.setMode`；持久化均为 `savePermissionConfiguration`；离线仅改变下次启动配置 |
| 自定义渠道 | `/api/settings/channels` | `night-bot-settings channel-save` | `operator.saveChannel`；在线共用 Host lifecycle；停机只创建新实例 |
| 钉钉新增/编辑 | `/api/channels/dingtalk` | `night-bot-settings dingtalk-add/dingtalk-edit --live` | 同一个 Host `channelConfiguration`，真实绑定和依赖检查 |
| 渠道启停/删除 | 渠道服务/Web 删除 | `night-bot-settings channel-enable/channel-remove --live` | 同一个 Host `channelConfiguration`，版本锁、排空、依赖和回滚 |
| Web 监听/操作者标识 | 无对应设置表单 | `night-bot-config web` / `night-bot-settings web` | `saveWebConfiguration`；不更换既有 actor，需重启监听 |
| 钉钉高级离线 provision | 无对应 Web 表单 | 既有 `night-bot-dingtalk add/set/env/enable/disable` | 保留高级账户/adapter 配置用途；共用 DingTalk validators、`updateConfig`、Host 离线锁和 ingress checkpoint；不是在线 Web 编辑的别名 |

## 安全及未验边界

运行时配置入口为 resident loopback 的 `POST /operator/settings`。只接受受限 JSON 命令、有效本机 Host、无浏览器 Origin、独立 settings operator capability；不接受 effect operator token。秘密文件位于既有私有 `data/secrets`，POSIX 所有者/权限、硬链接/符号链接校验和常数时间比较与 effect capability 共用实现。凭据本身不进入 URL、CLI 参数或输出。

这不是对同操作系统账号任意进程的隔离边界。`full` 模式的 shell 按该 OS 账号权限运行，能读取账号可读的配置/秘密；operator token 不能隔绝这样的任意脚本。Host 直接服务调用仍禁止模型 actor 修改配置。Windows 具体 ACL/内核隔离能力需另行实测，不把 POSIX 权限测试当作 Windows 认证。

更改配置不执行部署、不改变机器安全设置，也不声称所有配置热生效。真实第三方厂商账户、DWS 远端调用和 Windows 环境不由本地 fake/loopback 测试证明。

## 本轮验证

2026-11-10，本地 Node 测试：`node --test test/pi-settings-cli.test.js test/pi-effect-operator-http.test.js test/pi-channel-edit.test.js test/pi-channel-live.test.js` 共 36 项通过，0 失败、0 跳过。包括实际无 Web resident 接线、无模型请求、凭据脱敏、CAS、全目录零写检查、独立 capability、离线 Host 锁、历史标识/恢复标记拒绝，以及未知交付经 headless HTTP 删除/换目标时仍被原生命周期服务阻止。`check-coverage`、`check-production-imports`、`check-native-runtime` 和 `git diff --check` 通过。此处不代表全量运行时、真实厂商账户、视觉浏览器或 Windows 验证。
