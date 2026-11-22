# 自进化流程：更新与退役修复复验

本地 Windows、Node `24.19.0`、pnpm `11.25.0`。分支 `worktree-skill-lifecycle-recovery`，基线 `2a7f7c7b978bfe8f9cd802a854d98b9a5c0058fa` 加未提交产品、测试和文档差异。默认 Host／真实 Pi／隔离本地脚本模型；不是新镜像或真实模型质量复验。线上改前断点见 [第 8 轮](round-8.md)。

| 复验 | 结果 | 可观察证据 |
| --- | --- | --- |
| `test/pi-reflection.test.js` | 13 通过，0 失败 | 新回归让最终准入等 31 秒，再返回本次有效证据。原任务仍完成，复盘第一次就提交，原 Skill 唯一 key 从 1 升到 2，验证新版正文和不同的真实 creator 调用回执。无效来源和名称仍拒绝。 |
| `test/pi-memory-maintenance.test.js`、`test/pi-reflection-admission.test.js`、`test/pi-reflection-official.test.js`、`test/pi-skill-generation.test.js` | 合计 53 通过，0 失败 | 真实 Host 请求明示暂缓理由是字符串数组；在索引和计划中分别返回非字符串项，持久回执记录对应阶段，原经验和 revision 不变。保存新规则时同时撤销过时经验和失去支持的 Skill，两个回执以证据 ID 关联，旧加载标记失权，仍有有效支持的 Skill 保留。并发版本、秘密拒绝、creator 实际加载、异常恢复不重放、关停排空均覆盖。 |
| `test/pi-single-task.test.js` 多事项定向用例 | 通过，覆盖 11 个不同执行会话 | 两类经验原键更新，独立消费者实际读记忆或 Skill 正文并对不同输入给出正确结果；同规则再做仍正常跳过，版本与键不变；库存不套用装箱报价。没有重跑本轮无关的联合复用用例。 |
| `pnpm check`、`git diff --check` | 通过 | 覆盖清单、生产依赖导入及运行时守卫通过；补丁无空白错误。 |

实现只移除无工具推理入口的额外 30 秒总时限。保留 Pi 模型路由传输限制与流空闲超时、Host 取消排空、复盘的模型解析期限和 JSON 输出上限；原生 `TimeoutError` 在任务复盘中映射到字符串错误码。维护提示把 `deferred` 明示为短文字原因数组；非 JSON 或结构不匹配分别记录索引/计划阶段，不宽松转换或应用部分动作。保留来源、CAS、遗忘代次、权限和无重放约束。

验证源码 SHA-256：`src/memory/reflection.js` `d193546c6a1b19267653cb0a82084ab989828310ec5336db309e4c6ca7ed34ad`；`src/memory/maintenance.js` `3c32953f7e188fd61a304f867ed49b8c34b01e121911dedf4fffe74424167eb7`。对应回归：`test/pi-reflection.test.js` `01cf8ac422e787c61b95d714b9246739d558bcdcf0121e26fd564ed52119b2fd`；`test/pi-memory-maintenance.test.js` `7fcb37948c7194526f49eb5a2c9428da85ba8410ef1df9e0335ccc8db0d752d7`。

未提交、未发布候选，UAT 仍是旧版；新版本上的真实模型原键更新、正常跳过、消费新版正文和退役回执均未验证。沿用隔离合成脚本，新增按实际 Skill 正文标记核对版本、以及要求重复事项正常跳过才能通过，脚本仅做语法检查，未在候选镜像执行。无在役记忆清理、真实消息或生产访问。
