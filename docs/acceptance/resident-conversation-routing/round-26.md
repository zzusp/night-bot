# 第 26 轮：私有初态创建成功，首次真实 setter 完整投影失败

## 范围与版本

沿原 worktree / `worktree-resident-conversation-routing` / 原 PR，HEAD `6d79b0a0279d3f94f2d72d21f51ab1d654b0f509` 加未提交共享协作树。SG11/SG12 仍 ACTIVE。本轮只执行准确新 owned fixture 组件探针、只读解析结果和集中登记，不改生产实现或测试注册，不 Git 写入、CI、合并、部署、真实模型或渠道外发。第23轮 fake、第24轮原注册、第25轮失败 Native 均未重跑。

Windows 11 x64 / Node v24.19.0，实际源起止相同，不追认后续产品修订：

| 文件 | SHA256 |
| --- | --- |
| src/process/windows-acl.js | e1bbe8830229d56292d5b376b70e8a448464a60de61f579a57fce5ce204f65ac |
| src/process/win32.js | 730d4649449c92a68a80700dda2b9fc1bd7e50ee89538fb06b0f559489125d3d |
| src/process/contracts.js | a9eb7a93a4a4190a690c37cfb4ecc12bece676056eeb19613a04f72cd47e3329 |

原 Review 核准确 probe `3c6e3f875945c8c60293858eabc1aa4758b7422e47ea85a9dcb397335309f9c1`、清单 `b28293c29c1dbc55c72c12997758db1eba1a793274c3803c5bae0244b2e4a533`、check `176f91037dd6d73c553c7fe445356df1d4a6d01bdcdf1981ae216ed83ae1fa52`。Tests 同一新根参数先 --check，自然0/effects0/nativeExecuted=false，再唯一 --run。父采集器自然0只表示收集完成，真实 Native Node 自然1 / FAILED，stderr 空。

## 新 fixture 初态和实际边界

第25轮入口失败支持 WRITE_OWNER 前置缺口，未触达 setter。本轮保原失败脚本和旧根，另用唯一新根 `data/workspaces/sg11-security-projection-owned-08fddda7464141e199b142ca9be1d4f0`。只在 CreateDirectoryW 第一次创建时原子指定实时 Host user / primary group 和 protected DACL：Host FA、SYSTEM FA、OWNER_RIGHTS 0，三项 OI/CI。没有修改共享父目录 ACL、提权或降权限重试。CreateDirectoryW=1；真实初态 owner/group/DACL 匹配创建请求。根 DACL protected，两后代 DACL unprotected，全体 SACL unprotected；不预补400/800。

只读 query 自身 process / primary token，检查当前线程无 impersonation token；未创建或修改 Token。根句柄仍请求原0xe0080，两后代0x20080。四阶段在首个 Set 前全部冻结，8次 CreatePrivateObjectSecurityEx；保持原 flags / Token NULL / FILE_GENERIC_MAPPING。GetSecurityInfo=0x17，仅 OWNER/GROUP/DACL/LABEL，不是完整审计 SACL。Set 仅 root，DACL SecurityInformation=4，owner/group=NULL。未调用 Profile、Job、业务进程启动、Resume、HPCON 或 NamedPipe 创建/连接。

## 真实结果：首次 DACL-add 即 FAIL

唯一 SetSecurityInfo 返回0。写前 FileID / SD 检查通过；写后原句柄 FileID 检查通过，但三个对象 `sameOwnedSecurityDescriptor` 与独立完整 bytes.equals 均为 false。断言 `Actual setter projection differs from fixed native stage` 触发后立即停，不继续 DACL-release、label-low 或 label-release，不改 Native 返回位、清400/800、掩比较或用 actual 重基线。

| 对象 | 写前 control | 冻结 control | 实际 control | xor | 冻结/实际 SD 字节 | 冻结/实际 DACL 字节 | 冻结/实际 ACE |
| --- | --- | --- | --- | --- | --- | --- | --- |
| root | 0x9804 | 0x9804 | 0x9c04 | 0x400 | 228 / 228 | 152 / 152 | 5 / 5 |
| child | 0x8804 | 0x8c04 | 0x8c04 | 0 | 304 / 228 | 228 / 152 | 8 / 5 |
| child/file | 0x8804 | 0x8c04 | 0x8c04 | 0 | 304 / 228 | 228 / 152 | 8 / 5 |

