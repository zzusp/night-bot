# 实际验证

**本页前半部分是 `b16ac53` 的基线记录。当前替换后的结果见末尾“原生状态服务替换后的验证”；不能沿用基线测试数充作当前代码的证据。**

环境：托管 Linux 云机，Node.js 24.19.0，pnpm 11.25.0，2026-11-04。源主干为 `93e431a2a76938d32aefc070b093fcfb65691c70`。测试均使用隔离文件目录、脚本模型或 loopback 模型端点、模拟 DWS，不发送真实消息。

| 命令 | 结果 |
|---|---|
| `pnpm install --frozen-lockfile --ignore-scripts --store-dir /tmp/pnpm-store` | 通过，lock 可复现 |
| `pnpm test` | 12 项通过，核心 200 模块/3 UI 排除/1 明确适配/相对导入/静态 HTTP 路由守恒通过 |
| `pnpm test:domain` | 388 项通过，无跳过 |
| `pnpm test:routing` | 47 项通过，无跳过 |
| `pnpm test:runtime` | **142 项通过，0 失败、0 跳过**（最终整组复测，142331ms） |
| 产物隔离回归 `task-artifact-scope-native` | 6 项：1 通过、4 因宿主沙箱不可用失败、1 Windows 专属项跳过；不得算作通过 |

本地 HTTP wire 测试使用真实 pi-ai OpenAI 兼容协议解析和真实 PiLoopAgent，验证两次模型请求、一次实际 Host 工具调用和后续工具结果入模。CLI 测试实际启动 `bin/night-bot.js`，读取 `/health` 并通过 SIGTERM 正常退出。该协议测试不证明真实模型的自主判断质量。

原生服务测试覆盖 11 个执行成员、容量队列、共享资源、原会话续办、反馈消费、未知操作不重放、已完成文件交付不重做，以及冻结交付后的通知部分恢复。文件守恒不是行为覆盖的替代物，因此同时保留原测试，未删断言或改业务规则来凑通过。

## 修正与复测

初次迁移发现并修复：重复请求钩子导致日志步骤不闭合；Pi 二次 schema 验证提前拒绝 Host/Zod 默认值；隐藏工具尝试绕过原审计；技能刷新 context 在实际请求前未重采样。修复后分别运行原生服务、技能、角色限制和 wire 路径。

完整 runtime 第一次最终运行 141/142 通过，人工协调中“独立成员按原会话恢复”一次超时；单项及整个人工协调组复测通过。根因是测试仅将 Date 临时推进到重试时刻，恢复异步入场前又把时钟退回。测试现保留模拟时间直到原执行真正恢复并排空，保留业务、原会话、版本和不重放的全部断言；最终整组复测结果记录在下方。不能把单项复测冒充整组通过。

## 环境阻塞与未验证部分

- **shell 产物隔离：** DSH 的 sandbox provider 返回 `SANDBOX_UNAVAILABLE`，拒绝 unconfined 运行。云机虽然有 `/usr/bin/bwrap`，实际 `bwrap --ro-bind / / --unshare-user -- true` 返回 `setting up uid map: Read-only file system`。源仓库使用原 DSH 循环在相同依赖/云机上定点复测，返回同样的 `SANDBOX_UNAVAILABLE`，详见 `evidence/upstream-sandbox-baseline.txt`。本次没有改系统权限、关闭沙箱或以完整权限重跑这些测试。跨产物 root 的文件 API 拒绝与权限恢复仍有通过证据，但受限 shell 下完整产物隔离验收尚未完成。
- Windows/MSYS 专属项在 Linux 未执行。
- 未配置真实钉钉凭据、业务模型/数据库/Bytebase/GitHub/浏览器插件；真实群收发、真实自主模型语义、完整原生子代理业务、外部工作流、定时外发、Claude 后端和 Windows 部署没有验收。实现及配置接口保留，不能称这些能力已在生产验证。
- 无生产部署、数据迁移、合并或业务副作用。所有新代码仍需目标环境及实际 provider 验收。
- GitHub API `https://api.github.com/user` 返回 `Forbidden`；当前环境网络白名单不含 `api.github.com`，无法验证账号或创建草稿 PR。`gh auth status` 的“token invalid”提示不能单独证明凭据失效；Git 推送结果另行记录。

日志证据在 `docs/evidence/`（仅清理行尾空白），其中 initial 文件包含首次失败，刻意保留，不作为最终通过结果。当前实现仍有 DSH Host 依赖和单会话工具串行的吞吐差异，详见 MIGRATION。

## 最终收束

四组主验证共 589 项通过；产物隔离组另有 1 项通过，合计 **590 项通过、4 项环境阻塞失败、1 项 Windows 专属跳过**。最终运行时整组 142/142 通过，日志为 `evidence/runtime-final.txt`。源文件守恒、CLI/wire、领域与路由组全部通过；受限 shell 产物隔离的 4 个失败没有豁免。

远端写入预检 `GIT_TERMINAL_PROMPT=0 git push --dry-run origin HEAD:refs/heads/feat/pi-headless-runtime` 返回 `Permission to zzusp/night-bot.git denied to zzusp` 和 HTTP 403。该预检没有推送内容；未在相同证据下重试实际写入。草稿 PR 正文已保存在 `docs/PR-DRAFT.md`。远端创建分支/PR仍被阻塞；本地分支与 Git bundle 可交接给有写权限的环境。

## 原生状态服务替换后的验证

DSH 依赖审计见 `DSH-AUDIT.md` 和 `runtime-audit.json`。本轮替换 active JSON 域与默认模型服务，并分离生产与开发直接依赖；状态明确为 **部分迁移，尚非去 DSH 完成品**。

