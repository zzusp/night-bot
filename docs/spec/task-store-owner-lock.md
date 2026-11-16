# 任务账本进程占用锁

## 问题与目标

旧实现将 owner 保存为 PID 与随机 token，恢复时只检查 PID 是否存在。容器重启复用旧 owner 的 PID 时，会错误拒绝唯一的新 Host，形成 DYNAMIC_STORE_ALREADY_OPEN 重启循环。隔离真实子进程回归已复现两条失败：存活写者的 PID 元数据失效时第二写者被错误接纳；旧写者异常退出且 PID 被占用时新写者被错误拒绝。即时运维恢复应通过原版本 openDynamicTaskStore/close 在无任何 workload 写者时完成，不直接修改 owner、不重放副作用。

## 方案比较

1. 只放行 previous PID 等于当前 PID：无法覆盖 worker/模块副本和真正的竞争写者，拒绝。
2. 记录 Linux boot/starttime：已有 Pi 锁可参考，但仅修 Linux 且旧记录仍无法证明身份，不作为本次新机制。
3. 复用 execution-store-worker 已有的独立 SQLite BEGIN EXCLUSIVE 锁：OS 在连接或进程退出时自动释放，跨 Node 进程/worker 生效，不阻塞业务 WAL 读者。采用。

## 合同

- task 主库旁以规范路径创建 .owner.sqlite，持有整个 store 生命周期的 OS 锁；不删该文件，不按超时驱逐。
- 新 owner 保留 PID:opaque-token 结构，token 带 sqlite-exclusive-v1 前缀；只有带该标记的前任由已取得的 OS 锁证明已退出。
- 未标记的旧 owner 仍执行原 PID fail-closed 检查；不为了兼容而抢占旧版本的活写者。旧残留 owner 的运维恢复需先完全停止原 workload，再由原生 store 生命周期核实失活并清理。
- 事务 incarnation fencing、安装身份、schema、原任务/效果 unknown/no-replay 保持。新 owner 锁不能替代这些检查。
- 混合版本、共享网络文件系统和恶意替换锁文件不增加支持承诺；部署继续单副本 Recreate 与原本地 SQLite 文件系统。

## 验证

本地真实子进程竞争、异常退出与 PID 复用、原 incarnation fencing、失败打开后的锁释放；来源/hash/import 守卫。UAT 服务恢复独立使用原镜像，不将未合并源码装入云端。代码发布前仍需合并与正式镜像流程。
