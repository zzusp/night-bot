import test from 'node:test';
import assert from 'node:assert/strict';
import {messageProcessDuration} from '../src/message-process-duration.ts';

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
