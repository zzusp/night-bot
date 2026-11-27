import {openRouter} from './open-router';
import {test, expect} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import {FIXTURE_TOKEN} from './preview.mjs';
import {taskSessionView, routerSessionView} from '../server/session-view.js';

// Synthetic journal fixtures only. Exercise the real server projection before
// serving DTOs to the production page; no real journals or error bodies loaded.
async function projected(router: boolean) {
  const sessionId = 'synthetic-failure-preview', conversationId = 'room-product';
  const rows: any[] = [{sourceEntry: {id:'synthetic-label'}, messages:[{role:'assistant',content:[{type:'text',text:'工具失败预览 · 合成数据'}]}]}];
  const cases = [
    ['resident_reply_query', {name:'ToolArgsError',code:'INVALID_ARGS'}, true],
    ['resident_dependency_evaluate', {name:'ToolTimeoutError',code:'TOOL_TIMEOUT'}, true],
    ['resident_source_get', null, true],
    ['resident_task_query', null, false],
    ['resident_task_query', null, false],
  ] as const;
  cases.forEach(([name,info,isError],index) => {
    const id = 'synthetic-'+index;
    rows.push({sourceEntry:{id:id+'-call'},messages:[{role:'assistant',content:[{type:'toolCall',id,name,arguments:name==='resident_task_query'?{limit:10}:{private:'PRIVATE_ARGS'}}]}]});
    rows.push({sourceEntry:{id:id+'-result'},messages:[{role:'toolResult',toolCallId:id,toolName:name,isError,
      details:{nativeResult:{isError,error:{message:'PRIVATE_EXCEPTION',info}},stack:'PRIVATE_STACK'},
      content:[{type:'text',text:isError?'PRIVATE_BODY /private/path token=PRIVATE_TOKEN':JSON.stringify({tasks:[],total:0,unknown:'PRIVATE_SUCCESS_FIELD'})}]}]});
  });
  rows.push({sourceEntry:{id:'synthetic-answer'},messages:[{role:'assistant',stopReason:'stop',content:[{type:'text',text:'核对结束。'}]}]});
  const snapshot = {header:{id:sessionId,...router?{runtimeOwner:'conversation-router',conversationId,generation:1}:{}},entries:[{id:'synthetic-commit'}],
    audit:[{domain:'task',kind:'identity',version:1,payload:{taskId:'task-research',sessionId}}],context:{projection:{entries:rows}}};
  const persistence = {readNative:async()=>snapshot};
  return router ? routerSessionView({conversationId,readRouter:async()=>({id:conversationId,activeSessionId:sessionId,generation:1,phase:'active'}),persistence})
    : taskSessionView({task:{taskId:'task-research',session:{sessionId,sessionBound:true}},persistence});
}

for (const router of [true,false]) {
  test(`${router?'Router':'任务'}工具失败安全原因、折叠展开、键盘与撤权`,async({page})=>{
    const dto = await projected(router);
    expect(JSON.stringify(dto)).not.toMatch(/PRIVATE_|private\/path|nativeResult|stack/);
    const endpoint = router?'**/api/conversations/room-product/session?*':'**/api/tasks/task-research/session?*';
    let denied = false;
    await page.route(endpoint,route=>route.fulfill(denied?{status:403,json:{error:'RESOURCE_FORBIDDEN'}}:{json:dto}));
    await page.goto(router?'/#/channels/room-product':'/#/tasks/task-research');
    await page.getByLabel('访问令牌',{exact:true}).fill(FIXTURE_TOKEN);
    await page.getByRole('button',{name:'连接工作空间',exact:true}).click();
    if(router)await openRouter(page);
    const history=page.locator('.execution-history').filter({hasText:'工具失败预览 · 合成数据'});
    const group=history.locator('.execution-turn-process');
    await expect(group).not.toHaveAttribute('open');
    await expect(group.locator(':scope > summary')).toContainText('5 次工具调用');
    await group.locator(':scope > summary').focus();await page.keyboard.press('Enter');
    const steps=group.locator('.pi-tool-step');
    await expect(steps).toHaveCount(5);
    const reason='输入不符合要求，请检查参数。';
    const hiddenReasons = async () => {
      for(const index of [0,1,2]){
        await expect(steps.nth(index)).not.toHaveAttribute('open');
        const summary=steps.nth(index).locator('summary');
        await expect(summary).not.toContainText(/输入不符合要求|调用超时|未记录失败原因|INVALID_ARGS|TOOL_TIMEOUT/);
        await expect(summary.locator('[title]')).toHaveCount(0);
        await expect(steps.nth(index).locator('.pi-tool-body')).not.toBeVisible();
      }
    };
    await hiddenReasons();
    await steps.nth(0).locator('summary').focus();await page.keyboard.press('Enter');
    await expect(steps.nth(0)).toHaveAttribute('open');
    await expect(steps.nth(0).locator('summary')).toBeFocused();
    const output=steps.nth(0).locator('.tool-part').last();
    await expect(output).toContainText(reason);
    await expect(output).toContainText('INVALID_ARGS');
    await expect(output).not.toContainText('尚未声明');
    expect((await steps.nth(0).innerText()).split(reason).length-1).toBe(1);
    await steps.nth(0).locator('summary').click();
    await hiddenReasons();
    await steps.nth(2).locator('summary').click();
    await expect(steps.nth(2).locator('.tool-part').last()).toContainText('未记录失败原因');
    await expect(steps.nth(2).locator('summary')).not.toContainText('未记录失败原因');
    await steps.nth(2).locator('summary').click();
    await hiddenReasons();
    // One expanded known failure beside two collapsed failures in each capture.
    await steps.nth(0).locator('summary').click();
    await expect(page.locator('body')).not.toContainText('PRIVATE_');
    await expect(steps.nth(3).locator('summary')).toBeVisible();
    if(router)await page.screenshot({path:'/tmp/night-bot-tool-failure-expanded-desktop.png'});
    for(const theme of ['light','dark']){
      await page.setViewportSize({width:390,height:844});
      await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);
      await page.emulateMedia({reducedMotion:'reduce'});
      expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
      expect((await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze()).violations).toEqual([]);
    }
    if(!router){await page.evaluate(()=>document.documentElement.dataset.theme='light');await page.screenshot({path:'/tmp/night-bot-tool-failure-expanded-narrow.png'});}
    await page.evaluate(()=>window.dispatchEvent(new Event('online')));
    await expect(steps.nth(0)).toHaveAttribute('open');
    denied=true;await page.evaluate(()=>window.dispatchEvent(new Event('online')));
    await expect(page.locator('.execution-history .message-tool')).toHaveCount(0);
  });
}
