import {test, expect, type Page} from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import {FIXTURE_TOKEN} from './preview.mjs'

function contrast(first: string, second: string) {
  const luminance = (rgb: string) => {
    const [r, g, b] = rgb.match(/[\d.]+/g)!.slice(0, 3).map(Number).map(value => value / 255)
      .map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4)
    return .2126 * r + .7152 * g + .0722 * b
  }
  const values = [luminance(first), luminance(second)].sort((a, b) => b - a)
  return (values[0] + .05) / (values[1] + .05)
}

async function login(page: Page, path: string) {
  await page.goto('/#' + path)
  await page.getByLabel('访问令牌', {exact: true}).fill(FIXTURE_TOKEN)
  await page.getByRole('button', {name: '连接工作空间', exact: true}).click()
  await expect(page.locator('.message-user').first()).toBeVisible()
  await expect(page.locator('.message-assistant').first()).toBeVisible()
}

for (const theme of ['light', 'dark']) {
  for (const path of ['/chat/sample-plan', '/channels/room-product', '/channels/custom-direct']) {
    test(`${theme} ${path}: reference palette and borderless bubbles at desktop and mobile widths`, async ({page}) => {
      await login(page, path)
      await page.evaluate(theme => {document.documentElement.dataset.theme = theme}, theme)
      for (const width of [1440, 390]) {
        await page.setViewportSize({width, height: 960})
        const backgrounds: string[] = []
        for (const role of ['user', 'assistant']) {
          const row = page.locator('.message-' + role).first()
          const body = row.locator('.message-body')
          const style = await body.evaluate((element, role) => {
            const s = getComputedStyle(element)
            const root = getComputedStyle(document.documentElement)
            const normalize = (value: string) => {
              const [r, g, b] = value.trim().slice(1).match(/../g)!.map(value => parseInt(value, 16))
              return `rgb(${r}, ${g}, ${b})`
            }
            return {
              background: s.backgroundColor, text: getComputedStyle(element.querySelector('.markdown')!).color,
              expected: normalize(root.getPropertyValue(`--board-message-${role}-bg`)),
              borders: [s.borderTopWidth, s.borderRightWidth, s.borderBottomWidth, s.borderLeftWidth],
              shadow: s.boxShadow, outline: s.outlineStyle,
              padding: [s.paddingTop, s.paddingRight, s.paddingBottom, s.paddingLeft],
              corners: [s.borderTopLeftRadius, s.borderTopRightRadius, s.borderBottomLeftRadius, s.borderBottomRightRadius],
            }
          }, role)
          expect(style.background).toBe(style.expected)
          const referencePalette = theme === 'light' ? ['rgb(204, 223, 255)', 'rgb(244, 244, 245)'] : ['rgb(38, 59, 92)', 'rgb(48, 48, 51)']
          expect(style.background).toBe(referencePalette[role === 'user' ? 0 : 1])
          expect(style.borders).toEqual(['0px', '0px', '0px', '0px'])
          expect(style.shadow).toBe('none')
          expect(style.outline).toBe('none')
          expect(style.padding).toEqual(['13px', '17px', '13px', '17px'])
          expect(style.corners).toEqual(['14px', '14px', '14px', '14px'])
          expect(contrast(style.text, style.background)).toBeGreaterThanOrEqual(4.5)
          await expect(row).toHaveCSS('align-self', role === 'user' ? 'flex-end' : 'flex-start')
          backgrounds.push(style.background)
        }
        expect(backgrounds[0]).not.toBe(backgrounds[1])
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
        await expect(page.getByLabel('消息内容', {exact: true})).toHaveCount(path.startsWith('/chat') ? 1 : 0)
        await page.screenshot({path: test.info().outputPath(`${theme}-${width}.png`)})
      }
    })
  }

  test(`${theme}: Markdown quotes and links retain AA contrast in both bubbles`, async ({page}) => {
    await page.route('**/api/chat/sample-plan', async route => {
      const response = await route.fetch()
      const data = await response.json()
      for (const message of data.messages) message.text += '\n\n> 引用内容仍需清晰可读。\n\n[参考链接](https://example.com) 与 `inline code`。\n\n```text\n代码块示例\n```'
      await route.fulfill({response, json: data})
    })
    await login(page, '/chat/sample-plan')
    await page.evaluate(theme => {document.documentElement.dataset.theme = theme}, theme)
    for (const role of ['user', 'assistant']) {
      const body = page.locator(`.message-${role} .message-body`).first()
      const background = await body.evaluate(el => getComputedStyle(el).backgroundColor)
      for (const selector of ['blockquote', 'a']) {
        const node = body.locator(selector).first()
        await expect(node).toBeVisible()
        expect(contrast(await node.evaluate(el => getComputedStyle(el).color), background)).toBeGreaterThanOrEqual(4.5)
      }
      await body.locator('a').first().focus()
      await expect(body.locator('a').first()).toBeFocused()
    }
    expect((await new AxeBuilder({page}).include('.message-column').analyze()).violations).toEqual([])
    await page.emulateMedia({forcedColors: 'active'})
    for (const role of ['user', 'assistant']) {
      await expect(page.locator(`.message-${role} .message-body`).first()).toHaveCSS('border-top-width', '0px')
      await expect(page.locator(`.message-${role} .message-meta strong`).first()).toBeVisible()
    }
  })
}
