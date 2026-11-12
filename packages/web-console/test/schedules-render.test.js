import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, existsSync} from 'node:fs';
import {registerHooks} from 'node:module';
import {fileURLToPath} from 'node:url';
import ts from 'typescript';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';

let resource, requestedPath;
globalThis.__scheduleResource = path => {requestedPath = path; return resource;};
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
      if (url.endsWith('/src/hooks.ts')) input = input.replace('export function useResource<T>', 'function originalUseResource<T>') + '\nexport const useResource = path => globalThis.__scheduleResource(path);';
      const source = ts.transpileModule(input, {fileName: fileURLToPath(url), compilerOptions: {module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022}}).outputText;
      return {format: 'module', source, shortCircuit: true};
    }
    return next(url, context);
  },
});
let SchedulesPage, ApiError, dateTime;
try {
  ({default: SchedulesPage} = await import('../src/SchedulesPage.tsx'));
  ({ApiError} = await import('../src/api.ts'));
  ({dateTime} = await import('../src/hooks.ts'));
} finally {hooks.deregister();}
const record = {id: 'schedule-test', title: '核对定时任务', state: 'active', kind: 'every', scheduledAt: '2032-11-12T08:00:00.000Z', scheduleSummary: '每10分钟'};
const snapshot = items => ({items, total: items.length, offset: 0, limit: 20, nextOffset: null});
const render = (data, overrides = {}, query = '') => {
  resource = {data, loading: false, error: null, updatedAt: 1, refresh() {}, ...overrides};
  return renderToStaticMarkup(createElement(SchedulesPage, {route: new URL('http://localhost/schedules' + query)}));
};

test('scheduled task page renders compact native-state rows and only read controls', () => {
  const html = render(snapshot([record]));
  assert.match(html, /aria-label="定时任务状态"/);
  assert.match(html, /state=active" aria-current="page">启用/);
  assert.match(html, /state=inactive">停用/);
  assert.doesNotMatch(html, /已暂停|运行中|已结束|删除|编辑|恢复/);
  assert.match(html, /<li class="schedule-row">/);
  assert.match(html, /schedule-title">核对定时任务/);
  assert.match(html, /每10分钟/);
  const row = html.match(/<li class="schedule-row">([\s\S]*?)<\/li>/)[1];
  assert.doesNotMatch(row, /<a|<button/);
  assert.equal(requestedPath, '/schedules?state=active&offset=0&limit=20');
});

test('state and offset restore from URL without accepting obsolete or unsafe values', () => {
  render(snapshot([{...record, state: 'inactive'}]), {}, '?state=inactive&offset=20');
  assert.equal(requestedPath, '/schedules?state=inactive&offset=20&limit=20');
  for (const query of ['?state=paused&offset=-2', '?state=running&offset=Infinity', '?offset=9007199254740992']) {
    render(snapshot([]), {}, query);
    assert.equal(requestedPath, '/schedules?state=active&offset=0&limit=20');
  }
});

test('loading, empty, unavailable, stale and forbidden snapshots stay distinct', () => {
  assert.match(render(null, {loading: true}), /正在读取定时任务/);
  assert.doesNotMatch(render(null, {loading: true}), /暂无启用/);
  assert.match(render(snapshot([])), /暂无启用的定时任务/);
  assert.match(render(snapshot([]), {}, '?state=inactive'), /暂无停用的定时任务/);
  const error = new ApiError(503, 'SCHEDULES_UNAVAILABLE');
  assert.match(render(null, {error}), /定时任务暂不可读/);
  const stale = render(snapshot([record]), {error});
  assert.match(stale, /上次获取的数据/); assert.match(stale, /核对定时任务/);
  for (const status of [401, 403, 404]) {
    const denied = render(snapshot([record]), {error: new ApiError(status, 'RESOURCE_FORBIDDEN')});
    assert.doesNotMatch(denied, /schedule-title|上次获取的数据/);
    assert.match(denied, /定时任务暂不可读/);
  }
});

test('one-time schedules retain full year and local timezone with valid semantic time', () => {
  const html = render(snapshot([{...record, kind: 'at', scheduleSummary: '单次'}]));
  assert.match(html, /<time dateTime="2032-11-12T08:00:00.000Z">/);
  assert.match(html, /2032/);
  assert.ok(html.includes(dateTime(record.scheduledAt, false, true)));
  assert.notEqual(dateTime('2032-11-12T08:00:00.000Z', false, true), dateTime('2033-11-12T08:00:00.000Z', false, true));
  assert.equal(dateTime('invalid', false, true), '未记录');
  assert.doesNotMatch(dateTime(record.scheduledAt), /2032/);
});

test('every schedule result state stays inside the shared task-list surface', () => {
  const cases = [
    [snapshot([record]), {}, 'schedule-list'],
    [snapshot([]), {}, '暂无启用的定时任务'],
    [null, {loading: true}, '正在读取定时任务'],
    [null, {error: new ApiError(503, 'SCHEDULES_UNAVAILABLE')}, '定时任务暂不可读'],
    [snapshot([record]), {error: new ApiError(503, 'SCHEDULES_READ_FAILED')}, 'schedule-list'],
    [snapshot([record]), {error: new ApiError(403, 'RESOURCE_FORBIDDEN')}, '定时任务暂不可读'],
  ];
  for (const [data, overrides, content] of cases) {
    const html = render(data, overrides);
    const frame = html.match(/<section class="task-table-wrap schedule-results"[^>]*>([\s\S]*?)<\/section>/)?.[1];
    assert.ok(frame?.includes(content), `${content} must be inside the shared bordered surface`);
    assert.doesNotMatch(frame, /list-toolbar|pagination/);
  }
});

test('schedule rows retain readable spacing and separators in the shipped stylesheet', () => {
  const css = readFileSync(new URL('../src/styles/schedules.css', import.meta.url), 'utf8');
  assert.match(css, /\.schedule-row\s*\{[^}]*gap:\s*6px;[^}]*padding:\s*16px 18px;/);
  assert.match(css, /\.schedule-row \+ \.schedule-row\s*\{[^}]*border-top:\s*1px solid var\(--board-border\)/);
  assert.match(css, /@media\s*\(max-width:\s*520px\)[\s\S]*padding-inline:\s*14px/);
});
