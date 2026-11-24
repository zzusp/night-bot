# 模型与配置

私有配置默认位于 `data/config/config.json`。Web 设置和 CLI 复用同一 Host 配置服务；配置保存、运行时加载、实际调用成功是不同状态。

## 先查看当前配置

运行中的实例使用 `--live` 访问本机认证入口，不要求启用 Web：

```sh
node bin/night-bot-settings.js data/config/config.json show --live
node bin/night-bot-settings.js data/config/config.json model-list --live
node bin/night-bot-settings.js data/config/config.json channel-list --live
```

这些视图返回设置、模型目录或渠道状态，不输出密钥。CLI 不会在在线连接失败后自动改写磁盘；请求中断可能已经提交，应先只读核对，不盲目重试。

## 模型路由与角色

一个 API 路由可以包含多个模型，共用 API 地址、协议和凭据。打开控制台右上角「设置 → 模型分工」，可分别选择 Router 和任务执行的模型。旧分诊配置只保留作历史兼容，不再使用。

在 Bot 停止时，可先校验角色模型，再保存：

```sh
node bin/night-bot-config.js data/config/config.json role-model --role task --provider YOUR_PROVIDER --model YOUR_MODEL --check
node bin/night-bot-config.js data/config/config.json role-model --role task --provider YOUR_PROVIDER --model YOUR_MODEL
```

`--role` 支持 `router`、`task`。将占位值替换成已配置的路由与模型，按返回的 `restartRequired` 正常重启。API 和模型目录保存后不热切换已有执行会话。

Web「模型与 API」可管理路由及模型列表。正在被默认配置、角色或任务引用的模型受到删除保护；命令不会自动向服务商发现模型或验证模型可用性。

## 工作原则

打开右上角「设置 → 工作原则」。上面是 **Router 工作原则**，下面是 **执行会话工作原则**，各有自己的「保存」按钮。

把平时反复交代的业务做法写在这里，不必每次发任务都重说。以排查线上报错为例：

- **Router 工作原则**写怎么接任务、什么时候回报。例如：“同一故障已有任务就继续跟进，不重复建任务；有核实的结果或明确卡点再回报。”保存后下一轮生效，不改变正在跑的这一轮。
- **执行会话工作原则**写任务怎么做、怎样算核实。例如：“先确认故障环境和在跑的版本，再查对应时段的日志；把查到的事实和还没验证的判断分开写。”保存后在执行会话下次刷新上下文时生效。

两份规则互不覆盖，留空不加载，都不需要重启。原则不会授予权限，也不替代审批。请勿填写凭据。也可在本机分别维护 `data/config/router/AGENTS.md` 和 `data/config/execution/AGENTS.md`，见[工作原则配置](https://github.com/zzusp/night-bot/blob/main/docs/ops/shared-settings.md#会话工作原则)。

## 密钥管理

可以用初始化时指定的环境变量提供模型密钥，也可以通过凭据服务设置。环境提供的凭据在设置中只读。

在交互终端中运行以下命令，按隐藏输入提示提供密钥：

```sh
node bin/night-bot-settings.js data/config/config.json secret --kind model --provider YOUR_PROVIDER --action replace --confirm --live
```

不要把密钥直接写在参数、JSON 示例、URL、聊天或 Git 中。共享同一凭据引用的路由可能同时受更换影响，应先核对设置返回的共享关系。OAuth 和命名凭据引用见[完整配置与认证说明](https://github.com/zzusp/night-bot/blob/main/docs/ops/shared-settings.md)。

## 权限配置

新安装默认 `full`。它意味着按当前 OS 账号直接访问，**不提供工作区或进程隔离**。显式 `ask` / `auto` 保持有效，不会因默认值变化而自动升级。

停机时修改下次启动的模式：

```sh
node bin/night-bot-config.js data/config/config.json permissions --permission-mode ask --check
node bin/night-bot-config.js data/config/config.json permissions --permission-mode ask
```

认证 Web 操作者可在线保存模式，并回读 Host 当前状态。普通渠道成员、任务和模型不能自行切换安装权限。完整行为与未验边界见[权限与安全](./security)。

## 扩展入口

- `skillDirs`：加载技能。私有技能正文、脚本及素材属于运行数据，不提交到仓库。
- `channelPluginDirs` / `channelPlugins`：配置可选渠道插件，见[渠道接入](./channels)。
- 额外工具插件：由可信部署配置挂载浏览器、搜索或业务系统能力，不随核心安装自动可用。

插件与 Host 同进程运行，不是沙箱；不能把插件的工作目录当作安全隔离。完整命令、版本冲突与生效规则见[统一配置 CLI](https://github.com/zzusp/night-bot/blob/main/docs/ops/shared-settings.md)。