| 本轮验证 | 实际结果 |
|---|---|
| `pnpm test` | 20/20 通过；含 8 个新原生状态合同、真实 wire、CLI/HTTP 模型保存与重启读回；文件守恒 200 核心/3 UI 排除/3 明确适配通过 |
| `pnpm test:runtime`（新 native state Host） | 142/142 通过，0 跳过 |
| `pnpm test:routing`（新 native state Host） | 47/47 通过，0 跳过 |
| `pnpm test:domain` | 388/388 通过，0 跳过 |
| `pnpm test:containment` | 仍为 1 通过、4 `SANDBOX_UNAVAILABLE` 相关失败、1 Windows 跳过；未降低隔离 |
| 独立副本仅安装生产依赖 | 正常 frozen-lockfile/supply-chain 校验通过，461 包安装；未安装开发直接根 `dsh-base`、`dsh-app-boot`、旧 `dsh-agent-loop`、`dsh-storage-json`、`dsh-agent-default-model` |
| 生产依赖副本的 `pi-wire` / `pi-native-state` | 10/10 通过；包括实际 CLI 重启、模型 API 保存和实际 wire/tool 请求，不依赖完整测试 profile |
| `pnpm audit:runtime` | 生成明确的部分迁移报告，仍有 56 个生产直接 DSH 包；四个旧 active service 挂载已移除 |

主验证共 597 个用例通过，含 containment 的额外 1 个通过后合计 **598 通过、4 环境阻塞失败、1 Windows 跳过**。生产副本 10 项是重复环境验证，不叠加到独立用例数。最后一轮仅调整新存储的失败/清理错误合并，随后复跑了 20 项应用自有测试和生产副本 10 项；没有把这两个小组冒充重新执行全部 142 项。

首次尝试 production offline 安装时缺少 supply-chain 镜像元数据，因此失败，没有把后续缺依赖的测试当业务失败或通过。改用正常网络策略允许的 registry 在线 frozen 安装，校验通过；缓存只放 `/tmp`，没有绕过供给链校验、改变代理或使用另一身份。

新日志前缀为 `evidence/native-state-*`。JSON 域兼容原单文档格式，拒绝损坏、版本不符、重复进程内 writer 和符号链接；rename 后发生 I/O 不确定性时冻结 handle，避免旧内存继续覆盖磁盘。可选额外 per-record 插件布局未实现，明确报错，不能声称其已迁移。真正的 Pi 会话、工具/沙箱、凭据/附件、技能/子代理和 workspace 层仍待替换。

远端 403 拒绝未获得新的相关授权/凭据证据，**本轮没有重试推送或另换账号/环境**，也没有创建 PR、合并或部署。原始 bundle 仍保留，后续本地提交单独打包。

## Pi 权威会话阶段（本轮）

新日志实际由 `@mariozechner/pi-coding-agent@0.73.1` SessionManager 构造，物理格式为 Pi v3；模型输入 flush 后读取其分支，不再从旧 `deriveMessages()` 取得。`pi-wire` 测试把旧方法设为抛错，真实本地 OpenAI SSE 和工具往返仍成功；CLI/HTTP 重启保存模型测试继续保留。新 `pi-session-authority` 核验分支退役/完整审计、完整提交与撕裂尾部、完整记录篡改拒绝、读句柄不释放写权、无记录初始化可回滚、旧 v4 导入及写锁、路径链接拒绝、真实多模态字节以及旧运行时在 Pi 两次租约间改日志时拒绝恢复。`pi-replay` 核验原生签名、响应身份和异常/外来 replay 降级。

针对恢复与权限边界的二次代码审查发现并修复：打开失败须释放已取得的旧 writer fence；写入与清理错误必须共同保留且标记提交结果不确定；旧日志指纹不能只在首次导入验证；源 task log 递归扫描不得追入会在关闭时消失的 Pi 临时租约目录（仍拒绝目录项 symlink，由 Pi 校验 lease）；排空跟踪不能在异步释放容量前移除 promise。保留原容量/共享资源/恢复测试断言，权限纠正测试改为解码 Pi 原生 custom 审计事件并明确核对头版本3，不再假设旧物理日志格式。

检查范围限制：当前并未把旧 DSH Session/factory/工具权限/provider 兼容层移除，旧 v4 导入仍调用隔离的旧 JSONL reader/writer-fence 服务；未在真实钉钉或生产日志上操作。OS sandbox 的四项环境失败仍是实际阻塞，未放宽权限以通过。远端 push 未重试，PR/合并/部署均未发生。

恢复补充审查：旧图片日志导入在附件不可用时必须保留原日志、撤销 Pi authority 注册并释放两侧 writer fence；新增测试连续两次失败后仍可打开旧 writer，验证失败路径不会留下假活跃会话。native lease close 为幂等，清理失败仍保留原因。没有把这类失败当成工具已执行或可自动重试的证据。

本阶段结果：`pnpm test` 36/36、`test:runtime` 142/142（约221秒）、`test:routing` 47/47、`test:domain` 388/388；containment 1通过/4环境失败/1 Windows跳过，独立通过合计614。重复定向排查不重复计数。全量运行时回归已验证四种容量组合、共享资源队列、真实进程恢复、正常关闭与崩溃恢复不重放，失败过的旧物理格式断言及目录扫描竞态均已修复后重跑。

统一版本阶段：官方 @earendil-works core/SDK/pi-ai 1.5.0，`finishTurn` 正确保留结束/拒绝语义；本地49、运行时142、路由47均通过。新增13项原生 catalog 配置测试尚不表示 Host provider 已接管。上一0b7d6c2归档在独立克隆仅安装生产依赖后运行26项测试通过（重复验证，不与本地数量相加）。

## 本地 Pi provider 阶段

