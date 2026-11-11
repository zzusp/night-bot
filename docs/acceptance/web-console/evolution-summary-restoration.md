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
- **真实浏览器验收通过**：在 Windows 独立 checkout 检出源码提交 `07690fb139c32736da0adf3bd8d68b6dc386304c`，生产构建成功。使用 Microsoft Edge 157.0.4341.42 运行下列六个测试文件，终端输出 `28 passed (4.1m)`、exit 0；既有 `.last-run.json` 为 `status: passed`、`failedTests: []`。2026-11-11 只读复核时 checkout 仍为该提交、工作树干净，结果文件和截图仍存在，没有重新运行测试。
- 覆盖卡片/指标、DOM 与工具栏稳定性、迟到响应、不可读/撤权隐藏、正文返回、浅深色/窄屏/键盘/axe。已实际查看浅色/深色 × 1440px/390px 四张截图：两张摘要卡及八个指标完整，卡底说明与口径区未出现，分类及使用次数列保留，无重叠或横向溢出。
- 使用独立合成数据 fixture，验收结束后已关闭，3081 端口不再监听。验收当时现有部署的 HEAD、进程 PID 和启动时间均保持不变；本次验收没有修改原工作区、部署或重启服务。
- 云端此前的 Chromium 启动因 `socket() failed: Operation not permitted` 退出，共享云浏览器也无法连接命令环境的 localhost 预览。上述验证缺口已由独立 Windows 环境的真实 Edge 验收补齐。后续提交仅更新本文档，不改变已测源码。

实际验收命令（Windows 配置默认使用 `channel: msedge`、`browserName: chromium`，未增加环境变量或配置覆盖）：

```sh
pnpm --dir packages/web-console test:browser evolution.spec.ts evolution-tabs-counts.spec.ts evolution-list-layout.spec.ts evolution-content.spec.ts evolution-reader-layout.spec.ts page-headers.spec.ts
```

未运行根全量、runtime/routing/containment 套件，修改范围仅 UI。未修改真实安装目录、凭据和数据，未合并、部署或重启服务，未主动触发 CI；PR 保持草稿。
