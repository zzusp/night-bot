# 第三轮：原报告与两个附件恢复交付

## 范围与结论

2026-11-10，沿第一轮已完成任务及同一冻结交付，恢复原说明和两个报告文件。三件均已由真实钉钉发送/回读链确认 delivered，Web 原消息 API 也返回三个 delivered。未重跑任务、重建来源、改写冻结正文/文件或手工修改 SQLite。第二轮新 PDF/Word 任务及其他资源场景不在本次复验范围，不以本轮替代其验收。

实际源码：`df13fe5e876c55bc53e8092c62bca6dc5bafcbec`，基于已合并主线 `1514bbd`；测试安装为干净 detached 检出，同一安装数据和已保存配置。主检出有本轮前既存的历史补拉去重修改，位于插件、同一测试文件及 spec；本次仅精确提交自己的增量，未带入这些修改。报告及恢复脚本的后续提交不改变已验收运行时代码。

## 根因与修复

原始用户请求明确给出验收标记及同名报告文件，后来该标记同时成为 taskId。发送器把同值业务标记机械地当作内部身份，阻止正文；两个文件依赖父说明，因而一直 prepared。此前结清为 failed 只修复状态，未满足实际交付目标。

准备和发送共同使用可信原始来源的窄判定：仅同值任务标记不作为私有身份，其他身份、机制字段及私人路径规则仍保留。Host 按精确来源/版本/作者/会话临时提供原文，不改冻结 payload/hash。完整原本地拒发证明仅经操作者显式 CAS 恢复，事务重新检查当前任务完成版本、来源授权、未归档和产物；自动扫描不重发，未知网络结果仍只回读。本地拒发不再误触发全渠道一分钟限流等待。

## 真实业务结果

| 交付件 | 最终状态 | 平台验证 | 送达时间（UTC） |
| --- | --- | --- | --- |
| 原说明正文 | delivered | 原消息/会话及内容回读确认 | 2026-11-10 03:03:50.320 |
| resource-check-8a7dfbaa.md | delivered | 4153 bytes；SHA-256 de2fd902eb00dbb243fa36972a6f6ff9109f458ae2d05bdd48e43cc18ae82722 | 2026-11-10 03:03:55.076 |
| verification.json | delivered | 2609 bytes；SHA-256 9196e86b6d9afef6f06be7a8903b31c15ddcbd1da9eebabd5b540eea04eb76cd | 2026-11-10 03:03:59.649 |

- 原父说明发送尝试为2：第一次有完整本地拒发证明、未进入平台；本次才实际发送。两个文件发送次数各1；未生成第二份通知或替代文件。
- 恢复期间逐件比较原 payload/digest 均未变化，父摘要仍为 `7aeed44dcd112d9efb666403879e2a3ade266cec334166474873438ff7c95fb1`。任务完整快照比较未变，仍 completed/drained、五条来源；任务唯一 Pi journal 最后修改时间为 2026-11-09 14:57:21.062 UTC，早于本次恢复。
- 恢复验收脚本第一次把正常追加的发送/回读观测也计入完整 source 哈希，最终断言失败，但三件已经送达，未再次恢复或发送。独立只读核验：当前139条 stages 取原133条前缀后，能精确复现恢复前完整 source 哈希 `d48629131bbddb746f581f63183e8ce8e70b91bfd93537a7b0dafb067544e97b`；只有6条合法观测追加，来源业务字段未改变。脚本已改为比较来源业务快照，并增加只读 `--verify`；实际 `--verify` 通过，不掩盖原断言失败。
- 真实 Web 3080 正常登录后调用会话消息分页 API，原父件及两个子件均为 delivered，对应“已送达”；随后正常退出登录，未输出 token/cookie。
- 原监督器通过 IPC 正常排空退出，元数据/Host 锁移除及端口释放独立核验；更新干净检出后启动自检、三守卫及服务健康通过。现有 Bot 保持运行。未合并新修复 PR、未正式发布、未触发 CI。

## 本地验证

- `node --experimental-test-module-mocks --test test/group-notification.test.js test/task-notification-delivery.test.js`：48 PASS，0 FAIL/skip。
- `node --experimental-test-module-mocks --test --test-name-pattern='default application neutral Router tools' test/pi-channel-plugin.test.js`：2 PASS。包含公开标记/同名文件、真正私有 ID 提前拒绝、本地失败不自动重发、显式 CAS 恢复、伪造证明/接纳证据/重复点击拒绝、原任务和冻结 payload 不变、文件按序回读、冷恢复不重复。
- 上述正式 Host 用例初次发现本地拒发误触发全渠道60秒等待，文件未进入回读；修复责任层后同一组2例通过，未放宽期限或断言。
- `node --experimental-test-module-mocks --test test/native-dws-send.test.js test/task-notification-readback.test.js test/task-final-delivery.test.js`：26 PASS，0 FAIL/skip，覆盖实际适配器参数、身份/正文核对及文件回读大小/哈希拒绝反例。
- `pnpm check`：源码哈希、生产导入、原生运行时三守卫通过；实际候选检出同样通过。
- `scripts/recover-original-delivery.mjs --check <installation> <notification>`：零副作用自检通过。`--apply` 只调用一次正式 loopback Host 恢复入口；其末尾过宽 source 哈希断言失败的处理见前文。随后 `--verify` 独立通过，正文及两个文件状态和平台字节收据确认。

本轮共76项定向用例通过。完整 default/runtime/routing 未复跑；上一阶段 routing 的14项失败已在未改动 main/a9db763 同项复现，不将其描述成全绿，也未扩入本次修复。

## 边界与证据

可复用恢复工具为 `scripts/recover-original-delivery.mjs`：`--check` 无副作用，`--apply` 只续指定原通知，`--verify` 只读核验已送达记录。运行数据、日志原文、任务材料、凭据和原生平台身份不入库；本报告保留必要结果摘要。历史轮次报告与矩阵不覆盖，本轮没有新增临时截图/附件供后续清理。