Host 已将旧 provider 插件替换为本地 `NativePiProvider`；旧 `dsh-llm-pi-ai` 仅留在开发依赖供历史/差分测试。实际调用 Pi Models.streamSimple，保留已有通用 LLM 中间件及审计协议，不声称这些剩余 DSH seam 已去除。生产 DSH 直接依赖55。

- 本地测试99/99；包含旧 provider 的公开接口差分，41个 catalog provider、1592个模型的目录、推理/控制/上下文更新元数据，以及 prepared call 的默认值一致（不调用厂商接口）。
- 实际本地 HTTP/SSE 验证 Completions、Responses 和 Anthropic Messages 的请求、鉴权头、文本、usage 和 replay；PiLoop 完整工具往返与 CLI/HTTP 保存后重启继续通过。新测试还核对 prepared call 固定一代 endpoint，后续请求采用新配置。
- 凭据/OAuth refresh 排他、未挂载存储不假装保存、非法/缺失 key、登录设备码/提示/取消信号、动态 catalog 诊断、模型覆盖、工具声明、图像预算/逐出现次数卸载、text-only 和只读文件路径、流超时/中止/审计失败、quota/rate/context错误分类均有隔离测试。测试没有真实 OAuth 登录、钉钉外发或生产写入。
- 运行时142/142（约223秒）、路由47/47。本阶段领域代码未变，领域388及 containment 1通过/4 OS环境失败/1 Windows跳过沿用此前单独记录，未混称新执行。
- 对恢复错误分类作了二次审查，修正 quota 必须使用既有 `QUOTA` 分类、显式 context overflow 表述、重复存储模型的目录过滤、text-only adapter直调拒绝图片、以及 audit observer 抛错不能让 native stream 永久悬挂。

真实厂商 OAuth、AWS/Vertex/Azure 环境、WebSocket 等外部后端尚未验证；静态 catalog/登录映射和本地协议验证不能代替它们。通用 LLM/chunk/附件策略兼容层、工具/权限/进程服务、工厂与 registry 仍待完整迁移；当时 OS sandbox 检查仍未通过，后续复核见下；远端403未重试。

沙箱阻塞复核：经执行器批准的只读 `bwrap --ro-bind / / --unshare-user -- true` 探测在外层包装之外退出0；同样批准范围内运行原 `pnpm test:containment`，5通过、0失败、1 Windows跳过（约6秒）。之前4失败来自外层包装只读 uid_map，而非应用或云机内核。没有改沙箱/权限/测试断言。

生产安装修复复核：首次 fresh `--prod` 验证发现 provider context 引用了仅开发依赖的 attachment 尺寸 helper。已改为本地 `pi-provider-image.js`（横/竖/极端比例与预算差分），并加入 provider 未挂载则启动失败的真实 Host 测试；新增脚本检查218个运行时文件的92处字面量 bare imports，防止开发依赖掩盖生产缺项。最终本地101/101；只安装生产依赖的隔离副本74/74（重复验证，不相加）。离线安装曾因 typebox 镜像元数据缺失失败，随后正常 registry 安装成功，未绕过权限或改变锁定版本。

## 本地工具执行链替换

Host 与任务测试均挂载 NativeTools，覆盖分层注册/限制、单调权限、审计、输出约束、取消排空及可选 PTC 并行/顺序提交。工具调用意图在副作用前 flush 到 Pi 日志，结果在交给下一轮模型前持久化；flush 失败禁止 dispatch。PTC 退出会排空已开始的执行与审计，拒绝未开始的工作，不自动重放。

本轮应用测试128、任务运行时142、路由47、领域388全部通过；containment在获准的执行器外层执行6通过/1 Windows跳过，共711项独立通过。实际 Node PTC worker验证工作目录写入、嵌套文件工具RPC、外部路径拒绝和空继承环境。回归运行时约272秒，较上阶段约223秒增加，反映新增持久化屏障成本；未做吞吐基准。最后的纯渲染与异常getter改动由定向测试及128项应用组覆盖，未冒充再次运行完整任务组。

仍保留 DSH scope/schema/event carriers、通用 LLM、进程/jobs/sandbox后端、附件/凭据及工厂等；生产直接DSH依赖仍55个。此阶段不能标记完整迁移。生产闭包检查221文件/101裸导入均已声明。远端403未重试。

全新独立目录仅安装生产依赖（frozen-lockfile、ignore-scripts），wire/CLI/state/Pi authority/NativeTools/approval及公开工具差分48项重复验证通过，不叠加711项独立用例计数。

## 本地后台任务注册表

NativeJobs 已替换 Host 和任务恢复 fixture 的 jobs-local。8项注册表用例包含旧公开契约差分、UTF-8输出环、归属/作用域访问、限额、wait取消、最终pump读取、observer隔离、owner关闭实际排空及取消抛错的孤儿不确定性。

本轮应用136、任务运行时142（约301秒）、路由47、领域388全部通过，containment 6通过/1 Windows跳过，共719项独立通过。全新仅生产依赖副本47项wire/state/authority/tools等及7项注册表定向测试通过，共54项重复验证；公开旧jobs-local差分仅在开发依赖环境执行。225个实际运行时文件逐字节与生产副本一致。最后只新增Host必要服务检查及wire构造类型断言，定向wire/注册表11项和生产wire3项复跑通过；未重跑整组142项。

pnpm因仅调整依赖分组曾尝试自动重装而命中不可写默认缓存/无TTY保护；改用既定/tmp缓存和正常frozen安装成功，再直接执行node测试。未把这些启动失败当业务回归。54个生产直接DSH依赖和7个已替换active服务见runtime-audit.json；剩余进程后端仍存在，不能标记全迁移完成。远端403未重试，未创建PR/合并/部署。

## 本地沙箱与进程后端

