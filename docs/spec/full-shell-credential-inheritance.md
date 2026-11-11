# Full 工具进程继承部署凭据

## 目标与证据

用户于2026-11-11要求修复OSS凭据不可见并沿既有合并发布流程验证。生产Pod及应用主进程中两变量存在且非空，任务bash/Node中缺失；只读取证未输出密钥。实际链为已授权shell → memory/privacy最终spawn包装 → subprocess的scrubbedParentEnv。现有full仅在最终边界单独补回GITHUB_TOKEN，其他部署业务凭据没有等效路径。

## 方案取舍

1. 全局移除scrubbedParentEnv过滤：拒绝，会扩大普通进程及受限模式的ambient秘密继承。
2. 增加OSS变量名专例：拒绝，不能解决同因的其他业务系统，也把通用工具绑定厂商。
3. 复用现有Host授权边界：采用。仅正式绑定direct/full的bash/pwsh在最终spawn前继承可信启动进程快照的业务环境，仍排除NIGHT_BOT_/DSH_私有执行命名空间；显式调用环境覆盖保持，GitHub凭据服务既有优先级保持。仅补回底层按敏感名称清理的变量，普通环境和既有代理覆盖不变。普通进程、非shell工具及ask/auto继续原过滤/隐私策略。

## 实现和边界

现有不可变launchEnvironment增加按来源枚举能力，沿process来源取值，不读任务目录的dotenv、不把函数参数当环境变量。privacy包装在Job描述与工具参数冻结后才构造目标环境，不把凭据复制到配置、任务JSON或历史；底层Linux临时launch文件仍可能短暂承载环境并消费后删除，不能声称绝不落盘。full不是管理员，也不保证同账号Host秘密的OS隔离；应用授权、scope、审计、取消与无重放不变。

## 验证

先让现有正式full任务回归在旧实现复现非GitHub凭据缺失，再验证修复。实际shell只输出假凭据哈希匹配布尔值；检查工具参数、Pi历史和持久Job不含原值；涵盖通用非OSS秘密及私有namespace不继承。复用默认Host及真实进程，而非仅测试新枚举函数。对普通子进程、非full隐私路径和来源快照执行最小回归与pnpm check。正式镜像沿已合并SHA构建，云端更新保留原卷和所有配置，再由Router续原会话做签名只读核验，不直接替任务修改ledger或输出真实密钥。
