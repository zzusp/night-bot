# 云端模型与凭据接入：第4轮

## 结论与版本

按用户追加授权，云端模型路由已与本地一致并取得真实可见回复；Bot 容器中的 GitHub 环境变量认证和当前仓库只读访问通过。**DWS 设备登录未完成，仍未登录且无 profile，测试群收发/回读未执行；整体任务尚未完成。**

- 日期：本地 2026-11-11（UTC+08:00）。GitHub 验证于 01:29:55，真实模型回复验证于 01:35:05；末次只读运行态/DWS 回查时间以 JSON 为准。
- 实际应用仍为已合并 `0e18f7704652e88b0fe315b0c14030b1bab06c15`，镜像 manifest `sha256:9cc2ba4f6c26ff13674b9a5051e882c3be6818dde8062acd252d26cf0af9c4b5`。本轮没有修改应用源码、Dockerfile、依赖或锁文件，没有另建镜像。
- 工作分支 `worktree-k3s-cloud-runtime-20261111`，工作树差量为通用部署模板、文档和验收记录；最终 fetch 后 HEAD 与 origin/main 为 0/0。应用构建输入相对受验提交的独立 diff 为空；后续文档提交不冒充镜像源码。
- 运维说明新增的 DWS PowerShell 代码块已通过 PowerShell 7 AST 语法解析；这项只验证语法，没有再次执行登录。
- 第3轮基础运行证据继续有效，不因本轮模型配置改变而重复构建/全量测试，也不把历史通过项记成本轮重新执行。矩阵保留历史列，本轮未复跑项为 NOT_RUN。

## 验证结果

| 用例 | 结果与可观察终态 |
| --- | --- |
| 复用本地模型 | PASS；用户明确指定与本地相同，只读取模型 provider、型号、协议、base URL 和必要目录元数据；通过应用原生 updateConfig 事务先 checkOnly 再保存，生产凭据仍取现有 Secret，没有复制本地 key 值或完整配置 |
| 配置生效 | PASS；同步模型导入 ENV，以相同 annotation patch 先 server dry-run 再正常重建，回读已保存路由与本地匹配；没有改身份、记忆或历史会话 |
| 真实模型业务终态 | PASS；经 Web 认证发送独立固定 requestId，请求202后实际等到 HTTP 历史中的预期 assistant 回复，消息由0变2；没有把 accepted、Ready 或日志当作成功。见 model-runtime.json |
| GitHub 环境变量认证 | PASS；在真实 Bot 容器中由 gh 原生读取 GITHUB_TOKEN，成功请求 /user 与当前项目仓库元数据；没有打印 token、身份或执行 auth login，没有仓库写入。见 github-access.json |
| 最终工作负载 | PASS；只读回查1个Pod、Deployment期望与Ready均1、observedGeneration一致、重启计数0，20Gi PVC为Bound，实际imageID仍匹配发布摘要。见 workload-status.json |
| DWS 独立设备登录 | BLOCKED；真实执行 auth login --device --recommend --format json，已给出设备授权入口，但CLI进程以exit2结束。随后 auth status（包含verbose只读诊断）仍authenticated=false，profile list为success=true且profiles=[]。见 dws-authentication.json |
| 唯一测试群 | NOT_RUN；只保留用户授权的本地测试群定位信息，没有复制登录态，没有接入其他业务群或停用本地Bot。没有有效云端profile，故未绑定/启用渠道、未发群消息、未验入站/回复/厂商回读 |

GitHub 当前受验仓库为公开仓库；带令牌的身份和该仓库读取通过，不证明任何私有仓库可访问，更不证明写权限。返回的权限字段也没有通过写操作验证，不作为写权限验收。

## 关键问题与未完成边界

1. 本轮最初模型验证驱动出现内嵌正则转义错误；改用原生 endsWith/slice，并先对生成代码做语法检查。checkOnly 移到任何 Web 登录前；正式真实模型请求使用固定 requestId，未以不断换ID掩盖重复处理。
2. DWS 首次登录包装器仅显示授权链接/用户码和退出码，没有保留原始错误。因此失败具体原因未知，不能断言超时、用户拒绝或网络故障。旧进程已结束，不再把旧授权码当作正在等待，也不无条件循环重试。
3. 恢复时需要新的设备授权与身份确认。获取新流程的脱敏错误码/原因，成功后从真实 profile list 确定当前账号；核对与来源测试群同组织，再使用同一profile解析、配置、发送和回读。禁止复制本地登录态、跨组织套用群ID、重放历史群消息或把本地Bot回复冒充云端结果。
4. 模型成功没有解除第3轮中 ask/auto、活动任务排空、归档恢复、产品UI、其他架构等未验边界。当前 full 与 RuntimeDefault 的实际保护区别仍按部署说明；没有放宽权限来通过测试。

## 证据与续跑

- 本轮保留脱敏 model-runtime.json、github-access.json、dws-authentication.json 和 workload-status.json。公司目标、Secret引用、模型地址和群/账号定位信息只在受忽略的 docs/tmp/k3s-cloud-runtime/，不提交或公开。
- 唯一进度入口为 goal.md；matrix.csv 追加第4轮，历史报告不覆写当时结论，没有创建全绿 report.md。
- 生产实例、PVC、镜像及必要私有续跑检查点保留。只清理本次已无用途的模型/GitHub探针与临时文件；历史第3轮是尚未被本轮覆盖的浏览器、安全、停机/重建等最终证据，继续保留。
- 当前无仍在等待的 DWS 登录或其他后台验证任务。身份授权受阻期间不宣称群测试完成，也不承诺无实际续跑机制的自动恢复。
