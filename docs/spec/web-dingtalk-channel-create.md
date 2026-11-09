# Web 添加钉钉渠道

2026-11-09 实施前快照。沿resident-conversation-routing唯一goal/原PR2；本文件不是平行UI规范，UI规则只维护根DESIGN.md。

## 目标与现状

认证安装操作者从渠道页添加钉钉群聊或私聊；配置按本安装持久化，重启进入既有可选渠道初始化/身份解析。现有页面只有GET只读，现有CLI仅支持离线Host锁内配置修改，不能让Web调用CLI假装在线生效。

## 方案比较

1. Web直接spawn离线CLI：当前Host持锁必然失败，若加绕锁参数会破坏原离线契约，排除。
2. Web新增整套即时插件加载/卸载：还需生命周期恢复、真实订阅及失败回滚，超出“添加配置”的当前需求，排除。
3. 认证Host保存准确新增配置，保留既有配置锁与起始补拉水位，并明确restartRequired/liveApplied=false：采用。复用已有钉钉校验，不恢复旧DWS运行链或默认加载厂商依赖。

## 数据与交互

仅新增，不提供任意JSON、secret/env/executable/binding、编辑/删除入口。输入渠道标识、群聊/私聊、profile、按名称或ID的一个目标及可选显示名称/职责。同一profile不猜账号、同名目标不选第一项。外发默认关闭，未授权连接或发送不在本次验证执行。

POST走现有cookie、Host/Origin与CSRF；服务端保留绑定/水位与配置锁，重复ID拒绝而非覆盖。保存成功不等于当前适配器接入成功；GET能只读核对已保存目标，UI明确待重启。连接中锁定提交，校验失败保留字段；结果未知保持原渠道标识，只读核对，不自动重发POST。认证更换丢弃旧表单/回执，秘密不进日志/截图/URL。

## 验证与交付

隔离真Host/fake DWS验证群聊与私聊的字段映射、冷配置读回、已有配置不变、水位、重复/禁字段/未认证/CSRF拒绝；不通过mock证明自己调用成功。沿现有浏览器覆盖成功/加载/失败、键盘/IME、390px、浅深色及未知结果恢复，复用既有验证入口，不扩全量厂商验收。

构建当前Web并更新本次独立预览（只停自己的受管实例，IPC排空后重启），实际页面交互验证；所有运行数据与凭据ignored。新增默认DWS加载、外发、权限切档、CI/合并/部署均禁止。原full/R45和旧unknown现场保持。

## 追加决定：运行环境账号与指定群验证

2026-11-09用户明确要求去掉profile输入，使用运行环境已登录账号，并添加“Night Bot Test”群聊测试验证。此节替代上文profile表单候选，既有CLI显式profile能力保留。

Web DTO不再接受profile；Host仅在认证操作者显式新增时，懒加载复用可选插件现有profile list与selectDwsProfile逻辑，要求全局 isCurrent=true 严格唯一，且同组织内唯一 isOrgCurrent=true 为同一账号；无当前、组织默认不一致或多候选明确拒绝，不取第一项/最近账号，不修改默认账号，不通过读取/复制相邻项目秘密实现。解析出的准确profile只进本安装受控配置，后续启动/目标解析继续绑定同一profile；默认核心与启动探测仍不加载DWS。

保留保存待重启、listen=true、writes=false及配置锁/补拉下界。Tests唯一真实执行者仅对本次3082独立安装和指定群先只读身份/唯一名称核对，再经正式Web添加；Main管理正常IPC重启与浏览器。不得顺带授权外发或自行向群发送测试话术，其他群/私聊/旧安装、CI、合并、部署不在此追加范围。旧profile候选实跑与失败/构建证据保留为R46前批，最终去profile版本按受影响边界复验，同一轮集中归档，不伪称旧结果对应最终契约。

## 追加决定：账号查询的真实进程排空

增量审查发现现有 DWS runner 超时只发送 TERM 后立即拒绝，未等真实子进程 close；本次新增的账号查询可能已结算配置调用而仍留下进程，使 Host 过早释放安装锁。

