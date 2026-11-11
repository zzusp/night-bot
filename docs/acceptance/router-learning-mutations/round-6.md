# 第 6 轮：轻量记忆与可发现的 Skill 描述

## 范围与结论

按用户追加要求，Router 与任务沉淀的新记忆正文固定为 Summary、Why、How to apply，三项必填，不再保存新的推测。证据保留在 Router context 或任务 review 元数据，不重复铺入正文。学习 Skill 的适用条件同时进入 frontmatter 和真实模型目录 description；正文不再列出任务编号、通用权限声明、版本和 Applicability。

最终相关回归 **52 PASS / 0 FAIL / 0 skipped**，项目来源守卫通过。本轮为代码与隔离验证阶段；本地七条记忆及已有 Skill 的更新待新 PR 合并和正常部署，不提前标为完成。

## 受验版本

- 分支 worktree-router-context-memory-local，主线基线 0a1eafc065a7468d6a55e6fa5a890c151b39be10；另含上一阶段本地验收文档提交 484eebc。
- 测试实际针对上述分支的未提交工作树；以下源码指纹绑定最终结果，不以当时 HEAD 代替。Node.js 24.19.0、pnpm 11.25.0、Windows 11。
- 无依赖或数据库 schema 改动。Router 新条目使用 context v3，原 v1/v2 与无 context 的记录保持原样读取；通用逐字工具的授权合同不变。

| 源码 | SHA-256 |
| --- | --- |
| src/channels/resident-router-business.js | 0a914fddcf7cf17c4656d88118d69f67b8b7a2dbf22a665e5fb61cbda7561f91 |
| src/memory/format.js | 048a7fe79d97b712826983b2eca3f68636e4005b880212112f07a3a3295202e7 |
| src/memory/store.js | 858a83c71cf848387d0456980a89b690d29336f4f900bc133024b87305dfc44f |
| src/memory/service.js | 09378bba5e3d7c76f88b213ed6e0480aba800259db773853c6ce9d0b411afe8d |
| src/memory/reflection.js | 73eeee970cdf40de43a1f6bb0f873402db5bf1e91decbb349631d7b2818dc8c5 |
| src/memory/reflection-inference.js | b16966d5b0c28b8a6727932e77a71d15615d65538a3531cd97352d3739ac3d2a |

有序 `[文件名, SHA-256]` 数组的紧凑 JSON 指纹：`ed93692d68e6456babc96bc146c4ca8cd9cfc9f0147a90d39e9ae01c167cc89a`。

## 实跑与关键证据

1. 存储、迁移、撤销与通用入口：

```text
node --experimental-test-module-mocks --test --test-concurrency=1 test/pi-memory-store.test.js test/pi-shared-memory-migration.test.js test/pi-reflection-forget.test.js test/pi-memory-wire.test.js
# 33 PASS / 0 FAIL / 0 skipped
```

三段缺失或含秘密、私自指定 actor、无证据、证据篡改及正文/context 不符均拒绝；新 Router 输入不接受 hypothesis。长原话仍完整保留在元数据，而正文不随之膨胀。v1、v2 和通用旧记录读取、删除及冷启保持。

2. 任务复盘及 Skill 默认 provider：

```text
node --experimental-test-module-mocks --test --test-concurrency=1 test/pi-reflection.test.js test/pi-reflection-official.test.js
# 14 PASS / 0 FAIL / 0 skipped
```

真实默认 Host、SQLite 完成事件和官方 Pi 无工具请求产生三段经验，证据 ID 保留在 review，未持久化推测。缺少 Why 时失败关闭，不制造猜测或阻塞已完成任务。Skill 从文件和实际 provider 回读：description 为具体适用条件（含冒号的描述正确引用），模型清单不再使用统一通用文案；正文无四项冗余行。支持任务 ID 仍在 state，撤销、忘记和上一正文差异保持。

3. Router 真实调用链：

```text
node --experimental-test-module-mocks --test --test-concurrency=1 --test-name-pattern="explicit channel preference|channel memory follows|read-only Router|Router directly maintains|Router synthesizes" test/pi-resident-router-flow.test.js
# 5 PASS / 0 FAIL / 0 skipped
```

覆盖 21 个来源与拒绝场景、16 个记忆/Skill 生命周期检查、只读、个人和场景适用、场景关键词检索、跨作者召回、冷启、重复不重放、更新和差异、删除及无空任务。三段正文自包含，证据及原 ID 留在结构化元数据。

中间失败与处理：去掉正文中的适用说明后曾丢失仅在 subject.description 中出现的场景检索，已在正确的检索投影层索引该字段，没有把它重新铺入正文。新增缺 Why 与 hypothesis 反例实际在 Pi 参数校验层被拒绝，夹具原先误按 Host JSON 回执解析；现在核对真实参数错误文本和磁盘无写入，不伪造错误码。两项均已按最终源码复验通过。

4. `pnpm check` 与 `git diff --check` 通过，424 runtime JS、0 external SDK imports，来源/hash/import 守卫保持。

## 本地维护与边界

- 已只读核对七条现状：两条个人/项目来源记忆、五条任务经验。逐条对照原认证消息或 SQLite 原完成事件和 review；没有只改标题或将旧推测转成事实。
- 临时受控驱动在忽略的 docs/tmp，待已合并发行准备后执行零副作用自检，再离线使用 Store 事务更新；保留 ID、createdAt、originSource、provenance、origins、previous 和三项已有 Skill 支持关系。源码与 Git 中没有这些私有正文或运行数据。
- 已有学习 Skill 由新 Host 在正常启动时按同一渲染函数重建派生文件，不直接手改 Skill Markdown 或改原 review；真实本地七条、文件及 Web 回读另属部署阶段。
- 未运行完整 test/runtime/routing/containment。本轮仅上述相关回归；此前完整 routing 的 15 个同基线失败保留在第 4 轮，不宣称当前完整套件全绿。
- 使用本地脚本模型、隔离目录和假渠道，没有额外真实模型语义验收、真实渠道发送、远程部署或 CI。context v3 写入后的回滚须使用支持该格式的代码和匹配数据，不能删字段让旧版继续读取。
