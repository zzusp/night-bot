# 第二轮：最新主线整合与 PR 验证

## 结论

本轮性能相关最终专项 **100 通过、0 失败、0 跳过**，源码守卫与 Web 构建通过。运行时组仍有四项失败，已用最新主线实际运行时模块逐项复现同因，未宣称完整回归全绿；不扩大修复其业务合同。本轮完成隔离提交与 PR 交付验证，部署由用户指定的渠道修订/撤回会话统一执行，本会话未停止或重启运行安装。

## 受验源码与整合

- 日期：2026-11-12；Windows 11、Node.js 24.19.0、pnpm 11.25.0、官方 Pi 1.5.0。
- 独立分支：`worktree-triage-startup-performance`，不改共享主工作区的其他 WIP。
- 首次代码提交：`36b35f1dd07549e021b13efefe0d9e4cb9e82b43`。
- 最新已整合 main：`b030ada1d076d979c5cd088a00bee8946d9a1628`。
- 最终受验代码：`ce387b65340012dfeedf6ee860da8405bcdf9f99`，工作树代码干净；之后本轮只增加验收文字与矩阵。
- 相对 main 的 16 个 `src/packages/test` 差异文件聚合 SHA-256：`20647164e77df1cf2f5a9cb35fd86ba24d10eba47128c90f365ddecbe7e8179d`。按路径排序，依次哈希 UTF-8 路径、NUL、原始文件字节、NUL。
- 只提取本轮协议预加载/计时/无任务指标增量；主线已有 sourceStageTiming、角色模型、上下文记忆与回执兼容均保留。角色覆盖已由 Host 显式传给预加载门禁，未退回旧默认路由。
- 本轮首轮原始 dirty tree 验收仍保留于 `round-1.md`；其 37 项失败与 27 项跳过不能套用为当前提交的结果。

## 最终有效验证

1. `node --test --test-concurrency=1 test/pi-agent-observation.test.js test/pi-official-agent-factory.test.js test/pi-official-context-hooks.test.js test/pi-official-session.test.js test/task-session-observability.test.js test/pi-official-model-runtime.test.js test/performance.test.js test/pi-resident-router-flow.test.js`：**100/100 通过**，0 失败、0 取消、0 跳过，443089 ms。包括真实官方 Host/Pi 的纯分流尾部、冷恢复/重复来源无重放、Router 关闭与原批次续办、当前渠道记忆路径和精确回执隔离。
2. 官方协议实际 load/resolve hook：选中模块按 api 去重；未选提供方不加载；fetch 为 0；读取凭据引用会抛错的夹具仍通过。实际 Host 同时选择默认 openai-completions 和分诊角色 anthropic-messages，二者均进入预加载门禁；角色协议未发模型请求。
3. 纯分流：模型、工具调用及工具结果各 1，无 taskId、无任务、无发送；所有关键 phase 可见，actor 已释放。等待耐久 `triage-total` 后重启并重复来源，指标不变且模型请求不增加，不把局部 idle 当终态。
4. `pnpm check`：exit 0；190 保留、10 退休、3 排除、59 适配；425 生产文件、202 literal bare imports；外部 SDK imports 与旧编排定义均为 0。`git diff --check origin/main...HEAD` 通过。
5. 根目录与 Web 各自 `pnpm install --frozen-lockfile`：通过；独立依赖，未链接主检出 node_modules。`pnpm --dir packages/web-console build`：exit 0；实际 `dist/index.html` 501 字节、2 个 assets 可读。Web 源码树为 `84b986cbf52b87def785df6f0e6263727675a36b`，整合前后相同；构建成功不等于运行安装已更新。

## 运行时组失败与反证

`node scripts/test-pi.mjs runtime`：162 总计，146 通过、4 失败、12 跳过、0 取消；自然结束，1670860 ms，exit 1。该运行绑定整合前的本轮实现；随后在最终 `ce387b6` 上逐项复验四项仍同因失败：

- `test/task-session-execution-provider-recovery-native.test.js:160`：actual group human review 后读取不存在的数组项 `.at`，TypeError。
- `test/task-session-service-native.test.js:203`：三个 source supplement/echo/actor 组合，均为 `1 !== 2`。

为区分本轮影响与现有合同，在单独进程使用公共 `registerHooks`，将本轮改变的 13 个运行时模块替换为 `b030ada` 的实际原文件，仅内存加载、不改磁盘；测试夹具保留。四项仍全部同位置、同原因失败。实际加载模块均输出 SHA-256，例如：

| 模块 | main 原文件 SHA-256 |
| --- | --- |
| src/host.js | 23199f88345deac6ed44bbc1faf1367621ec429ec29adc3474bb8ed326b612cf |
| src/pi-official-runtime.js | 37e608d738b8fcfc9ea7bfdbceaee5071bd2271e080974e51c87601e25d516e3 |
| packages/dingtalk-core/task-session-service.js | a0517d766fae67a017f84433e85b20b7639dc45a43ca7aa02b5cc6f5c564b74d |

主线对照 0 通过、4 失败；这是明确失败复现，不是“运行时组通过”。未删除断言、改权限模式或恢复退役执行链。

初次最新主线整合前的并行组合为 100 总计、98 通过、2 失败：一项本地模型流未在夹具 idle 预算内完成，随后单独模型 16 项和最终串行 100 项均通过；一项旧 DWS flags 拒绝断言也由原 main 的 13 模块对照复现。最新 main 的 `c5f1043` 已按真实 retained-source 合同修正该夹具，本轮保留其增量后该用例通过。没有把前次失败命令改写成通过。

## 边界与交付

- 不重跑无关全量，不宣称 `pnpm test`、完整 routing/containment 或 Windows OS 受限执行已全绿；12 项运行时跳过仍是跳过。
- 模型与渠道验证均为本地脚本端点/假 transport；未发送真实测试消息、未请求付费模型，未测真实首答降幅。
- 分项只记录元数据；嵌套与并行不可相加，assistant 尝试不是 HTTP 次数。观测失败不改变业务结果、不引起重放。
- 无业务 schema/config 迁移，不复制凭据或运行数据。部署授权已明确；按用户协调由渠道修订/撤回会话独占部署，须等待双方已合并基线，保留接收进度与 data，并回查实际运行版本和接收终态。
- 当前远端 PR 为 #76，main ← worktree-triage-startup-performance。合并与部署事实以后续 GitHub 回查及运行态证据为准，不将本页的代码验证当作已部署。

无新私有日志/截图/fixtures 需要归档；必要文字证据集中于本页。原轮次报告保留，临时 PR 正文和停机自检脚本在任务收口清理；停机入口只运行过 effects=0 的 --check，没有执行 --stop。
