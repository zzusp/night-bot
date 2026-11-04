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
