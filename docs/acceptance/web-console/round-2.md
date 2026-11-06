# Web 控制台第二轮验收

日期：2026-11-07。结论：本机可选 Web 实现及本轮修复已验证；没有未解决的 Web 用例失败。默认核心套件的原始失败与定向修复结果分别保留，不声称最终代码又完整重跑了默认套件。真实厂商、Linux 专项、公网及部署不在本轮验收结论内。

## 源码与边界

- 最新远程基线在最终取证时仍为 `origin/worktree-resident-conversation-routing@d27350972df888bf864186eabe64513c12460382`。
- 隔离分支 `worktree-night-bot-web-console`。验证时为未提交工作树；随后提交只封存这些源码及文档。
- 最终 `packages/web-console` Git subtree：`8f8e2ffd72e09059cfeae3297d47a04bf60b7f3f`。Windows 定向修复测试 blob：`3c1308a779c57b1d1a4c6c966f5ddbd521eef60e`。这两个对象绑定实际验证源码，不受后续文档回填影响。
- `git ls-files -s -- packages/web-console test/pi-native-process.test.js` 的 UTF-8 输出 SHA256 为 `1cf17b45e6474eba41b47aa52b9c4358dc1d8e10a72a20d011b528fd5e29c032`，共 34 个文件。
- 核心运行源码、schema、根 package/lock/workspace 均无 diff。唯一既有测试改动是 Windows 环境变量大小写断言；主检出原有其他会话的四处未提交改动保持原样。
- Web 是独立依赖/构建的可选渠道插件；启用后与 Host 同进程，不宣称独立进程故障隔离。不启用 Web 的默认 Bot 回归不加载该包。

## 实跑结果

| 检查 | 实际结果与可断言范围 |
|---|---|
| 独立包 `pnpm install --frozen-lockfile` | 通过，pnpm 11.25.0；独立锁文件可复用，未改变根依赖 |
| 独立包 `pnpm build` | TypeScript + Vite 通过；最终 JS 416.59 KB / gzip 128.18 KB |
| `node --test packages/web-console/test/*.test.js` | 21/21，0 fail / 0 skip，11.14s |
| `pnpm --dir packages/web-console test:browser` | 最终源码完整 14/14，45.4s；真实插件 HTTP/SQLite，浏览器 Edge，Bot/Pi 行为使用显式隔离 fixture |
| 无障碍 | 浅色、深色各 5 路由 axe WCAG AA 均 0 violations；键盘、390px 导航、焦点恢复、IME 和 reduced motion 均可操作 |
| premium strict | 0 errors / 0 warnings；结果见 `round-2/premium-audit.json`，其中本机 projectRoot 已归一成仓库相对位置 |
| 根 `pnpm test` 原始完整执行 | 1206 tests：1179 pass / 1 fail / 26 平台 skip，1643.83s；唯一失败为修复前 `assert.ok(env.PATH)` |
| 修复后 `node --test test/pi-native-process.test.js` | 4 pass / 0 fail / 3 平台 skip，2.60s；全部该文件场景通过，未重跑其他已通过且未修改的文件 |
| `pnpm check` | source/hash/import/native guards 通过：194 retained modules，404 production/runtime JS，external SDK imports 0 |
| Git 与运行清理 | `git diff --cached --check` 通过；3081/3082 本任务预览停止，隔离数据及旧轮截图清理；工作树不包含构建、依赖、真实凭据或运行数据 |

设计 token 文档检查保留 11 条未引用镜像 token 提示，CSS 是 token 权威；这不属于 strict 错误，也不替代浏览器验证。

## 关键业务与反例

1. **真实 Host/Pi 接入**：插件发现后、应用恢复前即注册耐久传输；HTTP 入站等待 ready。真实官方 Pi 脚本分诊产出 core `delivered` 后，浏览器 API 回读到回复；同 requestId 重启不重复推理/发送，prepared 通知沿原 ID 恢复。
2. **真实任务执行上下文**：真实 `task_result` 完成任务后，读取用户原文、工具调用与返回；任务/会话伪造、超大分页、旧 revision 均拒绝。读取及 Web 关闭前后 journal 字节不变，模型请求数不增；不把任务补充留言当执行历史。
3. **接纳状态**：真实 HTTP POST 回执丢失后只读核对、不重复发送；新增三项明确的协议 fixture 覆盖 `202 pending/accepted:false`、失联后 pending→rejected、pending→accepted。pending 保留草稿和发送锁，明确拒绝恢复编辑，明确接纳才清草稿，每项只有 1 次 POST。
4. **任务阻断**：核心继续返回 `{executions, operations, legacy}`；Web 只投影 `{kind,id,title,status}` 及必要展示标记。三类非空记录、稳定匿名 ID、拒绝错误形状和敏感字段不下发均实测。真实 Host 同时断言核心对象不变、Web 空数组正确。
5. **页面能力**：登录/退出、草稿、侧栏会话、任务筛选分页与详情、只读渠道聊天、未知投递、空状态、失联/重连/登录过期，均完成浏览器检查；配置启用不冒充厂商已在线。
6. **安全边界**：令牌掩码、不进 URL/localStorage；HttpOnly/SameSite cookie、CSRF、跨源及 DNS rebinding 拒绝、固定服务端身份、受控路径/硬链接拒绝、未知发送重启不重放；Markdown 不执行 HTML，不自动加载第三方图片。

## 本轮修复与验证解释

第一轮审查发现的 pending 误判和 blockers 对象/数组错配均已修复，并新增有针对性的服务端/浏览器用例。先通过聊天定向 5 项，再在最终源码完整执行 14 项，不用局部通过代替最终浏览器整套。

根默认套件使用项目既有串行 runner，启动时仍是原 Windows 测试。失败可单独复现：`scrubbedParentEnv()` 返回键 `Path`，值与进程 PATH 相同，旧测试读普通对象的 `env.PATH` 得到 undefined。仅修测试按操作系统识别键，并额外断言值精确相等；敏感变量清理断言保留，运行实现不变。完整原始结果为失败，修复后的充分复验是该文件全量通过和 guards 通过。

## 最终证据与未验边界

本轮附件已在第三轮最终证据落盘核对后清理，下面链接仅保留原轮次归档位置及结果追溯。最新可查看截图见 [第三轮](round-3.md)，不把新截图冒充本轮原图。

最终截图：[桌面首页](round-2/desktop-overview.png)、[对话](round-2/chat.png)、[任务](round-2/tasks.png)、[执行信息](round-2/task-detail.png)、[执行上下文](round-2/execution-context.png)、[阻断记录](round-2/task-blockers.png)、[渠道](round-2/channels.png)、[渠道聊天](round-2/channel-chat.png)、[手机对话](round-2/mobile-chat.png)、[手机任务](round-2/mobile-tasks.png)、[深色](round-2/dark-chat.png)。截图为隔离样例，不是线上数据。

第一轮图片/JSON 已逐项删除，第一轮文字报告与 matrix 历史保留；浏览器中间 trace 和测试数据已清理。参考克隆 `docs/tmp/boardui-reference` 的递归删除被自动审批拒绝（仅返回 `blocked by policy`），它仍在 Git 忽略目录，不纳入交付源码。

未单独完整运行 runtime/routing/containment 专用套件；26 个默认平台条件跳过未计作通过。本机测试不能证明 Linux 沙箱、真实模型供应商、DWS/其他厂商送达或公网多用户安全。未合并、未部署、未发真实消息；Actions workflows 查得 0，未主动触发 CI。启用、升级与禁用操作见 [运行说明](../../ops/web-console-local.md)。
