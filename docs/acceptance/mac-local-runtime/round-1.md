# 第 1 轮：环境、安装与基线

## 受验版本

- 基线：`1514bbdfa26429b12bb2a6646b671206a3407498`，最初工作树干净。
- 环境：macOS 13.7.8（22H730），Intel x86_64，Node.js 24.15.0，pnpm 11.25.0。
- 无真实模型、DWS、业务系统调用，不改已有业务安装。安装没有跳过脚本或供应链策略。

## 通过证据

| 检查 | 结果 | 原件 |
|---|---|---|
| 根 frozen 安装 | 357 包；416 条供应链策略通过，node-pty/koffi 原生安装步骤完成 | `round-1/install-core.txt` |
| 独立 Web frozen 安装和 build | 156 条策略通过；tsc 与 Vite 构建完成，产物 index.html/JS/CSS 存在 | `round-1/install-web-build.txt` |
| 规范临时路径下 containment 调度 | 5 PASS，0 FAIL，17 SKIP；不代表 Mac 隔离已通过 | `round-1/containment-tests-canonical.txt` |
| 规范临时路径下 Web 服务测试 | 56 PASS，0 FAIL，0 SKIP | `round-1/web-tests-canonical.txt` |
| 规范临时路径下 routing 全组 | 73 PASS，0 FAIL，0 SKIP | `round-1/routing-tests-canonical.txt` |

这里的“规范临时路径”指仅向测试进程传入 `realpath(os.tmpdir())` 对应的 `TMPDIR`，没有改生产路径检查、权限模式或沙箱。

## 失败与修复依据

1. 默认 `pnpm test` 和最初的 containment 出现 `NIGHT_BOT_DATA_DIRECTORY_UNAVAILABLE`，内层原因 `NIGHT_INSTALL_ROOT_ALIAS_UNSAFE`。本机 `os.tmpdir()` 返回 `/var/folders/.../T`，`realpath` 为 `/private/var/folders/.../T`；系统 `/var` 是符号链接。`src/runtime/paths.js:24` 要求 portable 安装根等于其物理路径，拒绝是安全检查的预期行为。原件：`round-1/core-tests.txt`、`round-1/containment-tests.txt`。
2. 原始默认组在 `pi-single-task.test.js` 未退出，失败基线没有完整 TAP 总结。确认上述根因后停止该轮专属 runner/worker，保留原始输出；不能计作完成或通过。后续改用修复后的原命令复验，见第 2 轮。
3. runtime 全组在规范临时路径下完成：**163 项，150 PASS、1 FAIL、12 SKIP**；唯一失败是 32 轮授权续办超过原有 120000ms 业务期限。原件：`round-1/runtime-tests-canonical.txt`。没有增大期限或减少轮数。

## 真实应用初次探针

`round-1/app-smoke.txt` 记录真实 `night-bot-init.js` → `night-bot-run.js` → 子服务的 HTTP/Web 交互：health ok，静态资源 200，未认证任务 API 401，令牌登录 200，默认模式 ask，任务 completed/drained，管理关闭退出 0 且两监听均关闭。使用独立 `data/workspaces/mac-runtime-*` 安装与动态 loopback 端口。

**该轮 shell 无有效证明**：初版脚本未提供 bash 必填 `description`，返回 `invalid arguments: "description": missing`，没有进入命令执行。此结果不作为沙箱失败或命令成功的证据；第 2、3 轮使用完整参数补验。
