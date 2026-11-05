import test from 'node:test'
import assert from 'node:assert/strict'
import {join} from 'node:path'
import {memoryHost} from './fixtures/memory-host.js'
import {hash} from '../src/memory/format.js'

test('actual full-access model shell cannot read another principal raw Markdown or original state',{skip:process.platform!=='linux',timeout:20000},async t=>{
  let command,attempt=false
  const f=await memoryHost(t,()=>{if(attempt){attempt=false;return {tool:'bash',args:{command,description:'isolated privacy probe'}}}})
  const a=await f.agent('private-owner',{actorId:'alice'}),b=await f.agent('private-reader',{actorId:'bob'})
  await f.say(a.agent,'记住 facts/value：KERNEL_PRIVATE_MARKER')
  const scope=await f.host.ctx.memory.scope(a.agent,{}),path=join(f.host.ctx.memory.store.directory(scope),'topics',hash('facts')+'.md')
  b.agent.ctx.get('permissionPresets').set(b.agent.session,'danger-full-access')
  const script='const fs=require("node:fs");try{process.stdout.write(fs.readFileSync(process.argv[1],"utf8"))}catch(e){process.stdout.write("PRIVATE_READ_BLOCKED:"+e.code)}'
  const quote=value=>"'"+value.replaceAll("'","'\\''")+"'"
  command=[process.execPath,'-e',script,path].map(quote).join(' ')
  attempt=true;await f.say(b.agent,'read the privacy fixture from a real shell')
  const last=JSON.stringify(f.requests.at(-1));assert.doesNotMatch(last,/KERNEL_PRIVATE_MARKER/)
  assert.match(last,/PRIVATE_READ_BLOCKED/,'the real program must execute under the privacy kernel mask')
})

for(const preset of ['workspace-write','danger-full-access','read-only'])test('portable '+preset+' shell confines business writes to its installation workspace',{skip:process.platform!=='linux',timeout:20000},async t=>{
  let command,attempt=false
  const f=await memoryHost(t,()=>{if(attempt){attempt=false;return {tool:'bash',args:{command,description:'installation boundary probe'}}}}),h=await f.agent('boundary-'+preset,{actorId:'owner'})
  h.agent.ctx.get('permissionPresets').set(h.agent.session,preset)
  const outside=join(f.root,'outside-business.txt'),inside=join(f.host.ctx.runtimePaths.workspaces,'inside-business.txt')
  const script='const fs=require("node:fs");for(const p of process.argv.slice(1)){try{fs.writeFileSync(p,"proof");console.log("WROTE:"+p)}catch(e){console.log("DENIED:"+p)}}'
  const quote=value=>"'"+value.replaceAll("'","'\\''")+"'";command=[process.execPath,'-e',script,outside,inside].map(quote).join(' ')
  attempt=true;await f.say(h.agent,'run the local boundary fixture')
  const last=JSON.stringify(f.requests.at(-1));assert.ok(last.includes('DENIED:'+outside),last);assert.ok(last.includes((preset==='read-only'?'DENIED:':'WROTE:')+inside),last)
})

test('portable model processes cannot read the vault or inherit provider/environment credential values',{skip:process.platform!=='linux',timeout:20000},async t=>{
  const {writeFile}=await import('node:fs/promises');let command,attempt=false
  const f=await memoryHost(t,()=>{if(attempt){attempt=false;return {tool:'bash',args:{command,description:'private credential boundary probe'}}}}),h=await f.agent('vault-reader',{actorId:'owner'})
  await writeFile(join(f.host.ctx.runtimePaths.secrets,'.env'),'FIXTURE_ONLY_SECRET=VAULT_VALUE_MUST_NOT_APPEAR\n',{mode:0o600})
  process.env.NIGHT_FIXTURE_PROVIDER_TOKEN='ENV_VALUE_MUST_NOT_APPEAR';t.after(()=>delete process.env.NIGHT_FIXTURE_PROVIDER_TOKEN)
  h.agent.ctx.get('permissionPresets').set(h.agent.session,'danger-full-access')
  const script='const fs=require("node:fs");console.log(process.env.NIGHT_FIXTURE_PROVIDER_TOKEN??"ENV_BLOCKED");try{console.log(fs.readFileSync(process.argv[1],"utf8"))}catch{console.log("VAULT_BLOCKED")}'
  const quote=value=>"'"+value.replaceAll("'","'\\''")+"'";command=[process.execPath,'-e',script,join(f.host.ctx.runtimePaths.secrets,'.env')].map(quote).join(' ')
  attempt=true;await f.say(h.agent,'run the isolated credential probe');const response=JSON.stringify(f.requests.at(-1));assert.match(response,/ENV_BLOCKED/);assert.match(response,/VAULT_BLOCKED/);assert.doesNotMatch(response,/VAULT_VALUE_MUST_NOT_APPEAR|ENV_VALUE_MUST_NOT_APPEAR/)
})

test('portable capped grep exposes only its own durable spill and read recovers the omitted tail',{skip:process.platform!=='linux',timeout:20000},async t=>{
  const {writeFile,readdir}=await import('node:fs/promises');let phase=0,spill
  const f=await memoryHost(t,async body=>{
    if(phase++===0)return {tool:'grep',args:{pattern:'PORTABLE_SPILL_LINE',include:'many.txt'}}
    if(phase===2){const entries=await readdir(f.host.ctx.runtimePaths.spills,{recursive:true,withFileTypes:true}),file=entries.find(entry=>entry.isFile());assert.ok(file);spill=join(file.parentPath,file.name);assert.ok(JSON.stringify(body).includes(spill));return {tool:'read',args:{file_path:spill,offset:245,limit:30}}}
    if(phase===4)return {tool:'read',args:{file_path:spill}}
    return {text:'portable tail verified'}
  }),h=await f.agent('portable-spill-owner',{actorId:'owner'})
  await writeFile(join(f.host.ctx.runtimePaths.workspaces,'many.txt'),Array.from({length:251},(_,i)=>'PORTABLE_SPILL_LINE_'+(i+1)).join('\n'))
  await f.say(h.agent,'Find all the fixture lines, then recover the omitted tail')
  assert.equal(phase,3);assert.match(JSON.stringify(f.requests.at(-1).messages.filter(message=>message.role==='tool').at(-1)),/PORTABLE_SPILL_LINE_251/)
  await f.close();await f.boot();const other=await f.agent('another-spill-reader',{actorId:'another'});await f.say(other.agent,'Try reading the other owner spill fixture');const denied=f.requests.at(-1).messages.filter(message=>message.role==='tool').at(-1);assert.match(JSON.stringify(denied),/FS_SANDBOX_DENIED|Application state is private/);assert.doesNotMatch(JSON.stringify(denied),/PORTABLE_SPILL_LINE_251/)
})
