import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import ts from 'typescript';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';

const source = await readFile(new URL('../src/components/AgentProgress.tsx', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, {compilerOptions: {jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext}}).outputText
  .replaceAll('"react/jsx-runtime"', JSON.stringify(import.meta.resolve('react/jsx-runtime')))
  .replaceAll("'@remixicon/react'", JSON.stringify(import.meta.resolve('@remixicon/react')));
const {AgentProgress} = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);
const render = items => renderToStaticMarkup(createElement(AgentProgress, {items}));
test('agent progress derives remaining count and current step only from committed states', () => {
  const html = render([{text:'已读资料',status:'completed'},{text:'核对来源',status:'in_progress'},{text:'整理报告',status:'pending'}]);
  assert.match(html,/还剩 2 步/); assert.match(html,/aria-current="step"/);
  assert.match(html,/agent-progress-current.*核对来源/);
  assert.match(html,/已完成：/); assert.match(html,/进行中：/); assert.match(html,/待处理：/);
  assert.doesNotMatch(html,/更新于|<time/);
});
test('all completed is distinct from empty and pending has no invented active step', () => {
  assert.match(render([{text:'完成',status:'completed'}]),/步骤已完成/);
  assert.match(render([]),/暂无待办/);
  const pending=render([{text:'尚未开始',status:'pending'}]);
  assert.match(pending,/还剩 1 步/); assert.doesNotMatch(pending,/agent-progress-current|is-active|aria-current/);
});
test('step contents are escaped and redaction stays visible', () => {
  const html=render([{text:'<script>secret()</script>',status:'pending',redacted:true}]);
  assert.doesNotMatch(html,/<script>/); assert.match(html,/&lt;script&gt;/); assert.match(html,/敏感信息已隐藏/);
});
test('progress has a native keyboard disclosure and never simulates progress with timers', () => {
  assert.match(render([]),/<details[^>]*open=""/); assert.match(render([]),/<summary/);
  assert.doesNotMatch(source,/setTimeout|setInterval|stepDuration|onFinished/);
});
