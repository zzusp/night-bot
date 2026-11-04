# Migrate headless DingTalk execution to Pi (in progress)

迁移中草稿，尚未完成完整去DSH。Pi 1.5.0负责模型迭代、Models请求与SessionManager持久分支上下文；本地状态域和NativeTools负责配置、权限/审计执行链。保留消息、Topic、任务统筹执行、恢复、通知、文件交付与HTTP接口，排除3个可视化入口。200核心模块保留，5个明确适配，逐文件映射见source-manifest.json。

NativeTools在副作用前持久化调用意图，提交结果后再推进模型，保留取消排空、单调权限、PTC顺序审计及恢复不重放。通用LLM桥、DSH scope/schema、进程/jobs/sandbox后端、附件/凭据和工厂仍在，不能视为完整Pi原生实现。

本轮711项独立测试通过，1项Windows专属跳过；含真实本地三种模型协议、CLI重启、任务恢复及获准在外层执行器之外执行的原有应用沙箱。无真实钉钉、供应商模型或业务系统验收。完整证据与历史阶段限制见VALIDATION.md和validation-results.json。此前GitHub推送dry-run被403拒绝，未重试、未创建远端PR、未合并或部署。

后台任务注册表后续已由 NativeJobs 接管，保留owner/作用域访问、限额、输出游标、终态通知与取消排空。最新719项独立通过/1 Windows跳过，纯生产依赖54项重复验证；生产直接DSH包54个。进程与沙箱后端仍保留，PR仍属未完成迁移草稿。
