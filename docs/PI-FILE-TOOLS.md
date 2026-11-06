# 官方 Pi 文件工具与资源边界

默认实际 actor 在 SDK 捕获工具目录前，通过 NativeTools 注册官方 Pi 1.5.0
read/write/edit 实现。官方 schema 为 `path`；edit 为
`edits:[{oldText,newText}]`，支持 Pi 原生多处/fuzzy 匹配。旧 file_path、
old_string/new_string 不作参数翻译。`read_image` 仍走官方 read/image 渲染，
`read_window` 是独立的流式有界文本能力，不声称是 Pi 内置工具。

NativeTools 保留真实权限、超时、独占写、业务效果账及源/结果策略。文件 IO
使用当前保留预设的实际 filesystem/workingDirectory 能力，实际 mutation
仍重新检查 canonical 路径、当前策略与观察版本。单次提权只绑定已经通过参数与权限接纳的同一个实际调用，预检与执行共享这一次审批，不产生长期授权。
同任务的 materials/outputs/sessions/reviews 等 Host 区域在 PrivateFS 预检阶段
拒绝；已知 readonly 拒绝也在新效果 intent 前完成。审批后和实际写入时重新解析路径；真实开始后的不确定失败仍进入未知效果对账。取消/关闭等待已经开始的真实 IO。

## 可配置资源政策

配置文件的 `fileTools` 对象只接受以下正整数设置；不接受服务/函数/权限
注入。它调节资源上限，不能扩大工作目录、记忆或沙箱授权。

| 设置 | 默认值 | 行为 |
|---|---:|---|
| maxBufferedBytes | 10485760 | 普通 read 全缓冲上限，保留旧 10MiB streaming 阈值数值 |
| maxBufferedLines | 32768 | 普通 read 可缓冲行数；超出提示 read_window |
| windowMaxLines | 2000 | 单窗口最大行数，保留旧 readLimit |
| windowMaxLineCharacters | 2000 | 窗口单行字符上限，保留旧 readMaxLineLength |
| windowMaxBytes | 51200 | 单窗口输出字节上限，保留旧 readMaxBytes，最小256 |
| maxEditBytes / maxWriteBytes | 各1048576 | 新的单次编辑输入/写入正文上限 |
| maxEditCount | 32 | 新的单次 edit edits 数量上限 |
| maxArgumentBytes | 2097152 | 新的参数 JSON 字节上限 |
| maxTransportBytes | 33554432 | 新的单工具及同一官方 assistant 批次结果资源上限 |
| maxPathCharacters | 4096 | 新的路径字符上限 |
| maxOperationTargets | 4096 | 新的单工具内部目标能力数量上限 |
| windowMaxFileBytes | 536870912 | 新的窗口文件大小上限 |
| windowMaxScanBytes | 16777216 | 新的单次窗口扫描字节上限 |
| windowMaxChunks | 4096 | 新的单次窗口扫描块数上限 |

与旧工具的显著差异：大文件不再由普通 read 自动改为另一套流式渲染；超过
buffer/行数预算须明确调用 read_window。窗口有真实继续位置、截行及 EOF
元数据；超过扫描预算会明确拒绝，不能伪称已读到结尾。新增编辑/写入/扫描
上限是部署资源政策，旧工具没有对应的独立配置项；可按需求显式调大。
Pi 自己的普通 read 输出截断仍受其官方实现约束，不伪造任意可配置截断。

read_image 使用部署现有 attachment 单图/数量/字节/像素限制及实际 SDK
model 路由；不同模型的完整请求图片预算由既有 transformContext 单独执行。
同批图片/传输资源记账绑定真实官方 assistant entry 与实际 call，不因插入
业务 audit 而重置。原始图片只保留于官方 content；诊断/业务 value 仅保留
图片大小、类型与摘要，避免额外持久化 base64 副本。

若实际写已提交但结果记账/交付失败，会返回
PI_FILE_EFFECT_COMMITTED_RESULT_FAILED；任务保留未知效果、禁止自动重放。
该工具不是 OS 内核隔离替代。legacy 显式路径模式与 Windows 的既有平台
限制继续适用，不能由一次工具测试宣称完整平台隔离。

旧 native-tool-fs 源及少量 legacy fixture 暂留，不在默认工具链；其 notice
仍需保留。文件搜索/底层 FS/观察策略/进程等尚有各自来源，不以本次官方
read/write/edit 切换宣称全部 DSH 代码已消失。
