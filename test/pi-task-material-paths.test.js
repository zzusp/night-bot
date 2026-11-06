import test from 'node:test'
import assert from 'node:assert/strict'
import {bindTaskMaterialPaths,resolveTaskMaterialPaths} from '../src/tasks/material-paths.js'
const origin='/original/data/workspaces/tasks/task-1/materials',destination='/restored/data/workspaces/tasks/task-1/materials'
const name='source-'+'a'.repeat(32)+'.json',resource='resource-'+'b'.repeat(16)+'-'+'c'.repeat(16)+'.png'
const packet=()=>({taskId:'task-1',sourceId:'source-1',text:'Keep /original/data/workspaces/user.txt literally',path:origin+'/'+name,resources:[{status:'read',complete:true,path:origin+'/'+resource,bytes:3,sha256:'c'.repeat(64),resource:{url:'https://fixture.invalid/original'},value:{image:{path:origin+'/'+resource,mediaType:'image/png'}}}]})
test('typed material paths relocate only controlled leaves; packet and opaque source remain unchanged',()=>{
 const original=bindTaskMaterialPaths(packet(),origin),saved=JSON.stringify(original),value=resolveTaskMaterialPaths(original,destination,destination+'/'+name)
 assert.equal(JSON.stringify(original),saved);assert.equal(value.path,destination+'/'+name);assert.equal(value.resources[0].path,destination+'/'+resource);assert.equal(value.resources[0].value.image.path,destination+'/'+resource)
 assert.equal(value.text,original.text);assert.deepEqual(value.resources[0].resource,original.resources[0].resource)
})
test('old unmarked packets remain root bound, never guessed or rewritten',()=>{const old=packet();assert.equal(resolveTaskMaterialPaths(old,destination,destination+'/'+name),old);assert.equal(old.path,origin+'/'+name)})
test('typed material evidence rejects extra fields, traversal, foreign raw paths and mismatched image identity',()=>{
 for(const alter of [p=>p.pathBindings.fields.text='secret',p=>p.pathBindings.fields.path='../'+name,p=>p.path='/foreign/'+name,p=>p.resources[0].value.image.path='/foreign/'+resource,p=>delete p.pathBindings.fields['resources.0.path']]){
 const p=bindTaskMaterialPaths(packet(),origin);alter(p);assert.throws(()=>resolveTaskMaterialPaths(p,destination,destination+'/'+name),{code:'TASK_MATERIAL_PATH_BINDING_INVALID'})
 }
})
