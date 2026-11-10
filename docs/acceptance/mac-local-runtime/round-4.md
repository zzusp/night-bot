# 第 4 轮：测试同步修复与最终状态

## 最小修复

- `scripts/test-pi.mjs`：Mac 测试子进程使用系统临时目录的物理路径，修复 `/var` 别名导致 portable 临时安装被安全拒绝；不放宽生产安全检查。
- `test/pi-channel-plugin.test.js`：在 durable deferred 文件出现后，明确等待桥接器发布 `CHANNEL_NOTIFICATION_IDENTITY_PENDING` 健康事件，再执行原有“来源不存在、healthy=false、冷启补回仅一次、发送仅一次”等断言。不改产品逻辑，不删除或放宽原断言，不改期限。
- `README.md` 与 `docs/ops/mac-local-runtime.md`：记录 Mac 操作路径、物理临时目录和已验/未验边界。

## 通过证据

1. `TMPDIR=<physical temp> node --experimental-test-module-mocks --test test/pi-channel-plugin.test.js`：**29 PASS、0 FAIL、0 SKIP**，58716.940165ms，见 `round-4/channel-plugin-tests.txt`。timeout/error 两种延期身份、冷恢复、未知身份退化、scope 隔离及原始 ACL/防重断言均保留且实跑。使用 fake DWS，没有真实登录/发送。
2. 直接运行原命令 `pnpm test:containment`，没有额外 TMPDIR 设置：**5 PASS、0 FAIL、17 SKIP**，9100.72013ms，见 `round-4/containment-tests.txt`。证明测试入口修复有效；17 个 Linux 专属项目仍未在 Mac 内核验收。
3. 源码与 Git 的只读最终核验见 `round-4/final-checks.txt`，列出环境、受验输入哈希、差量及进程观察。

提交准备仅清理第 2 轮默认组和第 3 轮 DWS 定向输出中断言空白行的行尾空格；失败内容、用例计数、时间与栈信息不变。

## 当前结论

**Mac 服务/可选 Web/无命令任务可以运行；完整 Mac 运行验收未通过。**

- 已通过：锁定安装、Mac 原生安装步骤、Web 构建、真实管理启动器、HTTP、Web 静态资源与认证、loopback 模型普通任务、正常管理关闭；routing 73 项、Web 服务 56 项、受影响渠道文件 29 项、源码守卫通过，各自绑定原轮次，不叠加重复计数。
- 默认全组最近一次完整结果仍是第 2 轮 **1309 PASS / 1 FAIL / 46 SKIP**；其唯一失败的时序同步问题现由本轮整个受影响文件复验通过。没有重新运行整个默认组，不把定向补验写成“全组全绿”。
- 未解决：默认 ask 的实际 bash 探针返回未知效果并阻止自动执行；底层首错到未知效果的具体链路尚未定位。失败任务保留，无重放、无切 full。
- 未解决：32 轮续办原期限超时；独立复验也失败，另有失败清理问题，确切卡点与残留资源类型未收敛。没有扩测试期限求通过。
- 未验：真实模型凭据/厂商质量、真实 DWS、浏览器端交互、其余权限模式、Mac 内核完整隔离与生产部署。本轮不运行 CI、不提交/推送、不合并。

以 `matrix.csv` 为逐场景状态入口。尚有 FAIL，**不创建全绿 report.md**。隔离安装与未知效果原件留在 Git 忽略的 `data/workspaces/mac-runtime-*`，不删除或移动现有业务材料。
