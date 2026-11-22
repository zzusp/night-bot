# 自进化流程：复盘名称契约回归

基线 `84bf29649bae02db50c7292bb91a9dce02736e92`，`worktree-reflection-key-contract` 的未提交候选。实跑时 `src/memory/reflection.js` SHA-256 `232e0254409e49dc11dcbdaaf5ee8aee3fbb80d592bcc1773d0e51a4d0ea5bb3`、`src/memory/reflection-admission.js` `4b5a585cc2c539c5a07ae0e4b7162122d7e05c06479a9836910717f2bcf69b0d`、`test/pi-reflection.test.js` `5d270a1a2db10475d1fa1feb9266a0f5e1b2783112298cedb942369f9bdbeefc`。上一轮在役结果见 [round-3](round-3.md)。

- 改前 `bp2t3sug2`：有效完成证据搭配非法记忆名称，实际返回 `REFLECTION_EVIDENCE_INVALID`；新增回归据此失败。改后给模型明确机器标识格式，更新仍引用已读的原名称与版本；Host 分开记录记忆名称、Skill 名称和证据引用错误。没有自动改名、放宽证据校验或强制生成 Skill。
- `b8vrgsyo1`：`node --test test/pi-reflection.test.js test/pi-reflection-admission.test.js test/pi-skill-generation.test.js test/pi-memory-maintenance.test.js`，53 项通过，无失败、取消或跳过。空引用、未知引用、非法记忆名称和非法 Skill 名称均留对应拒绝回执，零生成、零写入，原任务保持完成；同组覆盖原键更新、版本冲突拒绝、creator 失败和取消排空、维护撤销双回执及有效支持保留。
- `brhtx280e`：`node --test --test-name-pattern '不同事项独立复用|^.*冷启动.*复用' test/pi-single-task.test.js` 命中的一项通过，包含 11 个独立任务会话，核对排空、正文读取、新输入上的正确结果、同类记忆和 Skill 原位更新、重复结果不升版、近似任务不误用。未重复执行联合读取用例；其基线结果保留。`pnpm check` 和 `git diff --check` 通过。

本轮只用本地隔离 Host、脚本模型和假渠道，未提交、推送或部署续修。真实模型的 Skill 自主生成、独立复用、原键更新和退役仍未闭环。下次以有多个可核对证据和决策分支的合成任务验证，不强制生成，也不把模型主动只存记忆计为 Skill 成功。
