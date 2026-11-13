# 第 1 轮：合并批次复查与刷新修复

## 范围与实际版本

复查 b030ada..39dde8f 的 14 个合并 PR，清单见 goal.md。覆盖渠道、Router/任务、Pi 资源、记忆迁移/学习、自进化缓存、反馈与 Web 路径；结论限于实际审阅和实跑，不证明不存在其他问题。

生产修复：210b52164c8fbdbc252fea91d99358be2c9214b9，基于 39dde8f9976876acb3ea0a35f07889ab343a4cb9。最后增量仅为来源补充测试断言与验收文档；复验后的 test/task-session-service-native.test.js Git blob 为 e7f5d2d909bb18dd768548240216e5d9f39da750。后续提交不改变生产源码，最终提交号从 PR 读取，不循环回填自身 SHA。

整批测试开始于修复中的工作树，各文件按启动时版本加载，不能用最终 HEAD 代表整批版本。全部业务测试使用隔离目录、脚本/本地模型与 fake 渠道；真实安装未替换，未发送真实测试消息、创建备份或重复迁移记忆。

## 确认的生产缺陷

1. Windows 旧缓存强刷失败。页面曾 HTTP 200，但 stale=true、refreshing=false、error=EVOLUTION_CACHE_REFRESH_FAILED，数量仍旧。原生三组对照中，仅持有旧目标读句柄时 rename EPERM；临时读句柄和无读者均可替换，排除临时读者与 DTO 格式解释。evolution-cache.js 发布临界区暂停新页、等在途读者归零、关闭旧目标后 rename；失败只重开身份/大小/mtime 相同且仍安全的旧文件，否则拒读。保留 version 2、原上限、哈希、独立正文授权及鉴权撤销，不 unlink 旧文件或盲目 retry。新增冷启动连续强刷和真实外部占用失败后恢复回归。
2. 解除归档重排游标。真实 SQLite 旧事件从 sequence 1 变成 3，保存游标后的消费者再次读到历史，nextCursor 改变。task-archive.js 仅为 task_events 恢复原 sequence，其余表仍按 ID 恢复。回归先红后绿，解除前后全量/增量 events、nextCursor 及重启结果相同；不导入 JSON 命令或重放历史。
3. 反馈截断泄漏。合成密钥跨 48000 边界时，旧实现先截断导致完整替换失配，留下 opaque-。redaction.js 改为完整脱敏后裁剪，并增加邮箱 token 起点避免长普通文本无 @ 时反复回溯。新回归先红后绿，同时断言输出恰 48000、无密钥前缀、有脱敏标记。不承诺任意自然语言都可安全公开。

## 初轮结果与失败收口

整批命令在本机 Bash 执行：

```sh
files=$(git diff --name-only b030ada..39dde8f -- 'test/*.test.js')
node --experimental-test-module-mocks --test --test-concurrency=1 $files
```

宿主 brtdia9kv 最终为 552 项：519 通过、29 失败、1 取消（preflight 超时）、3 平台跳过，exit 1，约 65.5 分钟。保留该失败结果；仅按责任组复验，未完整重跑最终 552 项。

| 初轮问题 | 最终处理与证据 |
| --- | --- |
| 正文/反馈文件 symlink 在 Windows EPERM | 平台专属用例独立跳过；普通 hardlink/大小/脱敏仍实跑；Linux 36 项 0 跳过覆盖真实 symlink |
| reflection contention/keys/末两项 reflection 清理 SQLite EBUSY（含失败父级汇总） | 夹具先排空 Host、关闭外部 Store，再删除目录；keys+contention 两文件 25 项通过，整个 reflection 文件在最终 62 项中通过 |
| Router preflight 120 秒超时 | 闸门误冻结并发任务准备，taskEntered 无法到达；改绑实际 preset Skills 与 Router actor，Windows 全部 7 阶段通过，preflight 约 19.5 秒，预算和生产行为不变 |
| 3 个来源补充用例期望两轮任务，实际一轮 | 脚本发 supplement，当前合同要求保存补充并保留等待。验证准确来源、contextRevision、humanRequests 完全不变、无额外回合及重启不重放；Windows/Linux 各 3 项通过 |

来源问题比较三种解释：遗漏调度、来源未落库、过期断言。工具说明与 docs/CHANNELS.md:112 明确 supplement 保留等待，不能恢复旧隐式唤醒；真实 Store 断言证明来源/作者/原文/sourceRefs/supplements 均落库，排除来源丢失；脚本未发 resume 却要求第二回合，确认为旧断言。没有修改生产调度、来源鉴权或问题结清规则。

