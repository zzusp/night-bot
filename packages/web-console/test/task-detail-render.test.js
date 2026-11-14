import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, existsSync} from 'node:fs';
import {registerHooks} from 'node:module';
import {fileURLToPath} from 'node:url';
import ts from 'typescript';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';

// Render real components with only the resource snapshot substituted. No browser,
// model or external side effects; interaction/layout coverage remains in Playwright.
let resource = {data: null, loading: false, error: null, updatedAt: null, refresh() {}};
globalThis.__taskTabResource = () => resource;
const hooks = registerHooks({
  resolve(specifier, context, next) {
    if (specifier.startsWith('.') && context.parentURL?.startsWith('file:')) {
      const url = new URL(specifier, context.parentURL);
      for (const extension of ['.ts', '.tsx']) if (existsSync(fileURLToPath(url) + extension)) return next(url.href + extension, context);
    }
    return next(specifier, context);
  },
  load(url, context, next) {
    if (url.endsWith('.css')) return {format: 'module', source: '', shortCircuit: true};
    if (/\.tsx?$/.test(url) && url.startsWith('file:')) {
      let input = readFileSync(new URL(url), 'utf8');
      if (url.endsWith('/src/hooks.ts')) input = input.replace('export function useResource<T>', 'function originalUseResource<T>') + '\nexport const useResource = () => globalThis.__taskTabResource();';
      const source = ts.transpileModule(input, {fileName: fileURLToPath(url), compilerOptions: {module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022}}).outputText;
      return {format: 'module', source, shortCircuit: true};
    }
    return next(url, context);
  },
});
let TaskOverview, TaskLearningSummary, taskLearningCounts, ApiError, TaskList, taskDurationText;
try {
 ({TaskList} = await import('../src/TasksPage.tsx'));
 ({TaskOverview} = await import('../src/components/TaskOverview.tsx'));
 ({TaskLearningSummary} = await import('../src/components/TaskLearningSummary.tsx'));
 ({taskLearningCounts} = await import('../src/task-learning-counts.ts'));
 ({taskDurationText} = await import('../src/task-duration.ts'));
 ({ApiError} = await import('../src/api.ts'));
} finally { hooks.deregister(); }
const source = {taskId:'task-1',reviewId:'r1',eventId:'e1'};
const change = {id:'review-specific',entryId:'stable-memory',kind:'memory',status:'applied',taskId:'task-1',reviewId:'r1',source};
const ready = {status:'ready',reviews:[],changesComplete:{memory:true,skill:true},changes:[change]};
test('counts deduplicate entries across reviews and versions, including updates, excluding candidates and foreign tasks',()=>{
 const data={...ready,changes:[change,{...change,id:'new-id',reviewId:'r2',version:2,source:{...source,reviewId:'r2'}},{...change,kind:'skill',entryId:'skill',action:'current-version'}, {...change,entryId:'candidate',status:'candidate'}, {...change,entryId:'foreign',taskId:'other'}, {...change,entryId:'foreign-source',source:{...source,taskId:'other'}}]};
 assert.deepEqual(taskLearningCounts('task-1',data),{memory:1,skill:1});
 assert.deepEqual(taskLearningCounts('task-1',{...ready,changes:[]}),{memory:0,skill:0});
 for(const data of [null,{...ready,changesComplete:undefined},{...ready,status:'unavailable'},{...ready,changes:null}])assert.deepEqual(taskLearningCounts('task-1',data),{memory:null,skill:null});
 assert.deepEqual(taskLearningCounts('task-1',{...ready,changesComplete:{memory:true,skill:false}}),{memory:1,skill:null});
 assert.equal(taskLearningCounts('task-1',{...ready,changes:[{...change,entryId:undefined}]}).memory,null);
});
test('summary shows stale known counts, but clears revoked values and keeps unknown distinct from zero',()=>{
 const render=(data,overrides={})=>{resource={...resource,data,error:null,loading:false,...overrides};return renderToStaticMarkup(createElement(TaskLearningSummary,{taskId:'task-1'}));};
 assert.match(render(ready),/记忆<\/dt><dd>1/);
 const values=(data)=>[...render(data).matchAll(/<dd>([^<]*)<\/dd>/g)].map(match=>match[1]);
 assert.deepEqual(values(null),['—','—'],'missing is not a recorded zero');
 assert.deepEqual(values({...ready,changesComplete:{memory:false,skill:false}}),['—','—'],'incomplete is not zero');
 assert.deepEqual(values({...ready,changes:[]}),['0','0'],'complete empty evidence is genuinely zero');
 assert.deepEqual(values(ready),['1','0'],'known value and known zero remain exact');
 assert.deepEqual(values({...ready,changesComplete:{memory:true,skill:false}}),['1','—'],'partial evidence retains known number');

 assert.match(render({...ready,changes:[]}),/记忆<\/dt><dd>0/);
 assert.match(render(null),/记忆<\/dt><dd>—<\/dd>/);
 assert.match(render({...ready,changesComplete:{memory:false,skill:false}}),/技能<\/dt><dd>—<\/dd>/);
 assert.match(render(null,{loading:true}),/—/);
 assert.doesNotMatch(render(ready),/本任务已应用成果|成果证据不完整|总数|<p/);
 const stale=render(ready,{error:new ApiError(503,'REQUEST_FAILED')});assert.match(stale,/上次获取的数据/);assert.match(stale,/记忆<\/dt><dd>1/);
 const denied=render(ready,{error:new ApiError(403,'RESOURCE_FORBIDDEN')});assert.doesNotMatch(denied,/<dd>1/);assert.match(denied,/—/);
});

