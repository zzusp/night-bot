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

# Night Bot Web 设计合同

## Overview

依据用户指定的 BoardUI 设计。参考固定版本 [BoardUI/boardui@ec5c5eb](https://github.com/BoardUI/boardui/tree/ec5c5eb3e29c2441be63b9422cd54f411ef23466)：`agent-chat.tsx`、`agent-composer.tsx`、`dashboard-sidebar.tsx`、`styles/theme.css` 和 `styles/typography.css`。可复用部分为该仓库公开 MIT 源码，许可保存在 `packages/web-console/licenses/boardui-MIT.txt`。

这是中文个人助手产品界面：用户与 Bot 对话，查看配置的渠道、渠道消息与任务执行情况。优先桌面长时间使用，窄屏保留同样的信息与操作。没有特定地域业务规则；UI 语言为简体中文，不推断用户身份、企业或业务。

保留 BoardUI 的浮动侧栏、圆角浅灰工作面、蓝色选中行与白色输入胶囊。任务和渠道共用其字体、状态徽标及控件，不添加无数据依据的统计、假进度、模型切换、语音或附件按钮。对话数据与任务状态来自 Bot 接口；Web 不成为底座领域字段的来源。

`packages/web-console/src/styles/boardui.css` 是运行时 token 权威；本文件镜像其已选值与理由，不生成第二套样式。所有共享组件消费 `--board-*` 变量，父页面也使用同一变量。维护时以 CSS 变量 → 共享组件 → 页面实测为同一条链。

## Colors

浅色画布白色、工作面 `#f7f7f7`、边线 `#ebebeb`，对应 BoardUI neutral-100/200。主动作使用 `#2d6eea → #2563eb` 垂直渐变；上沿由上游 blue-500 加深，使白色小字在整个渐变上对比度至少 4.63:1。正文 `#0a0a0a`；次要文字取 `#686868`，辅助文字 `#6f6f6f`：相较上游 neutral-400，提高必要文字在浅灰面板上的对比度。中性徽标在 `#ebebeb` 背景上使用次要文字，保留 4.5:1 以上对比度。

成功、等待、失败、提示采用独立语义色与文本；不能只靠颜色表示状态。深色通过根节点 `data-theme="dark"` 或 `.dark` 重映射：画布 `#121212`、工作面 `#171717`、浮层 `#262626`、正文 `#fafafa`，与上游表面顺序一致。高对比模式采用系统控件边界，滚动条恢复系统色。

## Typography

上游使用 Inter 与 JetBrains Mono；Web 通过本机字体回退支持中文（Segoe UI、苹方、微软雅黑），不为加载字体请求外部服务。标题 20/28、面板标题 16/22、正文 14/21、紧凑控件 13/20、辅助信息 11/18。正文不使用全大写或大量粗体。中文对话允许自然折行，技术长标识应完整查看，不只留悬浮提示。

## Layout

上游几何：页面外框 12px，主栏间隔 16px，展开侧栏 260px、收起侧栏 60px，面板圆角 24px。聊天正文最大宽度 768px，输入框与正文同轴；桌面侧栏从 1024px 起常驻，右侧辅助栏从 1280px 起显示，较窄宽度改为可导航视图而非挤压正文。

聊天区域拥有自己的滚动，输入框固定在该面板底部。任务详情、渠道列表使用各自内容滚动，长内容不扩大侧栏。状态反馈预留空间，不移动主要操作。全局滚动条可见，所有新滚动容器自动继承 thumb、track、hover、active 样式。

## Elevation & Depth

侧栏阴影沿用 BoardUI 的三层 recipe：`0 1px 0 / 1.96%`、`0 1px 12px / 5.88%`、`0 0 1px / 32.16%`。普通白色卡片只用 `0 1px 1px / 5%` 接触阴影。选中导航用蓝色边缘与白色内高光。禁止给每行任务或每条消息添加装饰性多层阴影。

## Shapes

面板 24px、卡片与消息 16px、控件 10px、状态徽标为胶囊。输入框单行起始高度 52px、8px 内边距、10px 控件间距；为中文多行输入支持自动增高至 160px，之后保留可见滚动条。发送按钮 34px 加容器边界满足初始 52px 高度，不放置无法执行的附件/取消操作。

## Components

文字链接使用 `--board-info`（浅色 #1d4ed8、深色 #93c5fd），不复用按钮背景蓝色；交互背景继续使用 `--board-primary`。图标按钮明确透传动作处理函数，Composer 的 `resize-none` 为不可手动拖动的共享几何合同。

`BoardPrimitives.tsx` 统一 Button、IconButton、Badge、Spinner、EmptyState、Logo、Composer。按钮有 hover、active、focus-visible、disabled、busy；busy 在原尺寸内覆盖进度，不使文本和相邻控件跳动。图标只用 Remix Icon，图标按钮提供中文可访问名称与 title。

Composer 是受控组件，消息文本归调用方持有。Enter 发送、Shift+Enter 换行，输入法合成期间 Enter 不提交；异步发送期间阻止重复提交，失败显示内联错误并保留调用方草稿。接纳未决时锁定当前消息，允许切换其他对话独立编辑；明确未接纳后恢复编辑，不擅自提供底座没有的中止能力。表单使用 `noValidate`，错误绑定字段，Spinner 仅在实际等待时展示。

消息发送者和工具名允许换行，代码块只在自身横向滚动。渠道来源未知显示「渠道成员」，执行记录用户输入显示「用户」，不推测是当前操作者。初次读取失败使用不可读状态及同一重试入口，不显示成功的空状态；部分概览不可读时保留其他真实信息。

日期/时间由页面统一格式化；空列表与加载失败必须有不同文案。导航、搜索、任务详情、渠道消息遵守同一反馈和滚动策略。触发远端动作的权限和持久化仍由 Bot/适配器核对。

动效仅用于状态变化与加载，普通交互 150ms。`prefers-reduced-motion` 下停用旋转、平滑滚动和几何过渡，等待状态仍有文字。产品所有提示与操作文案为中文，保留必要的技术名称 Night Bot、Bot、ID。

| 本文路径 | 运行时 token / owner | 使用方 |
|---|---|---|
| colors.* | `--board-primary/canvas/surface/panel/text/muted/subtle/border/success/warning/danger/info` | 共享组件与页面 |
| typography.sans / mono | `--board-font` / `--board-mono` | 文本与技术内容 |
| rounded.DEFAULT / card / panel / pill | `--board-radius-control/card/panel/pill` | 按钮、卡片、工作面、徽标 |
| spacing.frame / gap / sidebar / transcript | `--board-frame/gap/sidebar-width/content-width` | 主布局与聊天 |
| components.button | `.board-button` | 主/次/弱操作 |
| components.composer | `.board-composer-*` | Bot 聊天输入 |

## Do's and Don'ts

- 使用真实接纳、执行与完成状态；异步接纳不表述为业务完成。
- 共享变量和组件，保持聊天、任务、渠道的一致视觉层级。
- 不复制上游 AI SDK / 模型接口、演示数据、浏览器消息持久化、团队/计费设置或营销升级入口。
- 不隐藏滚动条，不把颜色作为唯一状态提示，不让视觉复刻削弱键盘和输入法行为。
