# 第 12 轮：原测试恢复与 Pi 权限增量

> 附件清理说明（2026-11-09）：按只保留最新轮最终证据及大 binary 不入库规则，本轮已无当前用途的 2 张 attempt-6 Loaded 浅/深色 PNG 已经精确清单 --check 后以同清单 --run 清理。正文中的截图路径、哈希及最终图描述仅记录当轮历史，对应附件现已清理；原文字结果、PASS/FAIL 和受验版本边界不变，普通文本证据、复用脚本及其余审计材料保留。

## 范围与版本

本轮沿原 worktree/分支/PR，Tests 仅修改测试、隔离夹具及验收记录；产品修复由原 Core、Platform、插件责任人实施。HEAD 为 `6d79b0a0279d3f94f2d72d21f51ab1d654b0f509`，受验源码含未提交的协作修改，不能用 HEAD 代替实际版本。每批真实版本绑定在同名 `*-source.json`，结果与日志在 `round-12/`。SG11/SG12 仍 ACTIVE，本报告不是最终全绿报告。

本阶段不重复已过旧 runtime/Web/credentials/restart，不重跑旧 CPU 诊断或 Profile 回收。所有模型为本地脚本端点，渠道为 fake DWS；无真实渠道发送、模型 API、CI、合并、部署或 Git 写操作。

## 已执行结果

| 批次/证据前缀 | 实际结果 | 结论与边界 |
| --- | --- | --- |
| `repaired-default-files-terminal-audit` | 原 credentials 13、restart 2 与 flow 17 的注册断言通过，flow 文件持续 CPU，精确受控停止 | 原文件级 FAIL 保留；raw 曾将受控退出误标自然退出，以独立 terminal-audit 纠正，不改 raw |
| `flow-cpu-diagnostic` | 17 注册通过后取得 2843 个 CPU 样本，精确 worker/runner/launcher 收口 | 仅诊断成功，不是自然业务 PASS；未再次执行该诊断 |
| `win32-exact-owned-profile-recovery` | 唯一执行自然 0，原 Profile 双 SID、94 字节原始 Moniker、目录 FileID 重验后原名删除一次，目录/注册缺席 | 仅准确已有专属资源回收；`storageApiBindingVerified`、`cleanupComplete`、`productionAdmissible` 仍 false，不追改旧 unknown |
| `permission-wire-attempt-1` | 9 项：3 PASS / 6 FAIL，自然 1 | 保留首次真实失败；ask 的 `PERMISSION_FILE_ARGUMENT_CHANGED` 是产品缺陷；auto 首批等待抢跑另列，不误报默认模型未接线 |
| `permission-auto-diagnostic` | uncertain 转人工 1 PASS，自然 0 | 真实 reviewCalls=1、modelRequests=2、人工 reject 零效果；仅旧版本定向证据 |
| `permission-ask-repaired` | 1 PASS，Node 自然 0 | 真实文件 write/read/独立 edit/兄弟路径拒绝；Python 在落盘终态后打印 Unicode 遭 GBK 错误，wrapper 1，不称整个执行器成功 |
| `flow-watcher-repaired` | 原 17 注册全部 PASS，Node 自然 0 | 不改原断言，无受控 stop；440 源 changed=[]；同样保留 Python GBK 打印失败/wrapper 1 |
| `permission-wire-repaired` | 10 项：6 PASS / 4 FAIL，自然 1 | auto strict allow、extra-fields/model-error 人工回退、CLI/认证 HTTP、CAS、symlink 拒绝通过；full 是真实产品缺陷，三 pwsh 尚被测试服务访问错误阻挡 |
| `dws-observer-lifecycle` | 新增 2 PASS，自然 0 | serial/concurrent ready 仅一个 observer；stop 等在途创建及准确关闭尾链；stop 后不重建。脚本化 observer 接缝，不冒充厂商实测 |
| `permission-full-and-commit` | 9 项：4 PASS / 5 FAIL，自然 1 | full 文件/持久/冷启/禁止 actor 换档及三项真 pwsh 通过；5 个新 FS 测试接缝错误保留。仅 windows-profile 宽图漂移，不能写成全部源稳定 |
| `permission-commit-scoped-fs` | 5 项：4 PASS / 1 FAIL，自然 1 | nonportable 真授权消费、portable alias、fsynced staging 后 cancel/epoch 均通过；nonportable alias 提前停在 preflight，实际 FS_NOT_OBSERVED，未形成目标竞态 |
| `permission-final-writer-alias` | 2 PASS，自然 0 | portable/nonportable 均真正进入 shared writeText 最后 checkedTarget await；切换 alias 后实际 PERMISSION_SCOPE_CHANGED，两物理文件不变；440 源 changed=[] |
| `job-resource-audit` | 新增 4 PASS，自然 0 | 真实 Pi 持久 journal 与脚本 native 边界；462 源 changed=[]。不创建 Profile、不应用 ACL，不代表原生 Windows 准入 |
| `docker-build-current` | 构建自然 0 | 491 输入 changed=[]，新镜像身份见后文；`applicationRuntimeValidated=false`，未用构建替代容器业务验收 |

