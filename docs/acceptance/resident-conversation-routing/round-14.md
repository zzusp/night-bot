# 第 14 轮：Router 关停因果与 Windows 范围投影

## 范围与版本

沿原 worktree/分支/PR，HEAD `6d79b0a0279d3f94f2d72d21f51ab1d654b0f509`，实际为未提交的协作工作树。每批绑定实际文件 SHA 起止，不能由 HEAD 或随后文件版本追认。SG11/SG12 仍 ACTIVE；没有 Git 写入、真实模型 API/渠道发送、CI、合并、部署、Profile 创建或原生 ACL/LPAC 执行。

本轮仅修改既有测试、库存和阶段记录。产品由原 Core/Platform 修改。证据路径相对本报告所在目录，以下文件均位于 `round-14/`。已通过且无相关变化的 factory/权限/Web/proof/Job 配置不整批重跑。

## 实际终态

| 证据前缀 | 受验版本与结果 | 适用边界 |
| --- | --- | --- |
| router-shutdown | Router 297c，Node 自然1，7PASS/1FAIL/0SKIP，14pin稳定 | 首批八项并非全通过，PAUSED吞错保留FAIL |
| router-shutdown-paused | Router 297c，真实actor abort门后仍自然1/1FAIL | 排除仅调用close而未到中断点的解释 |
| router-shutdown-paused-observed | Router 297c，增加trace后自然1/1FAIL | 旧prior不同于新取消reason，实际abort后release仍未拒绝 |
| router-shutdown-paused-fixed | Router 9a97，原负例自然0/1PASS/0SKIP，14pin稳定 | service→conversation→Router聚合异常准确包含旧prior |
| router-shutdown-related-fixed | 同9a97/同test，另批自然0/3PASS/0SKIP，14pin稳定 | 活跃请求、pending冷恢复、迟到handle三个受影响关停行为 |
| windows-scope-projection | contracts62a6/privacy02c4，Node自然0/4PASS/0SKIP，三pin稳定 | Host数据投影/parser，不是生产授权或Native准入 |

## 关停刺激、失败与修复

原四个产品文件分别为：

- `src/channels/router-lifecycle.js`：旧 `297c15f706de397508646dfac8567918a85fe35eb1e2916cffffa33c5bd6f3a9`，窄修后 `9a97650dceaa69ca5974b23f074c80bb3561ad55bbd5264982a5592350c2745b`。
- `src/pi-official-agent-factory.js`：`dbde124a32e88e2e058993f7c6fdf67426035d46705ae64e32eff3bc8780c64e`。
- `src/runtime/pi-business-admission.js`：`5e48f095770a3930bfdd8bcb385b5e40338b468018346ce6d0e2755d3a36c24b`。
- `src/runtime/pi-official-session.js`：`5877722630415971c06f7993af2f4bbb70f853da630893e5704691c506fc7343`。

`test/pi-resident-router-flow.test.js` 的四个新增注册使用真实 service、official factory、SDK、Pi journal 和本地 HTTP 脚本模型，不伪造数据库或提交回执：

1. 真实settle已提交后第二个模型请求在途，关闭实际abort SDK请求并join，不靠fixture放行结束；冷恢复不重放成功settle。
2. 原enqueue真正commit后阻止deliver；关闭不cancel、不改原packet/audit。冷恢复同packet只admit一次，再次冷启不重发。
3. registry实际create并发布actor后才延迟返回handle；关闭等待晚到handle、interrupt/join/dispose，不admit新batch或轮换generation。
4. 实际maintenance失败先导致admission PAUSED；捕获其准确错误对象，等待关闭的真实actor abort后再释放旧错误，要求关闭异常链保留同一对象。

第四项首批失败；添加真实abort门、随后仅添加trace的两次定点都仍为 `Missing expected rejection`。trace明确 `interrupt(priorCode=PI_BUSINESS_ADMISSION_PAUSED,sameReason=false)` → `abort(PI_OFFICIAL_ACTOR_NOT_LIVE)` → `release(PI_BUSINESS_ADMISSION_PAUSED)`，没有safe标志。初步fixture时序解释被反证，不再归fixture。

原Review/Core定位：同会话F1在途、F2排队，tails仅保存F2；F2的 `previous.catch` 吞F1旧异常，close只看到F2新的可豁免closeError。service有实际双schedule入口。Core仅给当前生命周期所有未settled工作加inflight追踪，两个入口加入、原finally删除，close快照全部inflight。没有读取历史errors永久污染关闭，没有修改开放期串行恢复、权限或Host。

修后原PAUSED断言不变，实际service→conversation→Router AggregateError末端保留原prior，单独1PASS。因close快照改动真实影响join，再复验上述前三项，单独3PASS。两批产品与测试版本相同，但不称新版八项全跑；旧首批7PASS与全部失败历史原样保留。原Review独立核差量与定点，原Core独立核三项结果及当前四源hash一致。

