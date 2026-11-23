import test from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {createServer} from 'vite';
import {createTaskInputDrafts} from '../src/task-input-drafts.ts';
import {encodeAttachments, newComposerRequestId} from '../src/compose-attachments.ts';

test('composer encodes ordered file bytes with a canonical base64 payload', async () => {
  const first = new File([new Uint8Array([0, 127, 128, 255])], '截图.png', {type:'image/png'});
  const second = new File(['原始文本\n'], '资料');
  assert.deepEqual(await encodeAttachments([first, second]), [
    {name:first.name, mediaType:'image/png', data:'AH+A/w=='},
    {name:second.name, mediaType:'application/octet-stream', data:Buffer.from('原始文本\n').toString('base64')},
  ]);
  await assert.rejects(encodeAttachments([new File([''], '空文件')]), /非空文件/);
  await assert.rejects(encodeAttachments(Array.from({length:9}, () => second)), /最多添加 8 个/);
});

test('composer can issue a random UUID v4 on HTTP without randomUUID()', () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
  const randomValues = bytes => {bytes.fill(0); return bytes;};
  Object.defineProperty(globalThis, 'crypto', {value:{getRandomValues:randomValues}, configurable:true});
  try {assert.equal(newComposerRequestId(), '00000000-0000-4000-8000-000000000000');}
  finally {Object.defineProperty(globalThis, 'crypto', descriptor);}
});

test('task input drafts retain attachments independently across task switches and operator sessions', () => {
  const drafts = createTaskInputDrafts();
  const file = new File(['task A attachment'],'A.txt');
  drafts.update('task-A', () => ({text:'task A draft',files:[file]}));
  drafts.update('task-B', () => ({text:'task B draft',files:[]}));
  assert.deepEqual(drafts.get('task-A'), {text:'task A draft',files:[file]});
  assert.deepEqual(drafts.get('task-B'), {text:'task B draft',files:[]});
  assert.deepEqual(createTaskInputDrafts().get('task-A'), {text:'',files:[]});
});


test('task input renders safe recovery actions for only the bound execution session', async () => {
  const server = await createServer({root:fileURLToPath(new URL('..', import.meta.url)), server:{middlewareMode:true,hmr:false}, appType:'custom'});
  try {
    const {TaskInputComposer} = await server.ssrLoadModule('/src/components/TaskInputComposer.tsx');
    const drafts = createTaskInputDrafts(), taskId = 'test-task';
    const render = (sessionId, draft = drafts.get(taskId)) => renderToStaticMarkup(createElement(TaskInputComposer,{taskId,sessionId,draft,drafts}));
    assert.equal(render(undefined), '');
    assert.match(render('test-session'), /给当前任务发消息/);
    const file = new File(['资料'],'资料.txt');
    const value = {text:'保留原稿',files:[file]};
    const missing = {...value,error:'待核实',attempt:{...value,requestId:'test-request',sessionId:'test-session',state:'missing'}};
    const matching = render('test-session',missing);
    assert.match(matching,/资料\.txt/);
    assert.match(matching,/保留原稿/);
    assert.match(matching,/核对发送状态/);
    assert.match(matching,/重试这条消息/);
    assert.doesNotMatch(render('different-session',missing),/重试这条消息/);
  } finally {await server.close();}
});
