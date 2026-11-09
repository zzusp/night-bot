# 第30轮：Linux六例实际执行与 provider 分列

## 结论与范围

本轮六个原注册在 Linux 当前封定源码镜像中实际执行：**6 PASS、0 FAIL、0 CANCEL、0 SKIP**。三个 Node 测试 worker 的六次实际 ordinary provider 选择全部为 fallback；**强所有权未证，不是 linux-scope 通过，也不是完整 Linux runbook 或 SG11/SG12 完成**。

构建 exit 0；测试 Node/容器 exit 0、attach CLI exit 0、独立 docker wait 回报 0；采集 driver exit 1 来自强 owner 判据未满足，不能称业务六例失败或整轮全绿。businessPass=true、strongOwnerPass=false、overallPass=false。本轮没有重新运行 Windows Native、真实渠道或真实模型 API，没有 Git 写入、CI、合并或部署。

## 实际版本与执行

- 原 worktree resident-conversation-plan/night-bot，分支 worktree-resident-conversation-routing，HEAD `6d79b0a0279d3f94f2d72d21f51ab1d654b0f509`；共享工作树未提交。结果绑定封定工作树内容，不只以 HEAD 代表。
- 生产构建输入共491项，封定及构建起止无漂移；source map SHA256 `88bc62104ce17e4bc534f5899576e4709a9ac6d254f1fc0c0131535daf569723`。逐文件映射只在 `round-30/linux-build-source-map.json` 维护；五项测试 payload 单列于 `round-30/linux-payload-source.json`。
- 镜像 `sha256:beec97219da9aede1f0e33eefca5899b36f7a39e5969b442170ea3540e22431b`，linux/amd64、User node；实际测试 Node v24.13.0、linux、uid1000。Windows 宿主 Node v24.19.0 不与其混写。
- 构建任务 bmg3o7c55：2026-11-08 12:21:31.239–12:21:45.315 UTC（北京时间20:21:31.239–20:21:45.315），exit0、sourceChanged=[]；构建成功不单独等于应用运行验收。
- 测试任务 b39s3x1n5：2026-11-08 12:23:06.392–12:23:17.608 UTC（北京时间20:23:06.392–20:23:17.608），TAP duration 8538.033737ms；后台任务均已接回，无在途构建或测试。
- 实际 driver SHA256 `e30b1ddf442fe0eb9d32a15629e6b8b21ce729fcebd564afecf8b81afbe60945`，与执行 receipt 相等。中途采样 dfb43c71 不是执行稿；准确 e30 差量已有原 Review 执行后核回，不倒签 dfb 前审。正式报告/矩阵/库存待集中独立核验。

封定 Windows 关联源码为 windows-acl f5c414c9、windows-profile22513f6e、win32 730d4649、contracts a9eb7a93、process/index c5028b99；完整 SHA 见上述逐文件 source map。这只界定镜像内容，不说明 Windows 分支在 Linux 执行。封后 ACL63afcbaf 的 NULL-SACL 拒绝门不在本轮版本，不能追认其行为通过；Profile225 真实生产准备链亦未由本轮覆盖。

## 命令与逐例结果

沿原 Dockerfile、entrypoint、seccomp 的严格构建路径，先 check 再构建/运行。严格 TLS、APT 签名和发行资产摘要验证未降级；无凭据代理的真实地址不进入证据。容器只读绑定精确五文件测试目录；运行前实际校验十项生产输入及全部五项 payload hash。

```text
node --import ./test/fixtures/sg11-linux-provider-observer.mjs --test --test-reporter=tap --test-concurrency=1 --test-name-pattern=<六个准确注册全名的锚定或式>
  test/native-shell-kernel-wire.test.js
  test/native-managed-shell-kernel.test.js
  test/native-memory-privacy-kernel.test.js
```

选择器用 Node24 原生 RegExp.escape 逐项构造，准确 argv 保留在 `round-30/linux-six-driver.mjs`。以下均来自原始 `round-30/linux-six.log`，不是按文件级聚合推测：

| 原注册全名 | 结果 | TAP行 |
| --- | --- | --- |
| real Linux confined shell joins cancellation of a process that refuses TERM | PASS | 6 |
| Linux owned subprocess direct exit cannot settle shell completion while a descendant remains | PASS | 12 |
| portable model processes cannot read the vault or inherit provider/environment credential values | PASS | 19 |
| task archive fences absolute writes, symlink escapes and private journals in an actual model shell; task temporary files stay local | PASS | 26 |
| actual Pi native confined bash retains one managed effect through explicit background and job collection | PASS | 33 |
| actual Pi native confined bash retains one managed effect through timeout promotion and job collection | PASS | 40 |