新NativeSandbox下原142项运行时回归先通过；接入本地源代码派生managed-process后，再次完整运行142项通过（约300秒）。最新应用154、路由47、领域388全通过，containment 8通过/1 Windows跳过，共739项独立通过；其中4项是尚未接入主循环的原生事件捕获原型单元测试，不能据此声称LLM桥已移除。

真实内核测试覆盖read-only/workspace-write的目录内外写入；真实process测试覆盖argv/取消、bounded output/spill/独立读游标、Linux私有0600请求一次性消费与execve精确环境、PTY输出与整会话关闭，以及直接命令退出后仍有后代、只有terminate并观测范围排空才能宣告退出。当前云机可能选择原先允许的fallback进程树管理；未把它宣称为用户systemd scope或Windows Job实机验证。

全新仅生产依赖副本71项重复验证通过，234个运行时文件逐字节一致。生产导入检查现递归扫描src子目录并检查literal lazy loads，共231个JS文件/118个裸引用，全部声明。进程平台实现保留原MIT来源、哈希与明确适配记录；不是复制代码就算完全去DSH。Windows ACL仍是生产依赖，真实Windows/macOS、外部供应商和真实钉钉均未验收。远端403未重试。

## 本地LLM与Agent registry、原生Pi事件

最新应用178项通过（含5项尚未挂载NativeProjections原型测试）、任务运行时142项通过（约277秒）、路由47、领域388通过、containment 8通过/1 Windows跳过，共763独立通过。先前原生事件切换142、NativeLlm切换142、NativeAgents切换142分别通过；审查修复“middleware只改delta仍须拥有输出控制”后再次完整运行最新142项，并保留三种本地真实协议与wire断言`pi-native`。没有将前序重复回归叠加计数。

独立仅生产依赖副本99项重复验证通过，238个运行时文件与最终manifest/lock逐字节一致；235个JS文件/125个裸引用全部声明。Agent类型/helper生产包为兼容既有RPC/子代理类型资源明确保留，故依赖数仍55；不把依赖分组变化冒充运行时迁移。NativeLlm的元数据/一次性call/热切换绑定/RPC标记与原实现公开契约差分通过，middleware拒绝与迭代清理错误仍按原边界传播。

NativeAgents验证创建期间卸载的顺序、失败回滚、相同id不同父实例隔离、ALS原Promise身份/排空/重入关闭、单工厂所有权、原id卸载以及事件scope/subject不可伪造。没有替换v4审计facade、Session/Projection服务及剩余权限/外部能力，也未做真实供应商或钉钉操作。远端403未重试。

## Session、Projection、策略与启动环境阶段

NativeSessions、NativeProjections、NativePolicy 均已挂载。自有测试195通过、完整任务运行时142通过、路由47通过、领域388通过、真实隔离8通过且Windows1跳过，共780通过。完整运行时是在策略挂载后执行；随后核心mode helper切换另跑31项相关回归，启动环境再以真实CLI与本地模型wire验证。未把子集测试冒充再次运行完整142项。

独立生产依赖副本重复验证116项（103核心/6沙箱/7后台任务），不叠加独立用例数。运行时代码241文件与副本一致；静态闭包检查238文件/130裸导入。保留200个核心模块，排除3个UI模块，6个核心模块明确适配。日志见evidence/native-session-policy-*，机器结果见validation-results.json。

SessionManager仍是Pi权威持久上下文；NativeSessions仍依赖原v4内存facade及publicationEntry兼容hook，未宣称完整去DSH。凭据、附件、部分工具/权限与skills/workspace等仍待替换。GitHub403拒绝未重试，未创建远端PR或合并。

## 原生凭据阶段

自有208、任务运行时142、路由47、领域388全部通过；加上上一阶段未更改隔离后端的8通过/1 Windows跳过，当前独立793通过。完整runtime274389ms在挂载NativeCredentials后执行；后续相同值提交确认与Pi auth取消检查以自有208/生产118最终复测覆盖，没有把小组冒充再次完整runtime。

全新生产依赖副本frozen安装通过，243运行时文件及manifest/lock逐字节一致；重复118通过（108核心+10本地凭据合同），不叠加独立数。旧credentials-local仅开发依赖，两个旧后端差分测试明确不在生产合同组选取范围，未以缺模块失败充作通过。静态闭包240文件/134裸导入；200核心/3UI排除/6适配守恒。

证据evidence/native-credentials-*。真实旧进程/新进程交叉锁、原子文件替换和删除、死PID恢复、未知锁拒绝、inode替换围栏、关闭排空、Pi入场取消、注释与0600、错误不回显秘密、损坏credential启动拒绝均有定点测试。授权会话服务本阶段仍保留；没有真实OAuth、供应商、钉钉或业务操作。远端403未重试，未提交远端PR、合并或部署。

## 原生授权会话阶段

自有225（其中17授权合同）、完整任务142（274331ms）通过；保留此前未改动领域388、路由47、隔离8通过/1Windows跳过证据，当前独立810通过。任务fixture不挂载authorization，本轮完整142是任务无回归证据；真实授权验收来自17合同、实际Pi Models登录和真实Host/CLI/wire。后加ALS提交观察归属和reentrant close改动经过最终自有225/生产138验证，未冒充另一次完整142。

全新生产依赖frozen安装通过，重复138通过（128核心/登录/授权，10本地凭据合同），244运行时文件及manifest/lock一致。静态闭包241文件/136裸导入。原生授权的差分、取消、close/drain、自注销、不误认其他writer和实际Pi SDK登录均经过验证。没有真实供应商OAuth或DingTalk副作用。日志evidence/native-authorization-*；仍为部分迁移，远端403未重试。

## 原生工作目录阶段

