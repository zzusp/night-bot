# 第3轮：OSS 凭据继承修复与真实签名读取

## 范围与源码

2026-11-11，北京时间。用户追加要求修复已查明的 OSS 工具进程凭据不可见问题，并沿既有授权完成合并、正式发布与原任务只读验证。本轮已闭环；另一个节点调查仍等待节点级权限及历史指标，不属于本轮 OSS 修复。

- [PR #56](https://github.com/zzusp/night-bot/pull/56) 已于12:49:29+08:00合并，merge `23a470bd7c31b71c81e61aa0499f1c525e243a33`。
- Windows实跑来源为 `9b4037c` 基线上的修复工作树，随后提交为 `8af1d054b8dc0e3b4ea895d0a79652c4f6095782`；正式镜像从与当时origin/main一致的干净merge `23a470b` 构建。
- 后续收尾分支仅修改验收文档与脱敏证据；镜像源码绑定上述已合并版本，不把文档HEAD冒充线上源码。未触发CI。

## 根因与修复

Pod exec和应用主进程中的两个变量都存在且非空。普通进程的 `scrubbedParentEnv` 清理敏感名称，旧Host的full最终spawn边界只特别补回GitHub凭据，因此任务只能发匿名请求。匿名403不能证明凭据无效或bucket授权失败。

`src/memory/privacy.js:74`复用Host已绑定的direct/full与bash/pwsh最终启动边界，补回可信process快照中被敏感名称规则过滤的业务变量；排除NIGHT_BOT_/DSH_，保持显式调用环境及GitHub凭据服务优先级。`src/native-environment.js:13`提供来源受限的快照枚举。没有全局去掉过滤、硬编码OSS变量特例或修改Pod环境。

备选方案与排除依据见[实施前快照](../../spec/full-shell-credential-inheritance.md)。普通进程、非shell、ask/auto没有新增凭据路径。Linux单次私有launch文件可能短暂承载目标env并消费后删除；目标程序主动打印的内容仍可能进日志、Pi或spill，不承诺通用自动脱敏。

## 本地与正式镜像

| 检查 | 真实结果 | 证明范围 |
| --- | --- | --- |
| 修复前真实默认任务 | EXPECTED-FAIL：1个断言失败，GitHub true，其余3项false | 任务completed不等于获得凭据，定位最终启动层 |
| 最终Windows针对性组合 | 7 PASS、0 FAIL、1平台SKIP；8319.8518ms | 真实pwsh/Node：4个业务假凭据匹配，私有namespace缺席，记录无原值，任务completed/drained |
| Linux正式镜像同组合 | 8 PASS、0 FAIL、0 SKIP；3650.771756ms | 镜像自身源码/依赖，真实bash及execve bootstrap；只读挂载当前test目录 |
| `pnpm check` | PASS：424运行时JS、0外部SDK导入 | 修复源码的source/hash/import/native守卫 |
| 默认应用入口与Web交互 | PASS：请求202后可见已提交回复，脚本模型1次调用 | 真正启动应用，不以import或测试夹具代替应用入口 |
| Web负例 | 未认证401、错误Origin403、缺CSRF403 | 认证请求正常 |
| 正常排空与同卷恢复 | 退出0、host lock消失；身份/token/旧会话保持 | 重复请求新增模型调用0，旧cookie失效 |
| 无头浏览器 | DOM为42；API/CLI截图均9460bytes、1280x720，已查看 | headless shell158.0.8127.18，无完整有头Chromium |

针对性命令：

```powershell
node --experimental-test-module-mocks --test --test-concurrency=1 --test-name-pattern='operator full native task child inherits|environment|process privacy|strips ambient|ordinary managed' test/pi-approval-wire.test.js test/pi-native-environment.test.js test/pi-native-shell-env.test.js test/pi-native-process.test.js test/pi-official-memory-privacy.test.js
```

镜像业务smoke复用 `docs/acceptance/docker-cloud-readiness/scripts/verify-runtime.mjs`，先 `--check`，再用独立专属卷实跑。全程非root、只读根、drop ALL、no-new-privileges及固定seccomp；测试不挂载宿主node_modules，不连接真实模型或钉钉。

正式tag：`headless-23a470b`。

Manifest：`sha256:8cd6ed07c876b165e22264dffe0182a9d7bcf90a4132b4e317541a99422a334c`。

Config/本地Image ID：`sha256:4b9a80fa1b9b8e6aa95ae1f8bb0293758e47f617e46d1236b0f923e819f8cf9b`。

远端manifest独立回读与本地已验Image ID、OCI完整revision匹配，平台linux/amd64。

## 云端原卷升级

按既有Docker/Kubernetes runbook暂停接纳，确认task、execution、group、operation、未决通知及分诊/Router队列计数均0，再正常缩容0；未SIGKILL、未删锁/尾部或重放快照。

- 新镜像在原PVC离线检查通过：SQLite quick_check=ok，host lock缺席，44份Pi journal以显式configPath及portable codec严格完整解码，2个task/session身份匹配。数量来自本轮重新枚举，没有沿用上一轮32。
- 暂停前后44份持久journal逐路径/摘要完全相同。一次性Job的UID、labels、Complete状态与证明对应，删除后独立get确认不存在。
- 13:02:16+08:00核实新Pod实际digest及4个关键源码hash匹配正式源码；原PVC、实例/actor、Web token、归一化配置hash保持。除应用/init镜像外Deployment spec完全相同，包括全部ENV/envFrom、Secret/ConfigMap引用、挂载及安全参数。
- UID1000、CapEff0、NoNewPrivs1、Seccomp2、temp0700；permissionMode仍full，属于容器OS账号权限，不是管理员或应用bwrap隔离。
- 通过原生认证Web接口恢复接纳，独立回读receiving/listening、无ingress错误。保留既有DWS登录态，没有重新登录或重置水位。
- 13:09:27+08:00最终检查：所有排空计数仍0；实际枚举47份journal，增量来自本轮真实输入/任务结果。原任务journal经严格解码回读，未将“已调度”当作完成。

## 原任务真实签名验证

13:03:01+08:00在唯一已解析测试群发送一次新认证只读续办消息，先dry-run，再发送并通过完整厂商查询回读。没有直接改SQLite、humanRequests或重放旧tool。

Router于13:03:37+08:00将原缺少受控签名入口的问题结清为answered，resolution.kind=router，保留新source及理由；原服务访问任务仍使用原唯一执行session，requirementRevision未变。它没有把“平台已修复”的陈述直接当作签名成功，执行会话随后独立实测。

| 对象 | 真实任务中的凭据布尔检查 | 签名bucket HEAD / location / 最小列表 | 抽样对象HEAD | Range bytes=0-0 GET |
| --- | --- | --- | --- | --- |
| ADMIN | 两变量存在且非空 | 200 / 200 / 200 | 200 | 206；Content-Range有效，收到1字节 |
| EDITOR | 同一任务进程环境 | 200 / 200 / 200 | 200 | 206；Content-Range有效，收到1字节 |

实际使用OBS-HMAC-SHA1，TLS验证保持。每桶仅列出1项、抽样1个既有对象，正文直接丢弃；未输出密钥、签名、Authorization、对象名或正文，不写对象、不改权限。不能泛化为全部对象/版本/加密条件均可读，也不验证写入能力。

ADMIN首个对象请求曾404：探测脚本使用URL pathname导致对象key中的点路径段被标准化。任务定位后改为保留原始HTTP路径，随后HEAD200、Range206；中间404没有被隐藏、特判成通过或归因为权限失败。仅修正任务内的探测脚本，没有修改业务对象或应用守卫；EDITOR已通过请求未重复。

13:07:14+08:00正式task_result返回accepted=true；独立读库最终为completed/drained=true，contextRevision/claimContextRevision=8/8。13:07:34+08:00厂商回读最终两桶成功结论，messageId与耐久delivered收据精确一致；没有把openTaskId当消息ID。任务数仍2，节点调查仍在原等待，不声称另一个业务问题也完成。

用户随后追加的私有渠道提示词更新已通过原生版本绑定PATCH在线应用并独立全文回读；liveApplied=true、restartRequired=false、其他配置不变。提示词原文及其私有路径不进入Git；该授权配置变化与上述镜像升级前后配置保持的核验分开记录。

## 结果、限制与归档

本轮OSS修复、正式发布和原任务真实只读验收通过。最终脱敏摘要见[runtime-evidence.json](round-3/runtime-evidence.json)，本轮已查看的无头截图见[browser.png](round-3/browser.png)。PR #56正文已同步合并、发布与业务事实并独立回读。

- Windows同批Linux专项为1 SKIP，后由Linux镜像8项全部通过补齐；第1轮其他Windows/Linux专项及旧全套失败不因此追认为通过。
- 第1轮routing的15项、底层151项既有失败，以及上一阶段2项Windows symlink EPERM仍按历史报告保留；本轮未复跑无关全套，不宣称全仓全绿，未触发CI。
- ask/auto没有新增凭据路径；8项针对性通过不等于完整受限模式containment交付。未用full成功代替受限沙箱验收。
- 节点级权限和历史指标缺口仍在，未扩大授权去改该业务环境。
- 可回退上一正式manifest `sha256:d34dc09cbf097e39bffe1781c8419d69bdf87c88af655901986fdc5c46447e0c`，但会恢复旧凭据继承缺口；仍须暂停、正常排空和严格检查原卷，不能回滚已提交来源/完成态或重放效果。

不生成全绿report.md。按归档规范保留历史轮次文字结论与矩阵，本轮最终脱敏证据之外的临时脚本、原始私有快照、无用容器/卷和旧轮二进制附件在收尾统一清理；不清理生产PVC、模型任务档案或既有其他会话材料。
