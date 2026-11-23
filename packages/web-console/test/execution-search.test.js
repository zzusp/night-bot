import test from 'node:test';
import assert from 'node:assert/strict';
import {searchExecutionRecords} from '../src/execution-search.ts';
const message = (id, text, extras={}) => ({id, text, role:'assistant', ...extras});
test('search finds loaded public bodies case-insensitively, including tools and thinking', () => {
 const rows=[message('a','Status OK'),message('b','核对日志',{role:'tool',toolName:'read'}),message('c','分析进展',{kind:'thinking'})];
 assert.deepEqual(searchExecutionRecords(rows,'status').map(x=>x.id),['a']);
 assert.deepEqual(searchExecutionRecords(rows,' READ ').map(x=>x.id),['b']);
 assert.deepEqual(searchExecutionRecords(rows,'思考').map(x=>x.id),['c']);
 assert.deepEqual(searchExecutionRecords(rows,'日志').map(x=>x.id),['b']);
});
test('search does not index private provenance, transport identifiers, attachments or live/unloaded content', () => {
 const rows=[message('private-id','safe',{source:{sessionId:'private-source'},requestId:'private-request',attachments:[{name:'private-file'}]}),message('live','private-live',{transient:true})];
 assert.deepEqual(searchExecutionRecords(rows,'private'),[]);
 assert.deepEqual(searchExecutionRecords(rows,'not fetched body page'),[]);
 assert.equal(searchExecutionRecords(rows,'safe')[0].excerpt,'safe');
});
test('search uses literal text rather than a regular expression and returns bounded plain excerpts', () => {
 assert.equal(searchExecutionRecords([message('a','x'.repeat(300)+'[.*]'+ 'y'.repeat(300))],'[.*]')[0].excerpt.length,142);
 assert.deepEqual(searchExecutionRecords([message('a','ordinary')],'[.*]'),[]);
 assert.equal(searchExecutionRecords([message('a','<script>payload</script>')],'payload')[0].excerpt,'<script>payload</script>');
});
test('empty/no-match/replaced snapshots clear results without retaining message objects', () => {
 const rows=[message('a','matching')];
 assert.deepEqual(searchExecutionRecords(rows,'  '),[]); assert.deepEqual(searchExecutionRecords(rows,'miss'),[]);
 assert.deepEqual(searchExecutionRecords([],'matching'),[]);
 assert.deepEqual(Object.keys(searchExecutionRecords(rows,'matching')[0]).sort(),['excerpt','id','label']);
});