采用在现有 runner 责任层保留真实 close 观测并 join：超时保留原错误，TERM 后必要时 KILL，实际退出前调用不结算，Host 沿既有配置调用排空保持锁。改接 Native 托管进程需引入另一套策略/执行链，超出一次只读账号查询的缺口；仅在 Host catch 等待拿不到 runner 已丢弃的子进程句柄，不能修根因，两者排除。不增加新进程平台，不改变账号选择、Web DTO 或外发授权。以真实受控子进程验证超时、Host 关闭及锁/配置终态，不能用直接抛超时 Error 的 fixture 替代。

## 追加决定：当前 CLI 的用户查询封装

首次指定群冷启真实失败，保存仍正确；同源只读绑定诊断收敛到 DINGTALK_USER_RESPONSE_INVALID。当前 DWS 1.0.63 的 contact.shortcut_search_user 精确 Schema 与真实返回均为 ok/outcome/data 封装，成功 outcome 为 success，data 必需 count/users；原 searchUsers 和假 runner 错按裸 users/count 处理。

在既有可选插件 searchUsers 叶子边界按当前契约校验成功封装与完整性，再解析用户数组，继续按已保存账号精确匹配；同步受影响 fake，覆盖拒绝与不完整返回。不为旧裸 fixture 增加回退；样本字段兜底会掩盖契约错误，排除。全局解包所有 DWS JSON 会改变原子命令及其他叶子的完整性边界，缺少必要性，排除。修后先沿同源只读完整绑定链确认，再正常 IPC 冷启原保存配置，不重复新增或手工创建第二订阅。


## 追加决定：会话详情的 MCP 结构

真实完整只读绑定链通过账号与 actor 后，在 conversation-info 叶子失败。该命令的精确 Schema 标明 interface_mode=mcp、没有输出 schema；同一已保存账号与指定群的实际响应为 success/result.conversationInfo，身份不在裸 result，也不在 contact 的 data 包装。沿既有 conversationInfo 校验成功标记、result 完整性与 conversationInfo，再保留原目标 ID、会话类型和绑定漂移校验；同步受影响 fake，不添加全局解包或旧裸响应回退。修后同源只读链已通过且配置、binding、ingress 未改；这不等于冷启与订阅通过。

## 追加决定：编辑与绑定身份切换

用户追加要求已添加渠道支持编辑。本节替代最初“仅新增、无编辑”的产品范围，不提供删除、热加载或外发授权入口。

比较三条路径：直接改 row 只适合名称/职责，改目标会撞旧 binding，清旧 binding 又会混用 ingress 与丢失旧投递回查，排除；只允许未绑定渠道改目标虽较小，但不能完整满足已添加渠道的编辑，排除作为完整交付；采用固定 channelId、账号继承、按实际绑定隔离的待重启切换。该隔离只位于可选钉钉插件，不建设通用配置平台。

- 编辑显示名称、职责、会话类型、目标填写方式和目标；channelId 固定，canonical 账号由 Host 继承已保存/实际绑定，不重新选择 OS 当前账号，不向浏览器显示或接受 profile。
- 复用 Host 配置事务、配置锁、关闭排空与原子写。认证操作者通过专用白名单详情读取可编辑字段和期望版本；更新拒绝旧版本覆盖。普通列表仍不回显 profile、目标或 binding。未知结果冻结原草稿，只读比较当前字段/版本，不自动重发。
- 名称/职责原位保存，重启后应用，不热调用 updateSettings；保留原绑定、游标、deferred 与外发配置。职责可能参与后续任务推理，不宣称只影响新任务，也不改写既有事实。
- 会话类型/目标若解析为同一实际身份，保留既有绑定与全部 ingress；真正切换身份时，旧 binding/ingress 保留，新身份采用独立起点，旧任务、会话/Router、SQLite、Pi、消息与冻结通知不迁移、不重定向。
- 旧目标有未决任务、输入或投递依赖时，身份切换明确拒绝并提示处理旧依赖；保存时检查，旧 Host 排空后的冷启激活点再次检查。不能以健康、暂停或 idle 代替该检查，不能清 unknown、重放或绕过 assertTarget。新目标不继承旧外发授权。
- 同 ID 编辑需比较已保存与实际运行配置，分别呈现待重启和真实当前运行态，不以 ID 已存在声称已应用。

