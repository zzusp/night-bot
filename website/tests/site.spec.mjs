import { test, expect } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'

const noOverflow = async page => {
  const sizes = await page.evaluate(() => ({ content: document.documentElement.scrollWidth, viewport: document.documentElement.clientWidth }))
  expect(sizes.content).toBeLessThanOrEqual(sizes.viewport + 1)
}

const orbitOverlaps = page => page.locator('.nb-orbit').evaluate(orbit => {
  const box = el => el.getBoundingClientRect()
  const cards = [...orbit.querySelectorAll('.nb-orbit-node')].map(box)
  const mark = box(orbit.querySelector('.nb-moon'))
  return cards.some((a, i) => [...cards.slice(i + 1), mark].some(b =>
    a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom
  ))
})

test('homepage is accessible, responsive and links to the real quick start', async ({ page }, testInfo) => {
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto('./')
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Night Bot')
  await expect(page.getByRole('heading', { name: /复盘任务，.*完成自进化。/ })).toBeVisible()
  await expect(page.getByText('示例', { exact: true })).toBeVisible()
  await expect(page.getByRole('heading', { name: '搭建自己的 Night Bot' })).toBeVisible()
  await expect(page.getByRole('region', { name: '为什么用 Night Bot？' }).locator('dt')).toHaveCount(3)
  const comparison = page.getByRole('table', { name: '和其他工具怎么选？' })
  await expect(comparison.getByRole('row')).toHaveCount(6)
  await expect(comparison.getByRole('link', { name: 'Harness AI', exact: true })).toBeVisible()
  await expect(comparison.getByRole('link', { name: 'OpenClaw' })).toHaveAttribute('href', 'https://docs.openclaw.ai/start/openclaw')
  await expect(page.locator('.nb-home')).not.toContainText('网页或钉钉')
  await expect(page.locator('.nb-actions a .nb-icon')).toHaveCount(2)
  await expect(page.locator('.nb-capabilities article > .nb-icon')).toHaveCount(6)
  await expect(page.locator('.nb-orbit-node')).toHaveText(['任务', '渠道', '定时', '记忆', 'Skills', '自进化'])
  expect(await orbitOverlaps(page)).toBe(false)
  await expect(page.locator('.nb-home')).not.toContainText(/[↗↪]/)
  await noOverflow(page)
  await page.screenshot({ path: testInfo.outputPath('homepage.png'), fullPage: true })
  expect((await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze()).violations).toEqual([])
  if (testInfo.project.name === 'mobile') {
    await page.setViewportSize({ width: 320, height: 740 })
    await noOverflow(page)
    expect(await orbitOverlaps(page)).toBe(false)
  }
  await page.getByRole('link', { name: '安装指南' }).click()
  await expect(page).toHaveURL(/\/night-bot\/guide\/getting-started\.html$/)
  await expect(page.getByRole('heading', { level: 1, name: '快速开始' })).toBeVisible()
  await page.reload()
  await expect(page.getByRole('heading', { level: 1, name: '快速开始' })).toBeVisible()
  await noOverflow(page)
  expect(errors).toEqual([])
})

test('local search handles results, no results, and dismissal', async ({ page }) => {
  await page.goto('./')
  await page.getByRole('button', { name: '搜索文档' }).click()
  const search = page.locator('#localsearch-input')
  await search.fill('模型')
  await expect(page.locator('.VPLocalSearchBox .result').first()).toBeVisible()
  await search.fill('zzzxxyynotadocument')
  await expect(page.getByText('没有找到相关文档')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(search).not.toBeVisible()
  await expect(page.getByRole('button', { name: '搜索文档' })).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(search).toBeVisible()
  const close = page.getByTitle('关闭搜索', { exact: true })
  if (await close.isVisible()) await close.click()
  else await page.locator('.VPLocalSearchBox .backdrop').click({ position: { x: 8, y: 8 } })
  await expect(search).not.toBeVisible()
  await expect(page.getByRole('button', { name: '搜索文档' })).toBeFocused()
})

test('dark documents retain readable navigation and have a recovery page', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('vitepress-theme-appearance', 'dark'))
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('./guide/security.html')
  await expect(page.locator('html')).toHaveClass(/dark/)
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  await noOverflow(page)
  expect((await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze()).violations).toEqual([])
  await page.goto('./404.html')
  await expect(page.getByText('页面不存在', { exact: true })).toBeVisible()
  await page.getByRole('link', { name: '返回首页' }).click()
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Night Bot')
})

test('document workspace retains content, outline, sidebar and deep links', async ({ page }, testInfo) => {
  await page.goto('./guide/usage.html')
  await expect(page.getByRole('navigation', { name: '文档位置' })).toContainText('与 Bot 协作')
  await expect(page.getByRole('heading', { level: 1, name: '日常使用' })).toBeVisible()
  await expect(page.getByText('“已接纳”只表示消息已收到。', { exact: true })).toBeVisible()
  await noOverflow(page)
  if (testInfo.project.name === 'desktop') {
    const geometry = await page.locator('.VPSidebar').evaluate(el => ({
      top: el.getBoundingClientRect().top,
      navBottom: document.querySelector('.VPNavBar').getBoundingClientRect().bottom
    }))
    expect(geometry.top).toBeGreaterThanOrEqual(geometry.navBottom + 12)
  }
  await page.screenshot({ path: testInfo.outputPath('usage-redesign.png'), fullPage: true })
  expect((await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze()).violations).toEqual([])
  if (testInfo.project.name === 'mobile') {
    await page.getByRole('button', { name: '文档目录' }).click()
  }
  await page.locator('.VPSidebar').getByRole('link', { name: '模型与配置', exact: true }).click()
  await expect(page.getByRole('heading', { level: 1, name: '模型与配置' })).toBeVisible()
  await expect(page.getByRole('navigation', { name: '文档位置' })).toContainText('开始使用')
  await noOverflow(page)
  const code = page.locator('.vp-doc div.language-sh').first()
  await expect(code).toBeVisible()
  const rects = await code.evaluate(el => ({ width: el.getBoundingClientRect().width, viewport: document.documentElement.clientWidth }))
  expect(rects.width).toBeLessThan(rects.viewport)
  await page.goto('./guide/usage.html#常见问题')
  await expect(page.locator('h2#常见问题')).toBeInViewport()
  await page.reload()
  await expect(page.locator('h2#常见问题')).toBeInViewport()
})

test('homepage FAQ expands by keyboard and dark homepage stays readable', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('vitepress-theme-appearance', 'dark'))
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('./')
  await expect(page.locator('html')).toHaveClass(/dark/)
  await noOverflow(page)
  const question = page.locator('summary').filter({ hasText: '需要先装 Pi CLI 吗？' })
  const answer = page.getByText('不用。准备好 Git', { exact: false })
  await expect(answer).not.toBeVisible()
  await question.focus()
  await page.keyboard.press('Enter')
  await expect(answer).toBeVisible()
  await page.keyboard.press('Enter')
  await expect(answer).not.toBeVisible()
  expect((await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze()).violations).toEqual([])
})