自有233（其中8目录合同）、完整任务142（273494ms）、路由47、真实隔离8通过/1Windows跳过；领域388沿用未改业务模块的凭据阶段证据。当前独立818通过。目录服务在root/preset/原生任务fixture均挂载后执行回归；随后增加required-service启动检查，以最终11项目录/wire/CLI测试覆盖。

全新生产依赖副本frozen安装通过，重复145通过（128核心+17凭据/目录合同），245运行时文件及manifest/lock一致。旧后端差分测试依赖开发包，明确不选择到生产合同组。闭包242文件/140裸导入；200核心/3UI排除/6适配守恒。证据evidence/native-directory-*。没有真实业务、外发或远端写入，403未重试。

## 原生附件阶段

自有247（含13附件合同与1实际Pi image wire）、完整任务142（278189ms）、领域388、路由47通过。隔离沿用未变的目录阶段8通过/1Windows跳过，当前独立832通过。所有当前运行时代码均在上述回归前已挂载，随后只新增审查断言与文档。

全新生产依赖frozen安装通过，实际Sharp codec不依赖安装脚本；重复156通过（129核心/实际图片wire +27凭据/目录/附件合同），249运行时文件及manifest/lock一致。旧backend差分依赖开发包，明确不选择到生产合同组。闭包246文件/142裸导入；200核心/3UI排除/6适配守恒。

文件引用/路径/流和PNG/JPEG/WebP/GIF、16-bit、alpha、orientation/metadata、normalization、请求衍生字节/variant身份有旧新差分；源原件immutable、摘要/计数、拒绝损坏去重覆盖、canon base64/批次先验证、暂存清理、暂停read关闭、共享取消和链接边界有实际文件测试。真实Pi SDK本地请求证明衍生图预算与原件不变。codec在Linux真实执行；Windows/macOS原生平台未真实验收，真实供应商、DingTalk和业务外部系统仍未触发。证据evidence/native-attachments-*；52直接DSH依赖/18活动服务替换是部分迁移记录。远端403未重试。

## 原生技能注册表阶段

自有257（其中10注册表合同）、完整任务142（273833ms）、路由47通过；沿用未变业务领域388及目录隔离8通过/1Windows跳过，当前独立842通过。NativeSkills在默认Host和任务fixture挂载后跑完整回归；后加closed provider-factory guard经最终自有257/生产166验证，没有冒充重新跑完整142。

全新生产依赖安装通过，重复166通过（139核心/registry+27本地凭据/目录/附件合同），250运行时文件及manifest/lock一致。闭包247文件/145裸导入。文件发现/watch仍是原provider，公开skill helper仍保留，不把注册表更换当作文件provider完成迁移。证据evidence/native-skills-*。52直接DSH依赖/19活动服务替换；远端403未重试，无PR/合并/部署。

## 原生技能文件与监听阶段

最终自有270、完整任务142（266347ms）、路由47通过；领域388与隔离8通过/1Windows跳过沿用未改模块的前阶段证据，独立855通过。全部运行时代码，包括registry卸载撤销与默认watch:true修复，均在最终完整142执行前完成。另一次早期142不冒充最终结果。

全新生产依赖frozen安装通过，重复178通过（141核心/registry/真实正文刷新wire+37本地合同），252运行时文件及manifest/lock一致。闭包249文件/149裸导入；200核心/3UI排除/6适配守恒。watcher派生文件与manifest hash一致，MIT notice保留。

11文件provider合同、11registry合同、真实Host外部metadata更新及真实Pi正文单独变更/提示/显式重读/旧审计提供证据。旧provider差分不选择到生产合同组。watcher在Linux执行，Windows/macOS实机未验收。51直接DSH依赖/20活动替换仍是部分迁移；无真实供应商或DingTalk副作用，403未重试。日志evidence/native-skill-filesystem-*。

## 原生工作区验证

最终own288/288、完整runtime142/142（270105.91513ms）、routing47/47均通过。沿用未改动domain388及工作目录阶段真实containment8通过/1 Windows跳过，共873个独立通过。新17项workspace合同与1实际Pi wire包含旧服务差分、canonical成员、header-only恢复、pending marker/回滚、观察一致性、关闭排空与归档祖先拦截。

全新`/tmp/night-bot-workspace-production`使用production frozen install显式ignore-scripts后复测159+37=196项通过，253运行文件及manifest/lock逐字一致；静态250 JS文件/152字面bare imports通过。首次未指定ignore-scripts的安装因pnpm拒绝未批准build scripts返回非零，未把该次安装当成功；没有批准或运行额外脚本，验证使用保留的预构建运行依赖。证据见`evidence/native-workspace-*.txt`。

生产DSH直接依赖51，活动服务替换21，仍非完整迁移。工作区旧包仅保留公开错误身份；权限/FS/shell/子代理及Session facade等仍待替换。没有真实业务调用、远端重试、PR或合并。

## 无界面授权与凭据刷新验证

最终own298/298、完整runtime142/142（261246.609146ms）、routing47/47通过；未改动domain388与原containment8通过/1 Windows跳过沿用，共883独立通过。新7项operator合同、1真实Pi外部写入wire、1引用锁前取消合同及配置校验验证隐藏输入/终端恢复、提前管道答案、EOF、取消、readonly引用、真实Pi API-key登录与注销、metadata-only输出，独立CLI进程不创建workspace/业务账本/agent或DWS连接。

全新`/tmp/night-bot-operator-auth-production`production frozen ignore-scripts安装成功，178+38=216项复测通过；256运行文件及manifest/lock逐字相同，静态253 JS/154字面bare imports通过。证据`evidence/operator-auth-*.txt`。真实vendor OAuth、外部业务系统未验收，不能以fake API-key登录证明真实账号已接通。51生产DSH直接依赖/21活动服务替换保持；尚未完成全迁移。远端403未重试。

