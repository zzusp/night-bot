import test from 'node:test';
import assert from 'node:assert/strict';
import {messageProcessDuration,messageProcessMetric} from '../src/message-process-duration.ts';

test('sub-second receipts use milliseconds, including zero and the value just below one second', () => {
  for (const [value, expected] of [[0, '0 毫秒'], [1, '1 毫秒'], [700, '700 毫秒'], [999, '999 毫秒']]) {
    assert.equal(messageProcessDuration(value), expected);
  }
});
test('one second and above use whole seconds with half-up rounding', () => {
  for (const [value, expected] of [[1000, '1 秒'], [1001, '1 秒'], [1250, '1 秒'], [1499, '1 秒'], [1500, '2 秒'], [1999, '2 秒'], [2000, '2 秒'], [2500, '3 秒'], [12000, '12 秒']]) {
    assert.equal(messageProcessDuration(value), expected);
  }
});
test('invalid receipt values never become a fabricated duration', () => {
  for (const value of [-1, NaN, Infinity, -Infinity]) assert.equal(messageProcessDuration(value), '—');
});

const receivedAt = '2026-01-01T00:00:00.000Z';
const at = ms => new Date(Date.parse(receivedAt) + ms).toISOString();
test('milestones compute elapsed time from the same source receipt, not neighboring nodes', () => {
  assert.equal(messageProcessMetric({kind:'received',timingType:'milestone',at:receivedAt}, receivedAt), '接收后 0 毫秒');
  assert.equal(messageProcessMetric({kind:'stage-router-started',timingType:'milestone',at:at(25579)}, receivedAt), '接收后 26 秒');
  assert.equal(messageProcessMetric({kind:'reply-visible',timingType:'milestone',at:at(28871)}, receivedAt), '接收后 29 秒');
  assert.equal(messageProcessMetric({kind:'reply-prepared',at:at(900)}, receivedAt), '接收后 900 毫秒');
});
test('measured stage durations stay distinct from elapsed milestone time', () => {
  assert.equal(messageProcessMetric({kind:'stage-router-completed',timingType:'span',at:at(29000),durationMs:3000}, receivedAt), '耗时 3 秒');
  assert.equal(messageProcessMetric({kind:'stage-send-completed',at:at(29000),durationMs:0}, receivedAt), '耗时 0 毫秒');
  for (const durationMs of [undefined,-1,NaN,Infinity]) {
    assert.equal(messageProcessMetric({kind:'stage-router-completed',at:at(29000),durationMs}, receivedAt), durationMs === undefined ? '耗时未记录' : '耗时异常');
    assert.equal(messageProcessMetric({timingType:'span',at:at(29000),durationMs}, receivedAt), durationMs === undefined ? '耗时未记录' : '耗时异常');
  }
});
test('missing or invalid clocks and reversed milestones never fabricate elapsed time', () => {
  for (const start of [null,'invalid']) assert.equal(messageProcessMetric({timingType:'milestone',at:at(900)}, start), '接收时间缺失');
  assert.equal(messageProcessMetric({timingType:'milestone',at:'invalid'}, receivedAt), '节点时间缺失');
  assert.equal(messageProcessMetric({timingType:'milestone',at:at(-1)}, receivedAt), '时间异常');
});
