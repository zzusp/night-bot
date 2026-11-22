import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=new URL('../src/',import.meta.url);
test('all authored selects share BoardSelect rather than platform option popups',async()=>{
 async function scan(dir){for(const entry of await readdir(dir,{withFileTypes:true})){const path=join(dir,entry.name);if(entry.isDirectory())await scan(path);else if(path.endsWith('.tsx'))assert.doesNotMatch(await readFile(path,'utf8'),/<select\b/,path)}}
 await scan(fileURLToPath(root));
});
test('shared select keeps explicit native semantics, modal portal and collision-aware geometry',async()=>{
 const code=await readFile(new URL('components/BoardSelect.tsx',root),'utf8');
 assert.match(code,/@radix-ui\/react-select/);
 assert.match(code,/closest\('dialog'\)/);
 assert.match(code,/Select\.ItemText/);assert.match(code,/Select\.ItemIndicator/);
 assert.match(code,/disabled=\{option.props.disabled\}/);
 assert.match(code,/position="popper"/);assert.match(code,/collisionPadding=\{12\}/);
 assert.match(code,/const encode = \(value:string\) => `value:\$\{value\}`/);
 const css=await readFile(new URL('styles/boardui.css',root),'utf8');
 assert.match(css,/width:var\(--radix-select-trigger-width\)/);
 assert.match(css,/radix-select-content-available-height/);
 assert.match(css,/board-select:focus-visible/);
});
