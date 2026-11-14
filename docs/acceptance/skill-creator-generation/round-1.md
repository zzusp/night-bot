# 第 1 轮：内置 creator 生成与受管发布

## 范围与源码

2026-11-15，Windows 11、Node.js 24.19.0、pnpm 11.25.0。基于 `origin/main` 的 `1eabcc856774cf3aadf8a347c1a6794968ab7a3a`，在隔离分支 `worktree-skill-creator-generation` 验证本任务未提交工作树，不能把 base 的 HEAD 当成已验证修复。以下摘要绑定最终运行源码；后续仅补充交付文档不改变这些字节。

| 文件 | SHA-256 |
| --- | --- |
| `src/memory/skill-generation.js` | `fe8236a3c396a15f3edf105021d80dfbf0d36d7add58b82bfb54e6f643caf6d8` |
| `src/memory/reflection.js` | `992a35f8e6ffd17a56b171d304140a5bbbd193e7b4826b304c28c89bc769285e` |
| `src/memory/service.js` | `de4aa25684359ef7380130999600208828c1cdf9abbf8a98971eae9f897d4d62` |
| `src/channels/resident-router-business.js` | `b586486b6e42a8d3bf4e4d7aa6ab6266bc12af61258bb177eb52eaa0c78e483c` |

## 结果

| 实跑 | 结果与证明范围 |
| --- | --- |
| `node --test test/pi-skill-generation.test.js test/pi-reflection.test.js test/pi-reflection-forget.test.js test/pi-reflection-keys.test.js test/pi-reflection-contention.test.js test/pi-reflection-official.test.js test/pi-router-skill-refresh.test.js test/pi-skill-tool-wire.test.js` | 66 PASS、0 FAIL、0 SKIP，89.815 秒。复盘、证据键、遗忘、幂等、发布不确定性、Router 资源刷新及内置/安装技能加载。此批在最后补齐调用者/Host 取消绑定之前运行。 |
| `node --test --test-name-pattern='Router directly maintains memory and learned skills|Router.*read.only|read.only.*Router' test/pi-resident-router-flow.test.js` | 2 PASS、0 FAIL、0 SKIP，142.759 秒。认证 Router 的 16 个 CRUD 检查点及只读拒绝；来源、版本、秘密/路径限制、删除、单调版本、旧加载撤销、冷启均保持，无空任务和真实外发。 |
| `node --test test/pi-skill-generation.test.js` | 最后取消绑定后 11 PASS、0 FAIL、0 SKIP，178.193 秒。实际 creator 新建/更新、不同于候选的生成正文、复盘成功/缺失不回滚完成、四种生成失败、锁外生成期间撤权/遗忘、调用者/Host 取消排空。此批与上批存在重叠，不将执行次数相加冒充独立用例数。 |
| `node docs/acceptance/skill-creator-generation/scripts/router-smoke.mjs` | 最终独立程序正常退出；正常渠道入口→分诊→Router→真实 `resident_skill_mutate`→Pi `skill` 调用→受管发布→目录读取→冷启，无重放，空任务 0、真实供应商消息 0。 |
| `pnpm --dir packages/web-console build` | 构建通过，存在 bundle 大小和插件耗时提示；本轮不改 UI，不将构建当作浏览器或业务验收。 |
| `pnpm check`、`git diff --check` | 最终工作树通过；190 retained / 10 retired、450 production/runtime JS、209 literal bare imports、0 external SDK imports。未新增依赖或修改来源清单。 |

独立运行的最小实际输出：

```json
{"actualRouterTool":"resident_skill_mutate","creator":{"callId":"call-3","name":"skill-creator","source":"bundled","sha256":"e61fd4f425b898eca9595228caf7da1ce221833ff4ac1b5275977c95c357e555"},"generatedBodyPublished":true,"catalogMatchesFile":true,"coldRestartNoReplay":true,"emptyTasks":0,"realVendorMessages":0}
```

## 关键反证与修正

- 原始问题不只是 creator 安装缺失：普通 Pi 技能加载原本正常，绕过发生在 Reflection 直接拼装发布层。生成专项故意返回与候选不同的新正文，首次复验发现状态有 body、文件仍渲染旧 steps，已修正 renderer 并保持该断言。
- 生成前失败最初暴露未分配 memoryKey 的报告错误；现于事务内分配合法键并保留失败 lesson，creator 缺失可追溯且原任务仍 completed。
- 早期广回归 60 PASS / 3 FAIL 分别来自低层夹具变量声明、Router 脚本模型不识别新生成请求和 Windows SQLite 清理顺序。修正夹具/资源关闭，最终 66 项通过；未降低生产权限、CAS 或失败标准。
- 独立程序首跑业务链成功但清理阶段 EBUSY，不算完整通过；修正为先关任务服务/SQLite、后删安装，最终独立运行和退出均通过。
- 锁外生成期间撤权/遗忘不发布，调用者或 Host 取消会中断并排空，不写正式技能或成功回执。

## 边界及证据保留

所有模型均为隔离本地 HTTP 脚本模型，渠道为假 transport；验证的是实际工具链、证据与发布合同，不证明真实模型生成质量、独立试用或 benchmark。未运行全量 `pnpm test` / `test:runtime` / `test:routing` / `test:containment`，未调用真实付费模型或发送消息。没有修改私有安装技能、批量重写旧技能或伪造历史 generation。

可复用运行脚本保留在 `scripts/router-smoke.mjs`。中间失败日志和单轮临时安装在任务收尾时清理；本报告保留关键失败、复验结果及必要文字证据，不依赖清理后的附件。合并 SHA、实际本地发行与部署读回集中维护在本任务 PR 最终正文，不以当前隔离测试宣称已部署。
