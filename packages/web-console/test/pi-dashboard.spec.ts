import {test,expect} from '@playwright/test';
import {FIXTURE_TOKEN} from './preview.mjs';

test('Pi dashboard execution and task card surfaces preserve data and responsive disclosures',async({page})=>{
 const row=(id:string,kind:string,status:string,text:string)=>({id:kind==='tool-call'?id:id+'-out',role:'tool',kind,callId:id,toolName:'bash',status,text,source:{sessionId:'fixture'}});
 const items=[...['a','b'].flatMap(id=>[row(id,'tool-call','pending',`echo ${id}`),row(id,'tool-result','completed',`result ${id}`)]),row('live','tool-call','running','echo working')];
 await page.route('**/api/tasks/task-research/session?*',r=>r.fulfill({json:{status:'ready',scope:'current-context',items,total:items.length,revision:'pi-preview',todos:{items:[{text:'核对来源',status:'completed'},{text:'检查执行结果',status:'in_progress'},{text:'整理交付',status:'pending'}]}}}));
 await page.goto('/#/tasks/task-research');
 await page.getByLabel('访问令牌',{exact:true}).fill(FIXTURE_TOKEN);
 await page.getByRole('button',{name:'连接工作空间',exact:true}).click();
 const group=page.locator('.execution-tool-group');
 await expect(group).toBeVisible();
 await group.locator(':scope > summary').click();
 const step=group.locator('.pi-tool-step').first();
 await step.locator('summary').click();
 await expect(step.locator('.tool-content')).toHaveText(['echo a','result a']);
 await expect(page.locator('.pi-tool-frame.is-running .pi-tool-shimmer')).toBeVisible();
 const card=page.locator('.agent-progress.pi-session-card');
 await expect(card).toContainText('检查执行结果');
 await expect(card.locator('.pi-card-sweep-layer')).toHaveCount(0);
 for(const width of [1440,390])for(const theme of ['light','dark']){
  await page.setViewportSize({width,height:960});
  await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  expect(await card.evaluate(el=>getComputedStyle(el).backgroundImage)).toBe('none');
  expect(await card.locator('.todo-in_progress').evaluate(el=>getComputedStyle(el).backgroundColor)).toBe('rgba(0, 0, 0, 0)');
  await page.screenshot({path:test.info().outputPath(`pi-dashboard-${width}-${theme}.png`),fullPage:true});
 }
 await page.emulateMedia({reducedMotion:'reduce'});
 expect(await page.locator('.pi-tool-shimmer').evaluate(el=>getComputedStyle(el,'::after').animationName)).toBe('none');
});

test('numbered read output copies exact blank lines and shell timeout is not elapsed time', async ({page,context})=>{
 await context.grantPermissions(['clipboard-read','clipboard-write']);
 const content='alpha\n\nbeta\n';
 const call=(id:string,name:string,text:string)=>({id,role:'tool',kind:'tool-call',callId:id,toolName:name,text,status:'pending'});
 const items=[call('read-lines','read',JSON.stringify({path:'/fixture/read.md'})),{...call('read-lines','read',content),id:'read-lines-out',kind:'tool-result',status:'completed'}, {id:'split',role:'assistant',text:'继续执行'},call('shell-timeout','bash',JSON.stringify({command:'echo hello',timeout:7}))];
 await page.route('**/api/tasks/task-research/session?*',r=>r.fulfill({json:{status:'ready',scope:'current-context',items,total:items.length,revision:'copy-check'}}));
 await page.goto('/#/tasks/task-research');
 await page.getByLabel('访问令牌',{exact:true}).fill(FIXTURE_TOKEN);
 await page.getByRole('button',{name:'连接工作空间',exact:true}).click();
 const read=page.locator('[data-message-id="read-lines"]');
 await read.locator('.pi-tool-step > summary').click();
 const code=read.locator('.pi-read-output > code');
 expect(await code.textContent()).toBe(content);
 await code.evaluate(el=>{const selection=window.getSelection()!;const range=document.createRange();range.selectNodeContents(el);selection.removeAllRanges();selection.addRange(range);});
 await page.keyboard.press('Control+c');
 expect(await page.evaluate(()=>navigator.clipboard.readText())).toBe(content);
 const shell=page.locator('[data-message-id="shell-timeout"]');
 await shell.locator('.pi-tool-step > summary').click();
 await expect(shell.locator('.pi-shell-command small')).toHaveText('(timeout: 7s)');
});

