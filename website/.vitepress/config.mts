import { defineConfig } from 'vitepress'

export default defineConfig({
  lang: 'zh-CN',
  title: 'Night Bot',
  description: '基于 Pi 的个人助理 Agent 初始化套件。部署自己的 Bot，让任务、记忆、技能和定时工作持续衔接。',
  base: '/night-bot/',
  srcExclude: ['README.md', 'node_modules/**', 'test-results/**', 'tests/**', 'scripts/**'],
  cleanUrls: false,
  lastUpdated: true,
  sitemap: { hostname: 'https://zzusp.github.io/night-bot/' },
  head: [
    ['link', { rel: 'icon', type: 'image/svg+xml', href: '/night-bot/favicon.svg' }],
    ['meta', { name: 'theme-color', content: '#2563eb' }]
  ],
  themeConfig: {
    logo: { src: '/favicon.svg', alt: '' },
    nav: [
      { text: '快速开始', link: '/guide/getting-started', activeMatch: '/guide/getting-started' },
      { text: '使用文档', link: '/guide/usage', activeMatch: '/guide/(?!getting-started)' },
      { text: '参考资料', link: '/reference/', activeMatch: '/reference/' }
    ],
    sidebar: [
      { text: '开始使用', items: [
        { text: '快速开始', link: '/guide/getting-started' },
        { text: '安装与平台', link: '/guide/installation' },
        { text: '模型与配置', link: '/guide/configuration' }
      ] },
      { text: '与 Bot 协作', items: [
        { text: '渠道接入', link: '/guide/channels' },
        { text: '使用教程', link: '/guide/usage' },
        { text: '权限与数据安全', link: '/guide/security' }
      ] },
      { text: '部署与维护', items: [
        { text: '部署与升级', link: '/guide/deployment' },
        { text: '参考资料', link: '/reference/' }
      ] }
    ],
    socialLinks: [{ icon: 'github', link: 'https://github.com/zzusp/night-bot', ariaLabel: '查看 Night Bot 源码' }],
    search: { provider: 'local', options: {
      miniSearch: { options: { tokenize: (text: string) => Array.from(new Intl.Segmenter('zh-CN', { granularity: 'word' }).segment(text)).filter(part => part.isWordLike).map(part => part.segment) } },
      locales: { root: { translations: {
      button: { buttonText: '搜索文档', buttonAriaLabel: '搜索文档' },
      modal: {
        displayDetails: '显示详细列表', resetButtonTitle: '清除搜索', backButtonTitle: '关闭搜索',
        noResultsText: '没有找到相关文档',
        footer: { selectText: '选择', navigateText: '切换', closeText: '关闭' }
      }
    } } } } },
    outline: { level: [2, 3], label: '本页内容' },
    docFooter: { prev: '上一页', next: '下一页' },
    lastUpdated: { text: '最后更新', formatOptions: { dateStyle: 'medium' } },
    editLink: { pattern: 'https://github.com/zzusp/night-bot/edit/main/website/:path', text: '在 GitHub 上编辑此页' },
    darkModeSwitchLabel: '外观', lightModeSwitchTitle: '切换为浅色', darkModeSwitchTitle: '切换为深色',
    sidebarMenuLabel: '文档目录', returnToTopLabel: '返回顶部', skipToContentLabel: '跳转到内容',
    notFound: { code: '404', title: '页面不存在', quote: '这个地址没有对应文档。你可以返回首页，或使用搜索查找。', linkLabel: '返回首页', linkText: '返回首页' },
    footer: { message: '官网仅提供介绍和文档，不连接你的 Bot 或运行数据。', copyright: 'Night Bot · <a href="/night-bot/third-party-notices.txt">网站依赖许可</a> · <a href="https://github.com/zzusp/night-bot/blob/main/THIRD_PARTY.md">来源与许可</a>' }
  }
})
