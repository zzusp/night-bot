import {test,expect} from '@playwright/test';
import {FIXTURE_TOKEN} from './preview.mjs';
test('真实 wheel 在补页锚点恢复期间立即打断，不被后续恢复帧拉回',async({page})=>{
 await page.setViewportSize({width:390,height:960});
 await page.addInitScript(()=>{
  const original=window.requestAnimationFrame.bind(window);let pending=0;(window as any).__anchorPending=false;
  window.requestAnimationFrame=(callback)=>{const text=callback.toString();const anchor=text.includes('scrollHeight')&&text.includes('scrollTop')&&text.includes('requestAnimationFrame');if(anchor){pending++;(window as any).__anchorPending=true;}return original(time=>{if(anchor)pending--;callback(time);(window as any).__anchorPending=pending>0;});};
  (window as any).__scrolls=[];document.addEventListener('scroll',event=>{if((event.target as Element)?.matches?.('.transcript'))(window as any).__scrolls.push({top:(event.target as Element).scrollTop,pending:(window as any).__anchorPending,time:performance.now()});},{capture:true});document.addEventListener('wheel',event=>{if(event.deltaY>0){const el=document.querySelector('.transcript');(window as any).__interrupt={trusted:event.isTrusted,pending:(window as any).__anchorPending,before:el?.scrollTop,delta:event.deltaY,target:(event.target as Element)?.className};}},{capture:true});
 });
 let release!:()=>void;const gate=new Promise<void>(resolve=>release=resolve);
 await page.route('**/api/conversations/room-product/messages?**',async route=>{const offset=Number(new URL(route.request().url()).searchParams.get('messageOffset'));if(offset)await gate;await route.fulfill({json:{items:Array.from({length:50},(_,i)=>{const n=(offset?0:50)+i;return{id:`m${n}`,role:'user',text:`隔离测试消息 ${n} `+'核对正文。'.repeat(30),createdAt:new Date(Date.UTC(2026,0,1,0,n)).toISOString()};}),pages:{messages:{total:100,nextOffset:offset?null:50,revision:'r1'},outbox:{total:0,nextOffset:null,revision:'o1'}}}});});
 await page.goto('/#/channels/room-product');await page.getByLabel('访问令牌',{exact:true}).fill(FIXTURE_TOKEN);await page.getByRole('button',{name:'连接工作空间',exact:true}).click();
 await expect(page.locator('[data-message-id]')).toHaveCount(50);const list=page.locator('.transcript');await list.evaluate(el=>el.scrollTop=80);
 await page.evaluate(()=>{let frames=0;(window as any).__resizing=true;const change=()=>{const el=document.querySelector<HTMLElement>('.message-column');if(el)el.style.paddingBottom=`${24+(frames%2)*3}px`;if(++frames<45)requestAnimationFrame(change);else{if(el)el.style.paddingBottom='24px';(window as any).__resizing=false;}};requestAnimationFrame(change);});
 release();await expect(page.locator('[data-message-id]')).toHaveCount(100);await page.waitForFunction(()=>(window as any).__anchorPending);
 await list.hover();const wheelStart=await list.evaluate(el=>el.scrollTop);await page.mouse.wheel(0,220);await page.waitForFunction(()=>(window as any).__interrupt);const event=await page.evaluate(()=>(window as any).__interrupt);expect(event.trusted).toBe(true);expect(event.pending).toBe(true);
 await page.waitForFunction(()=>!(window as any).__resizing);await page.waitForTimeout(100);const after=await list.evaluate(el=>el.scrollTop);console.log(JSON.stringify({event,after,wheelStart,actualDelta:after-wheelStart,scrolls:await page.evaluate(()=>(window as any).__scrolls)}));expect(Math.abs(after-wheelStart-event.delta)).toBeLessThanOrEqual(2);
});
