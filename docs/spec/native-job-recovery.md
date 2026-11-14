# 原生作业离线结清

目标：核实登记后丢失终态的 shell 作业，保留原调用禁止重放，并由原任务会话正常续办。原记录不等于进程仍存活；缺少退出收据也不能宣称构建成功。

方案比较：

1. 删除登记或补 producerReported 终态：制造未观察到的事实，拒绝。
2. 直接放宽 assertCanRun、改任务排空或改用新会话：丢失未决效果/原会话约束，拒绝。
3. 离线操作者核验后追加独立 job/reconciled 收据：采用。记录退出状态未知、可能存在部分效果、精确旧调用 noReplay。既有生产者和资源终态原样保留。

复用安装 .host.lock、Pi persistence 独占 writer、严格完整日志解码、portable codec 和 task 身份；SQLite 只读，不设置 drained、不 ACK 输入、不创建业务目标。仅处理无资源所有权收据的冷丢失 shell 作业；有资源保留、非法序列、陈旧日志/任务/安装或链接路径均拒绝。操作者的进程核验声明是带证据的人工判断，不是原 producer 退出证明，也不是 Host 排空证明。

入口 inspect 与 close --check 为零写；close 必须实际持有安装锁与原 session writer，按摘要冻结操作者说明及证据文件摘要，然后提交 typed receipt。重启继续依赖 Host 的正常恢复链。保留旧 journal 字节前缀，不重放旧命令；新执行输入说明结清限制。

验证最短路径：真实 CLI 的核验/结清、只读自检、live-lock 拒绝、日志与任务版本变化、证据篡改、外来身份、保留资源、冷读/noReplay、原会话的真实 Host 继续执行。现场业务与私有证据不提交 Git。
