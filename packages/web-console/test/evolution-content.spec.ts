import {test, expect, type Page} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import {FIXTURE_TOKEN} from './preview.mjs';

const item = {id: 'memory:fixture', kind: 'memory', name: '示例记忆', scope: 'bot', status: 'applied', revision: 2, updatedAt: '2026-11-10T10:00:00Z'};
const current = {text: '<script>safe plain text</script>\n新的中文内容\n' + '长内容'.repeat(200), revision: 2, updatedAt: item.updatedAt};
const body = {id: item.id, kind: item.kind, name: item.name, revision: 2, current, previous: {text: '旧内容', revision: 1, updatedAt: item.updatedAt}, comparison: {status: 'available', added: 1, removed: 1, lines: [{type: 'unchanged', text: '相同内容'}, {type: 'removed', text: '旧内容'}, {type: 'added', text: '新的中文内容'}]}, redacted: false};
async function open(page: Page) {
  await page.route('**/api/evolution?**', route => route.fulfill({json: {status: 'ready', coverage: 'bot-shared-current-state', items: [item], total: 1, offset: 0, nextOffset: null, memory: {}, skills: {}}}));
  await page.goto('/#/evolution');
  await page.getByLabel('访问令牌', {exact: true}).fill(FIXTURE_TOKEN);
  await page.getByRole('button', {name: '连接工作空间', exact: true}).click();
  await expect(page.getByRole('button', {name: '查看内容：示例记忆', exact: true})).toBeVisible();
}

test('正文显式读取、纯文本、最新差异、键盘返回与浅深色窄屏', async ({page}) => {
  let reads = 0;
  await page.route('**/api/evolution/items/**', route => { reads++; expect(new URL(route.request().url()).searchParams.get('revision')).toBe('2'); return route.fulfill({json: body}); });
  await open(page);
  expect(reads).toBe(0);
  const summary = page.locator('.evolution-summary'), summaryNode = await summary.elementHandle();
  const action = page.getByRole('button', {name: '查看内容：示例记忆', exact: true});
  await action.focus(); await action.press('Enter');
  await expect(summary).toBeHidden();
  await expect(page.locator('.evolution-plain-text')).toContainText('<script>safe plain text</script>');
  await expect(page.locator('#evolution-content-title')).toBeFocused();
  await expect(page.locator('.evolution-content script')).toHaveCount(0);
  await page.getByRole('button', {name: '最近差异', exact: true}).click();
  await expect(page.getByRole('group', {name: '最新与上次的逐行差异'})).toBeVisible();
  await expect(page.locator('.evolution-diff-line--removed')).toContainText('−删除：旧内容');
  await expect(page.locator('.evolution-diff-line--added')).toContainText('+新增：新的中文内容');
  await expect(page.locator('.evolution-diff-line--unchanged')).toContainText('未变：相同内容');
  await expect(page.getByText('新增 1 行', {exact: true})).toBeVisible();
  for (const theme of ['light', 'dark']) {
    await page.evaluate(theme => document.documentElement.dataset.theme = theme, theme);
    await page.setViewportSize({width: 390, height: 844});
    await page.emulateMedia({reducedMotion: 'reduce'});
    await page.getByRole('button', {name: '当前内容', exact: true}).click();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const violations = (await new AxeBuilder({page}).include('.evolution-content').analyze()).violations;
    expect(violations).toEqual([]);
    await page.locator('.evolution-content').screenshot({path: test.info().outputPath(`content-${theme}-390.png`)});
  }
  await page.getByRole('button', {name: '返回列表', exact: true}).click();
  await expect(action).toBeFocused();
  await expect(summary).toBeVisible();
  expect(await summaryNode!.evaluate(el => el.isConnected)).toBe(true);
  await expect(page.locator('.evolution-content')).toHaveCount(0);
});

