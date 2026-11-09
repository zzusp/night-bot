import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,mkdir,writeFile,rm,symlink,readFile} from 'node:fs/promises'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {installedSkills,openSkillUsage,skillIdentity} from '../src/memory/skill-usage.js'
async function fixture(t){const root=await mkdtemp(join(tmpdir(),'night-skill-usage-'));t.after(()=>rm(root,{recursive:true,force:true}));const paths={mode:'portable',installRoot:root,skills:join(root,'data/config/skills'),secrets:join(root,'data/secrets'),state:join(root,'data/state'),memory:join(root,'data/memory'),workspaces:join(root,'data/workspaces')};await mkdir(paths.skills,{recursive:true});return {root,paths}}
test('安装技能盘点去重、识别显式嵌套根，跳过链接和私有数据根；资源 ID 随安装迁移保持',async t=>{
 const {root,paths}=await fixture(t),nested=join(paths.skills,'nested','deep');await mkdir(nested,{recursive:true});await writeFile(join(nested,'SKILL.md'),'---\nname: nested-check\ndescription: Scoped local resource\n---\nRead real evidence.\n')
 await mkdir(join(paths.secrets,'hidden'),{recursive:true});await writeFile(join(paths.secrets,'hidden','SKILL.md'),'---\nname: private-never-list\ndescription: Not a public skill directory\n---\nDO_NOT_READ_THIS_ROOT\n')
 await symlink(paths.secrets,join(paths.skills,'escape'),'dir')
 const value=await installedSkills(paths,[nested,paths.secrets]);assert.equal(value.items.length,1);assert.equal(value.items[0].status,'applied');assert.equal(value.complete,false);assert.doesNotMatch(JSON.stringify(value),/private-never-list|DO_NOT_READ_THIS_ROOT/)
 const a=skillIdentity({name:'nested-check',provider:'filesystem',path:join(root,'data/config/skills/nested/deep/SKILL.md'),installRoot:root}),b=skillIdentity({name:'nested-check',provider:'filesystem',path:'/new-install/data/config/skills/nested/deep/SKILL.md',installRoot:'/new-install'});assert.equal(a,b)
})
test('调用事件落盘幂等，目录盘点不产生事件，SQLite sidecar 链接在打开前拒绝',async t=>{
 const {root}=await fixture(t),directory=join(root,'usage'),event={eventId:'a'.repeat(64),resource:'b'.repeat(64),name:'local-check',provider:'filesystem',version:'c'.repeat(64),mode:'model'}
 let usage=await openSkillUsage(directory);usage.record(event);usage.record(event);assert.equal(usage.inspect().items[0].modelCount,1);usage.close();usage=await openSkillUsage(directory);assert.equal(usage.inspect().items[0].modelCount,1);usage.close()
 const unsafe=join(root,'unsafe'),target=join(root,'untouched');await mkdir(unsafe);await writeFile(target,'UNCHANGED');await symlink(target,join(unsafe,'skill-usage.sqlite-wal'));await assert.rejects(openSkillUsage(unsafe),{code:'SKILL_USAGE_PATH_UNSAFE'});assert.equal(await readFile(target,'utf8'),'UNCHANGED')
})
