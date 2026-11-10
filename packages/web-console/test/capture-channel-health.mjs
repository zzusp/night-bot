import {chromium, expect} from '@playwright/test';
import {startPreview, FIXTURE_TOKEN} from './preview.mjs';
import {healthScenarios} from './channel-health-scenarios.mjs';
import {mkdir, writeFile} from 'node:fs/promises';
const out = new URL('../../../data/workspaces/channel-card-acceptance/', import.meta.url).pathname;
await mkdir(out, {recursive: true});
const browser = await chromium.launch({headless: true, ...(process.env.PREVIEW_BROWSER_EXECUTABLE ? {executablePath: process.env.PREVIEW_BROWSER_EXECUTABLE} : {})});
const evidence = [];
try {
  for (const scenario of healthScenarios) {
    const fixture = await startPreview({port: 0, replyDelayMs: 0, dingtalkHealth: scenario.health, dingtalkBindingActive: scenario.bindingActive});
    const page = await browser.newPage({viewport: {width: 1440, height: 960}, locale: 'zh-CN', deviceScaleFactor: 1});
    try {
      await page.goto(fixture.origin + '/#/channels');
      await page.getByLabel('访问令牌', {exact: true}).fill(FIXTURE_TOKEN);
      await page.getByRole('button', {name: '连接工作空间', exact: true}).click();
      const card = page.locator('.channel-card').filter({has: page.getByRole('button', {name: '渠道操作：dingtalk-work', exact: true})});
      await expect(card.locator('.channel-card-health')).toHaveText(scenario.label);
      await expect(card.locator('.channel-card-health')).toHaveClass(new RegExp(`channel-card-health--${scenario.kind}`));
      await expect(card.locator('.channel-card-target, .channel-card-responsibility, .channel-card-id')).toHaveCount(0);
      await expect(card.locator('.channel-card-error')).toHaveCount(0);
      await expect(card).not.toContainText('请先处理旧依赖');
      const data = await page.request.get(fixture.origin + '/api/channels').then(response => response.json());
      const actual = data.items.find(item => item.channelId === 'dingtalk-work');
      evidence.push({scenario: scenario.id, title: scenario.title, source: 'Isolated test adapter input through real production HTTP and DTO; not live account health', input: scenario.health, bindingActive: scenario.bindingActive, result: actual, displayedHealth: await card.locator('.channel-card-health').innerText()});
      await page.mouse.move(0, 0);
      await page.screenshot({path: out + `health-${scenario.id}-desktop.png`});
      await card.screenshot({path: out + `health-${scenario.id}-card.png`});
      await page.setViewportSize({width: 390, height: 844});
      await card.scrollIntoViewIfNeeded();
      await expect(card.locator('.channel-card-health')).toBeVisible();
      if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)) throw new Error(`Mobile overflow: ${scenario.id}`);
      await page.screenshot({path: out + `health-${scenario.id}-mobile.png`});
      console.log(`${scenario.title}: health-${scenario.id}-card.png`);
    } finally { await page.close(); await fixture.close(); }
  }
  await writeFile(out + 'source-state-evidence.json', JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify({out, scenarios: healthScenarios.map(row => row.id)}));
} finally { await browser.close(); }
