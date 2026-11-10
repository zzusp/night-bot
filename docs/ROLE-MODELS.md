# 分角色模型配置

一级分诊（`triage`）、常驻 Router（`router`）和任务执行（`task`）可分别选择
provider、模型及推理深度。无需开启 Web 渠道，也不要求 Bot 正在运行。

## 一个配置入口

Web 设置和 `night-bot-config` 使用同一个配置服务
（`src/settings/model-configuration.js`），共享模型能力校验、配置文件锁、
版本冲突检查和原子写入。Web 不拼接或执行 shell 命令。Web 的版本检查会拒绝
覆盖别人刚保存的配置；CLI 每次读取锁内的最新配置，只更新指定角色。

```sh
# 检查配置，不创建锁文件、不修改配置或目录
node bin/night-bot-config.js /absolute/install/data/config/config.json role-model \
  --role triage --provider openai --model gpt-5 --reasoning-effort low --check

# 保存一级分诊选型
node bin/night-bot-config.js /absolute/install/data/config/config.json role-model \
  --role triage --provider openai --model gpt-5 --reasoning-effort low

# Router 与任务分别设置。provider/model 必须已存在于 providers 配置中。
node bin/night-bot-config.js /absolute/install/data/config/config.json role-model \
  --role router --provider openai --model gpt-5 --reasoning-effort high
node bin/night-bot-config.js /absolute/install/data/config/config.json role-model \
  --role task --provider openai --model gpt-5 --reasoning-effort high

# 只修改一个字段；model-default 清除显式推理深度
node bin/night-bot-config.js /absolute/install/data/config/config.json role-model \
  --role task --reasoning-effort model-default

# 查看保存的配置，输出凭据引用，不读取或显示密钥值
node bin/night-bot-config.js /absolute/install/data/config/config.json show
```

示例模型仅表示参数用法，实际以当前 Pi 版本和本机已配置的模型列表为准。
可先通过原有 `model --provider ... --model ... --api ... --base-url ... --key-env ...`
命令配置全局 provider/model，再选择角色模型。这个命令也使用相同配置服务。
Web 与 CLI 新设 endpoint 均要求 HTTPS，或本机回环 HTTP；不接受账号密码、query 或 hash。
`--key-env` 只接受环境变量名称。未修改的既有 provider 配置不因查看或角色选择而被改写。
配置密钥仍使用凭据引用或已有凭据管理流程，不把密钥写入 role-model 参数。

## 保存格式与推理深度

`config.json` 的可选字段：

```json
{
  "roleModels": {
    "triage": {"provider": "openai", "model": "gpt-5", "reasoningEffort": "low"},
    "router": {"provider": "openai", "model": "gpt-5", "reasoningEffort": "high"},
    "task": {"provider": "openai", "model": "gpt-5"}
  }
}
```

- 每个显式角色必须同时具有 `provider` 和 `model`。未知角色、字段、provider、
  model 或推理深度会在保存和启动时被拒绝，不静默降级。
- Pi 的深度名称为 `off`、`minimal`、`low`、`medium`、`high`、`xhigh`、`max`。
  并非每个模型都支持所有深度，使用官方 Pi 的模型能力列表验证。不支持思考的
  模型可选择模型默认或官方允许的 `off`，不能设置 `high` 等思考级别。
- 不保存 `reasoningEffort` 表示使用 provider 的 `reasoning` 默认值，否则由
  Pi 使用模型默认（当前 Pi 1.5 从 `medium` 按该模型支持的级别调整）。Host 在启动时
  解析实际级别，不把这个派生值写回配置。`model-default` 只用于 CLI/ENV，保存时删除该字段。
- CLI 未指定的字段保留已有角色配置；首次创建角色时，缺少字段从旧配置补齐。
  更换 provider/model 时会清除继承来的旧推理深度，除非此次同时指定新深度。
