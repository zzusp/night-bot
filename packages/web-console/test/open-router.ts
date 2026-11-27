import type {Page} from '@playwright/test';

export async function openRouter(page:Page,scope?:string){
  await page.evaluate(scope=>{
    const match=/^#\/(chat|channels)\/([^?]+)/.exec(location.hash);
    const selected=scope??(match?(match[1]==='chat'?'chat':'conversations')+':'+decodeURIComponent(match[2]):undefined);
    location.hash='/router'+(selected?'?conversation='+encodeURIComponent(selected):'');
  },scope);
}