- root 的 owner/group/DACL/SACL、offset 和长度逐字节相同，仅 control 多0x400。这是直接 target 控制位投影反例。
- 两后代 owner/group/SACL 相同，DACL 不同。冻结候选额外保留原3份无 INHERITED_ACE 条目：Host FA、SYSTEM FA、OWNER_RIGHTS 0；目录 flags3，文件 flags0。再加5份继承条目。
- 实际后代仅5份继承条目：Host FA / SYSTEM FA / OWNER_RIGHTS 0 / synthetic-package read 0x1200a9 / OWNER_RIGHTS read 0x20000；目录 flags0x13，文件 flags0x10。其角色、flags、mask 与候选后5项相同。完整 SD 304→228B 的76B差额对应多计的3条旧 ACE。

原 raw 在 Python 内只读解码，公开结果仅角色/flags/mask/control/长度，不输出真实 SID / SD / FileID。Review 独立核同一 raw，确认以上两类差异和写前 actualBefore 逐字等原 SD；不能只补 root 的400，也不能将后代 control 相同写成完整 SD 相同。已直接交 Core / Platform 责任层，不由 Tests 修改产品。

## 资源、现场与证据

18分配（10 LocalFree、8 DestroyPrivateObjectSecurity）和5句柄（自身 process、query token、三文件）全部单次 attempted/closed，retained 均0。sourceChanged=[]。根创建成功，首个实际 DACL 已改变；后三阶段未执行，最终原 SD 恢复未验证。按失败合同保留新根，不自动恢复、删除或重跑；第25轮旧 c32c97 失败根仍保留。资源关闭不等于业务恢复或任意清理授权。无在途 Native 操作，三源消费窗已交回。

正式脱敏证据 `round-26/windows-owned-setter-summary.json`，SHA `05335c976b3ebdb8996e8113f279a10dd0732f717ef652235cff20961b80d0f7`；包含源起止、初态谓词、计数、逐对象差异和7项私有材料 hash。

| 本地 ignored 最终证据（docs/tmp/） | SHA256 |
| --- | --- |
| sg11-security-projection-owned-run-check.json | 176f91037dd6d73c553c7fe445356df1d4a6d01bdcdf1981ae216ed83ae1fa52 |
| sg11-security-projection-owned-run.json | 896664128bf13f9995d142ea2b6f07e7cd02b54333adaa0b70880b53d5901496 |
| sg11-security-projection-owned-run-stderr.log | e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855 |
| sg11-security-projection-owned-execution.json | 59469bbf40f5f8658942e3d0cc57023a4545463a13e3437ad2e2f896c2e842bf |

完整个人原始数据只本地 ignored，未跟踪、未暂存、未上传；正式报告和摘要不包含上述私有正文。第24轮限定37声明提取中间 JSON 已经精确 --check 后清理并独立核缺席；历史报告/最终证据保留，不清任何失败 Native 根。

## 集中登记与剩余

matrix 291业务行不变，复用 `sg11-native-security-projection-setter`，新增 round_26 登记首 Set 完整投影 FAIL；其他290行 NOT_RERUN_ROUND_26，所有旧列/历史 FAIL 逐字节保持。原行场景描述保首次第25轮登记文本，本轮语义以 round_26 单元格和本报告为准。无测试源码/注册变化，库存5468 / SHA `e1f29c70217c62b5f4236868c8d49628f6fc2fed246ad5b13b4e2d9ad1595914` 不变，不重复 AST 提取，不写全绿 report.md。

产品 target控制位与后代旧 ACE 归属仍待修，另三阶段、Low有效权限、生产Profile/temp/scope/ACK/Resume/mandatory cleanup/ordinary/ConPTY未闭；三平台最终同版及真实macOS执行端仍有缺口。Pi官方命令稳定批按影响独立验证，不等待重开本 Native；文件/search无产品变化，不新增ls。唯一总目标由 Lead 维护。