for (const theme of ['light', 'dark']) for (const width of [1440, 390]) {
  test(`差异无障碍与切换过程对比度：${theme} ${width}px`, async ({page}) => {
    await page.route('**/api/evolution/items/**', route => route.fulfill({json: body}));
    await page.setViewportSize({width, height: 960});
    await page.emulateMedia({reducedMotion: 'no-preference'});
    await open(page);
    await page.evaluate(theme => document.documentElement.dataset.theme = theme, theme);
    await page.getByRole('button', {name: '查看内容：示例记忆'}).click();
    await expect(page.locator('.evolution-plain-text')).toBeVisible();
    // Keep the pointer over each control. Do not wait out a color transition to make axe pass.
    for (const name of ['最近差异', '当前内容', '最近差异']) {
      const toggle = page.getByRole('button', {name, exact: true});
      await toggle.hover();
      const samples = await toggle.evaluate(async button => {
        const samples: {foreground: string; backgrounds: string[]; transitions: string; animations: string[]}[] = [];
        (button as HTMLButtonElement).click();
        const until = performance.now() + 240;
        do {
          await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
          for (const control of button.parentElement!.querySelectorAll('button')) {
            const style = getComputedStyle(control);
            samples.push({foreground: style.color,
              backgrounds: style.backgroundImage.match(/rgba?\([^)]+\)/g) ?? [style.backgroundColor],
              transitions: style.transitionProperty,
              animations: control.getAnimations().filter(animation => animation instanceof CSSTransition).map(animation => (animation as CSSTransition).transitionProperty)});
          }
        } while (performance.now() < until);
        return samples;
      });
      const luminance = (color: string) => {
        const values = color.match(/[\d.]+/g)!.map(Number);
        expect(values.length < 4 || values[3] === 1, `Expected opaque sampled color: ${color}`).toBe(true);
        return values.slice(0, 3).map(value => value / 255).map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4).reduce((sum, value, index) => sum + value * [.2126, .7152, .0722][index], 0);
      };
      for (const sample of samples) {
        expect(sample.transitions).not.toMatch(/(?:^|,\s*)(?:all|background(?:-[\w-]+)?|color)(?:,|$)/);
        expect(sample.animations.some(property => property === 'color' || property.startsWith('background'))).toBe(false);
        const text = luminance(sample.foreground);
        for (const background of sample.backgrounds) {
          const surface = luminance(background), contrast = (Math.max(text, surface) + .05) / (Math.min(text, surface) + .05);
          expect(contrast, JSON.stringify(sample)).toBeGreaterThanOrEqual(4.5);
        }
      }
      await expect(toggle).toHaveAttribute('aria-pressed', 'true');
      expect((await new AxeBuilder({page}).include('.evolution-content').analyze()).violations).toEqual([]);
    }
    await expect(page.locator('.evolution-diff-sign[aria-label]')).toHaveCount(0);
    await expect(page.locator('.evolution-diff-sign[aria-hidden="true"]')).toHaveCount(3);
    const currentToggle = page.getByRole('button', {name: '当前内容', exact: true});
    await currentToggle.focus(); await currentToggle.press('Space');
    await expect(currentToggle).toBeFocused();
    await expect(currentToggle).toHaveAttribute('aria-pressed', 'true');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}

test('加载、无上次、无变化、失败重试、撤权及版本冲突隐藏旧内容', async ({page}) => {
  let response: object = body, status = 200, delayed = false;
  await page.route('**/api/evolution/items/**', async route => {
    if (delayed) await new Promise(resolve => setTimeout(resolve, 500));
    await route.fulfill({status, json: response});
  });
  await open(page);
  await page.getByRole('button', {name: '查看内容：示例记忆'}).click();
  await expect(page.locator('.evolution-plain-text')).toBeVisible();
  status = 403; response = {error: 'EVOLUTION_BODY_FORBIDDEN'}; delayed = true;
  await page.getByRole('button', {name: '刷新内容'}).click();
  await expect(page.getByText('正在读取内容…')).toBeVisible();
  await expect(page.locator('.evolution-plain-text')).toHaveCount(0);
  await expect(page.getByRole('alert')).toBeVisible();
  status = 503; response = {error: 'EVOLUTION_UNAVAILABLE'};
  await page.getByRole('button', {name: '重新获取', exact: true}).click();
  await expect(page.locator('.evolution-plain-text')).toHaveCount(0);
  await expect(page.getByRole('alert')).toContainText('内容暂不可读');
  status = 200; response = {...body, previous: null, comparison: {...body.comparison, status: 'no_previous', reason: 'not_recorded'}};
  await page.getByRole('button', {name: '重新获取', exact: true}).click();
  await page.getByRole('button', {name: '最近差异'}).click();
  await expect(page.getByText('暂无可比较的上次内容', {exact: true})).toBeVisible();
  response = {...body, comparison: {...body.comparison, added: 0, removed: 0, lines: []}};
  await page.getByRole('button', {name: '刷新内容'}).click();
  await expect(page.getByText('可展示的内容没有变化。')).toBeVisible();
  status = 409; response = {error: 'EVOLUTION_VERSION_STALE'};
  await page.getByRole('button', {name: '刷新内容'}).click();
  await expect(page.getByText('条目已经更新，请重新获取列表后查看最新内容。')).toBeVisible();
  await page.getByRole('button', {name: '重新获取', exact: true}).click();
  await expect(page.locator('.evolution-content')).toHaveCount(0);
});

test('关闭未完成读取不重新展示正文，目录技能标明采集边界', async ({page}) => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => {release = resolve;});
  let started = false;
  await page.route('**/api/evolution/items/**', async route => {
    started = true;
    await gate;
    await route.fulfill({json: {...body, kind: 'skill', comparison: {...body.comparison, basis: 'observed'}}}).catch(() => {});
  });
  await open(page);
  await page.getByRole('button', {name: '查看内容：示例记忆'}).click();
  await expect.poll(() => started).toBe(true);
  await expect(page.getByText('正在读取内容…')).toBeVisible();
  await page.getByRole('button', {name: '返回列表', exact: true}).click();
  release();
  await expect(page.locator('.evolution-content')).toHaveCount(0);
  await page.getByRole('button', {name: '查看内容：示例记忆'}).click();
  await expect(page.getByText('比较范围：上次采集 → 当前')).toBeVisible();
});
