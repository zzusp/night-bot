# 自进化摘要卡恢复验收

## 范围与原因

基于 main `0e18f77`，修正 PR #43 将整张摘要卡删除的范围错误。已实际查看用户两张参考图：13:09 的三个红框仅包括记忆卡底部说明、Skills 卡底部说明和「查询范围与口径」折叠区；13:11 的图框选分类导航，要求去掉「全部」，不是删除顶部卡片。

- 恢复记忆、Skills 两张卡及原有八个指标，缺失与明确零不混淆。
- 三处红框说明仍不展示；保留「记忆」「Skills」分类和列表使用次数列。
- 分类/分页请求期间保留摘要 DOM 与指标，不让工具栏跳动；只更新列表加载区域。网络失败由共享 Notice 标注旧快照；403/401、明确 unavailable 和撤权后重试均不回显缓存。
- 正文阅读时隐藏摘要，返回复用原 DOM；760px 以下卡片纵向排列。未改后端、统计来源或权限。

## 验证

- `pnpm --dir packages/web-console test`：154 通过，0 失败、0 跳过。含两项新增实际 TSX 服务端渲染断言，验证两张卡、八个指标、移除说明、缺失和零。
- `pnpm --dir packages/web-console typecheck`：通过。
- `pnpm --dir packages/web-console build`：通过，仍有既有大于 500 kB bundle 提示。
- `pnpm check`：通过，424 个运行 JS 文件，0 外部 SDK 导入；`git diff --check` 通过。
- strict UI audit：0 findings。DESIGN.md 已同步，未改 runtime tokens。环境没有独立 `designmd` 命令，未运行该 lint。
- 相关浏览器回归最终收集 28 项，包含卡片/指标、DOM 与工具栏稳定性、迟到响应、不可读/撤权隐藏、正文返回、浅深色/窄屏/键盘/axe。
- **浏览器未通过验收**：本轮 27 项启动尝试均在 Chromium `process_singleton_posix.cc:297 socket() failed: Operation not permitted` 退出，未进入业务断言；申请提升执行后仍相同。后补的不可读缓存用例仅完成收集。不能以源码或 SSR 通过代替交互和视觉结果。

可用环境中补跑：

```sh
pnpm --dir packages/web-console test:browser evolution.spec.ts evolution-tabs-counts.spec.ts evolution-list-layout.spec.ts evolution-content.spec.ts evolution-reader-layout.spec.ts page-headers.spec.ts
```

未运行根全量、runtime/routing/containment 套件，修改范围仅 UI。未修改真实安装目录、凭据和数据，未合并、部署或重启服务，未主动触发 CI；PR 保持草稿。
