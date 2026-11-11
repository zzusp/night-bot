import assert from 'node:assert/strict';
import test from 'node:test';
import {fileURLToPath} from 'node:url';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {createServer} from 'vite';

// Render the real controls even in executors where Chromium cannot create IPC sockets.
// These structural checks supplement, not replace, the browser layout/interaction suite.
test('model settings render compact writable/read-only states without empty feedback blocks', async () => {
 const server=await createServer({root:fileURLToPath(new URL('..',import.meta.url)),server:{middlewareMode:true},appType:'custom'});
 try {
  const {SecretEditor}=await server.ssrLoadModule('/src/components/SecretEditor.tsx');
  const {ProviderApiEditor}=await server.ssrLoadModule('/src/components/ProviderApiEditor.tsx');
  const props={kind:'model',provider:'test-route',version:'test-v1',embedded:true,onSaved(){},onStateChange(){}};
  const readonly=renderToStaticMarkup(React.createElement(SecretEditor,{...props,state:{configured:true,writable:false}}));
  assert.match(readonly,/已配置/);
  assert.match(readonly,/由环境提供/);
  assert.match(readonly,/只读/);
  assert.doesNotMatch(readonly,/<(?:input|button|form)\b/);
  assert.doesNotMatch(readonly,/<p[^>]*><\/p>/);
  const writable=renderToStaticMarkup(React.createElement(SecretEditor,{...props,state:{configured:false,writable:true,sharedWith:['shared-route']}}));
  assert.match(writable,/type="password"/);
  assert.match(writable,/替换模型 API Key/);
  assert.match(writable,/清除模型 API Key/);
  assert.match(writable,/shared-route/);
  assert.match(writable,/替换或清除会同时影响/);
  assert.doesNotMatch(writable,/<p[^>]*><\/p>/);
  const apiProps={version:'test-v1',onSaved(){},onStateChange(){}};
  const api=renderToStaticMarkup(React.createElement(ProviderApiEditor,{...apiProps,provider:{provider:'test-route',api:'anthropic-messages',baseURL:'',baseURLConfigured:true}}));
  assert.match(api,/API 协议/);
  assert.match(api,/API 地址/);
  assert.match(api,/已有地址包含私密参数，不回显/);
  assert.doesNotMatch(api,/<p[^>]*><\/p>/);
  assert.doesNotMatch(api,/provider-api-help/);
  const create=renderToStaticMarkup(React.createElement(ProviderApiEditor,apiProps));
  assert.match(create,/路由标识/);
  assert.match(create,/首个模型 ID/);
  assert.match(create,/创建路由/);
  assert.doesNotMatch(create,/<p[^>]*><\/p>/);
 } finally { await server.close(); }
});
