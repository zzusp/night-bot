import test from 'node:test'
import assert from 'node:assert/strict'
import {join,dirname} from 'node:path'
import {deploymentView} from '../server/deployment.js'
import {pathInventory,bundledSkillDir} from '../../../src/runtime/paths.js'
import {createWebConsole} from '../server/plugin.js'
import {readFile} from 'node:fs/promises'
import {memoryHost} from '../../../test/fixtures/memory-host.js'

test('deployment allowlist keeps missing paths unknown and never serializes secrets',async()=>{
 const value=await deploymentView({installRoot:'/instance',state:'/instance/state',credentials:'/private/credentials.json',secret:'DO_NOT_EXPOSE',workspaces:'/work'})
 assert.equal(value.directories.find(r=>r.id==='data').path,null)
 assert.equal(value.directories.find(r=>r.id==='credentials').path,'/private')
 assert.equal(value.skillDirectories,null)
 assert.doesNotMatch(JSON.stringify(value),/DO_NOT_EXPOSE|credentials.json/)
})
test('real Host inventory uses runtime pathInventory and mounted native skill roots without inference',async t=>{
 const f=await memoryHost(t,()=>{assert.fail('deployment reads must not run model inference')})
 const startup=await f.host.ctx.get('deploymentInventory').read();assert.ok(startup.skillDirectories.some(r=>r.path===bundledSkillDir))
 await f.agent('deployment-inventory-fixture')
 const inventory=await f.host.ctx.get('deploymentInventory').read(),p=pathInventory(f.config)
 const result=await deploymentView({},()=>inventory)
 assert.deepEqual(inventory.paths,p)
 assert.equal(result.directories.find(r=>r.id==='credentials').path,dirname(p.credentials))
 assert.ok(result.skillDirectories.some(r=>r.path===bundledSkillDir&&r.kind==='bundled'))
 for(const path of [p.skills,join(p.agentsHome,'skills'),join(p.harnessHome,'skills')])assert.ok(result.skillDirectories.some(r=>r.path===path&&r.kind==='custom'))
 const web=await createWebConsole({channels:f.host.ctx.channels,paths:p,config:{senderId:'deployment-operator',channelId:'deployment-test',port:0},getApplication:()=>({}),getDeploymentInventory:()=>f.host.ctx.get('deploymentInventory').read()})
 try {
 assert.equal((await fetch(web.origin+'/api/settings/deployment')).status,401)
 const credential=(await readFile(web.credentialPath,'utf8')).trim()
 const login=await fetch(web.origin+'/api/login',{method:'POST',headers:{origin:web.origin,'content-type':'application/json'},body:JSON.stringify({token:credential})})
 assert.equal(login.status,200)
 const cookie=login.headers.get('set-cookie').split(';')[0]
 const response=await fetch(web.origin+'/api/settings/deployment',{headers:{cookie}})
 assert.equal(response.status,200)
 assert.deepEqual(await response.json(),result)
 assert.match(response.headers.get('cache-control'),/no-store/)
 assert.equal((await fetch(web.origin+'/api/settings/deployment',{headers:{cookie,origin:'https://foreign.invalid'}})).status,403)
 assert.equal(f.requests.length,0)
 } finally {await web.close()}
})
