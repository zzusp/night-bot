# Web 控制台第三轮复查

日期：2026-11-07。用户要求进一步检查、优化和完善。结论：本轮已复现问题均修复，最终服务端 24/24、浏览器 27/27 通过，必要构建及源码边界检查通过。

## 验证版本与范围

- 本轮起点 `9fef605c9a212367ba2ccdf65b708affa01cb49f`，分支 `worktree-night-bot-web-console`，沿现有 [PR #3](https://github.com/zzusp/night-bot/pull/3) 更新。
- 最终 fetch 的 base 仍为 `origin/worktree-resident-conversation-routing@d27350972df888bf864186eabe64513c12460382`。
- 实跑绑定未提交工作树；最终 `packages/web-console` Git subtree 为 `1324cceb46fefeca76cb92c87290c111bc09fd32`，随后提交封存相同源码。构建的 `dist/index.html` 独立读回引用 `index-B6W-Weny.js`，CSS 为 `index-Drg-spdh.css`。
- 本轮仅改可选 Web 包和文档。Bot 核心、schema、根依赖、既有核心测试均无增量；不为展示新增底座字段，不变更 Web SQLite schema。原有 500 条聊天历史展示上限保持。

## 已复现问题与修复

| 问题与证据 | 修复与反例验证 |
|---|---|
| 未知发送切页再返回：输入框禁用，但核对按钮为 0；在途发送卸载重挂载后仍停在“发送中” | 同一对话共享可订阅草稿、请求和提示；按 requestId 更新。切页/重登后保持核对入口，明确接纳才清草稿，原消息只有一次 POST |
| 新对话回执延迟，切到任务后被抢回旧聊天；A 在途会阻止 B 发送 | 导航只作用于仍挂载且匹配的页面，Composer 按对话隔离。等待指定迟到响应 `finished()` 和渲染帧后断言原路由保持、B 可独立发送 |
| 新登录 `/session=200` 后旧 POST 的 401 使 UI 再次退出 | 请求绑定认证代次，旧 401 不撤销新登录；重登前后的原草稿仍可核对。消息缩进和末尾换行不再被 trim 改写 |
| 退出回执晚于重登，旧 Set-Cookie 清掉新 cookie；多标签换 cookie 后旧标签一直 403 | 退出结束前不进入重登态；CSRF 失配只读同步会话，保留内容且不自动重发。退出替换草稿容器，旧回执无法恢复已退出草稿 |
| logout 期间旧 401 留下标记，随后 logout403→只读同步 session200，却仍误退出新会话 | 新会话同步成功同时清除旧过期标记。精确延迟真实 overview401/logout403 回执，修复前掉回登录页，修复后保留已同步会话及显式重试提示 |
| 初次任务/渠道/聊天读取失败，同时显示成功空态；概览 channels/conversations 抛错导致整页 500 | 空结果与不可读分开；概览五区块各自收敛，局部失败明确标注，其他真实区块继续显示，单一恢复入口可用 |
| 390px 消息区域宽 358px，却因长发送者名称出现 scrollWidth1140 | 元数据和长标识换行，代码块仅自身横向滚动；未知发送者不冒称“你”，未知渠道类型不冒称单聊；补齐阻断状态中文及“执行尚未开始”提示 |
| 任务结果/时间线采用递归黑名单，新嵌套 artifactFiles、localPath、参数或 credential 字段仍可能穿透 | 显式选取现有展示字段并脱敏已知凭据/私密路径，业务摘要不静默截断。真实 Host 断言 Bot 原始 evidence 不变、HTTP 展示字段已过滤 |
| 固定同毫秒先 z-first 后 a-second，旧标题返回“第二条消息”，最新状态受随机 ID 影响 | 标题/最新接纳状态按 SQLite 插入顺序；同时间用户先于回复，各表内顺序稳定，包含时钟回拨和重启 unknown 回归。不宣称同毫秒跨表完整因果排序 |

只读复审曾主动寻找 useResource 旧结果回写反例，未发现确定问题，其取消与单在途轮询实现保持。没有增加并行模型链、任务调度或通知重放逻辑。

## 最终实跑结果

| 命令 / 检查 | 实际结果 |
|---|---|
| `node --test packages/web-console/test/*.test.js` | 24/24，0 fail / 0 skip，16.34s；真实 Host/官方 Pi 脚本端点集成、重启回执和只读 journal 断言保留 |
| `pnpm --dir packages/web-console typecheck` | 通过；最终 build 再次执行相同 TypeScript 检查 |
| `pnpm --dir packages/web-console build` | 通过；JS 419.54 KB / gzip 129.07 KB，CSS 37.75 KB / gzip 7.64 KB |
| `pnpm --dir packages/web-console test:browser` | 最终完整 27/27，runner 显示 1.6m，exit 0；原业务/视觉 18 项 + 聊天/认证生命周期 9 项 |
| axe / 视觉 | 浅色和深色各 5 路由均 0 violations；390px 长内容、来源标签、键盘工具展开、上翻后新消息不拉走与回到底部验证通过 |
| premium strict | 0 errors / 0 warnings；JSON 中 projectRoot 归一为仓库相对路径，不改变 findings |
| `npx --yes -p @google/design.md designmd lint docs/acceptance/web-console/DESIGN.md` | 0 errors / 11 个原有镜像 token 未引用 warnings，CSS 仍是运行时权威；没有新增依赖 |
| `pnpm check` | source/hash/import/native guards 通过：194 retained modules、404 production/runtime JS、external SDK imports 0 |
| Git / 清理 | 最终 `git diff --check` 通过；测试监听 3081 已退出，隔离 fixture 已自动清理；旧轮附件清理见下文 |

本轮先完成 26 项，随后补入上述最后一个认证交叠反例，修复前失败、修复后定向通过，再重新完整运行 27 项。该反例初版因侧栏并行刷新提前触发另一个 401，随后在测试中固定侧栏只读快照以控制待测事件顺序；未替换待测的真实 overview/logout/session 响应，也未放宽断言。

## 证据与边界

最新最终截图共 13 张：[桌面首页](round-3/desktop-overview.png)、[聊天](round-3/chat.png)、[任务](round-3/tasks.png)、[详情](round-3/task-detail.png)、[执行记录](round-3/execution-context.png)、[阻断](round-3/task-blockers.png)、[渠道](round-3/channels.png)、[渠道消息](round-3/channel-chat.png)、[手机聊天](round-3/mobile-chat.png)、[手机任务](round-3/mobile-tasks.png)、[手机长渠道消息](round-3/mobile-long-channel.png)、[手机长执行记录](round-3/mobile-long-execution.png)、[深色](round-3/dark-chat.png)。均为隔离样例，不是生产数据。第一、二轮文字报告和 matrix 历史保留；旧轮截图/JSON、失败 trace 和临时测试产物已清理，仅保留第三轮最终证据。

本轮未重复跑无核心增量的根 `pnpm test`、完整 runtime/routing/containment。第二轮默认核心原始结果及 Windows 测试断言定向修复详见 [第二轮](round-2.md)，不能把历史 26 条平台 skip 计作本轮通过。未接真实厂商/真实模型、未合并、未部署、未主动触发 CI。

独立包启用后仍与 Host 同进程，只支持本机操作者；不声称公网、多用户、进程故障隔离或无损全历史浏览。本轮未重试此前被自动审批拒绝的参考克隆递归删除；旧克隆仍位于 Git 忽略的 `docs/tmp/boardui-reference`，不纳入提交。
