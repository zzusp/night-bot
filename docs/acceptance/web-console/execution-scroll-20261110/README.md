# 执行记录连续滚动验收

基线：`main` 的 `19970f21be55d75972872c75f0b92ceed26b7455`。验证仅在隔离临时副本与合成数据上完成，没有连接或修改生产数据。

## 实际效果

- [默认视图](default.png)：真实测试服务投影 565 条，首读 200 条、底部第 80 轮，无执行记录翻页。
- [上滚历史](older.png)：上滚自动增至 400/565 条，保持原阅读位置；较新的记录仍保留。
- [窄屏深色](narrow-dark.png)：390px，缩放后仍贴底到第 80 轮，用户蓝色气泡与对话页共用颜色、14px 圆角和 13px 17px 内边距；助手无气泡。

这些是 Playwright 驱动已安装 Chrome 的实际渲染截图，不是设计稿。截图不证明真实厂商模型或生产数据的执行结果。

## 行为核验

`execution-scroll.spec.ts` 覆盖首读 200、分批前插、普通记录与展开工具的锚点误差小于 2px、430 条突发追加跨批补齐、最终 1080 条按序且无重复、贴底跟随、工具折叠后自动补满、展开状态保留、错误重试、上下文变化恢复、撤权清缓存、窄屏键盘及 WCAG AA、浅深色用户气泡与对话页 computed style 完全相同。

服务端测试覆盖授权前缀 checkpoint、追加安全、压缩/改写/身份变化拒绝、边界参数及固定 revision 正文续读。记录流不开放原始 Pi 日志、思考、系统指令或私密工具字段。

## 本轮结果与已知边界

- `pnpm --dir packages/web-console build`、`pnpm check` 通过。
- `node --test packages/web-console/test/session-view.test.js packages/web-console/test/message-colors.test.js`：16/16 通过。
- 最终 Chrome 选择集（执行流、工具组、任务工作区、消息配色、两个既有浏览器用例）：24 通过、1 失败。唯一剩余失败为 `/channels` 的既有 `label-content-name-mismatch`；执行页相关检查全部通过。
- 最终选择集之前曾完整运行 156 项：147 通过、9 失败。修正了两处增量响应的旧测试假设。随后对未修改 main 的七项对照：渠道无障碍、自进化旧文案、消息浮层既有断言、设置告警 strict locator 四项仍失败，渠道菜单与两项链接焦点重跑通过。最终选择集没有再出现这三项偶发失败。不声称完整套件全绿。
- Windows 完整 Web 单测 141/143 通过；两项 `TASK_WORKSPACE_NOT_READY` 在未修改 main 的对应测试同样复现。Linux 初始实现 Web 单测 143/143 通过。
- 严格 Premium UI 静态审查 0 错误、0 警告；DESIGN lint 0 错误、14 个现有 token 未引用警告。构建保留既有大 chunk 提示。
- 未验证 Safari/Firefox、真实生产历史与厂商模型调用。未合并、未部署；按仓库规则未触发 CI。
