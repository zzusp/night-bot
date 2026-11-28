# 第一轮：本地原位更新

验证基于 Windows 本地 `worktree-uat-memory-skill-updates`：主线基线 `e941587a` 加本轮未提交的两处 Router 源码改动。本轮只使用隔离安装、合成资料和模拟渠道；没有改 UAT 或真实的业务记忆、Skill。

## 修复前后

- 基线用正式全局 Router 实跑时，接收核实任务的完成事件却看不到 `resident_memory_review` 和 `resident_memory_reconcile`。工具屏蔽始于 `33fc99a1` 统一 Router 的改动。修后从本次已接纳的待处理事件取证明，继续校验任务与来源、权限及版本。原位更新和删除通过；已正确、无关结果不改；旧版本、跨会话、撤权及不确定读回不会被报为写入成功。重启不重放。
- 安装 Skill 的实际文件路径可以由 Work 读取和编辑。测试先等到现有 `ask` 模式对同一执行会话、同一文件的 `edit` 请求，批准前原文件未动；批准后原文件的前言与名称保留，写后读到了新版。Pi 日志有各一次编辑意图与结果；重启 Host 后，独立 Work 通过实际 Skill 加载器读到新版。没有添加写入入口或审批层。learned Skill 仍走原受管更新工具，自检也没有恢复为结单自动复盘。

## 真模型与回读

`cortex-cowork` 接到自然语言请求后，先核对合成变更单，经 Work 更新原 Skill，再对关联完成结果审阅原记忆并作 `update`。第一次任务计划调用未成功；后续计划成功，最终只验证到一个已完成并排空的任务。文件编辑只获一次精确批准。独立回读原记忆 ID 不变、版本从 1 到 2、同主题无副本；原安装文件保留前言，并写明蓝标去 Q17、其他继续去 F3。模拟渠道收到一条结单回复，内容与持久结果相符。

- **已正确**：再次交办核对，实际记忆回执为 `keep`、`persisted:false`；记忆版本和 Skill 文件字节均未变化，也没有再次编辑。
- **拒绝审批**：另一份隔离安装对原 `SKILL.md` 的一次精确 `edit` 请求返回拒绝。任务完成并排空，文件字节和记忆版本不变。模拟渠道的 Bot 回复为：「没能修订已安装的纸鸢收件 Skill：写入被拒绝，已确认原文件未变，仍写着『纸鸢业务交件一律走 F3 队列』。」

## 自动检查与未验边界

- `node --test test/pi-router-memory-reconciliation.test.js test/pi-router-learned-skill-edit.test.js test/pi-router-memory-maintenance.test.js`：12 项通过，无失败或跳过。
- `test/pi-single-task.test.js` 中新增的安装 Skill 原位更新及冷启动加载用例：单独执行 1 项通过。
- `node --test test/pi-file-tools.test.js test/pi-file-mutation-preflight.test.js`：26 项通过，无失败或跳过，包括过时版本、私有路径、链接及撤权等边界。
- `pnpm check`、`git diff --check` 通过。未运行全量测试和完整 Linux 沙箱验收；这些结果不覆盖实际 UAT 镜像和厂商渠道。

UAT 只读取证为第 136 代，未关联到贴出的原回复、原 Skill 来源或调用回执。尚未合并、部署或在 UAT 发送测试消息；本轮不能据此认定现场问题已解决。
