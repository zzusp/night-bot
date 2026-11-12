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
let TaskExecutionDetails, LearningChanges, ApiError, TaskList, taskDurationText;
try {
  ({TaskList} = await import('../src/TasksPage.tsx'));
  ({taskDurationText} = await import('../src/task-duration.ts'));
  ({TaskExecutionDetails} = await import('../src/components/TaskExecutionDetails.tsx'));
  ({LearningChanges} = await import('../src/components/LearningChanges.tsx'));
  ({ApiError} = await import('../src/api.ts'));
} finally { hooks.deregister(); }
const source = {taskId: 'task-1', reviewId: 'review-1', eventId: 'event-1'};
const change = {...source, id: 'change-1', kind: 'memory', name: '保留任务来源', scope: 'bot', status: 'applied', action: 'upsert', version: 3, canRead: true, source};
const renderLearning = (data, section = 'changes', overrides = {}) => {
  resource = {...resource, data, loading: false, error: null, ...overrides};
  return renderToStaticMarkup(createElement(LearningChanges, {taskId: 'task-1', section}));
};

test('execution rail uses compact ordered facts and collapsed deliveries without losing full content', () => {
  const text = '交付结论。' + '保留全部证据。'.repeat(100) + '\n\n[原始材料](https://example.com/evidence)';
  const html = renderToStaticMarkup(createElement(TaskExecutionDetails, {task: {taskId: 'task-1', state: 'completed', timeline: {task: {events: [{kind: 'completed', at: '2026-11-10T03:00:00Z'}, {kind: 'created', at: '2026-11-10T01:00:00Z'}]}}, notifications: [{id: 'n-1', state: 'unknown', text, createdAt: '2026-11-10T03:00:00Z'}]}}));
  assert.ok(html.indexOf('任务已创建') < html.indexOf('任务已完成'));
  assert.match(html, /<details class="task-delivery">/);
  assert.doesNotMatch(html, /<details[^>]*\bopen|<button|获取最新|刷新|当前执行上下文/);
  assert.match(html, /待核实/);
  assert.match(html, /<time dateTime="2026-11-10T03:00:00Z">/);
  const preview = html.match(/class="task-delivery-preview">([^<]*)/)[1];
  assert.ok(preview.length <= 81);
  assert.ok(html.includes('保留全部证据。'.repeat(100)));
  assert.match(html, /href="https:\/\/example.com\/evidence" target="_blank" rel="noopener noreferrer"/);
});

test('execution missing fields are not fabricated zeroes or successful deliveries', () => {
  const html = renderToStaticMarkup(createElement(TaskExecutionDetails, {task: {taskId: 'task-1', state: 'waiting'}}));
  assert.equal((html.match(/task-section-count">未记录/g) || []).length, 2);
  assert.match(html, /暂无执行动态/); assert.match(html, /暂无交付记录/);
  assert.doesNotMatch(html, /已送达|>0</);
});

test('review shows outcome, timestamp, real conclusion and collapsed provenance only', () => {
  const html = renderLearning({status: 'ready', reviews: [{...source, status: 'done', at: '2026-11-10T03:00:00Z', summary: '真实复盘结论。'}, {...source, reviewId: 'failed', status: 'failed', summary: '', at: ''}], changes: [change]}, 'reviews');
  assert.match(html, /复盘完成/); assert.match(html, /复盘失败/); assert.match(html, /真实复盘结论/); assert.match(html, /未记录复盘结论/);
  assert.match(html, /<summary>复盘来源<\/summary>/); assert.match(html, /<code>event-1<\/code>/);
  assert.doesNotMatch(html, /<button|learning-change|刷新复盘记录|learning-heading/);
});

test('learning keeps actual applied state and explicit authorized name action, no disabled filler button', () => {
  const html = renderLearning({status: 'ready', reviews: [], changes: [change, {...change, id: 'candidate', status: 'candidate', canRead: false}, {...change, id: 'unused', status: 'not-applied', canRead: false}]});
  assert.match(html, /已应用/); assert.match(html, /候选，未应用/); assert.match(html, /未应用/);
  assert.equal((html.match(/<button/g) || []).length, 1);
  assert.match(html, /aria-label="读取授权正文：保留任务来源" aria-expanded="false"/);
  assert.match(html, /正文未授权/); assert.match(html, /来源与版本/); assert.match(html, /版本 3/);
  assert.doesNotMatch(html, /刷新|learning-body|disabled/);
});

test('empty, unavailable, loading, stale and revoked learning snapshots remain distinct', () => {
  const ready = {status: 'ready', reviews: [], changes: [change]};
  assert.match(renderLearning({...ready, changes: []}), /暂无学习变更/);
  assert.match(renderLearning({status: 'unavailable', reviews: null, changes: null}), /复盘与学习记录暂不可读/);
  assert.match(renderLearning(null, 'changes', {loading: true}), /正在读取学习记录/);
  const stale = renderLearning(ready, 'changes', {error: new ApiError(503, 'REQUEST_FAILED')});
  assert.match(stale, /上次获取的数据/); assert.match(stale, /保留任务来源/); assert.match(stale, /重新获取/);
  const denied = renderLearning(ready, 'changes', {error: new ApiError(403, 'RESOURCE_FORBIDDEN')});
  assert.doesNotMatch(denied, /保留任务来源|已应用|暂无学习变更/); assert.match(denied, /记录暂不可读/);
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
