import {defineConfig} from '@playwright/test'
import {fileURLToPath} from 'node:url'

export default defineConfig({
  testDir: './test',
  testMatch: 'browser.spec.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 40_000,
  expect: {timeout: 10_000},
  outputDir: fileURLToPath(new URL('../../docs/tmp/web-console-browser', import.meta.url)),
  reporter: 'list',
  globalSetup: './test/browser-setup.mjs',
  use: {
    browserName: 'chromium',
    channel: 'msedge',
    baseURL: 'http://127.0.0.1:3081',
    viewport: {width: 1440, height: 960},
    locale: 'zh-CN',
    timezoneId: 'Asia/Shanghai',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
})