`test/pi-official-agent-factory.test.js` 新增四项在首批各自PASS：真实create/resume construction跨close不发布迟到owner、清理writer；真实Router failed checkpoint在resource-refresh await后或实际claim commit后interrupt，不再生成resume-turn/模型请求，原输入admitted一次、cancelled零。没有假造claim或依靠预置回传。factory四项不受Router追踪差量影响，未重跑。

Router四项首先证明fixture的 `service.close`，随后restart才执行完整Host close/boot；factory四项证明真实factory/SDK边界。它们均不抵正式CLI或完整Host活动关闭，也不抵第13轮新镜像应用验收。

## Windows 范围投影

实际受验 `src/process/contracts.js` SHA `62a6ddc58f4d052619c680fa59d936efd28931fa8c8236623c46238ff5fa82b3`、`src/memory/privacy.js` SHA `02c4f0b22a28e3e7bf59eaf4331610f2fa7ab1c8265facbb3c95ff826a2bb8b5`、test SHA `012b24b0d5ed79aa8aef3b42a65ae34960070f5bab9fd42c5b6126793d661345`。

原privacy注册更新四读目录materials/work/outputs/tmp、默认仅work/tmp可写、sessions/reviews私有。新增外部根注册使用自己的隔离临时目录：Host绑定read/write根允许外部cwd；相邻cwd、私有/另一task拒绝；fileRoot不能越获批根；read-only没有写根。新增去重注册用大小写不同的同根read/write验证固定顺序、只升级匹配根、精确六根且输入不变。过滤还命中原TASKS大小写注册，总计4PASS。

Node v24.19.0自然0、stderr空，结果及日志先落盘；随后旧Python包装器GBK打印勾号失败1。独立回读确认Node0与四项PASS，未为打印重跑。原Review独立读全部四注册与结果，暂未找到此投影合同层新增缺口。没有调用Native/Profile；生产processAuthorization的Windows gate、真实有效权限、原Job持久ACK/Resume/ordinary/ConPTY均未由本批验证。

## 证据绑定

| result文件前缀 | result SHA256 | stdout SHA256 |
| --- | --- | --- |
| router-shutdown | 32a08aa697d049a36c07db825aff1ac30892e00542ae0e41f88c739a13068610 | 09d240f426504542515dfdea1c1f20d7c6af366802a9f0574840704da51b93fd |
| router-shutdown-paused | a99c85da1a2167b28ea557c64242254aa0f74cabfca0c16937bd5542de23b52e | 2945e772ed429982bb81055cf866525cc01c0d5c39e3d5391799d2d470e11042 |
| router-shutdown-paused-observed | 8a22e3f193dacf7d45fda1a06572b6f2708ae463644980261906a2c1cb8a1e34 | ff12ef1a637d24c1ea450ad045fdb523f123eff3ccba693ef278c99cc90b186a |
| router-shutdown-paused-fixed | 22b7b9be03325b675076a4bdde5bcb57dcada3ab5a4d9b560cfbd74e4db65032 | 7d3d07868aced54aac4bf31d40c4248636f7d36168f5a817c711215a2dd77a57 |
| router-shutdown-related-fixed | aa8dd1f89ac292cca101b73679eec60021ebc9492294d4f00fdd4fa9b13a69d0 | 7f24fceb07bbe0f259b7bb577490623d905adf1beb27c3897b204dee25197f44 |
| windows-scope-projection | 5f19ffc50f4c4a1630a60cf377a1e21dbe19f03ce9e848f86366339a3f167700 | 3880f4172f5004ed01dce1200f61f53db4b132357b74b89bc8b17216e892f48d |

每个前缀对应 `-result.json`、`.log`、`.stderr.log`；完整显式源码清单在result。首批flow test为978711b8，abort门版42656858，trace及修后两批为完整SHA `b07927a824f0a6c827bc37ef02949369b9354218506ecbe54c5a2d85178ca75f`；factory test为3e33bfab。不得以后续test全文hash追认初批。

## 库存、矩阵与余项

原AST提取器只解析520文件、5194注册、未解析0；库存5442→5452，新增Router4/factory4/范围2共10个注册，映射本轮12个逐完整名称PASS。保留所有原(file,case_name,occurrence)与registration_sha256；更新过的注册仍保旧registration身份，证据另绑实际test SHA。库存SHA `ac42e59d36deeece24d0ed9015ce0927bb92827d21dca10749655072a6e604ef`，当前未登记0不等于全量执行通过。首批仅逐名采用PASS，后续只以同名修后证据更新；失败历史保在本报告、原日志和matrix。

matrix集中新增round_14列；旧轮次字段不变，无动作项记NOT_RERUN_ROUND_14。没有全绿report.md。各fixture自己的临时目录由原t.after回收；无本轮OS/container资源新增。原Docker卷/终态容器仍保留，不称全部回收；历史报告与仍支撑结论的最终证据未泛化清理。

本阶段Tests执行已全终态，两组产品源窗交回。后续依既定范围验Platform修后DACL helper纯差量及必要Windows生产链；正式CLI/完整Host活动关闭、新镜像当前源应用、宿主浏览器/可选DWS自动接入、剩余注册与最终同版guards仍未完成。full不抵受限档、fake不抵厂商实测，不结束长期目标。
