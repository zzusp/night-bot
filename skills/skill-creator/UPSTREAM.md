# 来源与适配

本目录源自 Anthropic 官方 Claude 插件 `skill-creator`，用户指定版本 `e0ab6e51219e`。仅导入该版本技能目录的 18 个通用文件，不包含插件缓存、账号、私有安装技能或业务数据。

- 上游 `SKILL.md` SHA-256：`dcd4803e61e913e6fc27294184cd3a71f09f5e924ff20c8a9a20173e7b3c2bcf`。
- 原样保留 Apache License 2.0 许可：`LICENSE.txt`（SHA-256：`58d1e17ffe5109a7ae296caafcadfdbe6a7d176f0bc4ab01e12a689b0499d8bd`）。这些文件不改授仓库其他许可证。
- 本仓修改：在 `SKILL.md` 前部增加中文 Night Bot 适配，限定单执行会话、只读内置资源、受控工作目录、离线工具依赖、静态查看器和外部 CLI 边界。15 个附属文件逐字节保留；`scripts/improve_description.py` 与 `scripts/quick_validate.py` 仅清理上游各一处行尾空白，以通过仓库 whitespace 检查，不改执行逻辑。
- 本文件由 Night Bot 新增。后续更新需保留许可和修改声明，不从安装目录反向收集其他技能。
