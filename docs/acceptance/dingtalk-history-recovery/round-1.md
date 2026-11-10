# 第一轮：历史恢复去重与错误展示

## 受验版本

2026-11-10，Windows 11 / Node.js 24.19.0。代码提交 `1f268dc`；整合主线 `01b36b5` 后为 `eb4e363b4cddebc147c9f1c133173d3165b17424`，受验工作树干净，后续仅追加验收文档。原主检出的未提交变更未修改、未交付。

整合保留新的消息气泡颜色、无边框合同和 macOS 修订。插件、指纹校验、Web 投影及卡片实现与 `1f268dc` 逐文件字节一致；主线仅给插件既有两个暂缓用例增加异步健康等待，已单独复验。完整插件结果绑定 `1f268dc` 及相同源码指纹，不冒充在新提交重跑整套。

## 根因与修复

两个渠道历史分别完整返回 17 条、4 条；同版本冻结消息分别有 7 条、1 条指纹不同。差异为新增 DWS 平台标记、4 条附件提示及资源字段顺序变化，以及另一渠道引用作者被历史接口省略。历史完整但 Host 接纳失败，恢复界不推进，Web 只显示 recovering。

修复仅在可选插件读取精确来源：要求 routed、会话/作者/消息/版本/资源稳定身份一致，完整重建冻结 payloadHash。引用作者只从已验证绑定与持久参与者按 actor 摘要反查。证明成功后仅调用原 consumed，不改事实或来源，不重跑模型、任务及发送；真实变化仍失败关闭。目标切换及生命周期门禁仍生效。

Web 将补拉失败投影为三个固定错误码，卡片持续展示「历史恢复失败」与安全原因；不返回原始异常、厂商 ID、账号、目标或正文。running/ok 时旧错误文本不覆盖当前状态，矛盾 healthy=true 也不能显示已连接。

## 结果

| 验证 | 实际证据 |
| --- | --- |
| `node --test --experimental-test-module-mocks test/pi-channel-plugin.test.js` | 31 tests / 31 pass / 0 fail / 0 skipped，约 243 秒 |
| 新增真实 Host 冷恢复 | 文字、附件、引用补拉完成；healthy=true、recovering=false；3 个 deferred 消除、恢复界清除、backfillThroughAt 存在；消息事实、来源和通知逐项不变，模型请求及发送不增加 |
| 反例与生命周期 | 正文、作者、版本、引用正文/作者/ID、提及及资源变化拒绝；target hold 拒绝；第二次冷恢复真实冲突为 backfill=failed、recovering=true，耐久恢复界保留 |
| 现场纯校验器，只读 | 两个完整历史结果中的 7+1 个冲突全部通过冻结证明，包括 4 个附件和 1 个引用；未调用 receive/ingest 或写账本 |
| `node --test packages/web-console/test/channel-card-health.test.js packages/web-console/test/channel-health-fixture.test.js` | 15/15；真实认证 HTTP，隐私白名单通过 |
| 整合后 `node --test --experimental-test-module-mocks --test-name-pattern='defers unresolved' test/pi-channel-plugin.test.js` | 2/2；timeout/error 身份暂缓均沿原时间下界冷恢复一次，假厂商，非真实发送 |
| `channel-card-health.spec.ts` 真实 Edge/Chromium | 8/8；1440px、390px 无横向溢出，恢复失败原因可见，正常/异常/未就绪/缺失/切换阻断正确 |
| `pnpm -C packages/web-console build` | TypeScript/Vite 通过，293 模块；现有 >500 kB chunk 提示保留 |
| `pnpm check`、`git diff --check` | 来源覆盖/hash/import 守卫通过，404 运行 JS、externalSdkImports=0，无空白错误 |

最终构建：`index-Dm04R_BC.js`、`index-CvNp8fL2.css`，仅用于隔离浏览器夹具，不是运行安装发布。

## 排障与边界

- 长多行 shell 在执行前引号解析失败，拆分命令后完成；没有以失败调用宣称测试通过。
- 默认 3081 被其他会话占用，未停止其服务；临时 runner 用同一 preview 的 port=0，仅改变测试 baseURL/globalSetup/outputDir。
- 首轮浏览器 6 pass / 2 fail：旧断言将隐藏编辑 dialog 说明当作卡片正文。断言改为可见 `.channel-card-select`，保留全部异常/阻断用例，未改生产弹窗；复验 8/8，新主线样式下再验 8/8。
- 未重跑无关完整 runtime/routing/containment；未改执行器、沙箱、任务 schema 或权限模式。没有真实发送、合并本 PR、部署或重启实例，不声称运行渠道已恢复。
- 临时脚本、日志及失败附件不保留；本报告自包含必要文字事实，不留下失效附件引用。运行监督器及其他会话资源不清理。

## 源码 SHA-256

| 文件 | SHA-256 |
| --- | --- |
| `src/channels/plugins/dingtalk-ingress.js` | `597abc8945d3fa8ad77859e17da01b51472733e4bb516bb67f5a356aaa1704be` |
| `src/channels/plugins/dingtalk-dws.js` | `bf77d4c5a80855768b2f03ad45aa23224725eb7557ce26e9c411eb75d0e85000` |
| `packages/web-console/server/views.js` | `161c977189aeb8bf8a4468ec568f9e066732c2b364a51275fb2ee63c13a9ef72` |
| `packages/web-console/src/ChannelsPage.tsx` | `57e3718115a7778526b398149be501e104faa7f32231c37c62d4e0ee24346d04` |
