# 第 16 轮：当前源镜像、正式 CLI 活动关闭与冷恢复

## 范围与版本

沿原 worktree/分支/PR，HEAD `6d79b0a0279d3f94f2d72d21f51ab1d654b0f509`，未提交协作源码。SG11/SG12仍ACTIVE。由原Core/Platform分别交一次短封包窗，491份白名单源码逐bytes/集合核验后立即释放，后续build/run不冻结或读取工作树。证据路径相对本报告，均在 `round-16/`。

没有Git写入、真实模型API、真实渠道/登录、CI、合并、部署、Native ACL/LPAC执行或宿主策略变更。全部模型响应来自容器内loopback脚本服务，network none。新镜像结果不追认旧像失败，也不将镜像中的Windows源视为Windows已运行。

## 构建与安全边界

- 新镜像 `sha256:be1ffc45ee8a451ccddc63453305bde839ba4c01029a82d6bc26e79ef0c6d5e0`，tag `night-bot:sg12-current-r16`，Linux/amd64/user node。
- 封包manifest `docker-build-sealed-source.json` SHA `147bc6eb38022f02be771085f2a07fbb990ca6364e5d3e1570bdd3b23f308ec1`。491源/起止无漂移，sourceMap `96729e0d0324bbec5a0d81d39fc16d2f279b1881a1a680ed638ca5a2bf9c187b`，编码为排序的name+空格+文件SHA+换行，非tar摘要。
- manifest、构建source-map及result的源字典/摘要独立核等。构建自然0、sourceChanged=[]，仍保TLS/apt签名/固定资产digest及原已有无凭据代理；未修改代理值、Docker daemon或sandbox。
- 当前Router9a97650d、factorydbde124a、admission5e48f095、session58777226、入口def816be准确入包。Platform ACL3cdf29c4/Profile48b95b84仅按各自源码入包，不外推其Native行为通过。完整491源SHA在manifest/source-map。
- 容器始终为node非root、cap-drop ALL、no-new-privileges、只读根、独立/tmp tmpfs、network none、正式seccomp SHA `9264f1689d786e212fcfc1dc63eed5d08a2be4c236a252d5676f43f40691201f`。无privileged、SYS_ADMIN、unconfined、Docker socket或整宿主目录挂载。

## 实际应用与终态

原隔离应用驱动复用成功目录构建路径及既有安全参数。先分别执行build/app的零副作用--check；应用自检确认新卷/容器名缺席，--run只创建本任务专属卷 `night-bot-sg12-data-current-r16`，owner label `sg12-current-r16`。没有复用旧失败卷或复制data、账号、私有skills、node_modules。

应用内使用正式 `scripts/docker-entrypoint.sh run` → launcher/完整Host。默认ask配置实际落盘，未启可选DWS；真实loopback Web认证HTTP验证未认证401、foreign Origin403、坏CSRF403。认证Chat→triage→Router→唯一任务Pi，真实write/bash/read/task_result：

- task `container-business-r16` 为completed/session idle，结果 `CONTAINER_BUSINESS_R16_COMPLETE`。
- `work/direct.txt=CONTAINER_DIRECT_R16`、`work/shell.txt=CONTAINER_SHELL_R16`、`tmp/task.txt=CONTAINER_TMP_R16`；bash内读取私有Web token得到privateReadable=false。
- 脚本模型只在本次Router user批次对应的成功settle tool result后停轮，不凭任意历史成功结束，也不再无限重发settle；tool-free交接返回实际schema。

业务完成后，同conversation的确认消息经HTTP 202接纳；随后第16个真实SDK HTTP请求保持在途。server只等待res.close，不手工放行、不先关闭模型server。driver观察实际entered后给正式CLI SIGTERM；CLI自然0，server观察到真实socket断开，然后才启动同卷冷恢复。此项证明正式CLI/完整Host正常路径能够abort/join活跃官方Pi推理，超出第14轮仅service/factory层级；不证明任意异常关闭路径均排空。原Review指出：activeCloseRequested是全局门，未保确认requestId或绑定其source/event/settle，尚在途的task.completed内部批也可能先命中。因此本轮不声称确认消息本身已settle；后续只修ignored驱动精确绑定并另轮补证，无需重build。