Core 实施后端与必要插件存储；Docs 复用现有表单/dialog、API 类型、DESIGN 与操作文档；Tests 验证真实 Host 和浏览器；Review 验证未决依赖与反例。真实本地编辑仅使用本次指定群的名称/职责，不扩大到其他真实群或私聊，不发送消息。源版本冻结后集中归档 R46 与原 PR2，未通过的关闭/冷启检查保留真实结果。

### 编辑接口决定

复用原 Web 鉴权与 CSRF：GET/PATCH `/api/channels/dingtalk/:encodedId`。详情只含 `{channelId,version,name,prompt,conversationType,targetKind,target}`，无 profile/binding；PATCH 完整白名单为 `{expectedVersion,name,prompt,conversationType,targetKind,target}`，配置锁内比较期望版本，旧表单明确冲突。成功返回 `{ok,changed,restartRequired,liveApplied,channel,detail}`；无变化也依据保存/运行实际状态返回，不能固定要求 changed=true。普通列表增加 savedVersion/runningVersion，显示配置待重启与当前运行健康，不把版本相等当作身份激活成功；冷启切换被未决依赖阻止时，仍须显式未应用/待处理。

编辑后端由 Platform 单写，Core 独占已定位的 Router 关闭根因与原恢复回归；按冻结源窗口串行写共享源，不开新执行会话。原 pi-channel 测试正被占用，允许独立 `test/pi-channel-edit.test.js` 承载编辑真 Host/CAS/身份/水位/冷启反例，避免并写和重复原新增、关闭测试。Docs/Tests 按同一 DTO 推进前端与浏览器，未通过结果保留。


### 目标切换准入屏障

只查耐久状态再同步发布绑定，仍会遗漏已进入旧 group 的 HTTP create/reopen、尚未写 source/task 的在途准入；平台提醒也可能已保存绑定但 native create 未完成。采用任务服务中按旧 group 的短 hold 与真实已接纳 flight 检查，在 hold 内完成异步耐久检查并持有至绑定发布；busy 明确拒绝，不取消或自动执行旧工作。Router/platform 的真实在途与后续 submit/recovery、新 create/reopen/retry 共用可信 active-target 断言，旧结果、drained 与终态仍可落账，历史读取不受影响，切回同身份可恢复新准入。没有托管单目标绑定的其他渠道和默认核心不新增此限制。

未决查询复用既有归档任务/来源/Router/投递账本及 deferred；现有 resident store 仅在 getPlatformSchedule 旁增加只读按 group 枚举，覆盖提醒已持久、native 尚未建立的间隙，不增表/schema/调度器。必要槽限定在 task-session-service、platform-schedule、channels/service、router-lifecycle 与原可选插件；保留 Router 已验证的精确自身取消过滤和全部 join/持久化失败上报，不顺手重构。


### 从未绑定的错误目标纠正

新增仅保存目标声明，不要求当场完成厂商绑定，因此拼错的名称或失效 ID 也可能已经保存。编辑不能以旧声明可解析为前置。比较三案：强制解析旧目标会使纠错不可用；吞掉旧解析错误并覆盖绑定或沿用水位会猜测身份，破坏漂移保护；采用仅在磁盘和 inline 均确实没有耐久 binding 时，固定已保存 canonical 账号验证新目标，按首次 managed 身份独立保存 binding/ingress，外发保持 false。已有或运行中的 binding、损坏文件和身份不匹配不得走此分流。

没有旧 binding 不等于没有旧工作：旧 context、任务、来源、投递、未来提醒、deferred 和真实在途仍受完整切换门禁。此情形核查 channel 全部既有 scope，短 hold 同时拒绝全部新业务，包括恰好匹配候选新目标的请求，避免异步扫描后的落账间隙；原结果、drained 和历史读取仍放行。厂商验证与全面门禁成功后才保存新绑定，原状态保留，不宣称同身份保水位。不新增 CLI 或通用配置机制；在既有编辑真 Host 注册内补纠错及原状态不变反例。
