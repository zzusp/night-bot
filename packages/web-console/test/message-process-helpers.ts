import { expect, type Page } from '@playwright/test'
export async function openMessageProcess(page: Page) {
  await page.locator('.conversation-page .message-process-trigger').first().click()
  const dialog = page.getByRole('dialog', { name: '消息处理过程', exact: true })
  await expect(dialog).toBeVisible()
  return dialog
}
export async function openConversationRecords(page: Page) {
  const dialog = await openMessageProcess(page)
  await dialog.getByText('本会话的任务与安排', { exact: true }).click()
  return dialog
}