同卷冷启保持instance `night-3ddf4f38-efe7-4e72-b74f-25e632408c92`、原task completed/idle，任务步骤计数不增，原task Pi全文SHA前后均 `38e692ee25b1d878d2ea0bf6f7042d3396dab1a5d3b4218d3837c36a7a87be0b`。最后再次正式关闭自然0，hostClosed/modelClosed=true。共17个本地模型请求，task工具write/bash/read/task_result各一次；冷恢复无task工具重放。

外层driver/container均自然0，最终running=false/Pid0。独立docker inspect核精确container `ac3993ec8b7cfef2a1f09d1df1d678e585e966fc2dd7d08ca01ca3a2d9752808`、image、owner及真实终态。另确认专属卷无运行writer后，以同镜像非root、正式seccomp、capdrop/NNP/rootRO/network none及只读volume mount独立读取三份业务文件和任务journal，字节值/全文SHA完全一致，UID1000。

外层容器以 `--entrypoint node` 运行测试harness，harness内启动正式CLI子进程并给该子进程SIGTERM。本轮没有对镜像默认CMD/tini/PID1执行docker stop；不能将正式CLI自然关闭外推为完整容器入口信号链已验。冷恢复主驱动在第二次stop前比较hash/steps，最终只读卷核对在两次stop后再次核journal全文；更严格的全周期驱动比较随上述补证一起处理。

## 证据

| 文件 | SHA256 |
| --- | --- |
| docker-build-current-result.json | ed2bd2317982a23ca5b351926ba785d0c49b86d7775f888ee387efb7ebec6b81 |
| docker-build-current-source-map.json | 2277cce8343c747bdc5e303591d151b8ae14844b4fea432ededcadc5c1df16ff |
| docker-build-current.log | 7cb4c440be40fb00fec6b231558afc731269af6622aaa91040e777157ed030a2 |
| docker-build-check.json | 5947e274ac853e426522a792ad5af4ba8e500e3eebbb008144dc2eba72804066 |
| docker-application-check.json | 57284bcc7c08ad661e7c6dcf83da67b51600946a339c8880c53b93649c6f102c |
| docker-application-result.json | 6a4fc6e52dc342b0f1e16bffc0a338bf15b742b8a2f19868ef3c116fb10d7255 |
| docker-application.log | a4d37ec0e6acf8c1bc34a109030933a29f127c1d360f4e418b1b59f1ccf213c7 |
| docker-application-independent-files.json | 86625f4799fad38fd83232190193a4bc6ff4355713cead48cd1488bddce33211 |
| docker-build-input-cleanup.json | f7ddbdd009bb14c1d23579d29b48176052e1f8e958b27982c713df3440f7eb72 |

应用driver SHA `ccd821850afda366829bbd1b13a36d37f5b1c9e657df76ab5b7352fc28d862be`，完整源码/参数绑定在result。模型和业务数据均为合成夹具，不含真实账号。应用stderr为空。

附件清理说明：第17轮同镜像补证后，本轮docker-application的result/log/stderr/check/independent-files五个重复附件已按SHA清单删除。上表保留原摘要与本轮文字结果，不能再作为现存附件读取；构建相关附件仍支撑最新结论而保留。清理记录见round-17/docker-owned-cleanup.json。

## 清理与剩余项

构建成功/source-map及最终image独立核验后，清理脚本先--check验证491源集合/逐hash及归属，再仅删除本次 `docs/tmp/sg12-build-context-r16`。独立核缺席，保manifest/source-map、build/application最终证据与镜像。后续不能把该目录作为仍存在附件引用。没有tar/gzip新增，没有全局清Temp、tree kill或删除WAL/locks。

补证第17轮最终证据核验后，本轮及第17轮专属停态容器/卷均按精确owner/ID清理并独立核缺席，镜像继续支撑后续而保留。原第13轮旧像业务后受控失败及cold结果保留，本轮新像正常路径通过不覆盖旧失败。

matrix集中新增round_16列并按本次精确版本更新既有build/业务/活动关闭/同卷cold/清理行；无相关变化的旧OS探针/零写自检不重跑。本轮没有新增正式test注册，库存不因ignored驱动增加测试PASS，也不改第15轮登记结论。

宿主浏览器/可选DWS完整容器fake自动接入、Windows生产LPAC/原Job持久ACK/Resume/ordinary/ConPTY、剩余同版guards与总体交付仍未完成；无真实厂商结果，不写全绿report.md，不结束长期目标。
