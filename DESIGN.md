---
version: alpha
name: Night Bot Web
description: BoardUI 风格的独立 Bot 对话、渠道与任务控制台
colors:
  primary: "#2563eb"
  primary-top: "#2d6eea"
  canvas: "#ffffff"
  surface: "#ffffff"
  panel: "#f7f7f7"
  text: "#0a0a0a"
  muted: "#686868"
  subtle: "#6f6f6f"
  border: "#ebebeb"
  success: "#166534"
  warning: "#92400e"
  danger: "#b91c1c"
  info: "#1d4ed8"
typography:
  sans:
    fontFamily: "Inter, Segoe UI, PingFang SC, Microsoft YaHei, system-ui, sans-serif"
    fontSize: "14px"
    lineHeight: "1.5"
  mono:
    fontFamily: "JetBrains Mono, Cascadia Code, Consolas, monospace"
rounded:
  DEFAULT: "10px"
  card: "16px"
  panel: "24px"
  pill: "999px"
spacing:
  frame: "12px"
  gap: "16px"
  sidebar: "260px"
  transcript: "768px"
components:
  button:
    height: "36px"
  composer:
    height: "52px"
  sidebar:
    width: "260px"
---

# Night Bot Web UI/UE 设计规范

## Overview

### 文档地位与适用范围

**仓库根目录的本文件是 Night Bot UI/UE 的唯一指导性文档**，统一视觉、信息架构、组件、交互、状态、恢复、文案和可访问性。当前适用于 `packages/web-console` 的所有页面；新增页面沿用本规范。原独立交互合同已合并到本文，不另建平行 UI/UE 规则。

本文规定设计意图与行为约束；源码负责实现，业务/API/权限文档负责领域事实。不能用展示需求改变 Bot 的权限、数据或执行语义。通用设计技能、上游模板和历史截图只作参考；与本文不一致时，先按当前产品要求和业务约束明确差异，再同步修订本文与实现，不以现有代码自动覆盖规范。

| 文档或实现 | 职责 |
|---|---|
| 本文 | 唯一现行 UI/UE 规则与共享实现入口 |
| [premium-ui.json](docs/acceptance/web-console/premium-ui.json) | 指向本文的机器审查配置，不另立设计规则 |
| [使用说明](docs/manual/web-console.md)、[运维说明](docs/ops/web-console-local.md) | 操作者使用、安装和排障，不另立设计规则 |
| [实施前快照](docs/spec/independent-web-console.md) | 保留当时的架构取舍，不作为现行 UI/UE 规范 |
| [验收入口](docs/acceptance/web-console/goal.md)、该目录的 `round-*.md`、`matrix.csv` 与截图 | 指定版本的验证证据，不将历史结果当作当前规范或新版本通过证明 |

### 产品与视觉方向

