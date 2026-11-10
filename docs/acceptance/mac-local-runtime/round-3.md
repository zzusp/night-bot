# 第 3 轮：实际应用终态与独立失败复现

## 实际应用

使用 `node docs/acceptance/mac-local-runtime/scripts/smoke.mjs`，独立安装 `data/workspaces/mac-runtime-3AjDdA`，真实初始化与管理启动器，无真实厂商调用。原件：`round-3/app-smoke.txt`。

| 场景 | 观察 | 判定 |
|---|---|---|
| 核心 health | ok | PASS |
| Web index 与引用 JS/CSS | 200 | PASS |
| 未登录访问任务 API | 401 | PASS |
| 本机令牌登录 | 200，令牌不输出 | PASS |
| 权限读取 | ask，protection=not-attested/backend=null | PASS：准确报告，非隔离认证 |
| 无命令普通任务 | 真实 loopback 模型与 task_result，completed/drained，Web 任务列表可见 | PASS |
| 有效 bash 调用 | `printf MAC_SHELL_PROBE`；结果 active/drained + blocked，限制为 TASK_EFFECT_UNCERTAIN_NO_REPLAY，无成功输出证明 | **FAIL** |
| 正常管理关闭 | 启动器退出 0，核心及 Web 端口均无法连接 | PASS |

脚本对 shell 失败返回非零，不让其它通过项把整轮“冲绿”。保留失败任务，不清 unknown、不重放、不切 full。源码另显示 `src/memory/privacy.js:65` 仅在 Linux 获取 bwrap，`:97` 在缺失后端时拒绝；这支持 Mac 隔离接线缺口的判断，但本轮实际公开错误是 `TASK_EFFECT_UNCERTAIN_NO_REPLAY`，不能将源码预期错误冒充已观测到底层异常。底层首错如何转为未知效果仍是盲点。

## 两项单独复验

1. DWS timeout identity：1 FAIL，`round-3/dws-targeted.txt`。再次在 `test/pi-channel-plugin.test.js:554` 观察 true != false；失败诊断打印时 health 已变为 false。源码顺序是 `src/channels/plugins/dingtalk-dws.js:95` 先 await 持久化 deferred，再向外抛错；`packages/dingtalk-core/dws-bridge.js:746` await processMessage，catch 才更新 lastEventError 并 publishHealth。读取到持久化文件不证明后续健康更新已经完成，测试同步点早于被断言的事件。第 4 轮修正测试等待点，保留原断言。
2. 32 轮续办：1 FAIL，`round-3/runtime-targeted.txt`。独立运行仍超过 120000ms，另报告 `Native cancellation did not drain owned resources`。保持原业务期限与 32 轮断言，没有按性能问题直接延长期限。确切卡点、是否纯磁盘性能以及失败清理的具体对象均**未收敛**，不能声称该场景完成或资源完全清理。

## 独立守卫

`pnpm check` 退出 0，`round-3/source-guards.txt`：190 retained、10 retired、3 excluded、59 adapted；400 production JS、195 bare imports 已声明；相对导入闭合、HTTP 路由保留、external SDK imports 0、旧编排定义 0。

各组用例有重叠，不与默认组相加为“独立通过总数”。未运行真实厂商模型、DWS 收发、浏览器端到端交互或部署。