test('task list displays both duration columns and unknown history without fabricated zero', () => {
 resource = {...resource, data: {items: [{taskId: 't', title: '任务', state: 'waiting', durations: {observedAt: '2026-01-01T00:00:10Z', total: {milliseconds: 65000, activeSince: null}, execution: {milliseconds: null, activeSince: null}}}], total: 1, offset: 0, nextOffset: null}};
 const html = renderToStaticMarkup(createElement(TaskList, {route: new URL('http://local/tasks')}));
 assert.match(html, /总时长/); assert.match(html, /执行时长/); assert.match(html, /1 分 5 秒/); assert.match(html, /class="task-duration">—</);
});
test('duration formatting uses server clock plus monotonic elapsed and handles boundaries', () => {
 const fixed = milliseconds => taskDurationText({milliseconds, activeSince: null}, undefined, 9000);
 assert.equal(fixed(0), '0 毫秒'); assert.equal(fixed(999), '999 毫秒'); assert.equal(fixed(1000), '1 秒'); assert.equal(fixed(1999), '1 秒'); assert.equal(fixed(3600000), '1 小时 0 分'); assert.equal(fixed(86400000), '1 天 0 小时');
 assert.equal(taskDurationText({milliseconds: 2000, activeSince: '2026-01-01T00:00:00Z'}, '2026-01-01T00:00:10Z', 3000), '15 秒');
 assert.equal(taskDurationText({milliseconds: null, activeSince: null}, undefined, 0), '—');
});

 test('task overview shows authoritative durations without blockers', () => {
  const base = {taskId: 'task-1', state: 'waiting', title: '核对发布结果', objective: '核验实际服务状态', createdAt: '2026-11-14T00:00:00Z', updatedAt: '2026-11-14T01:00:00Z'};
  const empty = renderToStaticMarkup(createElement(TaskOverview, {task: base}));
  assert.match(empty, /总时长/); assert.match(empty, /执行时长/);
  assert.equal((empty.match(/<dd>—<\/dd>/g) || []).length, 2);
  assert.doesNotMatch(empty, /task-blocker-card|暂无已记录的阻断项|最后结论|刷新/);
  const html = renderToStaticMarkup(createElement(TaskOverview, {task: {...base, durations: {total: {milliseconds: 3600000, activeSince: null}, execution: {milliseconds: 120000, activeSince: null}, observedAt: base.updatedAt}, blockers: [{kind: 'execution', id: 'b1', title: '等待服务恢复', status: 'waiting'}]}}));
  assert.match(html, /1 小时 0 分/); assert.match(html, /2 分 0 秒/);
  assert.doesNotMatch(html, /等待服务恢复|task-blocker-card/); assert.match(html, /核验实际服务状态/);
});
