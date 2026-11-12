import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,mkdir,readdir,rm,writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {symlink} from './fixtures/filesystem-link.js'
import {taskProcessEnvironment,sameTaskTempPath} from '../src/process/task-temp.js'
async function fixture(t){const root=await mkdtemp(join(tmpdir(),'night-task-temp-'));t.after(()=>rm(root,{recursive:true,force:true}));return root}
test('task temp overrides stale mixed-case temp keys, preserves other environment and removes probe',async t=>{
 const root=await fixture(t),temp=join(root,'tmp');await mkdir(temp)
 assert.deepEqual(taskProcessEnvironment(root,{Temp:'/host',tmp:'/other',TMPDIR:'/global',KEEP:'value'}),{KEEP:'value',TMP:temp,TEMP:temp,TMPDIR:temp});assert.deepEqual(await readdir(temp),[])
})
test('missing and non-directory task temp fail without creating or falling back',async t=>{
 const root=await fixture(t);assert.throws(()=>taskProcessEnvironment(root),{code:'NIGHT_TASK_TEMP_UNAVAILABLE'});assert.deepEqual(await readdir(root),[])
 await writeFile(join(root,'tmp'),'not a directory');assert.throws(()=>taskProcessEnvironment(root),{code:'NIGHT_TASK_TEMP_UNAVAILABLE'})
})
test('task temp rejects redirected directory before creating a probe',async t=>{
 const root=await fixture(t),foreign=join(root,'foreign');await mkdir(foreign);await symlink(foreign,join(root,'tmp'),'dir')
 assert.throws(()=>taskProcessEnvironment(root),{code:'NIGHT_TASK_TEMP_UNAVAILABLE'});assert.deepEqual(await readdir(foreign),[])
})
test('Windows path identity tolerates spelling case but not a different directory',()=>{
 assert.equal(sameTaskTempPath('C:\\Task\\tmp','c:\\task\\TMP','win32'),true)
 assert.equal(sameTaskTempPath('C:\\Task\\tmp','C:\\Else\\tmp','win32'),false)
 assert.equal(sameTaskTempPath('/Task/tmp','/task/tmp','linux'),false)
})