独立只读 OS 查询曾确认 PID 39336、39012、101868 均缺席；其余批次以各自然 Node/launcher 终态为证，不扩大为全部 PID 已独立 CIM 核验。

## 权限实现及有效刺激

本阶段最终文件权限三源为：tool-permissions `b450b019e837316f28267e45dca63578e4d4af26750bf61b30fbef9cc9231919`、native-fs-sandbox `e708189753e461492296ec4de6c5c3255be51ccaef7a1b956e913d53b666131c`、memory/private-fs `28533b0d3a84e72a41ee1b9a8ac4c8efbc58ce4d8bfa5a6a9b0787b3092dceac`。ask 修复辅助 cwd lookup 后通过；最终 writer 对已有文件记录的授权缺失仍严格拒绝，未降级旧策略。full 再修 PrivateFS.admit 对辅助 cwd 的无条件 authorize，未放宽真实目标校验。

真实 IO gate 使用官方 Pi 实际持有的 `agentPresets.serviceFor(actor,'fs')`，不是 actor 继承 FS。最后 alias 两项仅在真实 `writeText` 动态调用中暂停 checkedTarget；先前 preflight 的 FS_NOT_OBSERVED 不满足最终窗口证明，故保留失败后精准复验，不把错误列表放宽。staging 两项暂停于原 LocalFS 已写入且 fsync 后，取消/切档后目标缺席且目录为空，证明没有发布和残留临时文件。

full 三项实际调用生产 pwsh：前台物理外部文件写入成功；后台在 prepare 未完成前不返回、spawn ready 后返回、tool 完成后 Job 仍运行，随后物理文件与 Job completed；准备期取消 starts=0、无文件。显式 full 是 OS 账号直接执行，不能替代 ask/auto 受限后端或 Windows LPAC 验收。

## 浏览器分阶段结果

真实 Edge、真实 Host/application/HTTP、真 cookie/Origin/CSRF、隔离本地模型，未拦截 API。权限方法仅 gate 真实时序或在实际提交后抛错，不注入假授权/假文件结果。每次续验只接未完成场景；下面不能合称同版整批通过。

| 批次 | 实际结果与完成阶段 | 保留的失败/局限 |
| --- | --- | --- |
| 首批 `web-permission-browser` | Node 自然 1；三档保存与配置回读、full 保护说明、allow 真实文件、reject/revoke 零效果、真实取消竞争 HTTP409 且 POST 一次已完成 | session 阶段复用刚 cancel 的终结 actor，PI_OFFICIAL_ACTOR_NOT_LIVE；本注册 0 PASS / 1 FAIL |
| `attempt-2` | Node 自然 1 | 第二页 logout→login 的未认证空窗与第一页真实读取竞争，脚本在旧面板已不可用时等待关闭按钮；未形成预定旧 CSRF 刺激，不报产品失败 |
| `attempt-3` | 真实同 browser context POST /login 替换共享 cookie；旧 logout 403→只读 session200，同页草稿保留；旧审批响应迟到不污染新面板；实际 full 已落配置但响应500，仅 GET 核对，PUT 一次 | 后续 fieldset 自身 toBeDisabled matcher 失败；日志中实际 fieldset disabled 且 radio 的无障碍快照为 disabled。本注册仍 0 PASS / 1 FAIL，不能追认为整注册 PASS |
| `attempt-4` | Node 自然 1 | 一次性读取故障被写后在途 GET 消耗，随后真实显式 GET200 已恢复；未持续保持故障到观测点，不能凭此报前端漏禁用 |
| `attempt-5` | 自然 0 / 1 PASS；等当前 full 快照完成，故障持续至真实 radio disabled，显式 GET 恢复；键盘打开、焦点约束、Escape 恢复、390px 无页面横滚；463 源 changed=[] | 实际查看截图发现深色图仍为 Loading，故不把该图当已加载内容视觉证据；两张旧图已由最终 Loaded 图替代，清理情况见末节 |
| `attempt-6` | 仅补内容已加载后的 390px 浅/深色图，自然 0 / 1 PASS，463 源 changed=[]；两图已实际查看，权限内容、三档和 full 警示可读 | 不重复前述业务，也不按测试标题扩大通过范围 |

最终前端仍为原 11 源集合 `eab3e6f18a072e4ce144880af4e01d0f309a01c4a3cf9966eee2893d02a66b81`，dist/index `11bff44133d8ac2d9d4376554b53b84e22deff2dbafc1e17a3d5c65c9620f1e2`；本线没有产品前端修改或重建。attempt-5 result/run 为 `dc8fdc8e`/`8e159a48`；attempt-6 result/source 为 `58caeafd`/`28a87377`。最终图为 `round-12/web-permission-attempt-6-light-mobile.png` SHA `7e36db8e4318013d9a5ed01eb4e1e1bb7e57ebc4d09d9a39cb5519a93b1714c6`、`round-12/web-permission-attempt-6-dark-mobile.png` SHA `38d1ba011cfcb7413d1eb4e1f64d8a2e75af28f7024ea6028988897baca7fe70`。失败批只有起始 source-map，未补造其完整起止稳定结论。

