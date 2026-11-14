import {test,expect} from '@playwright/test'
import {FIXTURE_TOKEN} from './preview.mjs'

test('settings and feedback forms stay centered at desktop and mobile widths',async({page})=>{
 await page.goto('/#/settings')
 await page.getByLabel('访问令牌',{exact:true}).fill(FIXTURE_TOKEN)
 await page.getByRole('button',{name:'连接工作空间',exact:true}).click()
 await expect(page.locator('.settings-page > .settings-card').first()).toBeVisible()
 for(const theme of ['light','dark']){
  await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme)
  for(const width of [1920,1440,1024,768,390]){
   await page.setViewportSize({width,height:1000})
   for(const route of ['settings','feedback']){
    await page.goto('/#/'+route)
    const container=page.locator('.'+route+'-page')
    const cards=container.locator(':scope > .settings-card, :scope > .settings-grid')
    await expect(cards.first()).toBeVisible()
    const parent=(await container.boundingBox())!
    for(const card of await cards.all()){
     const box=(await card.boundingBox())!
     expect(Math.abs((box.x-parent.x)-(parent.x+parent.width-box.x-box.width))).toBeLessThan(2)
     expect(box.width).toBeLessThanOrEqual(route==='settings'?1100:1000)
     expect(box.x).toBeGreaterThanOrEqual(0)
     expect(box.x+box.width).toBeLessThanOrEqual(width)
    }
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
    if(width===1440||width===390) await page.screenshot({path:test.info().outputPath(route+'-'+theme+'-'+width+'.png')})
   }
  }
 }
})