## 原生提示组装验证

最终own304/304、完整runtime142/142（257019.419773ms）、routing47/47通过；未改动domain388和containment8通过/1 Windows跳过沿用，共889独立通过。六项新增合同涵盖旧服务差分、scope覆盖、tool rest/hidden-known顺序与schema副本、complete authority、required context准入和独立suppressor生命周期。实际Pi wire断言NativeSystemPrompt构造器；正文刷新和工作目录重采样复测通过。

全新`/tmp/night-bot-system-prompt-production`production frozen ignore-scripts安装成功，184+38=222项通过；257运行文件及manifest/lock逐字一致，静态254 JS/157字面bare imports通过。证据`evidence/native-system-prompt-*.txt`。旧公开render/interpolation及scope helpers仍保留，51生产DSH直接依赖/22活动服务替换，不以此宣称完整迁移。远端403未重试。

## 原生模型请求重试验证

最终own312/312通过；新增7个retry合同与1真实Pi wire，工具成功→模型503→重试成功，全程工具/收据仅一次，并在第三次HTTP到达前从Pi reader核对retry/started持久记录。两个flush栅栏、失败或非Pi日志、取消/关闭排空、self-close、normal/always/downstream预算语义有合同证据。

任务fixture本来不挂载llm-retry，本阶段未改它；runtime142（257019.419773ms）和routing47明确沿用提示组装阶段最终整组，不声称本阶段重跑。domain388及原containment8通过/1 Windows跳过未改动也沿用。合计897独立通过。

全新`/tmp/night-bot-llm-retry-production`production frozen ignore-scripts安装成功；显式排除只在开发存在的旧retry差分后，191+38=229项通过，258运行文件及manifest/lock逐字一致，静态255 JS/158字面bare imports通过。首次负向name筛选未正确排除开发差分，产生缺旧包的一项失败；改用Node实际支持的`--test-skip-pattern`重跑后全通过，未把初次失败计作通过。证据`evidence/native-llm-retry-*.txt`。

原timeout行仅为函数库空挂载，移除不计活动服务替换；它及旧retry根依赖移到开发，传递helper依赖仍可能保留。49直接生产DSH依赖/23活动服务替换仍为部分迁移。没有远端重试、PR、合并或真实业务副作用。

## 本地子代理 provider 验证

最终own316/316通过。新增3个provider合同包含spawn/fork旧实现差分及借用事件身份/独立数组；实际Pi wire在父会话第二轮等待响应期间创建两child，验证PiLoopAgent、各自Pi authority、night-bot preset继承、spawn无父内容、fork仅包含已完成轮次。两child都自然完成并排空。该实验不验证全部continuation manager或外部provider；旧manager仍明确保留。

任务fixture保留自己的显式provider挂载，本阶段未改，runtime142（257019.419773ms）/routing47沿用提示组装阶段最终整组，不声称重跑。domain388及containment8通过/1 Windows跳过也未改动；合计901独立通过。

全新`/tmp/night-bot-subagent-providers-production`production frozen ignore-scripts安装成功，193+38=231项通过；显式排除开发差分，259运行文件及manifest/lock逐字一致，静态256 JS/159字面bare imports通过。证据`evidence/native-subagent-providers-*.txt`。47直接生产DSH依赖/25活动服务替换，仍为部分迁移。远端403未重试。

## 工具并发行为补齐验证

最终own322/322、完整runtime142/142（254585.98239ms）、routing47/47（23196.666915ms）通过。真实kernel containment重新运行8通过/1 Windows专属跳过（11904.77414ms）；依据AGENTS许可只将测试执行移出外层executor，应用自身bubblewrap/权限策略保持。未改动domain388沿用，共907独立通过。

五项实际Pi批次wire验证cap=2、乱序完成但model顺序收据、每个body前持久intent、静态/动态独占屏障、拒绝与隐藏工具零效果、取消不补位且等started body退出、一个concluding工具等全部兄弟收据后结束。异常重复id协议路径不执行body，保留ToolNotStarted可纠正收据；隔离旧串行driver基线同样通过，不宣称支持该无效vendor输出。最初测试把scope自己注册的submission工具当作可限制的继承能力，实际guard正确拒绝测试配置；改为root注册/agent限制后通过，未更改或放宽guard。

全新`/tmp/night-bot-parallel-batch-production`production frozen ignore-scripts安装成功，199+38=237项通过；259运行文件及manifest/lock逐字一致，静态256 JS/159字面bare imports通过。证据`evidence/parallel-batch-*.txt`。47直接生产DSH依赖/25活动服务替换保持，旧continuation manager/preset/FS/shell/权限等仍在；仍非完整迁移。远端403不重试。

## 原生审批/权限预设与终态提交验证

最终own341/341、完整runtime142/142（268793.216627ms）、routing47/47（25347.880652ms）通过。真实kernel containment重新8通过/1 Windows专属跳过（14037.094362ms），应用隔离未降低；domain388未改动沿用，共926独立通过。

10个approval合同和6个preset合同含旧服务差分、借用身份/scope、open-turn/live-session、问答/决定双flush、append和journal失败不grant、晚答/撤销/服务owner卸载、自关闭与已准入提交排空；preset覆盖同bundle/custom/动态默认、seeded/partial pin、当前Auto/冷恢复gate、原型名拒绝及catalog/command/RPC。三项真实Pi wire证明逐操作授权只执行一次、缺answerer失败、取消审计先于turn/end、idle等待终态sink且失败后拒绝新消息。

取消wire初次发现Pi driver未刷新最终turn/end，修复后最终日志在idle可读；终态flush失败经agent/error报告并封闭该实例，不能把idle误当成功持久化。普通取消及权限拒绝仍保持闭合日志和零未授权效果。没有测试真正外部Auto reviewer或业务账号。

