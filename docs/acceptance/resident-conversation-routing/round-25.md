# 第 25 轮：自有根 Native setter 首次打开失败

## 范围与版本

沿原 worktree / worktree-resident-conversation-routing / 原 PR；HEAD `6d79b0a0279d3f94f2d72d21f51ab1d654b0f509` 加未提交共享协作树，SG11/SG12 仍 ACTIVE。本轮仅准确组件探针、该自有根必要只读取证和验收登记，不改生产，不 Git 写入、CI、合并、部署、真实模型或渠道外发。第23轮 fake、第24轮六原注册均未重跑。

实际 Windows 11 x64 / Node v24.19.0。三源起止一致：

| 文件 | SHA256 |
| --- | --- |
| src/process/windows-acl.js | 8d3f7d5a23dddb3f187269b0977a8e515e30c30d5e0027e690ca88070e5c3003 |
| src/process/win32.js | f5b76f43012a1e0662d4b304f0024da790e4abeadefa288edb7061d205a6a2fe |
| src/process/contracts.js | a9eb7a93a4a4190a690c37cfb4ecc12bece676056eeb19613a04f72cd47e3329 |

原 Review 已核准确 checklist ba149a7b / probe9f860e43 / check042c1816、三 pin 与唯一 c32c97 根。此为既有自有 fixture 范围的安全前审，不授权另一 Profile/temp/Token/Job/Resume 清单。Tests 复核源窗、根缺席及 ignored 后，按原 check JSON 同一绝对参数先 --check 自然0/effects0/native=false，再唯一 --run。

## 真实结果：FAIL，尚未到 setter

- Native Node 自然1、status FAILED、stderr 空。父采集器自然0仅表示结果收集完成，不能记业务 PASS。
- Node 新建 `data/workspaces/sg11-security-projection-c32c97eac19749adbb27e235d957d630`、child、child/file。首次 root CreateFileW 请求 0xe0080（READ_CONTROL / WRITE_DAC / WRITE_OWNER / READ_ATTRIBUTES）、share3、OPEN_EXISTING、flags0x02200000，返回 ERROR_ACCESS_DENIED=5。
- 已持有原生句柄0、LocalFree / PrivateSecurity 分配0、SetSecurityInfo0、继承候选0。没有进入四冻结阶段；尚未取得原 Native FileID / SD，不能称其已回读恢复。
- 按清单立即停止，无低权限 fallback、自动恢复、改位、改比较标准或第二次 run。三对象现场保留，独立只读核仍存在；不因计数0擅自删除失败现场。
- 三 pin 起止一致。终态后已交回 Platform 三源消费窗，不因保根继续占产品文件；无 Native 或后台命令在途。

## 必要只读取证与反证

仅对原三对象读 Get-Acl / 文件属性，另在同继承身份诊断子进程读 WindowsIdentity、whoami /groups 与 /priv。未改 ACL、Token、策略，未新开探针句柄分拆权限位。完整 SID / SD 仅本地 ignored。

1. **WRITE_OWNER 前置条件缺口**：ownerMatchesCurrentUser=true，本对象匹配启用组的 Allow masks 为 0x1301bf、0x1200a9，均缺 WRITE_OWNER / WRITE_DAC。Full-control 仅对应 deny-only 组或非当前 token 成员，不能当有效 Allow；无当前用户显式 ACE / OWNER_RIGHTS ACE，可用特权无 SeTakeOwnership / SeRestore。owner 隐含 WRITE_DAC 不能推出 WRITE_OWNER。该证据支持合并打开被 WO 拒绝的解释，交 Platform 选择安全初始化路径。
2. **Deny / 属性候选**：三对象已读 DACL 均继承 Allow、Deny0，非 readonly、非 reparse、未 protected；未找到这组解释的支持证据。
3. **flags / 其他访问条件**：参数保持准确前审值，未做逐位新句柄或 AccessCheck。只读诊断不是原 Node token 的现场快照，也未取得 Native SD / Mandatory Label；不能把支持证据写成唯一根因，更不能写成 setter 继承候选已被证伪。

最小后续归测试 fixture 创建层；不能去掉 WO 只做 DACL 后宣称原四阶段通过，不能改共享父 ACL、full 或提权。新唯一自有根的原子安全创建仍需准确差量清单/自检/前审；本轮旧根和旧 FAIL 不重用、不追改。

## 集中证据与登记

正式脱敏证据：`round-25/windows-security-projection-summary.json`，SHA `11eed185d2a71ae032e1883f491f12c7cd981764faf2860035996e408e5d3fa7`，包含真实错误/计数、三 pin、只读谓词与全部私有材料 hash，不含真实 SID、SD、FileID 或凭据。

| 本地 ignored 最终证据（docs/tmp/） | SHA256 |
| --- | --- |
| sg11-security-projection-run-check.json | 8ebab89dde4138ee2ae93ea4b7c01e1e535d6d7557b33e4f32cee4bf5d363e8a |
| sg11-security-projection-run.json | f5816a9833329151b30b2036d586fe44cf722749f13b6640120f64e3f37f4d51 |
| sg11-security-projection-run-stderr.log | e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855 |
| sg11-security-projection-execution.json | 600b8898d5eb606a42642817f9de399853bc8a0e0fccb9a35247f3953b7aa05d |
| sg11-security-projection-permissions.json | f923603ceebf416965e34c5d3af04c0c8ffdde1d188a5a82173fc6c35ade2e87 |
| sg11-security-projection-identity.json | 1ab4950bc647cce313fd80c0e8c0a3c21c89e4e022975dba54dd8c44d6d237bc |

私有路径执行前后均核 ignored、未跟踪/暂存。

本轮无测试源码/注册变化，库存5468身份不变，不重新提取 AST。matrix 新增 round_25 和一个准确 setter 行，原290行及各旧轮结果保持；第21轮 NULL 无800反证等历史 FAIL 保留，不写全绿 report.md。

## 剩余

四阶段实际 target / 后代400/800、完整 SD 恢复、Low 有效权限均未验。失败根保留，后续任何恢复/清理/新 Native 动作按准确身份及前审边界执行。Platform 原生产链及安全初始化方案继续；Profile/temp、durable ACK/Resume、mandatory cleanup、ordinary/ConPTY 与三平台最终同版验收各自未闭。Linux / macOS 不由本 Windows 结果抵扣。唯一总目标由 Lead 更新。
