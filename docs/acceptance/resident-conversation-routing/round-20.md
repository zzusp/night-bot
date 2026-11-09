# 第 20 轮：默认 PID1 关闭、fake 自动绑定与内存继承观察

## 范围与版本

原 worktree/分支/PR，HEAD `6d79b0a0279d3f94f2d72d21f51ab1d654b0f509` 加未提交协作源码；SG11/SG12均ACTIVE。本轮未修改生产代码、Git写入、CI、合并、部署或真实模型/渠道外发。Docker只用本地独占测试容器/卷；Windows唯一Native批经原Review准确前审、同参数先--check后--run，仅只读句柄和内存继承，无SetSecurityInfo/Profile/Token/Job/进程/Resume/网络动作。

Docker受验491源来自封定包，内容摘要 `46b3e4c2cc32840b72a50a82ca54a480680c007ecad5c44078e76aee33b43a70`；不把随后协作树变化追认到镜像。Host `2f7b8047` / Application `72e47641` / NativeJobs `deee4fd4` 均在包内。镜像 `sha256:82b96bd4406654154e29b4717feedc02c67542ac6d7deed146a81d5ddd230a2b`，build自然0，封包起止无漂移。Windows另绑定ACL `4cf27e7237b8a3cc5cb78731e16d01420b703fd859ed91bb70788205465eda45` / Win32 `f5b76f43012a1e0662d4b304f0024da790e4abeadefa288edb7061d205a6a2fe` / contracts `62a6ddc58f4d052619c680fa59d936efd28931fa8c8236623c46238ff5fa82b3`，与镜像分开，不拼同版。

## 默认入口与 fake 实际结果

- 正式默认ENTRYPOINT `/usr/bin/tini -- /bin/sh /opt/night-bot/scripts/docker-entrypoint.sh`、CMD `run`，实际读取`/proc/1/cmdline`吻合，未覆写应用容器入口；辅助seed/readback容器才使用显式node入口。
- 首批driver `afa1b33bb2b82d4e118d36266fe41e888ff7aaabbeee836af4e24932b7e9dee5` 自然1：fake无后缀文件在项目type:module下调用require失败，实际健康为error；清理又因本机Docker只有`--time/-t`、不支持`--timeout`而exit125。均为夹具/命令兼容错误，未到待认证及活跃模型关闭断言，不当产品缺陷或业务PASS。首批result `52aa2201b51b6f3a300606d7544e8d990646827d050e307109f969d857fd3979` / log `0047db02418f45a8ab2da1b3a109f8af592016b28524ab5411165d9f3179cbf5`。准确首批容器ID `1cdadb3e6bd7fa0d33809cb0eadcba1a2cd3c7a327d13c2fedfe0665f8ddb686` 经owner/image自检后，以`docker stop -t -1`正常SIGTERM退出0/Pid0，无强杀。原失败在本摘要与matrix保留；三份被替代附件归档后按SHA清理，不再作为现存附件引用。
- a2只修fake文件为`.cjs`、本机支持的`-t -1`及新专属资源名。driver `1bf73e3d527b1dff9fb7ab825f1fc3a94c1a923b5d43022ac0e7934098c9f84e`，相同镜像，自检后执行自然0。真实认证Web和`/api/tasks`在fake waiting-auth期间仍可读。更改`lastUsedAt`后350ms不重试；只改`lastLoginAt`并提供合成登录态后，同一运行容器无重启，默认文件观察器经真实子进程fake CLI解析唯一`fixture-corp:fixture-user`、`self-open`、`fixture-room`并持久化binding。profile调用总数2；共5条profile/contact/conversation只读CLI，无send/upload/recall。
- fake明确`listen=false`、writesAuthorized=false。健康`waiting-auth → ready`，ready的connected仍false；证明认证等待与自动绑定，不声称已订阅事件、消息入站或真实厂商收发。
- 真实认证Chat接纳后，官方Pi向容器loopback模型发出`/v1/chat/completions`；模型记录entered后，宿主才执行真实`docker stop -t -1`。没有提前release或关闭模型来刺激取消，没有退出预算导致强杀；先观察真实socket disconnected，辅助模型自然close，launcher/container自然0，Running=false/Pid0/OOMKilled=false。只读卷readback核模型两条顺序、binding及正式`.host.lock/owner.json`缺席。该活跃请求属于一级分诊，不冒充第17轮准确Router确认批；旧Chat业务与冷恢复未重跑。
- 安全实录：user=node、capDrop ALL、no-new-privileges、只读根、network none；默认ask及bwrap门保留，加载seccomp JSON逐对象等于正式`9264f168`。daemon报告AppArmorProfile为空，本轮未设置或更改AppArmor，不声称其保护。无privileged/SYS_ADMIN/SYS_PTRACE、docker socket、宿主全目录挂载或系统策略变更。

