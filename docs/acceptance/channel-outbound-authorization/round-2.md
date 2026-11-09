# 第二轮：环境凭据恢复与原提醒逾期处理

## 范围与版本

日期：2026-11-09，Asia/Shanghai。本轮仅恢复操作者刚补充的已声明模型环境引用，并复验原消息正式恢复链路；未修改产品源码、启动 helper 或渠道授权。沿用第一轮 HEAD 与 14 个 tracked 文件增量，重新核对 diff SHA-256 仍为 e9a47e3968f527358572ec9399220996763f5c3a8359a930b81b07226c5038e8。未提交工作树仍是验证对象，不以 HEAD 代表全部源码。

## 实际执行与证据

- 只核对 LOCAL_PREVIEW_MODEL_KEY：Windows User 范围存在，旧 Claude/PowerShell Process 范围没有，Machine 范围没有。没有打印值、长度、前缀或把密钥写入文件。
- 先运行启动 helper 的零副作用检查，经 IPC 正常排空原实例，独立核实自有托管元数据与 Host 锁释放。随后在新 PowerShell 进程内从 User 范围读取该变量，仅通过进程环境传给同一安装的 Node 服务；没有复制其他凭据或变更 provider/model/endpoint。
- 20:07:59，原消息一级分诊 committed，needsHandling=true；官方 Pi 会话实际调用 channel_triage_submit。原 source 标记 routed=true，仍是原身份与版本，没有重建入站消息。
- Router 官方会话实际调用 platform_config_query、platform_schedule_submit、resident_router_reply、resident_router_settle；严格共用解码器 requireComplete=true 校验通过，无未提交物理尾部，模型无认证错误并以 stop 正常结束。
- platform_schedule_submit 按原目标时刻返回 status=expired，未创建排期，未顺延到次日。原时刻已错过，第一轮的准点提醒失败不能改写为通过。
- Router 使用应用受控回复链说明延迟与过期，并提供即时提醒。该通知于 20:08:18 平台发送，20:08:19 进入 delivered；sendAttemptCount=1、readbackAttemptCount=1。Router inbox 对原事件为 consumed。没有通过直接 DWS 发送补造结果。
- 独立使用同一保存 profile，经 DWS +messages-mget 精确读取持久收据消息 ID：complete=true、messagesComplete=true、hasMore=false、failures=[]，请求 1 条、找到 1 条；目标群、消息 ID 和逾期说明正文一致。平台正文包含正常的收件人 mention 前缀，保留实际返回，不当作正文完全逐字无前缀。
- Core /health 为 ok、recoveryIssueCount=0，/state/recovery-issues=[]，Web HTTP 200。原问候通知仍 delivered、发送次数仍 1、收据 SHA-256 与第一轮相同，未随凭据恢复重复发送。

## 结论与边界

用户新增的环境变量可以使用，已由真实分诊和 Router 推理、工具调用及应用投递终态证实，不只是变量存在。原 pending 消息已沿正式链路完成逾期处理，凭据阻断解除。

原 19:02 准点提醒仍是未履约结果；本轮未验证新的未来准点提醒。第一轮 Web 完整测试的 1 项原基线失败仍保留。源码无变化，未重复运行已通过的定向测试、构建、浏览器检查或扩大到无关回归。没有提交、push、PR、合并、部署或触发 CI。运行中的 helper 与服务资源继续保留。
