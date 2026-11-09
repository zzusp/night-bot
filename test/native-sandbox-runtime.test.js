import test from 'node:test'
import assert from 'node:assert/strict'
import {Context} from '@deepseek-ai/cordis'
import NativeSandbox from '../src/native-sandbox.js'
import {mkdtemp,rm,writeFile,readFile} from 'node:fs/promises'
import {join,dirname} from 'node:path'
import {tmpdir} from 'node:os'
import {spawnSync} from 'node:child_process'
for(const mode of ['read-only','workspace-write'])test(`native kernel sandbox enforces ${mode} within and outside workspace`,{skip:process.platform!=='linux'},async t=>{const root=await mkdtemp(join(tmpdir(),'night-kernel-')),inside=join(root,'inside.txt'),outside=join(dirname(process.cwd()),'.night-kernel-outside-'+root.split('/').at(-1)),ctx=new Context();ctx.logger={warn(){}};const sandbox=new NativeSandbox(ctx);t.after(async()=>{await ctx.fiber.dispose();await rm(root,{recursive:true,force:true});await rm(outside,{force:true})});await writeFile(inside,'before');await writeFile(outside,'before');for(const [path,allowed]of [[inside,mode==='workspace-write'],[outside,false]]){const wrapped=await sandbox.confine([process.execPath,'-e','require("node:fs").writeFileSync(process.argv[1],"after")',path],{mode,workspaceRoot:root});const result=spawnSync(wrapped.argv[0],wrapped.argv.slice(1),{env:{},encoding:'utf8',timeout:10000});assert.equal(result.error,undefined);assert.equal(result.status===0,allowed,result.stderr);assert.equal(await readFile(path,'utf8'),allowed?'after':'before')}})
