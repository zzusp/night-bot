# 第 2 轮：物理临时路径修复与默认回归

## 改动

`scripts/test-pi.mjs` 仅在 darwin 为测试子进程设置 `TMPDIR = realpath(tmpdir())`。未改生产目录安全检查、测试断言、平台跳过条件、业务期限或应用权限模式。原始命令不需要使用者手工设置路径。

## 实跑结果

- 原命令 `pnpm test` 完整结束：**1356 项，1309 PASS、1 FAIL、46 SKIP**，1085136.935094ms。原件：`round-2/core-tests.txt`。没有再次出现原临时安装根别名失败。
- 唯一失败：`test/pi-channel-plugin.test.js:554`，`default optional DWS defers unresolved timeout identity and cold backfills the original older message once`；健康值实际 true，断言期望 false。
- `pnpm test` 使用 `&& pnpm check`，测试非零导致其尾随守卫未执行；守卫在第 3 轮独立补跑，不把未运行项算通过。

## 完整 bash 参数的实际探针

独立安装 `data/workspaces/mac-runtime-35tFMs` 使用默认 ask，调用仅为 `printf MAC_SHELL_PROBE`，带必填 description。真实 task 的工具结果是 `TASK_EFFECT_UNCERTAIN_NO_REPLAY`，HTTP detail 显示 `status:active`、`drained:true`、`result.action:blocked`，不是 completed。原任务及未知效果原件保留，不自动重试。

本轮驱动最初只等待 completed，未识别 active/blocked 这一终止自动执行状态，因而等待不退出。确认实际 HTTP 终态与本任务 Pi 原件后，对专属管理启动器正常发送 SIGTERM；驱动以“服务已退出”失败结束。`round-2/app-smoke.txt` 保留这一驱动失败，**不以它声称业务命令完成或清理成功**。第 3 轮的修正版驱动区分普通任务成功和命令 blocked，独立核实管理关闭及监听关闭。

## 未收敛

全组健康检查失败究竟是时序同步问题还是产品行为问题，此轮不下结论；第 3 轮单独复现并核对实现顺序。32 轮续办失败沿第 1 轮保留，不在这里改判。
