# Night Bot Core

`@night-bot/core` 是 Night Bot 的私有通用应用服务包，当前 manifest 为 `private:true`、`UNLICENSED`。Pi AgentSession/SessionManager 负责推理、工具迭代、历史和模型上下文；Host 负责来源认证、任务账本、权限、版本、效果收据和可靠交付。移植来源与许可见 [来源说明](../../THIRD_PARTY.md)，本地迁接不改变原代码归属。

## 入口与职责

- 从根项目初始化和启动，命令及配置见 [README](../../README.md)。当前包没有声明旧 `@zzusp/dingtalk-dsh-assistant/resident` 或 `/client` 导出，不能把旧包名当成现行接入接口。
- 核心支持渠道无关的 `chat` / `chat-room`；DWS 和 Web 控制台是独立可选插件。默认无插件组合不依赖 DWS CLI、真实账号或 Web 页面，启用插件不替代业务授权。
- 一级分诊只决定逐来源 handling 和可选短回复；每个已认证 conversation 的常驻 Router 负责关联、安排和评估事项。每个事项只有一个执行 session，没有任务 Owner、委派执行团队或独立子执行会话；Topic 仅留作历史审计。
- 执行输入、实时补充、任务动作与依赖都绑定原来源、作者和当前版本；Pi generation 交接或任务完成不产生新授权。协议和生命周期见 [CHANNELS](../../docs/CHANNELS.md) 与 [SINGLE-TASK](../../docs/SINGLE-TASK.md)。

## 配置与私有技能

包内不提供个人 Agent 姓名、私人署名、业务技能或业务目标名单。actor、群职责、模型、可选 `replySignature` 与插件开关来自安装自己的私有配置，不从显示名或旧报告推断身份和权限。

个人 Skill 正文及同目录 scripts、references、assets 只保留在已忽略的安装数据中，不进入代码、fixture 或 npm 包；默认目录为安装内 `data/config/skills`，额外目录遵守当前受控 `skillDirs` 合同。模型按需读取技能，技能内容不是执行、外发、合并或部署授权。不导入旧 DSH 数据，也不复制旧账号、凭据或整份共享技能集合。数据和备份边界见 [DATA-LAYOUT](../../docs/DATA-LAYOUT.md)。

## 运行与交付边界

任务材料、工作、冻结输出、Pi 会话及复盘分区保存在该任务档案内；模型只能写任务 `work/` 和 `tmp/`。实际文件、冻结 descriptor、任务完成、通知送达和无工具复盘分别核验，不能用工具成功、send accepted 或页面就绪代替业务终态。

安装与升级使用完整 Night Bot 代码、依赖锁文件和匹配配置，保留各安装自己的 `data/`；本包目录不能单独充当完整安装。现存 unknown、历史 journal、授权版本及 no-replay 边界保持，正常停止和升级按 [运行手册](../../docs/ops/windows-local-runtime.md) 执行。当前 Windows 安全命令/进程隔离仍须以 SG11 的实际实现、OS 证据与受验版本核定，本页不宣称可生产隔离或全量通过。

## 历史记录

保留原包的 Issue172 历史引用：`docs/acceptance/issue-172/context-projection.md`。该记录未随当前 Night 仓库提供，不能作为本次通过证据。旧 Topic、Owner、多执行会话和包发布说明只代表该轮历史，不能作为当前运行步骤、兼容 ABI 或新业务授权。当前进展见唯一[验收入口](../../docs/acceptance/resident-conversation-routing/goal.md)，不重写历史结果来证明本次清理完成。
