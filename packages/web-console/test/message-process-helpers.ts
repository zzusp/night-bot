import { expect, type Page } from '@playwright/test'
export async function openMessageProcess(page: Page) {
  const trigger = page.locator('.conversation-page .message-process-trigger').first()
  await trigger.focus()
  await trigger.press('Enter')
  const dialog = page.getByRole('dialog', { name: '消息处理过程', exact: true })
  await expect(dialog).toBeVisible()
  return dialog
}
