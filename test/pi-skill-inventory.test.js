import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,mkdir,writeFile,rm,symlink,readFile} from 'node:fs/promises'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {installedSkills,skillIdentity} from '../src/memory/skill-inventory.js'
async function fixture(t){const root=await mkdtemp(join(tmpdir(),'night-skill-usage-'));t.after(()=>rm(root,{recursive:true,force:true}));const paths={mode:'portable',installRoot:root,skills:join(root,'data/config/skills'),secrets:join(root,'data/secrets'),state:join(root,'data/state'),memory:join(root,'data/memory'),workspaces:join(root,'data/workspaces')};await mkdir(paths.skills,{recursive:true});return {root,paths}}
test('安装技能盘点去重、识别显式嵌套根，跳过链接和私有数据根；资源 ID 随安装迁移保持',async t=>{
 const {root,paths}=await fixture(t),nested=join(paths.skills,'nested','deep');await mkdir(nested,{recursive:true});await writeFile(join(nested,'SKILL.md'),'---\nname: nested-check\ndescription: Scoped local resource\n---\nRead real evidence.\n')
 await mkdir(join(paths.secrets,'hidden'),{recursive:true});await writeFile(join(paths.secrets,'hidden','SKILL.md'),'---\nname: private-never-list\ndescription: Not a public skill directory\n---\nDO_NOT_READ_THIS_ROOT\n')
 await symlink(paths.secrets,join(paths.skills,'escape'),'dir')
 const value=await installedSkills(paths,[nested,paths.secrets]);assert.equal(value.items.length,1);assert.equal(value.items[0].status,'applied');assert.equal(value.complete,false);assert.doesNotMatch(JSON.stringify(value),/private-never-list|DO_NOT_READ_THIS_ROOT/)
 const a=skillIdentity({name:'nested-check',provider:'filesystem',path:join(root,'data/config/skills/nested/deep/SKILL.md'),installRoot:root}),b=skillIdentity({name:'nested-check',provider:'filesystem',path:'/new-install/data/config/skills/nested/deep/SKILL.md',installRoot:'/new-install'});assert.equal(a,b)
})

test('Host startup, skill loading and restart never create or mutate retired usage databases',async t=>{
 const {memoryHost}=await import('./fixtures/memory-host.js')
 const f=await memoryHost(t),directory=join(f.root,'data/memory/v2/bot')
 await f.host.ctx.memory.bindingReady
 const {readdir}=await import('node:fs/promises')
 assert.equal((await readdir(directory)).some(name=>name.startsWith('skill-usage.sqlite')),false)
 await f.close()
 const files=['','-wal','-shm','-journal'].map(suffix=>'skill-usage.sqlite'+suffix)
 for(const name of files)await writeFile(join(directory,name),'RETIRED:'+name)
 await mkdir(join(f.root,'data/config/skills/sample'),{recursive:true})
 await writeFile(join(f.root,'data/config/skills/sample/SKILL.md'),'---\nname: sample\ndescription: Test fixture\n---\nSample instructions.\n')
 await f.boot();await f.host.ctx.memory.bindingReady
 const handle=await f.agent('retired-usage',{actorId:'fixture'})
 const tool=f.host.ctx.tools.get('skill',handle.agent)
 assert.equal((await tool.execute({name:'sample'},{agent:handle.agent,signal:new AbortController().signal})).name,'sample')
 await f.say(handle.agent,'Continue with the loaded skill')
 await f.close();await f.boot();await f.host.ctx.memory.bindingReady
 for(const name of files)assert.equal(await readFile(join(directory,name),'utf8'),'RETIRED:'+name)
 assert.equal(f.host.ctx.memory.skillUsage,undefined)
})