## Job 资源耐久增量

`job-resource-audit-result.json` SHA `57eca8ffe62b46ebed0eddbf618f60ee87c3d6f63baa3a58e317282313cff7e7`，source-map SHA `f3119a1d02e6e16f524cda7e0d5fc36349795968978230f1b2960fe43e48a5b3`，log SHA `d1a8e17a2a0b2e23327de30237a4c51e3cfeb11163dbf518323fd57f12539f59`，测试 SHA `2606de6084d9dc5e0c2898b973c14ea7c38f3499569f0aedb8c917853fd55070`。受验 native-jobs `b8d4e3757d9e3e45f8ee2899a5318999b72625eedaf9540aa4d93bf03c054962`、runtime/job-ledger `2766d5ba064847635daf03c3f786df1874a3612ec622f40fc167d5c3c35afdd7`。

四项分别证明：planned identity commit 未完成时脚本 native 边界不进入；commit 失败不 ack、不发布成功终态；producer failed 且资源 unknown 后真实 Pi 冷重开仍阻止继续/不重放，错误 seq/call/name/count/SID 或缺失释放证明不能清除；并行工具调用的 ALS Recorder 不串属，ephemeral producer 不继承耐久资源 owner。真实 OS Create/ACL/Job 对象仍未在本批执行，脚本化 descriptor 不冒充 native 释放证明。原 18 个 ledger 注册未无理由重跑。

## 当前 Docker 构建

沿原 `docs/tmp/sg12-docker-tuna-build.mjs` SHA `4bc371dc`，先实际 `--check` exit0/effects0，再 `--run`，宿主 `ba65lo1an` 于 2026-11-08T04:09:19.654Z 自然 0。严格 HTTPS 镜像站/签名/摘要与既有无凭据代理保持，代理值未记录；没有改 daemon、系统策略或应用 sandbox。

独立 `docker image inspect` 核新镜像：

- tag：`night-bot:sg12-current-fe541e3b-r12`
- ID：`sha256:0c6c6f8c665a222d64390252df473b22b2cae9cfc09cbd133f73c509dbc9575c`
- Linux/amd64，镜像用户 `node`。
- 491 个构建输入起止 `sourceChanged=[]`。
- result SHA `bc1c3ebd4c009ea5c5e21e5b032cad35379242361cc1c166fdff7eee2cbc2a17`；source-map SHA `bc7f650e92563b5fa80d0471d394c344090fc4016e8c14788a8007ba0be5bfa4`；log SHA `e62a0a02cdc43f50dd3ddeddf9d6e807f8b530c039bb78e9de29444b3f6e4c81`。

这只证明当前镜像构建；容器未据此判定业务可用，`applicationRuntimeValidated=false`。既有旧镜像/旧 driver 不充当本版结果。构建结束即交回 Core/Platform 的实际源码消费窗口，不继续冻结。

## 库存与矩阵

本阶段复用已有 AST 库存提取器（只解析，不执行旧测试）：520 文件、5175 个当前注册、未解析 0。保留库存历史身份，不因源码退休抹旧注册。`test-case-inventory.csv` 从 5386 到 5414 行，新增 28 个漏登/新增注册：20 权限、2 DWS 生命周期、4 资源审计及此前漏登的 2 个 SG12 登录注册。43 个逐完整名称证据更新为本轮 PASS：flow17、权限20、生命周期2、资源4；各条绑定实际 test/source/log，不能相加成同版完整组通过。所有已有 registration_sha256 保持不变。

库存 SHA `ce25f4cc9aeb3008360984e75e3b9e5a1fc4f3fa28e597768e31ab1c3db0774b`。旧 approval3、channel 原有项、ledger18 未重跑，仅更新当前源/行号元数据，原历史证据仍保持历史边界。两个漏登 SG12 登录注册本阶段没有已映射逐项结果，明确 `NO_OBSERVED_RESULT`，不由同文件通过项推断。矩阵新增本阶段条目，不覆写原 flow 受控失败行。

## 清理与剩余

最终 Loaded 图已核哈希并实际查看。attempt-5 的两张旧截图不再支撑结论，按精确清单清理；attempt-5 的结果/源码/日志和所有 1–4 失败保留，原轮次结果不变。CPU 原始诊断和准确 Profile 回收证据仍有审计用途，本阶段不重跑、不泛化清理。

SG11/SG12 尚未完成：Windows 受限 LPAC 的实际生产准入、owned Profile/mandatory cleanup、秘密/跨任务读与未来继承/rename-delete、ordinary/ConPTY 完整生命周期仍待；新镜像 fresh/恢复卷 temp0700、隔离本地模型业务与 drain、可选 DWS waiting-auth/同容器 fake 登录自动接入未验；routing/domain/containment 剩余完整组与最终同版 guard、集中 Review 和原 PR 交付未完成。full 不能抵受限档，静态/helper/构建不能抵业务终态；无新真实厂商/生产验收结论。下一阶段直接消费本次精确镜像，不重建已成功镜像或重跑已闭权限/flow。
