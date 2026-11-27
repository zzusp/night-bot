import {test,expect} from '@playwright/test';
import {startPreview} from './preview.mjs';
let fixture:Awaited<ReturnType<typeof startPreview>>;
test.beforeAll(async()=>{fixture=await startPreview({port:0,sessionRecords:true})});
test.afterAll(async()=>{await fixture?.close()});
for(const width of [1440,390])test(`Router work activity is global and channel pages keep it hidden at ${width}px`,async({page})=>{
 const hits:string[]=[];
 page.on('request',r=>hits.push(new URL(r.url()).pathname));
 await page.route('**/api/overview',r=>r.fulfill({json:{status:'connected',tasks:{items:[],total:0},running:{items:[{taskId:'all',title:'全局执行任务',state:'running'}],total:1},interrupted:{items:[],total:0},channels:[],conversations:[]}}));
 await page.setViewportSize({width,height:900});
 await page.goto(fixture.origin+'/#/router');
 await page.getByLabel('访问令牌',{exact:true}).fill(fixture.token);
 await page.getByRole('button',{name:'连接工作空间',exact:true}).click();
 if(width<1251)await page.getByRole('button',{name:'显示工作动态'}).click();
 const rail=page.getByRole('complementary',{name:'任务动态'});
 await expect(rail).toContainText('全局执行任务');
 await expect(rail.getByRole('link',{name:/全局执行任务/})).toHaveAttribute('href','#/tasks/all');
 expect(hits.filter(path=>/\/api\/(chat|conversations)\/[^/]+\/(activity|stage-times)/.test(path))).toEqual([]);
 await page.goto(fixture.origin+'/#/channels/room-product');
 await expect(rail).toHaveCount(0);
})
