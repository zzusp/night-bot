# 第二轮：已合并发行与真实接收恢复

## 结论

2026-11-12 12:24（UTC+08:00）真实安装恢复成功。原失败渠道与另一启用钉钉渠道均为 listening/receiving、connected=true、error=null，原暂缓记录由正常补拉消费结清。原 v1 正文保留，编辑后的 v2 已独立入账并 routed；没有手工清游标、注入原消息或重放旧任务。

## 实际版本与发行

- PR [#77](https://github.com/zzusp/night-bot/pull/77) 独立 gh 回查：MERGED，mergedAt=2026-11-12T04:12:28Z，merge commit `a691993dd1d34ddb91c7ffbef185c0cc4c286163`；包含性能 PR #76 的 `485f100`。
- 实际独立发行目录 basename：`night-bot-release-dingtalk-revisions-20261112`；该检出的 HEAD 与 metadata、监督器、launcher、worker 命令行均绑定上述合并 SHA。发行工作树干净，src/packages/test 与第一轮受验代码 `8591e33` 无差异；本轮不重复无关本地测试。
- 首次检出前设 core.autocrlf=false/core.symlinks=false。发行及 Web 各自 frozen-lockfile 安装通过，Web tsc/Vite 构建与发行 pnpm check 通过；425 文件、190 保留/10 退休/59 适配，导入闭合、外部 SDK/旧编排定义均 0。构建有既有 bundle>500kB 提醒，不影响成功，未顺手改前端。
- 唯一 channelPluginDirs 已受控替换为新发行 packages；启用实例、模型/权限/身份与其它配置保持原样。没有第二份同类型插件，core 和 Web 插件不再指旧发行。

## 正常排空与安全切换

第一轮检查后，另一维护会话曾正常启动 b030ada。首次离线保存因此被 NIGHT_DATA_IN_USE 正确拒绝，配置没有部分写入；没有删锁或绕开保护。确认该会话已结束、无在途维护且不会再重启后，重新核对 metadata 与 7/7 completed+drained，再走当前实例的原监督器 IPC。

- 停机包装先 --check，effects=0；随后原监督器发送 night-bot-shutdown。等待真实监督器退出，原 supervisor/launcher/worker 三 PID 均不存在，日志 stopped/code=0/signal=null，metadata 正常消失。
- 目录替换先 --check（仅 channelPluginDirs、effects=0、插件发现通过）；正常排空后持同一离线 Host 锁，通过 updateConfig 保存。独立读回确认新路径且原 data/实例仍在。
- 新监督器 --check：源码 SHA/干净检出/依赖/构建、空闲端口、loopback、既有模型引用、显式 full 均通过，effects=0，才启动。full 使用原显式配置，未提升管理员权限，不宣称保留 OS 沙箱。
- 不创建备份，不删除旧备份，不复制凭据，不覆盖/回滚记忆维护结果，不改 SQLite、Pi journal 或 ingress 水位文件。

## 真实终态证据

| 验收 | 实际观察 |
| --- | --- |
| 运行进程 | supervisor 56548 → launcher 135128 → worker 129424，均从新发行启动；健康端口和 Web 端口由该 worker 承载 |
| Host | health=status ok / transport channels / modelMode real / recoveryIssueCount 0 |
| 认证 Web 渠道 | 两个启用钉钉渠道均 connectionState=listening、connected=true、ingress.state=receiving、ingress.errorCode=null、liveApplied=true、restartRequired=false；认证后真实 GET，非缓存旧卡片 |
| 实际订阅 | 两个 dws.exe 监听命令均携带 message,recall；不是仅 fake adapter 参数验证 |
| 原接收界 | paused=false，deferred=0、pendingRecalls=0，backfillThroughAt 已从原界正常推进到 2026-11-12T04:24:32.587Z，consumedAt 单调推进；没有人工删记录 |
| 原冲突来源 | 同消息 v1/v2 均在；v1 正文 SHA-256 与部署前独立快照一致，v2 正文 hash 不同且同作者，二者 routed=true；旧事实未被改写 |
| 业务与数据库 | 原 7 个任务均 completed+drained，无重建任务；33 条通知均 delivered，SQLite quick_check=ok。未额外发测试业务消息，正常历史接纳仍依原渠道配置处理 |
| 真实 Web 构建 | GET / 的 HTML 与本次 dist/index.html 完全相同；JS 577344 字节，SHA-256 984d91f9fddc649e359b94b318eb51e309996c4d30bd43f7a2f96c6149e81580；CSS 91134 字节，SHA-256 3f68118e793196b54ddfdd850656ca96c376d51ecba2b83a077a1d537109e0cb；实际响应逐字节匹配发行文件 |

必要私有证据保留在安装 data/logs 的 dingtalk-message-revisions-before.json、dingtalk-message-revisions-after.json、新旧监督器日志；它们不入 Git。本页自包含部署版本、结果与必要文字摘要，不公开账号、消息正文/ID、配置或凭据。第一轮历史失败与复验保留，不以此轮覆盖。

## 边界

实际编辑冲突已通过原历史补拉恢复验收。没有为验收去编辑或撤回真实业务消息；撤回的真实身份/墓碑/中断/撤权语义由第一轮真实 Host + fake DWS 回归证明，本轮额外证明实际供应商监听已包含 recall，不宣称已收到真实撤回事件。未收到明确 recall 的离线缺项仍失败关闭。

没有全量 runtime/containment 通过声明，也没有 Windows 默认受限模式通过声明。升级保留现有 data，没有匹配离线快照时不承诺新格式的无损回退。
