# 离线升级 Bot Markdown 记忆

此脚本只升级同一安装的 `data/memory/v2/bot`：从一个 topic 一个聚合文件，
变成总目录、分类目录、单条正文和按需来源文件（`scope.json.layoutVersion: 3`）。
它不启动模型，不补造内容，不搬迁 Pi 会话、原始聊天、外部 SDK 数据、技能或账户。
历史正文、ID、版本、创建/更新时间、期限、context、出处、previous、去重及遗忘记录保持。
更完整的新内容由正常 Bot 维护流程产生，不由迁移程序推测补齐。运行时生成的 `installed-previous.json` 技能历史观察文件保留在原位、原始字节不变，不转换成事实或候选；未知文件和不安全链接仍拒绝。

## 操作步骤

1. 排空任务并停止该安装的所有新旧 Bot 进程及其他记忆写入程序。禁止旧版本与新版本共用此目录。
2. 按安装备份流程保留完整离线备份。此脚本另存记忆结构转换所需原件，不能代替全安装一致性备份。
3. 使用 Node.js 24+，从新代码目录运行（把示例路径替换为实际安装根目录）：

   ```sh
   node scripts/migrate-memory.mjs --install-root /path/to/install --check
   ```

   不带 `--check`/`--apply` 也只检查。必须显式指定安装根目录；不猜测当前目录。
   检查不创建目录、锁、备份、收据，不 chmod，不恢复事务。输出只含数量、状态和路径，不含正文。
4. 检查无阻塞后显式执行：

   ```sh
   node scripts/migrate-memory.mjs --install-root /path/to/install --apply
   node scripts/migrate-memory.mjs --install-root /path/to/install --check
   ```

5. 核对 completed 收据中的条目/候选数及备份路径，启动新版本，通过正常记忆读取确认结果。
   记忆服务遇到未升级的旧 Bot 存储会报 `MEMORY_LAYOUT_MIGRATION_REQUIRED`，不会偷偷改写。
   Host 会拒绝启动，外层可能显示 `NIGHT_BOT_REQUIRED_SERVICE_UNAVAILABLE:memory`；
   用此检查命令定位原布局或未完成升级，不要跳过必需服务。

`--apply` 取得安装 Host 租约和 Bot 记忆租约；运行中的进程不会被超时抢锁。
检查发现任意 Host 锁均保守阻塞；apply 仅通过现有 PID/start/boot 身份协议回收确认死亡的锁。
非标准/外部 memory root 不支持：不要复制数据到示例路径绕过检查。

## 备份、重跑与失败

- 写入目标前，将旧 `scope.json`、`index.md`、`candidates.md`（若存在）和全部 `topics/` 原件
  保存到安装内 `backups/memory-layout-<source digest>/`，并逐文件校验 manifest。
  源 `topics/` 原件不删除；旧 scope/index 的原始字节保存在备份。
  备份含私人记忆，应使用与安装数据相同的访问保护，禁止提交 Git 或分享。
- `layout-migration.pending.json` 是持久升级日志。任何中途失败都不要手动删除它，
  不要让旧版本运行。修复磁盘/权限问题后执行同一个 `--check`、`--apply`，
  程序验证备份和已写入文件，再继续完成；目标中既非旧内容也非本次计划内容的文件会阻塞。
- `layout-migration.json` 是完成收据。重复 apply 返回 already-layered，不重复导入，
  不从 retained topics 恢复后来已遗忘的条目。新安装的 layout 3 不需要此升级。
- 未知文件、符号链接/硬链接、特殊文件、哈希不符、冲突、修改过的备份及不确定锁均拒绝。
  没有 `--force`，不删除或覆盖未知文件。保留现场后由运维确认原因。
- 若存在旧 `pending.json`，报 `MEMORY_MIGRATION_RECOVERY_REQUIRED`。先使用匹配的旧版本，
  在入口/渠道关闭且无并行写入者的维护环境中完成旧存储已有的事务恢复，再排空、退出、重新检查。
  新迁移器不解释/丢弃旧事务，也不把未完成状态当成功。恢复前先保留完整离线备份。
- 回退需要同时恢复匹配旧代码和完整离线数据，不要用旧版本直接打开 layout 3。
  脚本的局部记忆备份不回滚升级后新增事实、遗忘、任务状态或会话。

## 与旧 v1 → Bot 共享空间迁移的区别

既有 v1 personal/group/project → v2 Bot 共享 namespace 的复制/冲突候选/导入收据逻辑保留，
仍以原有 Host 生命周期和权限运行。它处理的是旧作用域合并；本脚本处理的是既有 Bot
目录的物理文件结构。两个过程都保留原件和防重收据，不能重置收据来恢复被遗忘内容。
来源不足的旧 context 保持原状，不制造理由、适用范围或证据。

本次代码与测试只使用临时合成夹具；不表示任何真实安装已完成迁移。
