import assert from 'node:assert/strict';
import test from 'node:test';
import {fileURLToPath} from 'node:url';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {createServer} from 'vite';

// Real component coverage also runs where Chromium cannot create IPC sockets.
test('role model cards omit descriptive summaries and retain actionable warnings', async () => {
 const server=await createServer({root:fileURLToPath(new URL('..',import.meta.url)),server:{middlewareMode:true,hmr:false},appType:'custom'});
 try {
  const {RoleModelEditor}=await server.ssrLoadModule('/src/components/RoleModelEditor.tsx');
  const selection={provider:'test-route',model:'test-model'};
  const catalog=[{provider:'test-route',name:'测试路由',models:[{id:'test-model',name:'测试模型',reasoningEfforts:['off','high']}]}];
  const render=(state)=>renderToStaticMarkup(React.createElement(RoleModelEditor,{state,catalog,version:'test-v1',onSaved(){},onReload(){},reloading:false,onStateChange(){}}));
  const state={running:{...selection,reasoningEffort:'off'},saved:selection,savedExplicit:false,nextStart:{...selection,reasoningEffort:'off'},restartRequired:false,environmentOverrides:[]};
  for(const [role,label] of [['triage','一级分诊'],['router','Router'],['task','任务执行']]){
   for(const savedExplicit of [false,true]){
    const markup=render({...state,role,savedExplicit});
    assert.doesNotMatch(markup,/当前运行：|当前保存：|下次启动：|沿用默认配置|沿用运行默认配置/);
    assert.match(markup,new RegExp(`<h2 id="role-${role}-title">${label}</h2><form`));
    assert.match(markup,new RegExp(`<label for="role-${role}-provider">${label}模型路由</label>`));
    assert.match(markup,new RegExp(`<label for="role-${role}-model">${label}模型</label>`));
    assert.match(markup,new RegExp(`<label for="role-${role}-effort">${label}推理深度</label>`));
    assert.match(markup,new RegExp(`保存${label}配置`));
   }
  }
  const restart=render({...state,role:'triage',restartRequired:true});
  assert.match(restart,/待重启/);
  const missing=render({...state,role:'router',nextStart:null});
  assert.match(missing,/<p role="alert">无法核验下次启动模型，请检查路由与推理深度配置。<\/p>/);
  const overridden={...state,role:'task',environmentOverrides:[{name:'NIGHT_BOT_TASK_MODEL',source:'process'}]};
  const environment=render(overridden);
  assert.match(environment,/环境变量优先于保存配置/);
  assert.match(environment,/按当前环境重启：test-route \/ test-model · 关闭/);
  assert.match(environment,/NIGHT_BOT_TASK_MODEL · 进程环境/);
  const incompatible=render({...overridden,nextStart:null});
  assert.match(incompatible,/<p role="alert">当前环境变量与保存配置不兼容，需修改或移除后才能正常启动。<\/p>/);
 } finally { await server.close(); }
});
