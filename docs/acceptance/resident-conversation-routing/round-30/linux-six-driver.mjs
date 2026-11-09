import assert from 'node:assert/strict'
import {execFileSync,spawn} from 'node:child_process'
import {readFileSync,writeFileSync,existsSync} from 'node:fs'
import {resolve} from 'node:path'
import {createHash} from 'node:crypto'
const mode=process.argv[2]
assert.ok(process.argv.length===3&&['--check','--run'].includes(mode))
const prefix='docs/tmp/sg11-linux-six-',name='night-bot-sg11-linux-six-current',owner='sg11-linux-six-current'
const sha=b=>createHash('sha256').update(b).digest('hex')
const docker=args=>execFileSync('docker',args,{encoding:'utf8',stdio:['ignore','pipe','pipe']})
const inspect=args=>JSON.parse(docker(args))
const build=JSON.parse(readFileSync(prefix+'build-result.json')),map=JSON.parse(readFileSync(prefix+'build-source-map.json')),payload=JSON.parse(readFileSync(prefix+'payload-source.json'))
assert.equal(build.exit,0);assert.deepEqual(build.sourceChanged,[]);assert.equal(build.sourceMapSha256,map.sourceMapSha256)
const image=build.image.id,im=inspect(['image','inspect','--format','{{json .}}',image])
assert.equal(im.Id,image);assert.equal(im.Config.User,'node');assert.equal(im.Os,'linux');assert.equal(im.Architecture,'amd64')
const policy='docs/ops/docker-bwrap-seccomp.json';assert.equal(sha(readFileSync(policy)),'9264f1689d786e212fcfc1dc63eed5d08a2be4c236a252d5676f43f40691201f')
for(const [file,digest]of Object.entries(payload.payloadFiles))assert.equal(sha(readFileSync(payload.payloadPath+'/'+file)),digest)
const absent=(()=>{try{docker(['container','inspect',name]);return false}catch(error){assert.match(String(error.stderr),/no such (container|object)/i);return true}})();assert.equal(absent,true)
for(const suffix of ['test.log','test-stderr.log','test-result.json'])assert.equal(existsSync(prefix+suffix),false)
const files=['test/native-shell-kernel-wire.test.js','test/native-managed-shell-kernel.test.js','test/native-memory-privacy-kernel.test.js']
const cases=[
 'actual Pi native confined bash retains one managed effect through explicit background and job collection',
 'actual Pi native confined bash retains one managed effect through timeout promotion and job collection',
 'real Linux confined shell joins cancellation of a process that refuses TERM',
 'Linux owned subprocess direct exit cannot settle shell completion while a descendant remains',
 'portable model processes cannot read the vault or inherit provider/environment credential values',
 'task archive fences absolute writes, symlink escapes and private journals in an actual model shell; task temporary files stay local',
]
const pattern=cases.map(s=>'^'+RegExp.escape(s)+'$').join('|')
const command=['node','--import','./test/fixtures/sg11-linux-provider-observer.mjs','--test','--test-reporter=tap','--test-concurrency=1','--test-name-pattern='+pattern,...files]
const selected=['package.json','pnpm-lock.yaml','pnpm-workspace.yaml','src/host.js','src/native-tool-bash.js','src/native-jobs.js','src/native-bash-sandbox.js','src/process/index.js','src/runtime/managed-shell-execution.js','src/memory/privacy.js']
const runtimeHashes=Object.fromEntries(selected.map(file=>[file,map.sourceFiles[file]]));assert.ok(Object.values(runtimeHashes).every(v=>typeof v==='string'))
const verify='const fs=require("node:fs"),crypto=require("node:crypto"),assert=require("node:assert/strict");for(const [file,digest]of Object.entries('+JSON.stringify({...runtimeHashes,...payload.payloadFiles})+'))assert.equal(crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex"),digest,file);assert.equal(process.platform,"linux");assert.equal(process.getuid(),1000);console.log("SG11_RUNTIME_INPUTS "+JSON.stringify({node:process.version,platform:process.platform,uid:process.getuid(),payloadFiles:5,sourceInputsVerified:true}));'
const shell='mkdir -p /opt/night-bot/data/temp && node -e "$1" && shift && exec /usr/bin/tini -- "$@"'
const common=['--network','none','--cap-drop','ALL','--security-opt','no-new-privileges','--security-opt','seccomp='+policy,'--read-only','--tmpfs','/tmp:rw,nosuid,nodev,size=128m,mode=1777','--tmpfs','/opt/night-bot/data:rw,nosuid,nodev,size=512m,uid=1000,gid=1000,mode=0700','--mount','type=bind,source='+resolve(payload.payloadPath,'test')+',target=/opt/night-bot/test,readonly']
console.log(JSON.stringify({mode,effects:mode==='--check'?0:undefined,image,sourceMapSha256:map.sourceMapSha256,payloadFiles:5,name,command,network:'none',nonRoot:true,capDropAll:true,noNewPrivileges:true,readOnlyRoot:true,readOnlyExactTestPayload:true,realVendorExecuted:false}))
if(mode==='--check')process.exit(0)
const result={startedAt:new Date().toISOString(),image,sourceMapSha256:map.sourceMapSha256,runtimeHashes,payloadFiles:payload.payloadFiles,driverSha256:sha(readFileSync(import.meta.filename)),realVendorExecuted:false,events:[],caseResults:[],businessPass:false,strongOwnerPass:false,overallPass:false}
let output='',errors='',id
try{
 id=docker(['create','--name',name,'--label','night-bot.test-run='+owner,...common,'--entrypoint','/bin/sh',image,'-c',shell,'sg11-linux-six',verify,...command]).trim();result.containerId=id
 const before=inspect(['container','inspect','--format','{{json .}}',id])
 assert.equal(before.Config.Labels['night-bot.test-run'],owner);assert.equal(before.Config.User,'node');assert.equal(before.HostConfig.Privileged,false);assert.equal(before.HostConfig.NetworkMode,'none');assert.equal(before.HostConfig.ReadonlyRootfs,true);assert.ok(before.HostConfig.CapDrop.includes('ALL'));assert.ok(!before.HostConfig.CapAdd?.length);assert.ok(before.HostConfig.SecurityOpt.some(v=>v==='no-new-privileges'||v==='no-new-privileges=true'))
 const seccomp=before.HostConfig.SecurityOpt.find(v=>v.startsWith('seccomp='));assert.ok(seccomp);assert.deepEqual(JSON.parse(seccomp.slice('seccomp='.length)),JSON.parse(readFileSync(policy,'utf8')))
 const binds=before.Mounts.filter(v=>v.Type==='bind');assert.equal(binds.length,1);assert.equal(binds[0].Destination,'/opt/night-bot/test');assert.equal(binds[0].RW,false);assert.ok(before.Mounts.every(v=>v.Type==='bind'||v.Type==='tmpfs'));assert.deepEqual(Object.keys(before.HostConfig.Tmpfs).sort(),['/opt/night-bot/data','/tmp'])
 result.actualIsolation={nonRoot:true,network:'none',capDropAll:true,noNewPrivileges:true,readOnlyRoot:true,readOnlyTestPayload:true,seccompMatchesOriginal:true,privileged:false,appArmorProfile:before.AppArmorProfile}
 const child=spawn('docker',['start','--attach',id],{stdio:['ignore','pipe','pipe']});child.stdout.setEncoding('utf8');child.stderr.setEncoding('utf8');child.stdout.on('data',s=>output+=s);child.stderr.on('data',s=>errors+=s)
 result.attachCliExit=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',resolve)})
 const state=inspect(['container','inspect','--format','{{json .State}}',id]);result.containerState={status:state.Status,running:state.Running,exitCode:state.ExitCode,oomKilled:state.OOMKilled};assert.equal(state.Running,false)
 const waited=Number(docker(['wait',id]).trim());result.waitExitCode=waited;assert.equal(waited,state.ExitCode)
 for(const line of output.split(/\r?\n/)){
  for(const [marker,key]of [['SG11_PROVIDER_OBSERVATION ','events'],['SG11_RUNTIME_INPUTS ','runtimeInputs']]){const at=line.indexOf(marker);if(at>=0){const row=JSON.parse(line.slice(at+marker.length));if(key==='events')result.events.push(row);else result.runtimeInputs=row}}
  const match=/^(not ok|ok) \d+ - (.+?)(?: # (.*))?$/.exec(line)
  if(match&&cases.includes(match[2]))result.caseResults.push({name:match[2],passed:match[1]==='ok',directive:match[3]??null})
 }
 result.providerObservedInEachFile=files.every(file=>result.events.some(v=>v.file===file.split('/').at(-1)&&v.kind==='ordinary'&&v.outcome==='returned'))
 result.businessPass=state.ExitCode===0&&result.caseResults.length===cases.length&&cases.every(name=>result.caseResults.filter(v=>v.name===name&&v.passed&&!v.directive).length===1)
 result.strongOwnerPass=result.providerObservedInEachFile&&result.events.length>0&&result.events.every(v=>v.outcome==='returned'&&v.selected==='linux-scope')
 result.overallPass=result.businessPass&&result.strongOwnerPass
}catch(error){result.error={name:error.name,message:error.message}}
finally{
 if(id){
  try{
   const actual=inspect(['container','inspect','--format','{{json .}}',id]);assert.equal(actual.Config.Labels['night-bot.test-run'],owner);assert.equal(actual.State.Running,false);assert.equal(docker(['rm',id]).trim(),id)
   try{docker(['container','inspect',id]);throw Error('OWNED_CONTAINER_STILL_PRESENT')}catch(error){assert.match(String(error.stderr),/no such (container|object)/i)}
   result.containerRemoved=true
  }catch(error){result.cleanupError={name:error.name,message:error.message};result.overallPass=false;result.containerRetained=true}
 }
 writeFileSync(prefix+'test.log',output,{flag:'wx'});writeFileSync(prefix+'test-stderr.log',errors,{flag:'wx'})
 result.logSha256=sha(Buffer.from(output));result.stderrSha256=sha(Buffer.from(errors));result.finishedAt=new Date().toISOString()
 writeFileSync(prefix+'test-result.json',JSON.stringify(result,null,2)+'\n',{flag:'wx'})
 console.log(JSON.stringify({businessPass:result.businessPass,strongOwnerPass:result.strongOwnerPass,overallPass:result.overallPass,caseResults:result.caseResults,providerSelections:result.events.map(v=>({file:v.file,kind:v.kind,selected:v.selected,pid:v.pid})),containerState:result.containerState,containerRemoved:result.containerRemoved,error:result.error,cleanupError:result.cleanupError}))
 process.exitCode=result.overallPass?0:1
}
