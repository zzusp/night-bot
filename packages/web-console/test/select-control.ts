import {expect,type Locator} from '@playwright/test';
export async function selectOption(control:Locator,value:string){
 await control.click();
 await control.page().getByRole('option').locator(`:scope[data-value=${JSON.stringify(value)}]`).click();
 await expect(control).toHaveAttribute('data-state','closed');
}
