import type {Page} from '@playwright/test';

export async function openRouter(page:Page){
  await page.evaluate(()=>{location.hash='/router'});
}
