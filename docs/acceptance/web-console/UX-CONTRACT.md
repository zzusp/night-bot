# Web 控制台交互合同

设计见 [DESIGN](DESIGN.md)，源码中的 `packages/web-console/src/styles/boardui.css` 是视觉 token 唯一来源。按仓库产物规范，设计与本合同集中在本目录；静态审查使用此目录作为合同根，显式扫描 Web 包源码。

## 业务依据

| 依据 | UI 后果 |
|---|---|
| 用户要求、`docs/spec/independent-web-console.md` | 三个入口：对话、任务、渠道；可选插件，无核心展示字段 |
| `docs/CHANNELS.md`、`src/channels/service.js` | 身份由认证后的服务端绑定；只有两种渠道会话；已接纳不等于完成 |
| `docs/TASK-ARCHIVE.md`、`src/runtime/pi-journal.js` | SQLite/Pi 是业务权威；展示层不可写任务状态或解码不完整 journal |
| `packages/dingtalk-core/task-session-service.js` | 任务详情、时间线、等待/终态直接投影；每任务单执行会话 |
| `packages/web-console/server/security.js` | loopback、固定操作者、令牌登录、HttpOnly SameSite cookie、CSRF、短期内存会话 |
| `packages/web-console/server/session-view.js` | 执行记录是当前提交的上下文，可能经过压缩；不展示思考、系统指令、工具参数与原始凭据 |

## Canonical UI Map

| Capability | Canonical owner | Source of truth | Allowed variants | Verification |
|---|---|---|---|---|
| Form | `Login` 与 `BoardPrimitives.Composer` | 本合同、服务端请求契约 | token-login / message-composer | browser.spec.ts 登录、IME、未知发送 |
| Scrollbar | `src/styles/boardui.css` 全局样式 | DESIGN | 应用纵向区域 / 表格与代码横向区域 | computed style、窄屏、axe |
| Toast | `Shared.Notice` 与局部 role=status | 本合同 | 持久错误横幅 / 局部复制回执 | browser.spec.ts failure paths |
| CRUD | `api.ts`、`ChatPage` | channels.receive、独立请求回执 | 仅发送对话；其余只读 | server.test.js、host.test.js、browser.spec.ts |

无选择型表格、下拉列表、日期输入、批量或破坏性业务操作，不引入对应控件。

## 导航、状态和数据

- hash 路由的页面标题为「页面 — Night Bot」。任务筛选/页码/当前页查询在 URL，详情有返回入口。未知路由保留侧栏并显示不存在页面。
- 桌面侧栏固定，手机用原生 `<dialog>` 提供焦点约束、Escape 与恢复；页面按钮和链接采用原生语义。
- 应用采用完整高度的聊天工作台。聊天消息区域独立滚动，任务/渠道页在主面板自然滚动；表格自身只负责横向溢出。所有长文、工具结果可访问，不用隐藏滚动条。
- 任务分页 20 条；当前页文本筛选明确标记「筛选当前页」，不伪装全量搜索。群消息和发送记录各自持有分页 revision/游标，旧快照冲突时回到最新。
- Web 会话侧栏分页；单会话最多展示最近 500 条并明确提示截断。原始记录仍在独立账本。执行上下文每页最多 50 条、工具正文可折叠，明确非完整原始日志。
- 无数据、无匹配、初次加载、后台刷新、失败、局部失败、旧数据均有独立状态；不虚构在线、百分比、费用、token 计数。`waiting` 表示「等待中」，涵盖依赖与人工输入。

## 发送、重连和隐私

- 一次发送使用稳定 requestId；确认前不清空草稿，连续操作不重复提交。Enter 发送，Shift+Enter 换行，中文 IME 完成候选不触发发送。
- 只有回执明确 `accepted` 才显示已接纳；HTTP 202 本身不证明接纳，`pending` 保留草稿和发送锁并允许只读核对。断线后先查原 requestId；未知保持待核实，明确未接纳保留草稿；只有已确认无记录才显示使用同一 ID 的重试。禁止自动生成新 ID 重放。
- 后台按快照更新，不伪装 token 流；每资源最多一个在途请求，换页取消旧读，连续失败三次停止自动刷新；恢复焦点或显式刷新重新核对。
- 草稿仅保存在当前标签页内存中，跨页面/登录失效后保留；刷新或关闭标签页不持久化业务内容。主题是唯一 localStorage 项。
- token 默认掩码，可键盘切换显示；不存浏览器持久存储、不放 URL。服务器拒绝跨源请求和浏览器伪造身份。退出清除前端可见缓存。
- Markdown 不接收原始 HTML；外部图片改为显式链接，避免读取消息就自动请求第三方。外链隔离 opener。
- 渠道消息只读。没有任务取消、渠道配置编辑、真实消息代发等越界按钮。

## 访问性与验证

中文文案；日期按浏览器本地时区格式化，原始时间保持 ISO。默认浅色、可切深色，支持 reduced motion/forced colors。按钮焦点可见、图标按钮有中文名称，错误有文字与恢复路径，状态不只靠颜色。

浏览器覆盖成功/失败/空/键盘/中文IME/390px/主题/断线/登录失效/消息不确定发送；axe 检查主要页面。静态规则不代替真实浏览器与 Host/Pi 回归。
