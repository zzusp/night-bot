# 当前 DSH/Pi 边界

外部 DSH 生产依赖为0，完整生产依赖图也为0。所有默认 Host owner 已替换；
49 个活动组件替换计数不包含补齐服务、协议辅助或命名空间兼容入口。

| 层 | 当前权威 | 保留内容与验证 |
|---|---|---|
| 模型与工具循环 | Pi agent-core1.5.0 | 本地 middleware/调度/收据；真实本地 wire 和并发/取消测试 |
| 当前历史与上下文 | Pi SessionManager | 校验和、单 writer、分支/提交、不重放；旧 deriveMessages 被毒化仍不影响真实请求 |
| 业务状态/权限/效果 | 应用服务与 SQLite/本地状态 | Scope、角色、单次批准、不可变 CWD/artifact proof、恢复不重放 |
| 兼容数据/API | 本地 MIT 派生协议 | v4 audit/publication/inbox、消息/chunk/tool/schema/RPC、旧包名入口 |
| 历史文件 | 本地 v0–v4 codecs/import IO | 原发布包生成 plain/zstd golden 字节不改写；独立原 IO 参考与新隔离 verifier |
| 平台进程/ACL | 本地 managed process/ACL | Linux 真内核通过；Windows 代码来源/固定哈希保留，实际 Win 内核未验收 |

没有生产旧 LlmRuntime/ToolRuntime/SessionStore 编排器；旧 Runtime 仅在独立
测试参考中存在。本地兼容层不等于原 DSH Host，也不等于已经完成外部业务验收。
Generic Cordis/schema/native-system 库仍是普通依赖。

源码/哈希与名字映射见 runtime-audit.json、legacy-runtime-source-manifest.json、
source-manifest.json、THIRD_PARTY.md。check-native-runtime.mjs 会拒绝退回
外部 SDK import、旧编排器定义和未记录的兼容源码修改。

真实 DWS/模型厂商/业务系统、Windows/macOS 内核与可选 Claude/browser/plugin
集成仍受实际环境与授权限制。远端 Git 写入此前403，被拒绝后未重试或绕过。
历史分阶段判断保存在 DSH-AUDIT-HISTORY.md，不是当前依赖状态。
