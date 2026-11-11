# Router 记忆与 Skill 维护目标

## 总目标

由 Router 决策并直接完成记忆、学习 Skill 的增改删，移除 Router 路径的话术授权门槛，保留 Host 的认证、来源/版本、权限、秘密、范围、事务与 no-replay。用户强调 Router 是整个 Bot 的大脑。用户现已明确授权合并、部署，并验证记忆与 Skill 增改删；不包含历史失败消息重放。

## Sub Goal Matrix

| 子目标 | 状态 | 证据入口 |
| --- | --- | --- |
| 明确职责、复用与安全边界 | 完成 | ../../spec/router-learning-mutations.md |
| 实现 Router 记忆与 Skill CRUD | 完成 | src/channels/resident-router-business.js；src/memory/service.js、reflection.js、evolution.js |
| 完成真实 Host/Pi 回归与源码守卫 | 完成，完整套件既有失败保留 | [round-1.md](round-1.md)、[matrix.csv](matrix.csv) |
| 同步合同、审阅差异、独立 PR | 完成，PR #57 已合并 | [PR #57](https://github.com/zzusp/night-bot/pull/57)，合同与运维说明已同步 |

| 正式镜像发布与生产部署 | 完成 | [round-2.md](round-2.md) |
| 真实 Router 记忆与 Skill 增改删及测试数据清理 | 6项持久化通过；Web送达/展示另有失败 | [round-2.md](round-2.md)、[matrix.csv](matrix.csv) |

## 当前检查点

- 2026-11-11：用户授权“合并并部署，验证记忆和 Skill 的增改删”。PR #57 已于06:29:55Z合并，merge SHA `8c90fc1913638101c2e0bd89462ff1de5280993c`，gh独立回查为MERGED。
- 发布分支 `worktree-router-learning-release-20261111` 基于上述已合并main；本阶段只追加验收文档，不改受验运行源码。最后fetch时main未新增，不推已合并原实现分支。
- 正式生产digest `sha256:5b3fc52dbf2688079e709d871d870a8997d9d0ea3148f987be8c19577692111a`；实际imageID与5个关键源码hash匹配，Ready/restart0；安全配置和token保持，渠道已恢复receiving/listening。
- 离线检查49份完整Pi journal与2个已有任务，默认排除秘密的安装备份145文件逐文件哈希通过。临时Job已删除，独立备份PVC保留；备份恢复未验。
- 真实模型执行记忆新增/更新/删除、Skill新增/更新/删除共6项，Pi持久收据全为ok/persisted，完整原话/来源/作者绑定通过。测试记忆、Skill状态与目录已删除，其他记录hash保持，新增任务0。
- **验证尚有失败**：Skill更新最终Web回复unknown（WEB_DELIVERY_SCOPE_INVALID，单次发送后只回读，未重发）；Web清单将Router Skill显示为unsupported。详细根因与边界见round-2，不声称全链路全绿；独立Web修复未在本轮实施或发布。
- 第1轮完整Router套件既有DWS基线失败保留；第2轮未重复跑无改动的回归全集。未向钉钉发送额外测试消息，不重放历史失败来源。
- 当前授权的合并、部署与六项写入验证均已执行；下一步为独立修复Web回复身份映射/合法收口unknown及同步Skill展示判定后复验。当前不自动扩大为另一次运行源码发布。
- 唯一证据入口为round-2.md与round-2-evidence.json；私有定位不入Git。未创建全绿report.md。
