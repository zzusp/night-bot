## 问题与结果

本 PR 统一长期记忆与学习 Skill 的准入：不保存可直接查询的信息、未经验证的猜测、临时流水、重复失效内容、凭据/不必要敏感原文或一次授权。Skill 描述事项、目标、主要环节、信息来源和正反场景，允许 Agent 按现场判断调整，不以细步骤、严格夹具和补丁脚本限制执行。

主线已经具备 Router 直接维护、分层 Markdown、实际 skill-creator、单调墓碑及幂等回执，本 PR 保留这些合同，并加入显式启用的事件局部维护与默认每周集中检查。未操作真实 Bot 的数据或安装配置。

## 实现

- `src/memory/extraction.js:4`、`src/memory/reflection-inference.js:5`、`src/memory/skill-generation.js:9`：共享准入同时进入主请求、候选、复盘、维护和真实 creator 生成。新任务候选为自由 Markdown guidance；Router 的 steps 仍作为主要环节候选。内置通用 creator 适配与 UPSTREAM 修改声明同步，不收集私有 Skill。
- `src/host.js:329`、`src/memory/service.js:45`、`src/memory/maintenance.js:48`：默认 Host 接入生命周期；仅安装操作者显式设置 reflection.maintenance.enabled:true 后运行，intervalHours 默认 168。首次只建立水位；完成回合、候选及任务经验实际落盘后触发局部检查，冷启补查到期/水位变化。不借业务 schedule 伪造真人任务。
- `src/memory/maintenance.js:152`：维护记忆/候选/受管 Skill 的 delete、merge、split、update，保留原来源、主体、证据、previous、Router 独立来源与单调版本；候选不晋升，未启用 Skill 不被激活，普通记忆不能晋升长期指令。维护不改写长期指令原条件，不跨主体合并。
- `src/memory/store.js:143`：沿用严格分层 journal，将记忆、evolution state、派生正文、review、水位与收据一并提交。metadata-only 不增加记忆 revision；读侧先恢复不确定提交。未知路径、非法形状、候选晋升及并发变化整批拒绝。
- `src/memory/maintenance.js:143`、`src/memory/maintenance.js:207`：经验撤销按实际 memoryKey 清理 review/destination 并推进遗忘代次，档案失败进入既有 archivePending。旧在用技能文件保留，当前有效 state/marker 决定加载授权。

### 并发提交边界

`src/memory/maintenance.js:134`

```js
const result=await withLock(join(this.directory,'.lock'),async()=>{
 if(hash(JSON.stringify(await this.owner.state(this.scope)))!==evolutionHash)throw failure('REFLECTION_REVISION_CONFLICT')
 this.owner.abort.signal.throwIfAborted()
 return this.store.transaction(this.scope,s=>{
 if(s.meta.revision!==view.revision)throw failure('MEMORY_SCOPE_CHANGED')
 return this.apply(s,evolution,byId,actions,report,schedule,prepared)
})
})
```

索引/正文推理与实际 creator 起草在共享发布锁之外；提交时同时比较完整 evolution 指纹和记忆 revision。实跑中 Router 在慢维护期间成功写入，旧维护拒绝而未覆盖新技能。

### 不制造无证据技能

`src/memory/reflection.js:88`

```js
if(lesson.skill?.evidenceBacked===true&&typeof lesson.skill.applicability==='string'&&lesson.skill.applicability.trim()&&lesson.skill.applicability!=='Not established'){
 const guidance=lesson.skill.guidance??(Array.isArray(lesson.skill.steps)?lesson.skill.steps.join(String.fromCharCode(10)):undefined)
 value.skill={guidance:checkedTextWithLimit(guidance,12000),reason:brief(lesson.skill.reason),applicability:brief(lesson.skill.applicability),evidenceBacked:true}
}return value
```

新候选缺少证据判断或具体适用性时不落技能，不调用 creator；已持久化历史重试仍遵循既有幂等协议。evidenceBacked 和合法引用只是来源/形状校验，不能证明模型结论真实。

## 验证

受验源码基于 c1a5796，提交为 c0920e0；实际改动字节聚合 SHA-256 为 6fdc9abd37cd52cf31583ea871d95d1047bf21a4e29657ed95e2de9c2ebcfd12。18 个文件共 168 项测试通过，分组执行，补充复验不重复计数。完整命令、首轮失败与修复、字节清单见 `docs/acceptance/memory-skill-periodic-review/round-2.md`，旧 round-1 只绑定旧基线。

- [x] `node --experimental-test-module-mocks --test --test-concurrency=1` 指定 maintenance/reflection/skill-generation/memory-wire 四文件：62 pass、0 fail/cancelled/skipped；真实 Host、Pi creator 工具循环、四类动作、冷启、取消排空、候选事件和模型回读刷新通过。
- [x] 同命令指定来源/隐私/分层渐进读取/存储/并发/墓碑/迁移/档案十三文件：105 pass、0 fail/cancelled/skipped；含双任务档案、附件恢复、决策时序与禁止重放。
- [x] `node --experimental-test-module-mocks --test --test-name-pattern='^Router directly maintains memory and learned skills' test/pi-resident-router-flow.test.js`：1 pass；16 个链路检查确认增改删、冷重启、共享 provider、旧加载撤销、单调版本，emptyTasks:0、realVendorMessages:0。
- [x] `node --test --test-name-pattern='整理经验同步' test/pi-memory-maintenance.test.js`：1 pass；档案回调先失败后成功，archivePending 清空，当前 review/遗忘代次/墓碑正确。
- [x] `node --test --test-name-pattern='周期复盘对记忆|既有凭据格式' test/pi-memory-maintenance.test.js`：2 pass；最终修改后未启用 Skill 不激活、凭据依赖本地清理，旧在用文件和正式安装 Skill 不动。
- [x] `pnpm check`：190 retained modules、460 production/runtime files、externalSdkImports:0；`git diff --cached --check` 和 long-goal 校验通过。data 路径被忽略，暂存的 Skill 仅为已准入通用 creator 的适配/修改声明。
- [ ] 全仓默认/runtime/routing/containment 全套、真实模型语义质量和跨平台验收未执行；本轮只运行直接相关链路，不宣称这些层面通过。
- [ ] UAT/生产升级、真实 Bot 历史内容完整复盘未执行；开启维护或建立水位不等于完成该实质复盘。

## 风险与边界

自动维护默认关闭，升级不等于授权清理。语义价值和新旧事实判断依赖模型；证据不足应 deferred，不能以长期未用为删除理由。Host 只执行来源/范围/版本/原子性保护，拒绝未知引用和跨范围计划；使用统计只发计数与时间，不发 provenance 身份。

回滚可先由安装操作者关闭 reflection.maintenance.enabled 并正常排空重启，停止后续自动维护。本 PR 不迁移既有存储布局，不批量改写旧技能；已提交维护不是可无条件逆向重放的操作。秘密来源审计、Pi 历史和既有备份不承诺安全擦除。本 PR 不部署、不发真实消息、不手动触发 CI，原检出其他会话修改不动。

🤖 Generated with [Claude Code](https://claude.com/claude-code)
