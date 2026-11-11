# 第2轮：合并发布与真实渠道续办

## 范围与版本

2026-11-11，北京时间。两项修复已分别合并：

- [PR #54](https://github.com/zzusp/night-bot/pull/54)：Router 明确解除等待，merge `6ab538dc2659df7528091d2657435febf1346439`，11:57:56+08:00。
- [PR #55](https://github.com/zzusp/night-bot/pull/55)：直接长期记忆授权识别，merge `9b4037c719b5259081b3088db2085b891d7c1af1`，11:58:07+08:00。

正式构建源为干净且与当时 origin/main 一致的 `9b4037c719b5259081b3088db2085b891d7c1af1`。后续发布记录分支只增补验收文档和脱敏证据，不把文档提交冒充已运行的镜像源码。不触发 CI，不合并无关部署文档 PR。

## 本地与镜像

| 检查 | 实际结果 | 证明范围 |
| --- | --- | --- |
| 合并源码 pnpm check | PASS：424个运行时JS，0外部SDK导入 | 来源/hash/import/native守卫 |
| 两修复共同路径实跑 | 6 PASS、0 FAIL、0 SKIP，245808.2673 ms | 授权识别、正式渠道记忆/17组拒绝/只读、两类原会话续接 |
| 正式镜像业务 | PASS：Web请求202后实际可见回复，模型请求1次 | 应用真实入口，不以构建或进程存在代替运行 |
| Web安全反例 | PASS：未认证401、错误Origin403、缺CSRF403 | 已认证Web正常 |
| 无头浏览器 | PASS：158.0.8127.18、实际DOM42 | 仅headless shell；API/CLI截图均9460 bytes、1280×720，已查看 |
| 排空与同卷重启 | PASS：退出0、host lock消失、旧会话/身份/token保持 | 旧cookie拒绝，重复请求模型调用0 |
| Registry独立回读 | PASS：远端manifest/config digest及OCI revision绑定 | linux/amd64，与本地验收Image ID相同 |

关键实跑命令：

```powershell
pnpm check
node --experimental-test-module-mocks --test --test-concurrency=1 --test-name-pattern='memory authorization recognizes|explicit channel preference|channel memory rejects|read-only Router reports|Router resumes a waiting task' test/pi-memory-wire.test.js test/pi-resident-router-flow.test.js
```

正式tag：`headless-9b4037c`。

Manifest digest：`sha256:d34dc09cbf097e39bffe1781c8419d69bdf87c88af655901986fdc5c46447e0c`。

Config digest/本地Image ID：`sha256:82f263fee8163b6b744b25c559ebd42bd70ff8fcfe59c393a23da0f3ac2b0862`。

当轮脱敏机器摘要和截图已在第3轮收尾按只保留最终轮附件的规范清理；本报告保留上述完整版本、digest、计数、结果与必要文字证据。第3轮附件仅证明其自身版本，不替代本轮实跑。构建仅设置既有HTTPS Debian镜像源参数，未放宽TLS或包签名检查。

## 云端发布

按既有Docker/Kubernetes runbook暂停接纳、正常排空、单副本缩容0，在原PVC以新正式镜像执行离线证明，再精确更新应用/init镜像并恢复1副本。没有重建PVC、重新登录DWS或替换配置。

- 严格解码32份Pi journal、2个task/session身份通过；显式使用runtimePaths的configPath和portable codec，requireComplete=true，SQLite quick_check为ok，host lock缺席。
- 32份持久历史SHA全不变。暂停快照还含一个活跃Router的租约owner文件，正常排空后消失；只排除该已释放租约，没有忽略持久历史差异或未提交尾。
- 首个自写预检payload省略configPath，相对安装根误解析为/data，Job失败；修正后通过。同名server dry-run曾遇AlreadyExists，改独立check名称；上层摘要误计租约owner后，核原成功Job UID/labels及严格历史证明继续后半段。未修改应用守卫或伪报通过。
- 12:16:06+08:00独立核实新Pod ready1，实际imageID为上述digest，5个关键源码hash与合并源码匹配。
- PVC UID、实例/actor、Web token、归一化配置hash保持；除应用/init镜像外Deployment spec完全相同，包括环境变量、Secret/ConfigMap引用、挂载和安全参数。
- UID1000、CapEff0、NoNewPrivs1、Seccomp2、data/temp为0700；Web认证200及401/403反例、真实浏览器DOM42通过；DWS authenticated/token_valid均true。
- 权限模式仍为full：应用不保留工作区OS沙箱，权限为容器UID1000；父容器readonly/cap-drop/no-new-privileges/seccomp仍在。未声称full保留应用bwrap围栏。
- 原生认证Web接口恢复接纳，独立回读requestedPaused=false、receiving/listening且无ingress错误，未重置水位。升级启动本身没有自动解除旧等待或重放旧消息。

## 真实业务与记忆

### 原任务续办

12:16:42+08:00向唯一已解析测试群发出一条新认证续办消息。DWS完整查询回读原消息和引用承接，不把openTaskId当messageId或送达证明。

- Router于12:17:35和12:17:48分别将两个原问题结清为answered，resolution.kind=router，保存reason和新来源。
- 两任务各保持原唯一session，任务数仍为2；严格committed Pi历史中出现新的实际工具结果及task_result，不止contextRevision增加或wake排队。
- 12:31:08+08:00最终只读核验：两任务均drained=true，contextRevision/claimContextRevision分别为4/4、7/7。其间自然人质疑和新证据也由Router明确resume同一原会话，没有重建任务。
- 目标应用日志最小只读访问HTTP200；节点排查取得新证据后，因节点级接口403及缺历史指标进入新的等待。对象存储签名未验证：两个凭据变量在Pod环境/应用主进程均存在且非空，但工具进程不可见。
- 只读查明Host的`src/process/contracts.js:11`默认过滤KEY/PASSWORD/SECRET/TOKEN继承变量，`src/process/runner-launch-B2zsQ1Dz.js:572`的childEnv以此构建环境。将证据作为新群消息补充，不再误报Pod缺配置；不修改该安全边界，不输出或提取密钥。
- 12:29:52+08:00DWS真实回读最终更正：工具环境过滤与Pod配置须区分，签名认证仍缺受控执行入口。本轮仅修正结论及任务内部工作记录，未修改生产状态；未附额外附件。

两个业务事项没有被标记completed：续办已执行并回复，当前真实权限/凭据入口阻断仍等待。此等待与修复前“信息已存、执行从未续接”不同，不把发布完成等同于业务排查全部完成。

### 长期记忆

12:24:40+08:00用新认证原消息重申明确记忆请求，未重放旧source或直接写持久文件。12:25:55后正式resident_memory_remember返回ok=true、persisted=true；Bot共享scope revision=3，该条entry revision=1。

独立只读解码Markdown，完整原话、新source、作者hash及quoteSha256均匹配；保留原提出者适用范围及当前授权、不覆盖本地改动、不据此授权push/deploy的边界。Router committed历史中正式工具成功，全部扫描journal完整，无尾部错误。12:26:03+08:00群内完整回读最终“已保存”确认，不把承接消息当持久化成功。

## 未通过与边界

- 第1轮routing的15项、底层151项既有失败未因发布消失；干净base逐项反证见[round-1.md](round-1.md)。本轮仅复跑合并相关6项，不宣称全量通过。
- Windows的Linux live privacy namespace专项仍SKIP；记忆分支扩展迁移批次有2项Windows symlink EPERM，未进入业务断言。不列为通过，没有触发CI。
- 原业务的节点级只读权限和对象存储受控凭据入口尚未解决；未为验收扩大授权、修改业务配置、提供密钥或实施额外修复。私有原文、定位、群ID和运行记录不提交Git。
- 回退镜像为上一正式manifest：`sha256:1c9d45f19fa85219a78f7e9a291a2168691b066d0d85cf4c5d1d6ed08582c29d`。回退前仍须暂停、正常排空和严格检查原卷，不能回滚已提交answered或重放已消费来源。

未生成全绿report.md。发布与当前业务状态以本轮为准，旧轮不追认新版本。最终仅保留脱敏截图和必要机器摘要；中间快照、脚本及私有原始证据已在本轮收尾统一清理，不保留已清理附件的失效依赖。
