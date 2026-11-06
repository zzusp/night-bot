# 当前 DSH/Pi 边界

外部 DSH 生产依赖、开发声明与锁文件包均为零。当前默认 Host 使用官方 Pi 1.5.0 AgentSession、SessionManager、buildSessionProjection 和 convertToLlm，Night 只维护授权、业务 SQLite、严格 journal 提交与副作用收据。

旧可变 Session、Host 消息影子、projection/query/title 服务、子代理产品和历史 v0–v4 数据导入已退休。保留本地 namespace aliases 是运行产物的一部分，不能只复制 src。

另外移除未接线的 `src/pi-provider-context.js`、`src/runtime/pi-native-provider-context.js` 和 `src/runtime/pi-tool-catalog.js` 及专属旧测试；其旧角色映射/工具目录链不再保留。实际会话使用官方 `AgentSession`/`SessionManager` 和 `DefaultResourceLoader`。仍在使用的 `pi-request-context.js` 负责应用内存策略，不作为第二套模型上下文驱动。

本轮删除已无实现与测试副本的 projection 专属 notice。FS protocol 与 observation 仍含精简改写的派生契约/算法，两份 FS notices 继续保留；session 共享 deepEqualJson 算法、SessionTitleInvalidError、subagent 共享 sandbox 片段、Windows DACL/ReplaceFileW、权限/调度/watcher 等派生实现仍须保留署源。零外部包不等于零派生源码。

核查入口：THIRD_PARTY.md、runtime-audit.json、source-manifest.json、legacy-runtime-source-manifest.json；本轮脚本和结论见 [本机验收](acceptance/pi-native-retirement-local/goal.md)。源码/哈希/import 守卫拒绝外部 DSH 包、旧编排器和未记录的派生源码变化。

Linux 历史测试不能证明 Windows 内核隔离。portable 非 Linux 模型进程隐私尚未实现时维持失败关闭；本轮文件任务不调用 shell。真实 DWS 外发、额外业务系统和其他平台能力仍需单独授权验收。旧结果见 DSH-AUDIT-HISTORY.md。
