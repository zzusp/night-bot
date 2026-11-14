import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
const input = readFileSync(new URL('../src/task-conclusion.ts', import.meta.url), 'utf8');
const js = ts.transpileModule(input, {compilerOptions: {module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022}}).outputText;
const {taskConclusion} = await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`);
const task = {state: 'waiting', session: {status: 'idle'}, result: {summary: '已完成核对，等待发布窗口。', question: '是否继续？', evidence: ['测试已通过'], limitations: ['尚未部署']}};
test('only explicit stopped Host result is rendered, retaining limitations and question', () => {
 assert.equal(taskConclusion(task), '已完成核对，等待发布窗口。\n\n是否继续？\n\n**依据**\n\n- 测试已通过\n\n**限制**\n\n- 尚未部署');
 assert.equal(taskConclusion({...task, state: 'completed'}), taskConclusion(task));
});
test('running, unknown, missing, or reasoning/tool content cannot become conclusion', () => {
 for (const state of ['running', 'queued', 'unknown']) assert.equal(taskConclusion({...task, state}), null);
 assert.equal(taskConclusion({...task, session: {status: 'running'}}), null);
 assert.equal(taskConclusion({...task, session: undefined}), null);
 for(const result of [undefined, {}, {text:'tool raw'}, {thinking:'reason'}, {summary:' '}]) assert.equal(taskConclusion({...task, result}), null);
});
test('plain legacy result and duplicate question retain truthful content', () => {
 assert.equal(taskConclusion({...task, result:'   已完成   '}), '已完成');
 assert.equal(taskConclusion({...task, result:{summary:'等待', question:'等待'}}), '等待');
});
