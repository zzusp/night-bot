# 第 2 轮：最新主分支本地部署

## 目标、授权与源码

操作者明确授权合并 PR #96 并部署本地，随后再次指定“部署最新代码”。PR #96 已在现场核实时合并，mergeCommit=aaa6d97dcf6e318f2c815b39b31ab1e6d7c6d3fa，mergedAt=2026-11-13T01:04:30Z；本轮没有重复合并、直接推 main 或手动触发 CI。

最终部署 main 的 457585e5879a707c7be33d3e6737081934272f86，包含 #96 及随后合入的 #95/#94。部署后重新 fetch，origin/main 仍为该 SHA。独立发行首次 checkout 前设置 core.autocrlf=false、core.symlinks=false，最终 HEAD 匹配、git status --porcelain 为空。没有以脏主仓、未合并分支或本地镜像替换发行。

沿用原安装 data，不创建备份，不重复已完成的 v3 记忆迁移，不复制凭据或业务数据。凭据从既有 OS 用户环境的原配置引用加载，只验证存在/来源，不打印值、不写入源码或配置。权限模式和渠道实例不变。

## 部署与实际终态

- 新发行 pnpm install --frozen-lockfile、pnpm check、Web build 通过。守卫 retainedModules=190、productionImportFiles=437、runtimeJsFiles=437、externalSdkImports=0；Web 产物 index-BKLpr2Pm.css 和 index-B5QMd9zM.js。构建有超过500kB的chunk提示，不是失败。
- channelPluginDirs 仅精确替换新发行 packages；同一 updateConfig 事务先 checkOnly 再保存，配置哈希/CAS及插件发现通过，其他字段不变。实际发行的两个插件入口均位于新发行。
- 01:17:02Z 正常 IPC 停机；01:17:03Z 核实旧 supervisor/launcher/core 全退出，元数据由监督器自身删除，19198/3080均可重新绑定。未强杀、删锁或改账本。
- 监督器 --check 为 PASS、effects=0、两端口空闲、模型引用可用，随后 --run。01:18:46Z resident/Web同时HTTP200；从停机请求到HTTP可用约104秒，不称作渠道回填完成。
- 实际 launcher PID=36148、core PID=123600，命令行都指向新发行，metadata.release为457585e。permissionMode仍为原full。PID仅是本轮观测，下次部署需重核。

## 真实页面验收

Chromium/Edge打开实际3080 Web，令牌仅在本机内存读取并输入登录页，不放URL、参数或截图。未使用路由mock、fixture或额外模型请求。

连续两次点击“刷新记录”，认证 /api/evolution?refresh=1 均返回ready；cache.updatedAt分别为01:20:15.048Z、01:20:34.932Z，均stale=false、refreshing=false、error=null。卡片31条已应用、0候选，与当前Store的v3根索引/分类索引及哈希、revision=42独立核对。目录技能11/11可用，inventoryComplete=true。真实卡片截图已查看；安装截图不提交Git。

usageCoverage=partial，刷新成功不代表历史调用计数完整；没有因此重新执行任务或重发消息。

## 实际渠道、业务保留与遗留

认证API：Web connected=true；两路钉钉connected=true、connectionState=listening、liveApplied=true、restartRequired=false、errorCode=null。但ingress仍recovering，不宣称回填或全部业务完成。未发送人工测试消息，未测试新的发送权限。

任务仍10个、9 completed/1 waiting，全部drained=true、recovering=false，部署前后状态指纹一致。投递账本从73增为75，正常运行的适配器出现真实消息/回读活动，观察到一条delivered和一条starting/readbackRequired；不声称账本字节完全不变，不手工重放或改未知状态。

resident持续degraded，recoveryIssueCount从1变2：既有任务阻塞保留，冷恢复新增ROUTER_BATCH_UNSETTLED。runbook已说明须沿原checkpoint的Host合同处理；本轮不新增入口、直调SDK、改SQLite/Pi journal清警或擅自恢复业务批次。HTTP200/listening不等于整机健康。

## 最新界面回归：已报告、未修复

精确457585e的Web插件fixture及新构建执行：

```text
pnpm --dir <release>/packages/web-console exec playwright test test/conversation-frame.spec.ts test/task-list-width.spec.ts test/task-progress.spec.ts
```

7项，5通过、2失败，exit1：

1. task-list-width：1024px窗口pageFits=false，页面横向溢出；未放宽“仅表格滚动”断言。
2. task-progress：深色待办“进行中”为#2563eb、背景#171717、11px，对比度3.46:1，低于4.5:1，axe color-contrast serious；未关闭检查。

部署前已告知，操作者再次明确要求最新代码，最终仍部署457585e，未回退到#96合并点，也未在本次指定部署动作中顺手修改其他PR界面实现。保留失败事实，不宣称最新界面全绿。第1轮552项初轮失败及专项结果原样保留，本轮未重复全量测试。

## 收尾与边界

本轮无生产源码修改。维护唯一goal.md、matrix.csv第2轮列及本报告，不新增全绿report.md。主仓指纹与开工一致。仅清理本任务不用的临时脚本、fixture中间产物和未采用的#96独立发行；保留最终457585e运行发行、现用监督器和全部原安装数据，不清理旧安装或其他会话资源。

结论：最新代码已部署，记忆页连续强刷真实故障已验证消除；仍有两个未修界面问题、部分统计与恢复/回填遗留，不是全系统健康声明。
