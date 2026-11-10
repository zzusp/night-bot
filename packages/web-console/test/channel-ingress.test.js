import test from 'node:test';
import assert from 'node:assert/strict';
import { channelPath } from '../src/channel-url.ts';
import { ingressAction, ingressTargetPaused, ingressUnavailable, ingressStateText, validChannelIngress } from '../src/channel-ingress.ts';

const item = (patch = {}) => ({ channelId: 'fixture', type: 'plugin', enabled: true, savedVersion: 'a'.repeat(64),
  ingress: { supported: true, available: true, backfill: 'history', requestedPaused: false, state: 'receiving', errorCode: null, ...patch } });
test('ingress URLs preserve dot-only and reserved/unicode IDs', () => {
  assert.equal(channelPath('.', 'ingress'), '/channels/ingress?channelId=.');
  assert.equal(channelPath('..', 'ingress'), '/channels/ingress?channelId=..');
  assert.equal(channelPath('群/接收?x#y', 'ingress'), '/channels/' + encodeURIComponent('群/接收?x#y') + '/ingress');
  assert.equal(channelPath('.', true), '/channels/dingtalk?channelId=.');
  assert.equal(channelPath('normal'), '/channels/normal');
});
test('undeclared or unavailable ingress is blocked independently of enabled and outbound authorization', () => {
  assert.ok(ingressUnavailable({ ...item(), ingress: undefined }));
  assert.ok(ingressUnavailable(item({ supported: false })));
  assert.ok(ingressUnavailable(item({ available: false })));
  assert.equal(ingressUnavailable(item({ available: true, state: 'unavailable', errorCode: 'DINGTALK_AUTH_REQUIRED' })), '');
  assert.ok(ingressUnavailable(item({ available: false, state: 'unavailable', errorCode: 'DINGTALK_AUTH_REQUIRED' })));
  assert.ok(ingressUnavailable(item({ backfill: null })));
  assert.ok(ingressUnavailable({ ...item(), savedVersion: 'invalid' }));
  assert.equal(ingressUnavailable({ ...item(), enabled: false, writesAuthorized: false }), '');
});
test('pause, resume and retry use the declared intent without claiming history completion', () => {
  assert.equal(ingressAction(item()), '暂停接收'); assert.equal(ingressTargetPaused(item()), true);
  assert.equal(ingressAction(item({ requestedPaused: true, state: 'paused' })), '恢复接收');
  assert.equal(ingressTargetPaused(item({ requestedPaused: true, state: 'paused' })), false);
  for (const paused of [true, false]) {
    const error = item({ requestedPaused: paused, state: 'error' });
    assert.equal(ingressAction(error), paused ? '重试暂停接收' : '重试恢复接收');
    assert.equal(ingressTargetPaused(error), paused);
  }
  assert.match(ingressStateText(item({ state: 'pausing' })), /正在暂停.*尚未完成/);
  assert.match(ingressStateText(item({ state: 'recovering' })), /正在补拉.*尚未完成/);
  assert.match(ingressStateText(item({ backfill: 'none' })), /无法补拉/);
  assert.equal(validChannelIngress({ ...item().ingress, errorCode: undefined }), false);
  assert.match(ingressStateText(item({ state: 'error', errorCode: 'DINGTALK_AUTH_REQUIRED' })), /先完成渠道认证/);
  assert.match(ingressStateText(item({ state: 'unavailable', requestedPaused: true, errorCode: 'DINGTALK_AUTH_REQUIRED' })), /等待认证.*暂停意图已保存.*尚未确认/);
  assert.match(ingressStateText(item({ state: 'error', errorCode: 'DINGTALK_HISTORY_RECOVERY_FAILED' })), /原接收进度保留/);
  assert.doesNotMatch(ingressStateText(item({ state: 'error', errorCode: 'PRIVATE_ACCOUNT_SECRET' })), /PRIVATE_ACCOUNT_SECRET/);
});
