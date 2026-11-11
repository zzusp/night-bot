# Night Bot 官网与文档

公开静态站点，预期地址为 <https://zzusp.github.io/night-bot/>。它不连接 Bot 运行时、不提供登录，也不读取 `data/`。Bot 控制台仍位于 `packages/web-console`。

## 本地维护

需要 Node.js 24+ 和 pnpm 11.25.0，网站依赖独立安装，不安装或启动 Bot：

```sh
pnpm --dir website install --frozen-lockfile
pnpm --dir website test
pnpm --dir website build
pnpm --dir website preview
```

预览 <http://localhost:4173/night-bot/>。开发模式使用 `pnpm --dir website dev`，只监听 loopback。网站固定使用稳定 VitePress 1.6.4；本目录 workspace override 将其 Vite 依赖固定到已修补的 6.4.6，Vue 固定为 3.5.45。升级时同时重跑构建、审计和浏览器测试，不撤销补丁覆盖。

浏览器回归只访问本地静态网站，不启动真实 Bot、模型或渠道。CI 固定使用 Ubuntu 24.04 runner 预装的 Chrome，避免在每次构建中重新下载系统依赖；本地可安装 Playwright 浏览器：

```sh
pnpm --dir website exec playwright install chromium
pnpm --dir website test:browser
```

已有受信任 Chromium 时，可通过 `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` 指定路径。测试覆盖桌面/窄屏导航、直接刷新深层路径、站内搜索（结果/无结果/Escape）、深色、减弱动效、404 和 axe 可访问性检查。

## 内容与发布边界

- `index.md` + `.vitepress/theme/Home.vue`：首页。示意内容明确标注，不使用真实截图或运行数据。
- `guide/`：整理后的用户指南；深层命令和合同链接到现有公开仓库文档。
- `reference/index.md`：精选参考目录。不会把整个 `docs/`（含历史验收记录）打包进站点。
- 设计规范仍为根目录 `DESIGN.md`；主题直接消费已有 `boardui.css` token。
- `.vitepress/dist`、缓存和测试产物被 Git 忽略。构建结束会检查页面白名单、站内资源、锚点与 `/night-bot/` 基路径，并拒绝意外页面或敏感目录。

新增公开页面时，需同时更新导航、`scripts/check-site.mjs` 的 `expectedPages` 与测试。维护指南时检查当前代码和 README，不能把历史验收、旧默认权限或单平台通过记录写成现状。

## GitHub Pages

`.github/workflows/website.yml` 在 PR 上构建和测试，不部署。`main` 上相关文件变更以及在 `main` 手动运行时，构建通过后只上传 `website/.vitepress/dist` 并部署。第三方 Actions 固定 commit SHA；构建任务仅有 contents 只读，部署任务才申请 Pages 写入与 OIDC。无需新增长效 token 或仓库 secret。

首次发布前，仓库管理员需要在 Settings → Pages → Build and deployment 中把 **Source** 设为 **GitHub Actions**。普通 workflow `GITHUB_TOKEN` 无权自动启用 Pages。若尚未配置，部署的 “Verify Pages configuration” 会失败，但构建与 PR 检查仍可独立通过。配置后重新运行 workflow 即可。

仓库 About 的 Website 字段应填写 <https://zzusp.github.io/night-bot/>。这属于 GitHub 仓库设置，不由源码文件自动更改。若改仓库名、域名或路径，须同步修改 VitePress `base`/sitemap/favicon、链接检查的 origin/base、测试 baseURL 和 README 链接。