两隐私例实际执行当前 ask/portable 断言。脚本/本地模型与 fixture 值不含真实凭据，不是实模型或供应商集成证据。

## provider 与实际隔离

observer 在容器 test/fixtures，相对导入指向 /opt/night-bot/src/process/index.js；只通过 --import 进入 Node 测试 worker，不注入业务 runner。它包住真实 selectContainmentMode，以 Reflect.apply 保留 this/参数、返回原选择、重抛原异常；未替换 provider 或预跑独立 probe 代替业务选路。

| 实际worker | sequence | 原实际选择 |
| --- | --- | --- |
| pid21 native-managed-shell-kernel | 1、2 | ordinary → fallback |
| pid60 native-memory-privacy-kernel | 1、2 | ordinary → fallback |
| pid91 native-shell-kernel-wire | 1、2 | ordinary → fallback |

这些观测只支持 fallback 条件下的六例结果。强 owner 环境缺口仍在，没有加权限或同条件机械重跑。

实际 inspect 已核：非root、network none、cap-drop ALL、no-new-privileges、root read-only、一个精确只读测试bind、仅 /tmp 与 /opt/night-bot/data 两个tmpfs，seccomp 内容等原配置，Privileged=false。没有 privileged、SYS_ADMIN、SYS_PTRACE、unconfined、Docker socket、整棵宿主挂载或宿主策略修改。实际 AppArmorProfile=""，没有设置禁用flag；不能声称受AppArmor保护。

专属容器 night-bot-sg11-linux-six-current 自然终态 exited/running=false/exitCode0/oomKilled=false，经独立 wait、归属label核对后普通rm，已独立inspect核缺席；未force、tree kill或影响其它容器。

## 库存、矩阵与最终附件

- 库存保5468身份，只改六个原注册的逐例证据字段为准确版本PASS；身份、registration hash、当前源码元信息、分类和其它行不变。证据绑定实际TAP行、payload SHA、fallback、镜像和source map，不外推强owner。
- 库存SHA256 `a8051a1e6570249d0a69a4c74d0f176d327cf8cb844b03b101defa05d010465a`；按index六项fieldsBefore独立逆构，精确回原全文 `467fabea4de2708fac4bb45312d75f48e5911a1ad6028bbc4c5c2f6790764457`。
- 矩阵仍293业务行，只增round_30。原sg10-linux-containment为 `PARTIAL_SIX_CURRENT_CASES_PASS_PROVIDER_FALLBACK6_STRONG_OWNER_UNPROVEN_NOT_FULL_RUNBOOK`，其余292行NOT_RERUN_ROUND_30，不改历史场景或业务身份。
- 矩阵SHA256 `5c9ecd41bd7273a752b48b916271f72ca626db139fb0e8c9f23e9b3c3b10d801`；独立剥新列逐字节回第29轮 `2da8c245cc1febcbf6eb3e2be6d9be6cfc501a058921763817ef5344376fce9f`。
- 最终证据集中在round-30/，共12份文字附件：构建source map/result/log、payload map、测试result/log/stderr、准确seal/build/test driver、observer，以及linux-batch-index.json。11个被索引附件均独立核bytes/SHA等归档前源；index统一保附件hash、实际provider、退出码、逐例结果及逆构元数据，不再复制第二套hash清单。
- 脚本副本为准确执行源码证据，内部仍引用当时docs/tmp路径，不是可直接重跑的自包含入口。生产源码由受验映射和版本库追溯，不保存一套运行树。

## 清理与剩余项

归档核hash后，精确清理本批13个自有临时文件、491项构建输入目录和五项payload目录；清理脚本先--check/effects0再run。随后独立只读核13文件、两个目录和清理脚本自身共16路径均缺席，归档附件仍原hash。未删r20等既有上下文、原Windows探针/私有证据或四个失败根。

第29轮报告只追加observer原临时路径清理注，原结果和Native附件未改；移除该注可逐字节重建原报告b3776e10。第30轮observer保原1014B/hash。镜像保留供本目标尚未闭合的强owner环境调查，没有运行容器。

本轮只闭合六项业务证据与归档；SG11/SG12仍ACTIVE。Linux强owner、macOS原生执行端、Windows生产受限链/ConPTY、NULL拒绝门行为和最终同版检查仍需独立证据。后续仅准备Nt最小组件准确稿交Review，不先Native；门回归不与API表达能力、传播观察或生产scopeReady混为一项通过。不修改goal/spec/生产实现，不Git写入，不建全绿report。