全新`/tmp/night-bot-approval-presets-production`production frozen ignore-scripts安装成功，216+38=254项通过；261运行文件及manifest/lock逐字一致，静态258 JS/166字面bare imports通过。证据`evidence/native-approval-presets-*.txt`。45直接生产DSH依赖/27活动服务替换，仍非完整迁移；远端403未重试。

## 原生 Shell 环境事实验证

最终own347/347、完整runtime142/142（269070.236306ms）、routing47/47（24063.696693ms）通过。真实kernel containment九项通过、一项Windows专属跳过（13900.908611ms）；domain388未改动沿用，共933独立通过。六项合同覆盖旧实现差分、原子注册、不可变权限声明、调用者scope、异步resolver拒绝与生命周期。实际Pi→Bash→应用沙箱验证可信session/home/扩展事实注入且ambient DSH authority被剔除，未关闭应用隔离。

全新`/tmp/night-bot-shell-env-production`production frozen ignore-scripts安装成功，221核心+38合同+1真实沙箱wire=260项复测通过。262运行文件及manifest/lock逐字一致，静态259 JS/168字面bare imports通过。证据`evidence/native-shell-env-*.txt`。44直接生产DSH依赖/28活动服务替换；FS/shell工具与capability后端、指引、preset注册表和子代理续办管理器等仍待迁移。远端403未重试，未创建PR或合并。

## 原生指引上下文验证

最终own354/354、完整runtime142/142（271945.803893ms）、routing47/47（36330.030087ms）通过。真实kernel containment九项通过、一项Windows专属跳过（15174.067728ms）；domain388未改动沿用，共940独立通过。六项合同包含旧loader/renderer差分、legacy surface访问即抛错、变更/删除、嵌套执行token、capability拒绝及关闭排空；真实Pi wire验证两个global root、项目baseline、真正read后的nested发现、外部修改、删除和cwd replacement。

全新`/tmp/night-bot-agent-instructions-production`production frozen ignore-scripts安装成功，227核心/wire+38合同=265项复测通过；本阶段未声称独立生产kernel重跑。263运行文件及manifest/lock逐字一致，静态260 JS/171字面bare imports通过。最初误在开发目录执行production裁剪，导致主测试缺少开发包且runtime/routing未启动；这些结果全部作废，恢复完整frozen依赖后重跑所有受影响组，最终证据仅引用重跑日志。证据`evidence/native-agent-instructions-*.txt`。43直接生产DSH依赖/29活动服务替换；仍非完整迁移，远端403未重试。

## 原生 preset 注册表验证

最终own364/364、完整runtime142/142（276320.298322ms）、routing47/47（26412.217702ms）通过。真实kernel containment九项通过、一项Windows专属跳过（13194.834498ms）；domain388未改动沿用，共950独立通过。六项registry合同/真实Pi wires及四项preflight合同验证保留旧generation/lease、精确parent继承、不可变声明、目录/RPC元数据、根服务泄漏与缺依赖/导入失败、Pi持久选择、首次turn后锁定、等待中启动竞态、失败实例封闭及新实例resume。兼容预检保留精确ABI/exemption、patched Include、循环/不可读Include诊断；不在预检中评估插件代码。

全新`/tmp/night-bot-native-presets-production`production frozen ignore-scripts安装成功，234核心/wire+38合同=272项复测通过。265运行文件及manifest/lock逐字一致，静态262 JS/183字面bare imports通过。证据`evidence/native-presets-*.txt`。42直接生产DSH依赖/30活动服务替换，source-derived算法明确MIT归属。仍非完整迁移；后续审查发现默认Host缺少旧manager冷恢复所需sessionQuery，尚未把该功能列为完整覆盖。远端403未重试。

## 原生子代理 manager / cold query 验证

最终own384/384、runtime142/142（273832.191419ms）、routing47/47（23866.063919ms）通过。任务夹具组合未改动；新默认Host manager/query的直接行为由11项实际Pi child-control wires覆盖，不能把142任务回归当作完整generic child功能验收。真实kernel containment九项通过、一项Windows专属跳过（15906.450825ms）；domain388未改动沿用，共970独立通过。另有6个query合同、3个旧helper差分，涵盖冷读revision/handle关闭、source冲突、取消/关闭排空及self-close。

真实wires验证cold continuation不重调provider/不重放已完成工具、目录/递归未知与不可用分支、父会话完成通知、结构化纠错、人工文本和有效/无效图片、request/time-zone归属、容量forest隔离、interrupt ack与工具退出分离、scoped forest drain、startup/terminal Pi commit失败及实际Host shutdown。人工图片错误从旧AttachmentError身份切换为本地错误及当前附件服务的封闭代码识别，保留attachment-invalid；图片正文进入真实Pi wire。测试最初误把父通知HTTP算入child重复请求，已按子内容/图片识别并显式验证通知，未禁用通知。外部provider仅fake run协议，非真实后端验收。

全新`/tmp/night-bot-native-subagents-production`production frozen ignore-scripts安装成功，250实质核心/wire+38合同=288项复测通过。首次筛选把全部排除的helper文件作为Node空harness计入1项；最终移除该文件重跑，不给空harness通过计数。269运行文件及manifest/lock逐字一致，静态266 JS/201字面bare imports通过。证据`evidence/native-subagents-*.txt`。43直接DSH生产依赖（新声明一个read-only格式helper）、31个活动服务替换；此前缺失query已恢复，但仍非完整迁移。远端403未重试。

## 原生会话标题验证

