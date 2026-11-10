# 同一路由多模型验收记录

日期：2026-11-10。基线：`19970f21be55d75972872c75f0b92ceed26b7455`。本记录验证隔离配置和测试工作区，不使用生产凭据，不调用真实模型，不部署。

## 问题与范围

原设置页仅有默认模型 API 表单和角色选择；角色下拉读取已有 provider 模型目录，因此配置只有一个模型时只能选择一个。底层 `providers[provider].models` 已支持多项，本次补齐同一路由的 Web/CLI 管理入口，不增加另一套模型、密钥或 ENV 配置。

## 场景与证据

| 场景 | 已观察结果 | 证据 |
| --- | --- | --- |
| 同一路由新增、改 ID/别名、清除别名、删除 | 真实配置保存后独立读取确认；已有 API、凭据引用、模型元数据不变 | `test/pi-model-catalog-settings.test.js`、`test/pi-settings-cli.test.js` |
| 官方内置模型目录 | 首次写入保留所有原 ID 及 overrides；已有显式白名单不扩展 | `test/pi-model-catalog-settings.test.js` |
| 三角色选择 | 新增后一级分诊、Router、任务执行均可选择；刷新后仍为实际保存的 ID | `packages/web-console/test/model-catalog.spec.ts` |
| 删除与改 ID 保护 | 默认、角色、legacy、有效 ENV、持久任务默认引用及最后一项受保护；删除需确认 | 共享配置测试、Web server 测试、浏览器测试 |
| resident 任务默认竞态 | 未保存明确 task 角色时，阻止删除或改 ID；显式 task 或有效 task ENV 优先于旧持久默认 | `test/pi-model-catalog-settings.test.js` |
| 并发及未知结果 | CAS 冲突保留草稿；断网、坏回执、写入后读取失败不自动重写；删除弹窗保持打开时的版本 | `packages/web-console/test/model-catalog.spec.ts` |
| 交互与可访问性 | 空/重复 ID 不写入，中文输入法不误提交，离开保护、确认取消和焦点恢复；分页、筛选、长名称可用 | 同上 |
| 视觉 | 浅/深色、1440/390 宽度无横向溢出；WCAG 2 A/AA、2.1 AA axe 无违规；人工查看窄屏及桌面截图 | 同上生成的截图；临时产物不入库 |

## 实际执行

- [x] 根目录与 Web 包分别 `pnpm install --frozen-lockfile --prefer-offline`。
- [x] `node --test test/pi-model-catalog-settings.test.js test/pi-settings-cli.test.js test/pi-operator-settings.test.js`：30 通过、0 失败、1 跳过。跳过为已有 Linux-only GitHub full shell 场景，未当作 Windows 验证。
- [x] `pnpm check`：源码覆盖、生产依赖、原生运行时边界检查通过。
- [x] Web 包 `pnpm typecheck`、`pnpm build`：通过；构建保留既有大 chunk 提示。
- [x] Web Playwright 新模型目录 6 项与原设置 7 项：13/13 通过。实际命令为 `pnpm exec playwright test --config ../../docs/tmp/model-catalog-browser/config.ts test/model-catalog.spec.ts test/settings.spec.ts`；临时配置只将既有 preview fixture 改为独立 13081 端口，避免碰到已占用 3081 的其他工作。常规空闲环境可直接使用仓库 Playwright 配置运行这两个文件。
- [ ] Web 包 `pnpm test`：140 通过、2 失败；两项均为 `TASK_WORKSPACE_NOT_READY`。在未修改的基线工作树单独执行以下两个文件，同样 1 通过、2 失败，因此不归因为本次模型配置变更，也不宣称全套通过：
  - `packages/web-console/test/session-host.test.js:91`：learning HTTP，task `learn-one`。
  - `packages/web-console/test/shared-evolution-runtime.test.js:13`：共享记忆，task `source-task`。
- [x] `git diff --check`：通过。

## 边界与回滚

不自动猜测服务商支持的模型 ID、不新增远程模型发现或推理探测。新增 ID 须由操作者提供，配置可保存不代表服务端一定可用。角色继续沿用既有 `NIGHT_BOT_{TRIAGE,ROUTER,TASK}_{PROVIDER,MODEL,REASONING_EFFORT}` 优先级。

保存目录不热切换当前会话，按原部署流程重启后生效。已配置 resident 时，删除/改 ID 前必须先明确保存 task 角色或设置有效 task ENV，以避免独立持久任务默认存储与目录发生竞态。增加模型和改显示名称不受该限制。

回滚代码即可移除新管理入口，已保存的标准 provider 模型列表继续由原配置机制识别。本次未修改生产配置、未迁移数据、未合并、未部署。真实服务商模型验证和生产重启验收未执行。
