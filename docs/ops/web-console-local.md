# 可选 Web 控制台本机运行

## 边界

Web 包位于 `packages/web-console`，使用 Node.js 24+，独立 pnpm 清单和锁文件。Bot 根安装、CLI 与默认服务不导入这个包；不需要安装 React/Vite 即可运行 Bot。插件只通过既有渠道和只读服务接入，不修改核心 schema。

启用后的插件是可信 Host 代码，和 Bot 同进程生命周期，不宣称独立进程故障隔离。前端静态文件缺失时 `/api` 仍可用，页面返回明确 503；关闭浏览器不停止 Bot。禁用插件会关闭 Web 入站和该渠道投递，其他 Bot 功能继续运行。

服务只接受 `127.0.0.1` 的同源请求，默认端口 3080。此交付不包含公网、多用户账户、反向代理/TLS或厂商渠道上线验收；不要直接改监听为 `0.0.0.0`。

## 安装和构建

在安装根执行（PowerShell 7）：

```powershell
pnpm install --frozen-lockfile
pnpm --dir packages/web-console install --frozen-lockfile
pnpm --dir packages/web-console build
```

首次安装独立 Web 依赖是必要步骤；不要整体链接另一个 worktree 的 node_modules。构建产物在该包 `dist/`，不入 Git。Bot 不启动前端开发服务器。

## 显式启用

在现有私有配置中**追加**下列插件目录及实例，保留已有配置，不覆盖它们：

```json
{
  "channelPluginDirs": ["packages"],
  "channelPlugins": [
    {
      "type": "web-console",
      "channelId": "local-web",
      "enabled": true,
      "config": {
        "senderId": "operator",
        "operatorName": "本机操作者",
        "port": 3080
      }
    }
  ]
}
```

目录相对 `installRoot`，其中每个子目录通过 `night-channel.json` 发现。`senderId` 是该实例的稳定身份，由服务端配置；更改它会改变来源身份，不用于临时切用户。Web 令牌持有者能查看本安装的任务和渠道信息，只给该安装的操作者使用。

按既有 [Windows 运行手册](windows-local-runtime.md) 启动 Bot；本插件会记录页面 URL 和访问令牌**文件路径**，不会记录令牌内容。地址必须使用日志中的 `http://127.0.0.1:3080`（或配置端口），不能换成 `localhost`，否则严格 Host 校验会拒绝。

令牌位于 `data/secrets/web-console-<channelId哈希>/access-token`，仅在本机读取后输入登录页。不要把令牌写入源码、环境变量、URL、截图、PR 或聊天。会话 cookie 为 HttpOnly/SameSite Strict，12 小时过期；所有写 API 校验 CSRF。重启会使浏览器会话失效，但令牌及业务回执保留。

独立接纳和回复账本在 `data/state/web-console-<channelId哈希>/delivery.sqlite`。它只记录 Web 渠道事务，不替代任务 SQLite 或 Pi 会话。升级保留整个 data；备份和恢复遵守已有离线一致性及默认排除 secrets 的规则。

## 升级、停用与诊断

- 正式升级基于已合并代码，并按既有运行手册停机/备份/升级；构建后带上该版本 `dist/`。此任务不执行正式部署。
- 停用：将该实例 `enabled` 改为 false，按运行手册重启。不要删除 data；待核实回执不自动重放。仅停止浏览器不需要重启 Bot。
- 端口占用：选空闲的 `config.port`，不要终止无关进程。已有 token 文件/存储目录被链接、权限不符或结构异常时会失败关闭；不要通过放宽权限绕过。
- 503 `WEB_ASSETS_NOT_BUILT`：在相同代码版本的独立包安装并构建。不要把这个错误解释为 Bot 未启动。
- 401：登录失效或 token 不符。403：检查是否用了日志中的 127.0.0.1 地址与同源页面。未知接纳/发送：查同 requestId 的回执，不新建请求重放。

## 开发与隔离验收

```powershell
pnpm --dir packages/web-console test
pnpm --dir packages/web-console build
pnpm --dir packages/web-console test:browser
```

浏览器脚本使用本机 Edge、真实插件 HTTP 和显式隔离样例，自动关闭服务并清理临时数据；不需要真实 DWS 或模型凭据。若端口 3081 被占用，先确认是否本任务遗留，不杀其他服务。截图是样例验收证据，不是生产状态。

可手动运行 `node packages/web-console/test/preview.mjs --port=3082`；此脚本打印**仅测试**令牌，Ctrl+C 退出。演示脚本仅用于开发，不参与插件生产入口。

`pnpm --dir packages/web-console dev` 在 18999 提供 Vite 开发页，将 `/api` 代理到本机 3080 的可选插件。开发代理重写目标 Host/Origin，生产插件的同源规则保持不变。正式运行直接由插件托管构建产物。
