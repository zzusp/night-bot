import test from 'node:test';
import assert from 'node:assert/strict';
import { executionItems, transcriptItems, toolState } from '../src/execution-items.ts';

const call = (id, status = 'pending', sessionId = 'session') => ({ id, role: 'tool', kind: 'tool-call', callId: id, toolName: 'shell', text: 'safe projected input', status, source: { sessionId, entryId: id } });
const result = (id, status = 'completed', sessionId = 'session') => ({ ...call(id, status, sessionId), id: `${id}-result`, kind: 'tool-result', text: 'safe projected output' });
const done = id => [call(id), result(id)];

test('consecutive calls/scripts form one group in received order; input objects are unchanged', () => {
  const messages = [...done('a'), ...done('b'), ...done('c')];
  const before = structuredClone(messages);
  const items = executionItems(messages);
  assert.equal(items.length, 1);
  assert.equal(items[0].kind, 'tool-group');
  assert.deepEqual(items[0].tools.map(item => item.id), ['a', 'b', 'c']);
  assert.equal(items[0].tools[1].results[0], messages[3]);
  assert.deepEqual(messages, before);
});

test('user and assistant messages are hard boundaries and singleton tools remain standalone', () => {
  const items = executionItems([...done('a'), { id: 'user', role: 'user', text: 'continue' }, ...done('b'), ...done('c'), { id: 'assistant', role: 'assistant', text: 'update' }, ...done('d')]);
  assert.deepEqual(items.map(item => item.kind), ['tool', 'message', 'tool-group', 'message', 'tool']);
  const split = transcriptItems([call('a'), { id: 'note', role: 'assistant', text: 'update' }, result('a')]);
  assert.deepEqual(split.map(item => item.kind), ['tool', 'message', 'tool']);
  assert.deepEqual(split[0].results, []);
  assert.equal(split[2].results[0].id, 'a-result');
});

test('all pending, running, queued and unknown tools remain separate even between completed groups', () => {
  for (const state of ['pending', 'running', 'queued', 'unknown', 'waiting']) {
    const items = executionItems([...done('a'), ...done('b'), call('current', state), result('current', state), ...done('c'), ...done('d')]);
    assert.deepEqual(items.map(item => item.kind), ['tool-group', 'tool', 'tool-group']);
    assert.equal(items[1].id, 'current');
  }
  assert.deepEqual(executionItems([call('a', 'completed'), call('b', 'running')]).map(item => item.kind), ['tool', 'tool']);
});

test('poll completion merges into stable first-call group; next running call stays outside', () => {
  const initial = [...done('a'), ...done('b'), call('current', 'running')];
  const first = executionItems(initial);
  const updated = executionItems([...initial, result('current'), call('next', 'running')]);
  assert.equal(updated[0].id, first[0].id);
  assert.deepEqual(updated[0].tools.map(item => item.id), ['a', 'b', 'current']);
  assert.equal(updated[1].id, 'next');
});

test('session identity and tool names cannot pair mismatched results; failures remain represented', () => {
  const items = executionItems([...done('a'), call('b', 'pending', 'other'), result('b', 'failed', 'other')]);
  assert.deepEqual(items.map(item => item.kind), ['tool', 'tool']);
  const unmatched = transcriptItems([call('a'), { ...result('a'), toolName: 'read' }]);
  assert.equal(unmatched.length, 2);
  assert.equal(unmatched[0].results.length, 0);
  const group = executionItems([...done('a'), call('b'), { ...result('b'), isError: true }]);
  assert.equal(group[0].tools[1].results[0].isError, true);
});


test('job_output participates in the normal consecutive group without duplicating results', () => {
  const job = [call('job'), result('job')].map(row => ({ ...row, toolName: 'job_output' }));
  const messages = [...done('a'), ...job, ...done('b')];
  const items = executionItems(messages);
  assert.equal(items.length, 1);
  assert.deepEqual(items[0].tools.map(row => row.id), ['a', 'job', 'b']);
  assert.equal(items[0].tools[1].results.length, 1);
  assert.deepEqual(executionItems(messages), items);
});

test('unfinished job_output remains separate and joins the stable group only once settled', () => {
  const job = { ...call('job'), toolName: 'job_output' };
  const initial = [...done('a'), ...done('b'), job];
  assert.deepEqual(executionItems(initial).map(row => row.kind), ['tool-group', 'tool']);
  const streaming = { ...result('job', 'running'), toolName: 'job_output' };
  assert.deepEqual(executionItems([...initial, streaming]).map(row => row.kind), ['tool-group', 'tool']);
  const final = { ...streaming, status: 'completed', text: 'finished output' };
  const updated = executionItems([...initial, final]);
  assert.equal(updated[0].id, executionItems(initial)[0].id);
  assert.deepEqual(updated[0].tools.map(row => row.id), ['a', 'b', 'job']);
  assert.deepEqual(updated[0].tools[2].results, [final]);
});

test('job_output keeps conversation boundaries, exact call/name/session identity and result order', () => {
  const input = { ...call('job'), toolName: 'job_output' };
  const output = { ...result('job', 'error'), toolName: 'job_output' };
  const rows = transcriptItems([input, { id: 'update', role: 'assistant', text: 'update' }, output]);
  assert.deepEqual(rows.map(row => row.kind), ['tool', 'message', 'tool']);
  assert.equal(toolState(rows[0]), 'error');
  assert.equal(rows[2].results[0], output);
  for (const mismatch of [{ ...output, toolName: 'read' }, { ...output, source: { sessionId: 'other', entryId: 'result' } }, { ...output, callId: 'other' }]) {
    const unpaired = transcriptItems([input, mismatch]);
    assert.equal(unpaired[0].results.length, 0);
    assert.equal(unpaired[0].resultStatus, undefined);
    assert.equal(unpaired[1].results[0], mismatch);
  }
});

test('interleaved job_output follows the same pairing rules as ordinary tools', () => {
  const job = [call('job'), result('job')].map(row => ({ ...row, toolName: 'job_output' }));
  const rows = executionItems([call('a'), ...job, result('a'), ...done('b')]);
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0].tools.map(row => row.id), ['a', 'job', 'b']);
  assert.deepEqual(rows[0].tools.map(row => row.results.map(result => result.id)), [['a-result'], ['job-result'], ['b-result']]);
});

test('an orphan job_output result retains its position and joins ordinary settled records', () => {
  const output = { ...result('missing'), toolName: 'job_output' };
  const rows = executionItems([...done('a'), output, ...done('b')])[0].tools;
  assert.deepEqual(rows.map(row => row.id), ['a', 'missing-result', 'b']);
  assert.equal(rows[1].call, undefined);
  assert.equal(rows[1].results[0], output);
});

test('later conversation-separated receipt supplies current status without duplicating output', () => {
  const later = { ...result('a', 'failed'), id: 'a-later', text: 'later failure' };
  const items = transcriptItems([call('a'), result('a', 'pending'), { id: 'update', role: 'assistant', text: 'update' }, later]);
  assert.equal(toolState(items[0]), 'failed');
  assert.equal(items[0].results.length, 1);
  assert.equal(items.at(-1).results[0], later);
});
