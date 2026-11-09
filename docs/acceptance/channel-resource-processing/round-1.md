# 第一轮：钉钉资源读取与真实任务处理

## 范围与版本

- 日期：2026-11-09，Asia/Shanghai。源码为 main / a6299b7d2db088b38d0cbed1abe1bfe2019f31d7，与本地运行实例一致。
- 验证开始时 tracked 工作树干净；验收阶段没有修改运行时源码，仅新增本目录的验收记录，当时尚未提交、push 或创建 PR。用户后续另行授权提交验收 PR；文档归档提交与上述实测代码版本分开，不合并、不重新部署、不触发 CI。
- 仅复用已授权的既有本地安装、保存账号与指定测试群，发送四个无私有信息的样本及一条验证指令，各实际调用一次。不输出凭据，不修改账本、恢复水位或任务材料，不手工补发结果。
- 批次与任务：resource-check-8a7dfbaa。独立脱敏证据见 [round-1/proof.json](round-1/proof.json)，用例结果见 [matrix.csv](matrix.csv)。私有账号、群身份、原消息 ID 与原始回执不进入版本库。

## 实测结果

| 文件 | 插件及 Host 材料 | 任务实际读取结果 | 判定 |
| --- | --- | --- | --- |
| proof-image.png | 插件下载并返回 image；Host 保存 23822 字节 PNG，SHA-256 与样本一致 | read_image 直接读到 IMG-6B74A570；17+29=46 | PNG 图片附件通过 |
| proof-text.txt | 插件下载 UTF-8 文本；Host 保存 124 字节，SHA-256 与样本一致 | TXT-4DF475DA；6×9=54 | 通过 |
| proof-sheet.xlsx | 插件下载原工作簿并转为 760 字节 JSON 文本；含原文件 SHA-256；Host 冻结转换文本 | XLS-5F3FD61E；3×7+4×11=65；另下载原表并读取单元格复核 | 插件内容交付和计算通过，不表示原 XLSX 已在 materials 留存 |
| proof-document.pdf | 独立真实 adapter 抛 coordination_resource_format_unsupported；正式来源快照为 unavailable / RESOURCE_READ_FAILED，无文件路径或链接 | 模型另行运行 DWS 下载到 work，再以 pypdf 读出 PDF-B32204B8；13+28=41 | 内容处理绕行成功；插件材料交付失败 |

随机校验码及计算答案仅存在附件内部，群内指令不泄露答案。四份任务 work 中原始文件的长度与 SHA-256 均独立比对发送样本一致；报告中四项校验码与计算结果均正确。PNG 在发送侧已目视确认，正式材料与该样本哈希一致；TXT 内容、XLSX 原表单元格和 PDF 实际提取文本均已独立检查。未以模型自述替代文件、哈希或真实工具结果。

本次 PNG 以 file 附件发送。CLI 用户身份不接受本地 --file 配合 --msg-type image，预检失败后没有实际发送原生 image；没有切换身份或将 fileId 改称 mediaId。原生图片消息、在线钉钉文档、Word 均未完成真实验收。Word 不在当前扩展名白名单，只能报告静态缺口，不能称为实测失败。

## 真实任务终态

- 指令和四个附件共五条来源已全部绑定同一任务。
- 正式 task_result 已接受，任务 completed，drained=true；Router 的 task.completed 事件已 consumed。
- 使用运行时相同 decodePiJournal(..., {requireComplete:true}) 检验最终任务会话：committedBytes=614608，totalBytes=614608。提交链、身份及完整性校验通过，记录包含真实 read_image、文本读取、DWS 下载、Python 提取及被接受的 task_result。
- work/resource-check-8a7dfbaa.md 的 SHA-256 为 de2fd902eb00dbb243fa36972a6f6ff9109f458ae2d05bdd48e43cc18ae82722；work/verification.json 的 SHA-256 为 9196e86b6d9afef6f06be7a8903b31c15ddcbd1da9eebabd5b540eea04eb76cd。两者均已成为 Host 冻结的最终交付文件。
- PDF 原文件可由 DWS 下载，排除了资源不存在这一解释。模型环境已有 pypdf/openpyxl；未安装新解析依赖。模型自行执行的下载命令未显式指定 profile，不能将其当作严格渠道中立、受限模式或同账号绑定合同通过的证据。

## 群内交付失败

任务已完成不代表用户已在群内收到结果。本轮正文通知状态为 unknown，sendAttemptCount=1，无 receipt。错误为 GROUP_REPLY_INTERNAL_DETAILS。正文包含与本任务 taskId 相同的批次字符串；离线复用 assertConversationReply(text,[taskId]) 可重现拒绝。保留门禁，没有删改身份检查来让测试通过。

两份报告文件通知均为 prepared，依赖正文通知先送达。证据采集时 readbackAttemptCount=7；这是应用自身回读，不是再次发送。knownNotSent=false，不能擅自把持久状态改为未发送或安全重试。

独立使用同一保存 canonical profile，通过 dws chat +search-msg 在原测试群按批次搜索，时间范围为北京时间 22:49:00 至 23:04:16（左闭右开）：complete=true、partial=false、hasMore=false、failedCount=0、failures=[]。唯一匹配是原验证请求，未找到该结果正文；此结论只覆盖该查询范围，不声称未来不会送达。没有真实完成回复消息 ID，不能伪造精确回读通过。

## 根因与边界

1. packages/dingtalk-core/dws-adapter.js:565 只将受支持扩展名转成文字，PDF 走格式不支持分支；临时下载文件随后被清理。这是适配层拒绝，不是钉钉原资源丢失。
2. packages/dingtalk-core/task-session-service.js:671 的材料合同只接 text 或 image；原始任意文件没有对应交付形态。PDF 失败在材料快照里归为 RESOURCE_READ_FAILED，具体格式原因被丢失。
3. src/channels/message-safety.js:20 对已知内部身份拒绝外发。此次模型照指令复述了恰好成为 taskId 的批次名，通知在门禁处受阻；材料读取成功与群内交付失败是两层结果。

若后续实施资源接入，优先让渠道插件在已绑定账号和来源上下文下载原文件，再由 Host 以文件名、MIME、长度及哈希冻结为任务材料，任务只消费受控本地路径。另两种方案的限制是：逐格式解析只能覆盖已实现格式，不能代替通用原件交付；签名链接需要验证任务侧实际可达性、凭据隔离及过期语义。本轮只交付验证结论，不实施跨层合同改造，也不自动修复外发链。

## 证据、清理与未执行项

- 脱敏 proof.json 保留本轮最终关键事实；真实材料、work、任务会话、冻结产物及通知记录继续保留在既有安装的任务归档与 SQLite 中，不迁移、不删除。
- 脱敏证据与本报告已独立核对；清理脚本先运行 --check，再删除本批十份发送侧临时样本与含私有标识的查询输出，独立只读检查确认该临时目录已不存在。任务原件与正式证据保留。
- 本轮无运行时代码变化，执行的是实际钉钉、插件、Host、模型任务与平台查询验收；未重复运行 pnpm test、test:runtime、test:routing、test:containment 或生产构建。
- 收尾只读 /health 返回 HTTP 200、status=degraded、recoveryIssueCount=2；原服务仍运行，不声称健康全绿。本轮没有为告警清水位、重启或改变未知通知状态，也没有展开另一条恢复排障主线。

## 结论

PNG 附件、TXT 和 XLSX 的插件内容交付及任务读取通过。PDF 只有模型绕行读取通过，插件没有交付可达材料；群完成回复与报告附件尚未送达。整体资源接入与交付验收不通过，不创建全绿 report.md。
