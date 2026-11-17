# 渠道崩溃后的安全自动恢复

## 目标与已知事实

修复进程内存耗尽等非正常退出后，遗留空 contexts 锁与已接纳 Router 批次的未配对 resident_router_settle 阻断接收的问题。不扩大到 OOM 分配根因、未知外部效果、镜像发布或生产部署。

实现基线 98648cd84130f069bd4c52add10dacf2ba095f58。开工时 tracked 工作树干净；本轮首次 fetch 因 GitHub 连接失败，远端最新状态尚未核实，交付前再核对。现场私有资料不入库，通用回归复用仓库隔离测试。

## 取舍

1. 通用锁超时抢占、未配对工具自动重放：拒绝。无法证明活跃写者退出，也无法排除已发生的外部效果。
2. 全量替换跨平台锁协议或引入新恢复账本：不采用。影响所有维护/会话持有者，超出两个已证崩溃点，现有安装租约与 SQLite 幂等事务足够。
3. 采用现有权威边界内的窄恢复：Host 成功取得独占安装租约、通过 restore pending 检查后，在任何渠道写者启动前仅清理同 UID、非链接、真实空的 contexts.json.lock。通用 acquireLock 继续对未知空锁关闭失败；非空锁由既有 owner 校验处理。

Router 仅对原已接纳批次中唯一未配对 resident_router_settle、精确原 eventIds、原 operationId 进行纯 SQLite 对账。检查当前会话/generation/渠道目标、原输入与账本视图；禁止并发模型回合，拒绝其他未结工具、错误工具结果、外部效果或未知作业。复用原业务幂等键完成或读取既有事务，追加真实 toolResult 并严格提交；不生成 assistant、成功通知或外部效果收据。关闭旧 handle 后由 Pi 正常重开同一 session，以官方历史重建上下文，保留原前缀与唯一 owner。

已经结清而未写 toolResult 的批次，下一次有待处理事件、打开原 Router 时同样先对账再接纳新输入；不为了检查空闲会话强行加载所有 Router 历史。若原事件/版本不再匹配且无原提交收据，保持 fail-closed。

## 修改与验证

- 修改 Host 启动的 contexts 空锁回收、官方 Pi factory 的 Host-only 结清对账及 Router 生命周期调用；不改 schema、不加依赖、不放宽普通续办守卫。
- 复用真实 Host/SQLite/Pi/本地脚本模型夹具，覆盖事务提交前中断、提交后结果前中断、再次冷启、新来源处理、原前缀及通知禁重放。
- 反例覆盖活跃安装持有者、非空/不安全锁、错误或其他未配对调用、来源版本变化和跨批次参数；保持正常 aborted/operator 续办与当前权限规则。
- 先跑修复前失败用例，再跑相关 Host/Router 回归、pnpm check 及按影响需要的 routing 检查。测试全部隔离，不发真实消息或触发 CI。
