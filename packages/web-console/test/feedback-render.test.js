import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, existsSync} from 'node:fs';
import {registerHooks} from 'node:module';
import {fileURLToPath} from 'node:url';
import ts from 'typescript';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
let destination;
const paths=[];
globalThis.__feedbackResource=path=>{paths.push(path);return {data:path==='/feedback'?destination:undefined,loading:false,error:null,refresh(){}}};
const hooks=registerHooks({
 resolve(specifier,context,next){if(specifier.startsWith('.')&&context.parentURL?.startsWith('file:')){const url=new URL(specifier,context.parentURL);for(const extension of ['.ts','.tsx'])if(existsSync(fileURLToPath(url)+extension))return next(url.href+extension,context)}return next(specifier,context)},
 load(url,context,next){if(url.endsWith('.css'))return {format:'module',source:'',shortCircuit:true};if(/\.tsx?$/.test(url)&&url.startsWith('file:')){let input=readFileSync(new URL(url),'utf8');if(url.endsWith('/src/FeedbackPage.tsx'))input=input.replace('useState<Feedback | null>(null)', 'useState<Feedback | null>(globalThis.__feedbackRecord ?? null)').replace('useState<{title: string; body: string} | null>(null)', 'useState<{title: string; body: string} | null>(globalThis.__feedbackDraft ?? null)');if(url.endsWith('/src/hooks.ts'))input=input.replace('export function useResource<T>','function originalUseResource<T>')+'\nexport const useResource = path => globalThis.__feedbackResource(path);';return {format:'module',source:ts.transpileModule(input,{fileName:fileURLToPath(url),compilerOptions:{module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}}).outputText,shortCircuit:true}}return next(url,context)}
});
let FeedbackPage;try{({default:FeedbackPage}=await import('../src/FeedbackPage.tsx'))}finally{hooks.deregister()}
const render=()=>renderToStaticMarkup(createElement(FeedbackPage));
test('feedback starts with visible scope, model destination and unchecked consent, never starts collection on render',()=>{
 destination={target:'zzusp/night-bot',model:'provider/model',revision:'configuration-1',endpoint:'https://models.example'};paths.length=0;const html=render();
 assert.match(html,/独立 Pi 会话/);assert.match(html,/运行信息、渠道状态汇总和日志错误码/);assert.match(html,/自动脱敏可能遗漏/);assert.match(html,/当前模型服务/);assert.match(html,/zzusp\/night-bot/);assert.match(html,/provider\/model/);assert.match(html,/https:\/\/models.example/);
 assert.match(html,/type="checkbox"/);assert.doesNotMatch(html,/checked=""/);assert.match(html,/<button[^>]*disabled=""[^>]*><span[^>]*>开始诊断/);assert.deepEqual(paths,['/feedback',null]);assert.doesNotMatch(html,/确认提交 Issue/);
});
test('scope remains visible before configuration is available, submit stays unavailable',()=>{destination=undefined;const html=render();assert.match(html,/数据收集与提交提示/);assert.match(html,/提交 GitHub 前请核对完整内容/);assert.match(html,/<button[^>]*disabled=""[^>]*><span[^>]*>开始诊断/)});
test('UI has separate exact-payload confirmation and model-bound collection with no persistent browser content storage',()=>{
 const source=readFileSync(new URL('../src/FeedbackPage.tsx',import.meta.url),'utf8');
 assert.match(source,/consent: true, model: destination.data.model/);assert.match(source,/confirm: true, title: record.title, body: record.body/);assert.match(source,/setSubmitAttempted\(true\)/);assert.match(source,/method: 'DELETE'/);assert.doesNotMatch(source,/localStorage|sessionStorage|dangerouslySetInnerHTML|window\.confirm/);
});

test('ready feedback displays editable exact server preview and unsaved edits block publication',()=>{
 globalThis.__feedbackRecord={id:'report',state:'ready',target:'zzusp/night-bot',title:'已脱敏标题',body:'## 已脱敏正文\n<script>not executable</script>'};
 try {
  let html=render();assert.match(html,/id="feedback-issue-title"[^>]*value="已脱敏标题"/);assert.match(html,/id="feedback-issue-body"/);assert.match(html,/&lt;script&gt;not executable&lt;\/script&gt;/);assert.doesNotMatch(html,/<script>/);assert.doesNotMatch(html,/更新预览/);
  globalThis.__feedbackDraft={title:'修改标题',body:'修改正文'};html=render();assert.match(html,/value="修改标题"/);assert.match(html,/>修改正文<\/textarea>/);assert.match(html,/更新预览/);assert.match(html,/type="checkbox" disabled=""/);assert.match(html,/<button[^>]*disabled=""[^>]*><span[^>]*>确认提交 Issue/);
 } finally {delete globalThis.__feedbackRecord;delete globalThis.__feedbackDraft;}
});
test('editing clears approval and uses PATCH before permitting exact server-payload publication',()=>{
 const source=readFileSync(new URL('../src/FeedbackPage.tsx',import.meta.url),'utf8');
 assert.match(source,/method: 'PATCH', body: { title: editDraft.title, body: editDraft.body }/);
 assert.match(source,/setRecord\(updated\); setEditDraft\(null\); setConfirm\(false\)/);
 assert.match(source,/record.state !== 'ready' \|\| editDraft !== null \|\| !confirm/);
 assert.match(source,/setEditDraft\({title: event.target.value,[^}]+}\); setConfirm\(false\)/);
 assert.match(source,/setEditDraft\({title: editDraft\?\.title[^}]+}\); setConfirm\(false\)/);
 assert.match(source,/finally { editLock.current = false;/);
});

test('collection binds explicit consent to provider endpoint revision',()=>{
 const source=readFileSync(new URL('../src/FeedbackPage.tsx',import.meta.url),'utf8');
 assert.match(source,/revision: destination.data.revision/);
 assert.match(source,/useEffect\(\(\) => { setConsent\(false\); }, \[destination.data\?\.model, destination.data\?\.endpoint, destination.data\?\.revision\]\)/);
});
