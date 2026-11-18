import {expect,type Locator} from '@playwright/test';
export async function selectOption(control:Locator,value:string){
 await control.click();
 await control.page().locator(`[role=option][data-value=${JSON.stringify(value)}]`).click();
 await expect(control).toHaveAttribute('data-state','closed');
}
