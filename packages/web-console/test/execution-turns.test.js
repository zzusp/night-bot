import assert from 'node:assert/strict';
import {test} from 'node:test';
import {executionTurns} from '../src/execution-turns.ts';

const row = (id, role, kind, extra = {}) => ({id,role,kind,text:id,...extra});
const call = id => row(id,'tool','tool-call',{toolName:'read',callId:id});
const result = id => row(`${id}-result`,'tool','tool-result',{toolName:'read',callId:id,status:'completed'});

test('conclusions stay outside round folds and split subsequent tool history', () => {
  const rows = executionTurns([
    row('input','user','instruction',{createdAt:'2026-11-23T00:00:00.000Z',source:{sessionId:'s'}}), call('one'), result('one'),
    row('report-one','assistant','task-result',{createdAt:'2026-11-23T00:00:00.010Z',source:{sessionId:'s'},timing:{turnDurationMs:4}}),
    call('two'), result('two'), row('report-two','assistant','task-result'),
    call('three'),
  ]);
  assert.deepEqual(rows.map(item => item.kind === 'turn' ? [item.id,item.complete,item.toolCount,item.durationMs] : item.row.message.id), [
    'input',['input',true,1,10],'report-one',['report-one',true,1,undefined],'report-two',['report-two',false,1,undefined],
  ]);
});

test('history may begin midway through a turn; do not claim complete tool totals', () => {
  const rows = executionTurns([call('before'),result('before'),row('reply','assistant','router-reply')],true);
  assert.equal(rows[0].kind,'turn');
  assert.equal(rows[0].complete,true);
  assert.equal(rows[0].toolCount,undefined);
});

test('compaction and interruption are independently visible; no normal completion status for interrupted process', () => {
  const rows = executionTurns([row('input','user','source'),row('think','assistant','thinking'),row('cancel','assistant','message',{status:'aborted'}),
    row('compaction','assistant','compaction'),row('second','user','source'), row('answer','assistant','message',{status:'stop'})]);
  assert.equal(rows[1].complete,false);
  assert.deepEqual(rows.filter(item=>item.kind==='standalone').map(item=>item.row.message.id),['input','cancel','compaction','second','answer']);
});

test('unsupported metrics are absent and same-text replies remain distinct', () => {
  const rows = executionTurns([row('input','user','source'),call('plain'),result('plain'),
    row('r1','assistant','router-reply',{text:'same'}), row('r2','assistant','router-reply',{text:'same'})]);
  assert.equal(rows[1].durationMs,undefined);
  assert.deepEqual(rows.slice(-2).map(item=>item.row.message.id),['r1','r2']);
});
