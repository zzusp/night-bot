import {test, expect} from '@playwright/test'
import {FIXTURE_TOKEN} from './preview.mjs'

test('任务元数据保持单行与独立列宽，窄屏仅表格滚动', async ({page}) => {
  await page.route('**/api/tasks?*', route => route.fulfill({json: {items: [
    ['waiting', '核对材料并验证完整结果'], ['completed', '整理本周执行结果'], ['running', '处理长标题'.repeat(40)],
  ].map(([state, title], index) => ({taskId: 'width-' + index, state, title,
    objective: '核对任务材料中的实际事实与结果，保留完整证据。'.repeat(15),
    createdAt: '2026-11-12T01:00:00Z', updatedAt: '2026-11-12T14:01:00Z',
    durations: {observedAt: '2026-11-12T14:01:00Z', total: {milliseconds: 34500000}, execution: {milliseconds: 30780000}},
  })), total: 3, offset: 0, nextOffset: null}}))
  await page.goto('/#/tasks')
  await page.getByLabel('访问令牌', {exact:true}).fill(FIXTURE_TOKEN)
  await page.getByRole('button', {name:'连接工作空间', exact:true}).click()
  await expect(page.locator('.task-table tbody tr')).toHaveCount(3)
  for (const width of [2048, 1440, 1024, 760, 390]) {
    await page.setViewportSize({width, height: 960})
    for (const theme of ['light', 'dark']) {
      await page.evaluate(theme => document.documentElement.dataset.theme = theme, theme)
      const geometry = await page.locator('.task-table').evaluate(table => {
        const singleLine = (node: Element) => { const range = document.createRange(); range.selectNodeContents(node); return new Set(Array.from(range.getClientRects()).map(rect => Math.round(rect.top))).size <= 1 }
        const wrap = table.parentElement!
        return {pageFits: document.documentElement.scrollWidth <= innerWidth,
          statusWidths: Array.from(table.querySelectorAll('.task-status')).map(cell => cell.getBoundingClientRect().width),
          singleLines: Array.from(table.querySelectorAll('th, .task-status .board-badge, .task-updated time, td.task-duration')).every(singleLine),
          scrollWidth: wrap.scrollWidth, clientWidth: wrap.clientWidth,
          visibleColumns: Array.from(table.querySelectorAll('th')).every(cell => getComputedStyle(cell).display !== 'none')}
      })
      expect(geometry.pageFits).toBe(true)
      expect(geometry.statusWidths.every(value => value >= 103)).toBe(true)
      expect(geometry.singleLines).toBe(true)
      expect(geometry.visibleColumns).toBe(true)
      if (width === 390) expect(geometry.scrollWidth).toBeGreaterThan(geometry.clientWidth)
      await page.screenshot({path: test.info().outputPath(`task-columns-${width}-${theme}.png`), fullPage:true})
    }
  }
})