最终own392/392、完整runtime142/142（266058.478842ms）、routing47/47（24867.636413ms）通过；任务夹具已切换NativeSessionTitle。真实kernel containment九项通过、一项Windows专属跳过（11203.299369ms）；domain388未改动沿用，共978独立通过。七项合同含旧normalizer/lifecycle差分、pin/late-result、声明与来源seq验证、provider卸载排空、self-unregister/owner self-close；实际Pi wire证明只有一个request/header的两轮自动标题、固定后不覆盖、显式刷新与持久cold read。

全新`/tmp/night-bot-session-title-production`production frozen ignore-scripts安装成功，256核心/wire+38合同=294项复测通过；270运行文件及manifest/lock逐字一致，静态267 JS/207字面bare imports通过。证据`evidence/native-session-title-*.txt`。原生控制器仍保留canonical公开错误身份，43直接生产DSH依赖/32活动组件替换；不是完整迁移。同步rename保留append语义，未冒充同步fsync。远端403未重试。

## 原生 Web registry / HTTP 后端验证

最终own417/417、runtime142/142（259708.737601ms）、routing47/47（22725.408041ms）通过。真实kernel containment九项通过、一项Windows专属跳过（9843.013237ms）；domain388未改动沿用，共1003独立通过。新增8 registry合同、10 HTTP合同、2实际Pi/preset wires、5配置合同；包含旧协议差分、Scope卸载排空/自关闭、DNS/NAT64/private拒绝、固定lookup真实本地socket、逐跳重校验/关闭、响应/MIME/charset预算、代理委托、timeout/abort及late resolver禁止后续HTTP。低层connector使用显式本地fixture pin，不改变public provider私网拒绝。

真实Pi web_fetch/search证明意图在provider/transport前持久化、private请求无transport、结果/错误收据及不可信内容标记保留；旧工具默认不输出provider answer，HTML的markdown转义按原行为保留。旧/new night-bot preset并存验证HTTP为Host单例，避免全局重复注册。未对真实搜索vendor/外网服务验收。

全新`/tmp/night-bot-web-production`production frozen ignore-scripts安装成功，279核心/wire+38合同=317项复测通过；273运行文件及manifest/lock逐字一致，静态270 JS/215字面bare imports通过。证据`evidence/native-web-*.txt`。42直接生产DSH依赖/34活动组件替换，仍有generic tool timeout缺口及FS/shell/工具等后续工作；不是完整迁移。远端403未重试。

## 原生 Web 工具与协作超时验证

最终own429/429、runtime142/142（260962.880164ms）、routing47/47（24453.076894ms）通过。真实kernel containment九项通过、一项Windows专属跳过（10240.516272ms）；domain388未改动沿用，共1015独立通过。新增4超时合同、3Web工具合同、2实际Pi超时wire及3配置合同。验证旧schema/render差分、校验先于provider、精确去重和有序来源、输出截断、工具启用及安全timer界限。

实际Pi wire证明timeout发出取消后仍等待已开始且忽略取消的body退出，持久化一份超时收据后才继续模型，不重放effect；search配置budget同样作用于provider。祖先和本地timer具有相同公开错误码时用reason身份保持归属。协作超时不代表进程已经终止；后端仍负责自身排空。

全新/tmp/night-bot-web-tools-production frozen production ignore-scripts安装成功，290实质核心/wire+38合同=328复测通过；275运行文件及manifest/lock逐字一致，静态272 JS/220字面bare imports通过。证据evidence/native-web-tools-*.txt。41直接DSH依赖/35活动组件替换；补回此前未挂载的timeout策略不计旧组件替换。仍非完整迁移，远端403未重试。

## 原生目录、待办与子代理工具绑定验证

最终own436/436（21194.439809ms）通过；新增4合同和3实际Pi wire。验证完整todo替换/重复与并行状态拒绝/turn reset、目录精确caller与signal、稳定adjacent marker、cold send一次续办、外来send拒绝、absent interrupt接受无操作，以及模型实际delegation创建Pi child、父目录持久记录和return guidance。18项定向回归（含既有11 manager wires）通过。初次测试误用同步throws检查async defineTool、无inject属性访问和把parent参数中的marker算成child请求；修正测试后最终通过，未放宽运行时。

全新/tmp/night-bot-control-tools-production frozen production ignore-scripts安装，296实质核心/wire+38合同=334复测通过；279运行文件及manifest/lock逐字一致，静态276 JS/232字面bare imports通过。runtime142/routing47/domain388及真实kernel9通过1 Windows跳过因夹具与对应运行边界未改动沿用d78b96e证据，不声称本阶段重跑；独立覆盖共1022通过。证据evidence/native-control-tools-*.txt。37直接DSH依赖/39活动组件替换，仍未完成全迁移；403未重试。

## 原生技能工具与 Pi 目录可见性验证

最终own442/442（21525.140975ms）通过，新增5合同及1实际Pi wire。旧schema/输出差分、Session.surface访问即抛错、Pi目录重复抑制/变更/清空、malformed seed/writer缺失、精确registration shadow、invocation禁止/incomplete snapshot、直接user手势去重与scope均通过。实际Pi三轮证明summary不偷加载body、/wire-skill注入正文且无重复catalog/无tool effect、移除后空replacement。既有OS watcher body变更与显式重读wire也在7项定向组通过。

全新/tmp/night-bot-skill-tool-production frozen production ignore-scripts安装，301实质核心/wire+38合同=339复测通过；280运行文件及manifest/lock逐字一致，静态277 JS/236字面bare imports通过。runtime142/routing47/domain388/kernel9通过1 Windows跳过因对应边界未改动沿用d78b96e证据，不声称重跑；共1028独立通过。证据evidence/native-skill-tool-*.txt。36直接DSH依赖/40活动组件替换，仍未完成迁移；403未重试。