依据用户指定的 BoardUI 设计。参考固定版本 [BoardUI/boardui@ec5c5eb](https://github.com/BoardUI/boardui/tree/ec5c5eb3e29c2441be63b9422cd54f411ef23466)：`agent-chat.tsx`、`agent-composer.tsx`、`dashboard-sidebar.tsx`、`styles/theme.css` 和 `styles/typography.css`。复用公开 MIT 源码，许可保存在 [boardui-MIT.txt](packages/web-console/licenses/boardui-MIT.txt)。

这是中文个人助手产品界面：用户与 Bot 对话，查看配置的渠道、渠道消息与任务执行情况。优先桌面长时间使用，窄屏保留同样的信息与操作。没有特定地域业务规则；UI 语言为简体中文，不推断用户身份、企业或业务。

保留 BoardUI 的浮动侧栏、圆角浅灰工作面、蓝色选中行与白色输入胶囊。任务和渠道共用其字体、状态徽标及控件，不添加无数据依据的统计、假进度、模型切换、语音或附件按钮。对话数据与任务状态来自 Bot 接口；Web 不成为底座领域字段的来源。

Web 是可选可视化入口：关闭页面不停止已接纳任务，禁用插件后 Bot 仍可通过其他入口运行。不增加展示专用核心字段，不另建模型或调度链。插件启用后与 Host 同进程；独立包和可选加载不代表进程故障隔离。

### 业务依据与 UI 后果

| 业务依据 | UI 后果 |
|---|---|
| [渠道合同](docs/CHANNELS.md)、`src/channels/service.js` | 身份由认证后的服务端绑定；会话只有 `chat` / `chat-room`；已接纳不等于业务完成 |
| [任务归档](docs/TASK-ARCHIVE.md)、`src/runtime/pi-journal.js` | SQLite/Pi 是业务权威；展示不得写任务状态或消费未提交的 journal |
| `packages/dingtalk-core/task-session-service.js` | 每任务一个执行会话；任务状态、等待原因、结果与时间线按真实记录投影 |
| `packages/web-console/server/security.js` | 本机单操作者、令牌登录和会话边界；界面不提供账号切换或身份伪造入口 |
| `packages/web-console/server/session-view.js`、`packages/web-console/server/views.js` | 执行记录是当前已提交上下文；仅展示必要字段，隐藏思考、系统指令、工具参数、凭据与私密路径 |

## Colors

浅色画布白色、工作面 `#f7f7f7`、边线 `#ebebeb`，对应 BoardUI neutral-100/200。主动作使用 `#2d6eea → #2563eb` 垂直渐变；上沿由上游 blue-500 加深，使白色小字在整个渐变上对比度至少 4.63:1。正文 `#0a0a0a`；次要文字取 `#686868`，辅助文字 `#6f6f6f`：相较上游 neutral-400，提高必要文字在浅灰面板上的对比度。中性徽标在 `#ebebeb` 背景上使用次要文字，保留 4.5:1 以上对比度。

成功、等待、失败、提示采用独立语义色与文本；不能只靠颜色表示状态。深色通过根节点 `data-theme="dark"` 或 `.dark` 重映射：画布 `#121212`、工作面 `#171717`、浮层 `#262626`、正文 `#fafafa`，与上游表面顺序一致。高对比模式采用系统控件边界，滚动条恢复系统色。

## Typography

上游使用 Inter 与 JetBrains Mono；Web 通过本机字体回退支持中文（Segoe UI、苹方、微软雅黑），不为加载字体请求外部服务。保留以下既有层级，不将所有标题或正文压成同一字号：

| 用途 | 当前字号 / 行高与变体 |
|---|---|
| 聊天欢迎标题 | `clamp(23px, 2.3vw, 32px)` / 1.5；手机 23px |
| 列表、详情标题 | 桌面 24px / 1.6；列表在 760px 以下 22px，520px 以下列表与详情为 21px |
| 通用空态标题 | 20px / 28px |
| 默认正文 | 14px / 1.5；消息 Markdown 为 13px / 1.9，保留长文阅读空间 |
| 通用按钮 | 13px / 20px；次要信息采用既有 10–12px 层级 |

正文不使用全大写或大量粗体；现有英文区块眉题只作辅助，不能承担唯一导航或动作说明。中文自然折行，发送者、工具名和技术长标识可完整查看，不只留悬浮提示。

## Layout

### 页面结构与响应式

页面外框 12px，主栏间隔 16px，桌面侧栏 260px，主面板圆角 24px。聊天正文最大宽度 768px，输入框与正文同轴。当前没有桌面侧栏折叠入口；CSS 保留的 `--board-sidebar-collapsed: 60px` 不是已交付交互。

| 视口 | 布局规则 |
|---|---|
| 宽度大于 1250px | 聊天页显示右侧活动栏，可手动收起；任务与渠道始终有独立导航入口 |
| 宽度不超过 1250px | 隐藏活动栏与其切换按钮，保留主面板宽度 |
| 宽度至少 1024px | 桌面侧栏常驻 |
| 宽度不超过 1023px | 隐藏桌面侧栏，以导航按钮打开原生 `<dialog>`；支持焦点约束、Escape、关闭后焦点恢复 |
| 宽度不超过 760px / 520px | 详情依次转为单栏；520px 以下外框 6px、主面板圆角 18px、渠道卡片单列；减少辅助列，主要信息和操作仍可到达 |

### 导航与数据范围

三个主入口为「与 Bot 对话」「任务」「渠道」。hash 路由设置「页面 — Night Bot」标题；未知路由保留导航并显示不存在页面。详情提供返回入口，任务状态筛选、页码和当前页查询保存在 URL。渠道筛选/搜索、详情视图及历史页游标是页面内临时状态，不承诺跨路由保存。

| 视图 | 内容与数据导航 |
|---|---|
| Web 对话 | 侧栏分页选择对话；单会话显示最近 500 条，截断时提示范围；更早记录仍在服务端账本 |
| 任务列表 | 每页 20 条；文本搜索明确标为「筛选当前页」，不伪装全量搜索；搜索框的清除按钮立即清空并恢复输入焦点 |
| 任务详情 | 目标、状态、结果、执行动态、阻断与交付记录；「执行信息」「执行记录」分视图展示 |
| 执行记录 | 每页最多 50 条，携带 revision 查看更早记录；明确是 Pi 当前已提交上下文，压缩或分支后不保证包含全部历史 |
| 渠道列表 | 配置启用状态与适配器接入状态分开；已启用不等于厂商在线或真实发送已验收；会话搜索只过滤已获取的列表 |
| 渠道消息 | 只读聊天视图；入站消息与发送记录分别持有分页 offset/revision，单路每页最多 50 条，合并展示 |

执行记录和渠道消息的旧快照发生冲突时提示错误；由用户点击「重新获取」重置到最新页，不擅自跳走正在阅读的历史记录。旧页不持续轮询，最新页按快照更新。

### 滚动与布局稳定性

聊天消息区域独立滚动，输入框固定在该面板底部；任务与渠道列表在主面板滚动，表格只管理自身横向溢出。执行上下文有独立消息容器，不将其高度限制施加到相邻详情内容。

用户停留底部时跟随新消息，向上阅读后不自动拉回，提供「回到最新消息」。长发送者与工具名换行；代码块和 Markdown 表格在自身横向滚动，不撑宽页面。任务摘要可两行截断，完整内容必须能在详情查看。

状态反馈和 busy 控件保持稳定几何。全局滚动条可见，新滚动容器自动继承 thumb、track、hover、active 样式，不要求逐容器开关；高对比模式恢复系统色。

## Elevation & Depth

侧栏阴影沿用 BoardUI 的三层 recipe：`0 1px 0 / 1.96%`、`0 1px 12px / 5.88%`、`0 0 1px / 32.16%`。普通白色卡片只用 `0 1px 1px / 5%` 接触阴影。选中导航用蓝色边缘与白色内高光。禁止给每行任务或每条消息添加装饰性多层阴影。

## Shapes

共享几何为面板 24px、侧栏等共享卡片 16px、控件 10px、状态徽标胶囊。保留已有内容变体：详情与会话列表 13px、渠道卡片与表格 14px；用户消息采用 `0 14px 14px 14px` 的气泡，助手消息不套同款气泡。不要把这些变体误写成所有卡片/消息一律 16px，也不为新页面随意添加另一套圆角。

输入框单行起始高度 52px、8px 内边距、10px 控件间距；支持自动增高至 160px，之后保留可见滚动条，禁止手动拖动改变布局。发送按钮 34px 加容器边界满足起始高度，不放置无法执行的附件/取消操作。

## Components

### Token 与源码归属

[boardui.css](packages/web-console/src/styles/boardui.css) 是运行时 token 的唯一声明来源；本文 frontmatter 镜像已选浅色值并说明用途，不生成第二套样式。深色映射及状态颜色也在该文件；[app.css](packages/web-console/src/styles/app.css) 实现页面布局与明确的组件变体。唯一指导文档不等于把 CSS 迁成 Markdown 生成系统。

文字链接使用 `--board-info`（浅色 #1d4ed8、深色 #93c5fd），交互背景使用 `--board-primary`，不能因为当前色值相似就混用语义。共享组件与页面消费同一组 `--board-*` 变量。

| 本文路径 | 运行时 token / owner | 使用方 |
|---|---|---|
| colors.* | `--board-primary/primary-top/canvas/surface/panel/text/muted/subtle/border/success/warning/danger/info` | 共享组件与页面 |
| typography.sans / mono | `--board-font` / `--board-mono` | 文本与技术内容 |
| rounded.DEFAULT / card / panel / pill | `--board-radius-control/card/panel/pill` | 按钮、共享卡片、工作面、徽标 |
| spacing.frame / gap / sidebar / transcript | `--board-frame/gap/sidebar-width/content-width` | 主布局与聊天 |
| components.button | `--board-control-height` / `.board-button` | 主/次/弱操作 |
| components.composer | `.board-composer-*` | Bot 聊天输入 |

### Canonical UI Map

下列路径相对 `packages/web-console/`。已有 owner 必须复用或按明确业务差异扩展，不在页面内复制另一套交互。

| Capability | Canonical owner | Source of truth | Allowed variants | Verification |
|---|---|---|---|---|
| Form | `src/App.tsx` 的 Login、`src/components/BoardPrimitives.tsx` 的 Composer | 本文与服务端请求契约 | token-login / message-composer | `test/browser.spec.ts` 登录、IME、原文输入 |
| Scrollbar | `src/styles/boardui.css` 全局样式 | 本文 Layout 与运行时 token | 应用纵向区域 / 表格与代码横向区域 | computed style、窄屏、axe |
| Toast | `src/components/Shared.tsx` 的 Notice、局部 `role=status` | 本文反馈与恢复规则 | 持久错误横幅 / 局部复制回执；当前无独立弹出 toast 系统 | `test/browser.spec.ts` failure paths |
| CRUD | `src/api.ts`、`src/ChatPage.tsx` | 本文发送流程、`channels.receive` 与独立请求回执 | 仅发送对话；任务与外部渠道只读 | `test/server.test.js`、`test/host.test.js`、浏览器测试 |
| Message | `src/components/Shared.tsx` 的 MessageList、Markdown、Status | 本文消息、来源与安全展示规则 | Web 对话 / 渠道消息 / 执行上下文 | 长文本、工具折叠、滚动与复制用例 |
| Resource | `src/hooks.ts` 的 useResource、`src/api.ts` | 本文异步读取与认证规则 | 轮询最新数据 / 固定历史快照 | `test/browser.spec.ts`、`test/chat-lifecycle.spec.ts` |

无选择型表格、下拉列表、日期输入、批量或破坏性业务操作，不为补齐组件库而引入。以后确需这些能力，先在本文定义适用行为和共享 owner。

### 控件、输入与反馈

`BoardPrimitives.tsx` 统一 Button、IconButton、Badge、Spinner、EmptyState、Logo、Composer。按钮有 hover、active、focus-visible、disabled、busy；busy 在原尺寸内覆盖进度，不使文本和相邻控件跳动。图标只用 Remix Icon，图标按钮提供中文可访问名称与 title。

Composer 是受控组件，消息文本归调用方持有；原始缩进和换行不被自动 trim。Enter 发送、Shift+Enter 换行，输入法合成期间 Enter 不提交。表单使用 `noValidate`，错误以文本关联字段，失败保留草稿；Spinner 仅表示实际等待。动作使用原生 `<button>`，导航使用 `<a>`，不用浏览器 `alert/confirm/prompt` 代替产品反馈。

错误通过共享 Notice 或表单内联提示给出恢复动作；复制反馈使用局部 `role=status`，失败允许手动选中文字复制。相同操作保持相同名称与结果；不以短暂提示作为关键错误的唯一载体。

### 发送状态与恢复

一次发送固定 `requestId` 和原文。只有回执明确 `accepted` 且未标记 `accepted: false` 才清空草稿；HTTP 202 本身不能证明接纳，接纳更不代表任务完成。

| 结果或阶段 | 界面行为 | 允许的后续动作 |
|---|---|---|
| 请求在途 | 当前消息锁定，显示等待，禁止重复提交 | 可切到其他对话独立编辑与发送 |
| 明确已接纳 | 清空对应草稿，更新该会话记录 | 继续对话；回复和任务状态等待真实更新 |
| 明确拒绝或请求校验失败 | 保留原文，解释原因并恢复编辑 | 修正后主动发送 |
| `pending` / 结果未知 / 断线 | 保留草稿与原请求，锁定当前消息，提供「核对发送状态」 | 只读查询同一 `requestId`，不自动重放 |
| 核对确认原请求不存在 | 保留原文与请求 ID | 提供「重试这条消息」，仍使用同一 ID |

草稿、未决请求、核对提示和核对中状态归原对话共享存储。切页或组件卸载不能丢失恢复入口；迟到回执按 `requestId` 更新原状态，不能清空新请求草稿、抢走当前路由或锁住其他对话。没有底座支持的取消能力就不显示中止按钮。

### 异步读取与真实状态

`useResource` 每个资源实例最多一个在途读取；换资源取消旧读，忽略迟到结果。连续失败三次停止自动轮询；启用轮询的资源在标签页重新可见时核对，用户也可显式刷新；固定历史页不因重新可见而自动刷新。使用快照更新，不伪装 token 流或可量化进度。

| 读取状态 | 展示要求 |
|---|---|
| 首次加载 | Loading 与文字说明，不能预先显示空结果 |
| 成功但无数据 / 无匹配 | 区分「暂无」与「没有匹配」，提供与场景相符的下一步 |
| 首次读取失败 | 不可读状态、错误原因与「重新获取」，不显示欢迎页或成功空态 |
| 后台刷新失败且有旧数据 | 保留上次数据并明确标注，允许重试 |
| 概览局部失败 | 五个区块独立反馈，保留其他真实信息，不把失败计作零任务/未配置 |
| 执行尚未开始 / 正在提交 / 暂不可读 | 分别提示，不能都归为「暂无记录」 |

状态文案复用 Status：`waiting` 为「等待中」，可能等待依赖或人工输入；未接纳、待核实、已发送、已送达、已完成互不替代。未知状态保持原值或「未记录」，不推测为成功。不要虚构在线状态、百分比、费用或 token 计数。

### 会话、草稿与安全展示

- 草稿只保存在当前标签页内存，切页和登录失效后的重登可恢复；刷新、关闭标签页或主动退出不持久化业务内容。主题是唯一 localStorage 项。
- token 默认掩码，提供键盘可操作的显示/隐藏按钮；不存持久浏览器存储、不放 URL。身份由服务端认证绑定，不能由浏览器指定 sender/channel。
- 旧认证代次的 401 不撤销新登录。多标签 CSRF 失配时只读同步当前会话，保留草稿，不自动重放写操作；退出响应落定前不允许进入重登流程。
- 主动退出清除可见缓存并替换草稿容器，旧回执不能恢复退出前内容；只读同步成功后的新会话不能消费旧过期标记。
- Markdown 不执行原始 HTML；外部图片显示为显式链接，避免读取消息自动请求第三方；外链隔离 opener。
- 任务结果、时间线与补充留言只展示白名单字段。执行上下文隐藏思考、系统指令、工具参数与敏感路径；长工具内容折叠，脱敏/截断明确提示，不把当前上下文冒充完整原始日志。
- 渠道消息只读，不添加渠道配置编辑、任务取消、真实渠道代发等未获支持的动作。

### 文案、本地化与可访问性

产品提示、操作和可访问名称使用简体中文，保留必要的 Night Bot、Bot、ID 技术名称。渠道来源未知显示「渠道成员」，执行记录用户输入显示「用户」；只有 Web 对话使用「你」。会话类型缺失写「会话类型未记录」，不能默认为单聊。动作名称直接表达结果，不暴露与用户决策无关的内部实现术语。

日期通过 `hooks.dateTime` 统一按 `zh-CN` 和浏览器本地时区格式化；原始时间值保持 ISO，缺失或非法值显示「未记录」。默认浅色，可切换深色，语义层级保持一致。

可访问性目标为 WCAG 2.2 AA：原生语义、可见焦点、可访问名称、足够对比度、状态文字和键盘等价操作；不能仅靠颜色或 hover 表达信息。图标按钮必须有中文名称；对话框、折叠工具记录、复制、搜索清除和分页均可用键盘操作。

动效仅用于状态变化与加载，普通交互 150ms。`prefers-reduced-motion` 下不依赖旋转、平滑滚动或几何过渡传达状态，等待仍有文字；`forced-colors` 下使用系统控件边界及滚动条颜色。

## Do's and Don'ts

- 使用真实接纳、执行与完成状态；异步接纳不表述为业务完成。
- 共享变量和组件，保持聊天、任务、渠道的一致视觉层级。
- 不复制上游 AI SDK / 模型接口、演示数据、浏览器消息持久化、团队/计费设置或营销升级入口。
- 不隐藏滚动条，不把颜色作为唯一状态提示，不让视觉复刻削弱键盘和输入法行为。

### 维护与验证

1. 改 UI/UE 前读本文并核对业务/API 约束与共享 owner。视觉、流程或状态发生持久变化时，同步修改本文与对应 token/组件；不恢复独立 UX 合同，不在 README、手册或验收报告中另立规则。
2. 保持 frontmatter → `boardui.css` → 共享组件 → 页面用途可追溯；本文镜像与运行时不一致时查明意图，记录修正原因，不能无说明地放宽规则。
3. 纯文档整理运行 `designmd lint DESIGN.md`、strict 静态审查，以及链接/旧引用检查；不把历史浏览器结果声称为本次实跑。审查器使用仓库根目录作为 `project_root`，显式传入 `--config docs/acceptance/web-console/premium-ui.json`；配置中的源码/命令/evidence 路径均相对仓库根目录。审查输出用 `--output docs/acceptance/web-console/design-contract-audit.json` 保存在验收目录。
4. 修改页面、交互或运行时代码时，执行配置中的相关单元/集成、类型检查、构建与浏览器命令。浏览器至少覆盖成功、加载、失败、空/无匹配、键盘、中文 IME、390px、浅深色和受影响的异步恢复；涉及滚动、认证、长内容、reduced motion 的变更需覆盖对应反例。
5. 静态审查和 axe 不能替代真实浏览器或 Host/Pi 回归，也不等于完整 WCAG 认证、真实厂商接入或部署验收。结果记录到 PR；需要跨轮回归时沿用既有验收目录与版本绑定，规范本身不堆测试流水账。