test('Prism read output highlights multiline syntax without changing copied source or executing markup',async({page,context})=>{
 await context.grantPermissions(['clipboard-read','clipboard-write']);
 const source='/* first\nsecond */\nconst value = "<script>window.bad=true</script>";\n\n';
 const items=[{id:'syntax',role:'tool',kind:'tool-call',callId:'syntax',toolName:'read',text:JSON.stringify({path:'/fixture/code.ts'}),status:'pending'},{id:'syntax-out',role:'tool',kind:'tool-result',callId:'syntax',toolName:'read',text:source,status:'completed'}];
 await page.route('**/api/tasks/task-research/session?*',r=>r.fulfill({json:{status:'ready',scope:'current-context',items,total:2,revision:'syntax'}}));
 await page.goto('/#/tasks/task-research');
 await page.getByLabel('访问令牌',{exact:true}).fill(FIXTURE_TOKEN);
 await page.getByRole('button',{name:'连接工作空间',exact:true}).click();
 await page.locator('.pi-tool-step > summary').click();
 const code=page.locator('.pi-read-output > code');
 await expect(code.locator('.token.pi-token-keyword')).toContainText('const');
 await expect(code.locator('.token.pi-token-comment')).toHaveCount(2);
 expect(await code.textContent()).toBe(source);
 await code.evaluate(el=>{const range=document.createRange();range.selectNodeContents(el);const s=window.getSelection()!;s.removeAllRanges();s.addRange(range);});
 await page.keyboard.press('Control+c');
 expect(await page.evaluate(()=>navigator.clipboard.readText())).toBe(source);
 expect(await page.evaluate(()=>Object.hasOwn(window,'bad'))).toBe(false);
});

test('native shell arguments remain compact and real output copies its final newline exactly',async({page,context})=>{
 await context.grantPermissions(['clipboard-read','clipboard-write']);
 const output='first actual output\n\n'+'line '.repeat(144)+'\nlast actual output\n';
 const args={command:'node example.js',description:'Controlled process',timeoutMs:7000,workdir:'/fixture',run_in_background:false};
 const items=[{id:'native-shell',role:'tool',kind:'tool-call',callId:'native-shell',toolName:'bash',text:JSON.stringify(args),status:'pending'},{id:'native-shell-out',role:'tool',kind:'tool-result',callId:'native-shell',toolName:'bash',text:output,status:'completed'}];
 await page.route('**/api/tasks/task-research/session?*',r=>r.fulfill({json:{status:'ready',scope:'current-context',items,total:2,revision:'native-shell'}}));
 await page.goto('/#/tasks/task-research');
 await page.getByLabel('访问令牌',{exact:true}).fill(FIXTURE_TOKEN);
 await page.getByRole('button',{name:'连接工作空间',exact:true}).click();
 await page.locator('.pi-tool-step > summary').click();
 await expect(page.locator('.pi-shell-command code')).toHaveText(args.command);
 await expect(page.locator('.pi-shell-command small')).toHaveText('(timeout: 7s)');
 await expect(page.locator('.pi-shell-parameters')).toHaveCount(0);
 await expect(page.locator('.pi-tool-body')).not.toContainText(args.description);
 const code=page.locator('.pi-plain-output > code');
 expect(await code.textContent()).toBe(output);
 expect(await code.locator('..').evaluate(el=>({max:getComputedStyle(el).maxHeight,bg:getComputedStyle(el).backgroundColor,radius:getComputedStyle(el).borderRadius}))).toEqual({max:'320px',bg:'rgb(245, 245, 245)',radius:'4px'});
 await code.evaluate(el=>{const range=document.createRange();range.selectNodeContents(el);const s=window.getSelection()!;s.removeAllRanges();s.addRange(range);});
 await page.keyboard.press('Control+c');
 expect(await page.evaluate(()=>navigator.clipboard.readText())).toBe(output);
});