Web 初轮 266 项：261 通过、3 失败、2 跳过。一次高负载 inventory EVOLUTION_BUSY 后独立完整 12 项通过，未改生产重试；两处任务未初始化按真实 begin/finish 协议补齐，不伪造 ready。共享记忆后续触达原 45 秒上限；阶段日志显示正常持久 IO 在 learned 阶段已耗时约 33 秒，Linux 全路径约 13 秒。采用项目既有 nativeTestTimeout Windows 系数后全路径约 58 秒通过，未放宽断言。

## 最终实跑

| 验证 | 结果及边界 |
| --- | --- |
| pnpm check | 通过；190 retained modules、437 production/runtime JS，来源/哈希/导入守卫不放宽 |
| Web build | 通过；本轮前端实现未改，不因文档/测试增量重复构建 |
| Windows 缓存/inventory/session-host/shared-evolution/reflection/archive | 62 项：60 通过、2 平台跳过，0 失败/取消；含真实 HTTP 登录/强刷及冷启动统计 |
| Windows reflection keys/contention | 两文件 25 项通过；所属 28 项命令另有 session-host 2 通过、shared 1 超时，后者已在最终 62 项中通过，不把旧命令 exit 1 写成成功 |
| Windows Router handoff-performance 完整文件 | 7 项全部通过，0 跳过/取消 |
| Windows 来源补充三变体 | 3/3 通过，持久来源/原会话/重启去重核验 |
| Linux feedback/evolution-content/archive 完整文件 | 36 项全部通过，0 跳过，包含真实文件 symlink |
| 缓存完整文件 | Windows 28 通过、2 跳过；Linux 29 通过、1 Windows 专属跳过，各共 30 项 |
| Linux 来源补充三变体 | 3/3 通过 |
| Playwright 7 个相关 spec | 47 全通过；实际启动 Web 插件，业务数据为 fixture，不代替现用安装验收 |

Windows 最终组合命令：

```text
node --experimental-test-module-mocks --test --test-concurrency=1 packages/web-console/test/evolution-cache.test.js packages/web-console/test/evolution-inventory.test.js packages/web-console/test/session-host.test.js packages/web-console/test/shared-evolution-runtime.test.js test/pi-reflection.test.js test/task-archive-store.test.js
```

Router 完整文件、来源三变体分别执行 node --experimental-test-module-mocks --test，加 test/pi-router-handoff-performance.test.js 或 --test-name-pattern="Router supplements only the admitted source" test/task-session-service-native.test.js。

Linux 使用本机已有 headless-39dde8f 镜像、node 入口、network none、只读挂载本 worktree 的 src/test/packages 至对应源码路径，依赖来自镜像，数据在容器临时目录。没有构建/拉取或替换正式镜像，不挂生产 data。首次缓存独立测试只挂工作区，模块不依赖原生扩展。

浏览器覆盖 evolution、evolution-update-toolbar、evolution-initial-load、evolution-list-layout、schedules、task-progress、execution-scroll。已查看并保留 round-1/evolution-light-390.png；SHA256 为 baf4878062a84751db7f0078c66cdc12ba413902eed04d80592024c846cdb836，fixture 截图仅证明所示 390px 页面渲染。

## 跳过与真实阻断

- 整批初轮 Windows 跳过 3 项：POSIX chmod 操作者 token 权限、Linux process-group 忽略 TERM、Linux portable model-process namespace 下的真实取消。本轮未补跑这三个独立 Linux 功能，不宣称完整 Windows 受限执行已通过。
- 缓存/正文/反馈的 symlink、POSIX 权限、Windows 外部占用等专属用例分平台报告；适用边界实跑，不把跳过当通过。
- 现用实例只读核验仍为干净 39dde8f，Web/resident HTTP 200；resident 保留既有 degraded 与 1 项恢复问题，不据端口可用推断健康或送达。
- 未获合并修复 PR 的明确授权；正式部署要求已合并版本，故未合并、未替换发行，实际安装页面 fresh 终态尚未验收。PR #96 不代表本地修复已生效。
- 原整批命令仍记录 FAIL；其全部失败/超时责任组已复验收口，不声称最终完整全量全绿，不新增 report.md。

## 产物与收尾

本轮报告和 matrix.csv 保留初轮结果与最终复验，截图仅保留上述最终证据。已在 --check 零副作用自检后统一清理 23 个本任务失败夹具目录和中间截图目录，独立复核 identified=26、present=0（另外两个已不存在）；最终截图已独立核对 SHA256。不清理其他会话、现用 data、进程或工作树。原始测试输出继续由宿主管理，不将带本机路径的整段日志入库。
