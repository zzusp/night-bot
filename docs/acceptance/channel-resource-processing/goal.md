# 钉钉资源处理真实验证

## 目标

验证已授权测试群的图片、文本、表格和 PDF，区分平台资源、插件读取、Host 材料冻结、任务内容处理及群内送达。资源须由插件交付实际可达材料或链接，不能把原生 ID 当作访问路径。本轮为验证，不修改产品代码、凭据、账本或恢复水位。

## 当前结论（2026-11-09，Asia/Shanghai）

- 验证完成，整体不通过：PNG 图片附件、TXT、XLSX 的插件读取和内容处理通过；PDF 插件格式不支持且材料 unavailable，模型自行 DWS 下载加 Python 解析才得到答案。
- 任务五条来源全部绑定，completed、drained=true，Router 完成事件 consumed，完整 Pi journal 与四份原始文件哈希已独立核验。
- 完成回复触发 GROUP_REPLY_INTERNAL_DETAILS，状态 unknown，无平台收据；两份报告附件 prepared。独立平台搜索只找到原请求，未找到结果正文。没有改状态或手工补发。
- 原生 image 消息、在线文档和 Word 未实测。PNG 是 file 附件；不得冒充原生 image 通过。
- 验证基线为 main / a6299b7d2db088b38d0cbed1abe1bfe2019f31d7，运行时源码未改。用户随后要求将本目录的验收记录通过 feature 分支提交 PR；本次只归档文档及脱敏证据，不实施产品修复、不重部署、不合并、不触发 CI。提交与 PR 状态以 Git/GitHub 独立回查为准。

## 证据与边界

完整结果集中在 [round-1.md](round-1.md)、[matrix.csv](matrix.csv) 和 [round-1/proof.json](round-1/proof.json)。任务自身材料、报告、会话与账本保留在既有安装；发送侧临时副本在报告核对后清理，私有身份与原始回执不进入 Git。原本地服务保留运行。

后续若另行授权实施，需同时补齐插件原始文件交付及 Host 受控材料合同，并处理结果正文中的内部身份外发拒绝；本轮没有自动扩展为修复或新一轮测试。
