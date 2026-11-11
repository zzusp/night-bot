# 渠道接入

渠道是可选适配器。核心可独立运行，Web 与钉钉都不是启动前置。渠道使用 `chat`（私聊）和 `chat-room`（群聊）两种对话抽象，认证来源和会话身份由 Host 与插件共同校验。

## Web 控制台

Web 面向本安装的单个操作者，不是面向公网的多用户服务。它提供中文对话、任务查看、执行记录、模型设置、渠道管理和权限审批。

按[快速开始](./getting-started)安装独立依赖、构建并配置 Web。默认使用本机地址 `http://127.0.0.1:3080`，从本机令牌文件获取访问令牌。不要将控制台或核心管理端口直接暴露公网。

关闭浏览器不会停止 Bot；禁用 Web 不会关闭核心的其他能力。已有安装应沿用原渠道 ID 和操作者标识。详细启停与排障见[Web 运维](https://github.com/zzusp/night-bot/blob/main/docs/ops/web-console-local.md)。

## 钉钉

钉钉通过可选 DWS 插件接入，默认核心不会探测或启动 DWS。

1. 在运行 Bot 的环境安装并登录 DWS CLI，确认使用正确账号。
2. 通过 Web「渠道」或[统一配置 CLI](https://github.com/zzusp/night-bot/blob/main/docs/ops/shared-settings.md)添加私聊或群聊。
3. 为每个实例设置唯一 `channelId`，核对实际目标与身份绑定。一个实例只绑定一个会话；多个实例可共存。
4. 根据保存结果正常重启，分别核对已保存、已加载和真实连接状态。
5. 只有在操作者明确授权后才启用外发，并单独验证发送及平台回读。

新建渠道默认关闭外发。外发授权覆盖正常回复、通知和附件等渠道发送，不替代具体任务的业务授权。修改目标时不能同时开启外发授权；旧任务、未知回执与依赖可能阻止切换，不要删除记录绕过。

“保存成功”不等于“已连接”，“已连接”也不等于“已送达”。结果未知时沿原回执核对，不能重复发送或换一个渠道 ID 规避检查。

### 附件

PDF、Word 等原件可作为只读任务材料，单个材料上限 **8 MiB**。原件可达不保证运行环境装有解析器，不要执行收到的附件或在下载目录启动解释器。

更多内容：[渠道协议](https://github.com/zzusp/night-bot/blob/main/docs/CHANNELS.md) · [Windows 接入步骤](https://github.com/zzusp/night-bot/blob/main/docs/ops/windows-local-runtime.md)

## 自定义渠道

可信安装操作者可通过 `channelPluginDirs` 与 `channelPlugins` 加载插件。插件需实现认证身份、生命周期、能力和状态合同，不应把厂商原始身份字段直接泄漏为公共核心接口。

渠道名称与职责用于说明工作范围，不能扩大权限。普通消息不能自动安装插件代码。新增、修改、启停和删除可能涉及在途任务、旧身份与未知发送，应使用受支持的配置入口。

开发接口见[渠道插件合同](https://github.com/zzusp/night-bot/blob/main/docs/CHANNEL-PLUGINS.md)。