- 没有配置的角色继续使用全局/任务默认选择逻辑，不会强制生成三个覆盖项。
  正式文件安装的全局选择以 `config.json` 的 `model` 为唯一配置来源，Web 与 CLI
  保存后重启会实际生效。以前单独保存的全局选型文件保留原样，不再覆盖该配置。
  现有运行时交互的全局模型保存也走同一个配置服务，成功后更新当前运行快照。
  任务的旧 `resident.taskSessions` 和既有任务选型配置仍作为未显式设置 task 角色时的回退。

## 环境变量

临时覆盖使用以下九个变量，不修改保存的配置：

| 角色 | provider | model | 推理深度 |
| --- | --- | --- | --- |
| 一级分诊 | `NIGHT_BOT_TRIAGE_PROVIDER` | `NIGHT_BOT_TRIAGE_MODEL` | `NIGHT_BOT_TRIAGE_REASONING_EFFORT` |
| Router | `NIGHT_BOT_ROUTER_PROVIDER` | `NIGHT_BOT_ROUTER_MODEL` | `NIGHT_BOT_ROUTER_REASONING_EFFORT` |
| 任务执行 | `NIGHT_BOT_TASK_PROVIDER` | `NIGHT_BOT_TASK_MODEL` | `NIGHT_BOT_TASK_REASONING_EFFORT` |

```sh
NIGHT_BOT_TRIAGE_REASONING_EFFORT=low \
NIGHT_BOT_ROUTER_REASONING_EFFORT=high \
NIGHT_BOT_TASK_REASONING_EFFORT=model-default \
pnpm start /absolute/install/data/config/config.json
```

PowerShell 中可使用 `$env:NIGHT_BOT_TRIAGE_REASONING_EFFORT = 'low'`，然后运行同一
启动命令。临时覆盖用完后移除对应进程环境变量。

变量也可放在安装目录的 `data/secrets/.env`。它们通过现有原生环境加载流程读取，
优先级是进程环境 > 已配置的项目 `.env` > 已配置的用户 `.env` > 保存的角色字段 >
旧配置回退。标准安装只读取其 `data/secrets/.env`，不会扫描工作区或外部 home。
只有上述精确名称获准进入 `.env`；其它 `NIGHT_BOT_*` 启动控制变量仍被拒绝。

ENV 按字段覆盖，所以只设置某个角色的推理深度即可。更换 provider/model 时同样
清除旧深度；需要固定深度时同时设置。空字符串不是“清除”：它会被拒绝。
`show` 始终展示保存值而不是当前进程 ENV 覆盖，以免把临时值误当成已保存配置。

## 生效与历史

标准 `data/config/config.json` 安装统一以配置文件的 `model` 为全局默认来源。升级前请核对该值：
历史交互入口保存的 `night_model_selection` 文件会保留，但不再覆盖配置文件。
如果要继续使用仅在旧选型文件里保存的选择，请先用上述 CLI 显式保存到配置，再正常重启。
新的交互保存同样写入共享配置入口，不再双写旧选型文件。非受控位置的历史启动配置继续只读，
并保留旧选型存储；不会为了保存配置而放宽路径保护。统一设置 CLI 需要标准受控安装路径。

保存角色配置后需要重启 Bot。ENV 在启动时冻结，修改 shell 或 `.env` 后也需要重启。
三个角色正在执行或已经打开的会话都不会在一次任务中途热切选型。重启后重新打开或恢复的
会话也会应用对应角色的新模型和深度，包括从显式深度改回模型默认，同时保留既有 Pi 历史、任务与来源记录，不重置会话、
删除历史或重放已执行的副作用。尚未打开的会话在首次打开时使用本次启动配置。

若仍设置了 ENV，Web/CLI 保存的新值会被它覆盖。可先删除相应 ENV 再重启，或使用
设置页显示的“当前运行 / 下次启动 / 环境覆盖”状态确认实际来源。

本功能不改变消息来源认证、工具权限、任务依赖或批准收据。模型选择不是权限授权。