## Windows Native 实际观察

准确脚本 `a5853042ce6c851b239ec8204d493c4c4812cd361df655c1d44460e661984802`；原Review先核清单`e646ad1c`及自检`8ada0d0f`。先复制nativeRaw全文/长度/hash/control，再parser与merge；不吞错、不修改返回控制位求绿。唯一run自然0、stderr空、六观察、errors=[]、三pin无漂移。6个LocalFree与6个DestroyPrivateObjectSecurity均单次attempted/closed，3个只读句柄闭合，retained均0。Destroy六次未清零slot只是观察，不作泄漏门槛。原句柄回读FileID/SD全文不变；唯一随机fixture根已安全删除并独立核缺席。

| 变体 | child | native creator | native output | merged | control xor / merged全文相同 |
| --- | --- | --- | --- | --- | --- |
| NULL / directory | 0x8c04 | 0x8404 | 0x8804 | 0x8c04 | 0 / true |
| NULL / file | 0x8c04 | 0x8404 | 0x8804 | 0x8c04 | 0 / true |
| explicit Medium / directory | 0x8c14 | 0x8414 | 0x8814 | 0x8c14 | 0 / true |
| explicit Medium / file | 0x8c14 | 0x8414 | 0x8814 | 0x8c14 | 0 / true |
| inherited Medium / directory | 0x8c14 | 0x8404 | 0x8814 | 0x8c14 | 0 / true |
| inherited Medium / file | 0x8c14 | 0x8404 | 0x8814 | 0x8c14 | 0 / true |

实际NULL child原`0x8c04`已带SACL_AUTO_INHERITED(0x800)，creator`0x8404`不带，Native output`0x8804`带。六项merged全文等于原child、xor0，证明本次基线重建最终未变；不能概括API“不新增800”，未覆盖父/child原800都缺席的NULL基线。该缺席反证按Lead最新最小要求另批准确前审后补file/dir两项，不重跑这六项。本轮不证明实际Low设置/撤销、NRU/NXU共享回收、LPAC有效权限、生产准入或Job ACK/Resume/ordinary/ConPTY。

完整SD、原FileID及raw仅留本地ignored `docs/tmp/sg11-label-inheritance-run.json`，SHA `86a13ef17fdc55797a6d7d730dc064099ddba6078483120a16052918b99cf9aa`，未上传、发布或加入Git；仓库仅保脱敏`windows-label-inheritance-summary.json`，SHA `5211c0dbdf016235a060f85be63ba33764edcb8e2e68b2b41f75fb2d3288f496`。原Review已独立核完整raw、资源和根终态，报告不复制个人SD。

## 证据与集中维护

证据相对本报告，位于`round-20/`。

| 文件 | SHA256 |
| --- | --- |
| docker-build-current-result.json | 0b3bac3187539203d63d8b5040cf3616bded212b47d7bf50330b390beca021f3 |
| docker-build-current-source-map.json | be0d3d110d7f46166810736ab46b2a40f5a8869bc61d15021271a33a66703a00 |
| docker-build-current.log | 04a294094fda8124090afdec8daf7ab67d05d9dac22c6c8736db68d397ec355f |
| docker-default-pid1-a2-result.json | 1d8afdee67faba86d60f60da4f359d87c162866c3ec7f52bcc5f9ef4e71dde32 |
| docker-default-pid1-a2.log | 4dc4af0114e6de74dcd3cdcc17d345d7430877bafd175c6c703c2380343f3189 |

本轮无新增正式注册或测试源码变化，不重复AST库存或已过测试，原库存5466身份保留。matrix新增round_20，保旧列/失败，更新既有build/清理行；新增首批失败、默认PID1、fake自动绑定、Native观察四行。Native使用OBSERVED而非生产PASS。精确491源封包、两停态容器/两专属卷及首批替代附件的清理见`docker-build-input-cleanup.json`与`docker-owned-cleanup.json`；仅清本任务资源，保最终image/build-map/log/结果及本地私有raw。

## 剩余边界

SG11/SG12仍ACTIVE：父/child无800的NULL两项反证，Windows生产scope/持久ACK/Resume/mandatory cleanup，NRU/NXU与新DACL回收/bootstrap最小纯验证，最终同版guards/全量/原PR交付仍待。不以镜像或内存观察抵扣。真实厂商、真实模型API、消息监听/收发、本轮新浏览器场景未执行。唯一goal仍由Lead单写。
