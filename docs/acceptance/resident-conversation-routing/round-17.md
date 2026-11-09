# 第 17 轮：确认消息精确绑定与冷启全周期补证

## 范围与版本

沿原 worktree/分支，HEAD 6d79b0a0279d3f94f2d72d21f51ab1d654b0f509加未提交协作源码。只改ignored应用驱动，不改产品、不重build、不重新跑正式test注册。复用第16轮491源封包镜像 `sha256:be1ffc45ee8a451ccddc63453305bde839ba4c01029a82d6bc26e79ef0c6d5e0`；来源仍为第16轮manifest/source-map。安全参数和11源绑定不变：node非root、cap-drop ALL、NNP、root只读、network none、正式9264f168 seccomp及独立tmpfs/新卷。

第16轮实际活动SDK关闭成立，但确认requestId未保留、全局开关可能让较早task.completed内部批抢先hold。按原Review反例，最新驱动只认最新Router user envelope；成功settle返回须准确conversation/generation/cursor，tool_call_id接回本批settle调用且eventIds全集相等；本批source.messageId还须等于保存的closeRequestId并同conversation。旧内部批正常结束，不靠task completed/idle推Router排空。activeRequest保无秘密来源/版本/批次/settle身份。第二次stop自然0后才核steps及task Pi全文，覆盖整个冷启关闭周期。原Review完整静态读新driver，确认上述差量，未执行本批命令。

## 实际结果

`docs/tmp/sg12-current-app-r17.mjs` SHA `28f50b6d84e2d8726c7553efba6e0ad1f98994bc640d8f5278163040aefe44b3`。node --check及--check effects0后执行；宿主bob2zp7hn、容器均自然0，06:45:01.836Z–06:45:14.960Z。独立docker inspect确认容器 `ce6215869e055abcefa2e46dd40d8aa5f50d2359a48f47610a73022692f646d0` 已exited/0/Pid0，image和owner准确。专属卷 `night-bot-sg12-data-current-r17`，owner sg12-current-r17。

- 正式entrypoint run启动完整Host；认证HTTP Chat→triage→Router→唯一task Pi，真实write/bash/read/task_result。task container-business-r17完成/idle，summary CONTAINER_BUSINESS_R17_COMPLETE；三份work/tmp实际文件值逐个匹配，bash私有token读拒绝。401、坏CSRF403、foreign Origin403均实际观察。
- 指定确认messageId和closeRequestId均 `59a3308a-d409-4c73-bacf-be946d2d50b5`，source `im:05907bda1317d819e3adf3b98210c9b75e5f9780b91f00be9d1aff986c91bd71`，version1。
- 本批唯一event `router-event:49ec6b3f60369770ddd5a45b3583dfcc9e534aad8ac6914099deaadbb6847dc6`，batchEventIds与settleEventIds完全一致。conversation `conversation-6d2d38111e21f4426d32db021ae0106659032af3f8aa39b02dfa06bf5c5e8d99`、generation3、settledCursor3、settleCallId container-call-15，operationId绑定该event。
- 仅以上确认批成功settle后的真实SDK HTTP16在途hold。正式CLI SIGTERM→自然0，server真实res.close，activeRequest.disconnected=true；没有手工release或提前关模型server。总17个本地模型请求。
- 同卷冷启instance night-0fc4d9fd-da78-4324-9987-910d51351243和原task完成/idle保持。第二次stop自然0后steps4→4，原task Pi全文SHA前后均 `63ce19f4c1a39b5262a0702d64cc5ed268f53bbc8d46317d2811171617507583`，无task工具重放。hostClosed/modelClosed=true，stderr空。

## 证据与剩余边界

证据在round-17/：docker-application-result.json SHA `513ff146180d0df17964afaacec34c4ff7f39ba9b41b9b622fae46bffdb5ae85`；docker-application.log SHA `90c9a4653ae3cd089b88dea14f4502bcb05b6035d670f5feb078cf1aea671d0b`。结果与stdout digest、真实容器状态已由另条只读命令核验，所有source来自镜像而非后续工作树版本。

本轮仅正式CLI/完整Host正常关闭，不是镜像默认CMD/tini/PID1的docker stop链；不证明Host异常close全路径。无真实模型API、渠道、登录、浏览器或Native Windows。fake自动接入、宿主浏览器与Windows生产链、最终guards/交付仍待既定后续；SG11/SG12继续ACTIVE，不写全绿report.md，不做Git/CI/合并/部署。

matrix集中新增round_17列，仅标本次业务/精确活动关闭/冷启三行；build未重跑。不新增正式测试注册，不重刷库存。第16轮原结果范围保在round-16.md与round_16列，确认归属缺证未改成产品FAIL。旧轮次重复应用附件与本任务停态资源在最终证据核验后按精确清单清理，构建manifest/source-map仍支撑本轮而保留。

## 阶段收口

原Review已独立核实际result/stdout/空stderr、driver与491源图、精确确认批身份和全冷周期；不是仅静态审查或自报通过。无Tests在途命令。清理脚本先--check后--run，只删本任务r16/r17两套已自然exited/0/Pid0的容器与无运行writer的专属卷；两套完整ID/label及五个旧重复附件SHA在 `round-17/docker-owned-cleanup.json`，SHA `df80a699c2005717c3a11c118e9c35c605eab1524f6d5b5aa206ed9dc3510c58`。另条只读命令核容器/卷/旧附件缺席，最新结果/日志及构建来源仍存在，be1镜像保留。没有删除未知资源、live WAL/锁或历史报告。
