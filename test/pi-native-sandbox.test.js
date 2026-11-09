import test from 'node:test'
import assert from 'node:assert/strict'
import {Context} from '@deepseek-ai/cordis'
import NativeSandbox,{sandboxProfile} from '../src/native-sandbox.js'
import {AclWriteGrant,freezeOwnedPackageWriteStages,subtractOwnedPackageWrites,addScopedFileAccess,subtractScopedFileAccess,scopedLabelFacts,planScopedFileLabels,planScopedFileLabelRelease,scopedFileLabelInheritanceInputs,mergeScopedFileLabelInheritance,freezeScopedFileLabelStages,scopedFileInheritanceInputs,mergeScopedFileInheritance,freezeScopedFileAccessStages,freezeScopedFileReleaseStages} from '../src/process/windows-acl.js'
import {bindWindowsFileRequest,windowsFileRequest,windowsLaunchPolicy,windowsScopeRoots} from '../src/process/contracts.js'
import {createPrivacy,windowsPrivateProcessSpec} from '../src/memory/privacy.js'
import {spawnLpacJobProcess,createPseudoConsole} from '../src/process/win32.js'
import {existsSync,mkdtempSync,rmSync,mkdirSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join,win32} from 'node:path'
const policy={mode:'workspace-write',workspaceRoot:'/workspace'}
function fixture(t,Impl=NativeSandbox,config={}){const ctx=new Context();ctx.logger={warn(){}};const provider=new Impl(ctx,{runnerCommand:[],runnerFailureSignatures:[],probeTimeoutMs:100,...config});t.after(()=>ctx.fiber.dispose());return provider}
test('sandbox backends preserve literal argv, policy mode and honest enforcement metadata',async t=>{
 const binaries={bwrap:'bwrap',landlock:'/fixture/landlock',seatbelt:'/fixture/seatbelt','windows-acl':'/fixture/windows'}
 for(const runner of Object.keys(binaries))for(const mode of ['read-only','workspace-write']){
  const actual=fixture(t);actual.internals={chain:[runner],landlockLauncher:binaries.landlock,seatbeltExec:binaries.seatbelt,windowsAclRunnerArgs:[binaries['windows-acl']]}
  const result=await actual.confine(['echo','literal $x'],{...policy,mode})
  assert.equal(result.argv[0],binaries[runner]);assert.deepEqual(result.argv.slice(-3),['--','echo','literal $x'])
  assert.equal(result.enforcement,runner==='windows-acl'?'partial':'full')
  assert.ok(result.denialSignatures.length>0);assert.ok(result.runnerFailureRules[0].fatalSignatures.length>0)
  if(runner==='bwrap')assert.deepEqual(result.argv.slice(1,-3),['--ro-bind','/','/','--dev','/dev','--unshare-pid','--proc','/proc','--die-with-parent',...(mode==='workspace-write'?['--tmpfs','/tmp','--bind','/workspace','/workspace']:[])])
  if(runner==='seatbelt'){assert.ok(result.argv.includes('-p'));const profile=result.argv[result.argv.indexOf('-p')+1];assert.ok(profile.includes('(deny file-write*)'));assert.equal(profile.includes('(subpath "/workspace")'),mode==='workspace-write')}
 }
})
test('native sandbox probes in preference order once and retains partial enforcement',async t=>{const p=fixture(t),calls=[];p.internals={platform:'linux',landlockLauncher:'/fixture/landlock',probeBwrap:()=>{calls.push('bwrap');return false},probeLandlock:()=>{calls.push('landlock');return'partial'}};assert.equal((await p.confine(['true'],policy)).enforcement,'partial');await p.confine(['true'],policy);assert.deepEqual(calls,['bwrap','landlock'])})
test('native sandbox unavailable verdict is cached and cannot dispatch unconfined argv',async t=>{const p=fixture(t);let probes=0;p.internals={platform:'linux',probeBwrap:()=>{probes++;return false},landlockLauncher:'/fixture',probeLandlock:()=>{probes++;return'unusable'}};for(let n=0;n<2;n++)await assert.rejects(p.confine(['true'],policy),e=>e.code==='SANDBOX_UNAVAILABLE');assert.equal(probes,2);const unknown=fixture(t);unknown.internals={platform:'unknown'};await assert.rejects(unknown.confine(['true'],policy),e=>e.code==='SANDBOX_UNAVAILABLE')})
test('native sandbox validates custom runners, exact argv, cancellation and policy before grants',async t=>{for(const config of [{runnerCommand:['runner']},{runnerFailureSignatures:['fatal']},{probeTimeoutMs:0},{runnerCommand:['runner'],runnerFailureSignatures:['a\nb']}])assert.throws(()=>fixture(t,NativeSandbox,config));const p=fixture(t,NativeSandbox,{runnerCommand:['operator','prefix'],runnerFailureSignatures:['custom-fatal: ']});p.internals={platform:'linux'};const result=await p.confine(['echo','$(literal)'],policy);assert.equal(result.argv.at(-1),'$(literal)');assert.deepEqual(result.runnerFailureRules,[{fatalSignatures:['custom-fatal: ']}]);await assert.rejects(p.confine(['true'],{...policy,mode:'unknown'}),/mode/);await assert.rejects(p.confine([],policy),/argv/);const signal=AbortSignal.abort();await assert.rejects(p.confine(['true'],policy,signal));p.close();await assert.rejects(p.confine(['true'],policy),/closed/)})
test('native sandbox owns isolated metadata snapshots and read-only profiles',async t=>{const p=fixture(t);p.internals={chain:['bwrap']};const first=await p.confine(['true'],policy);first.denialSignatures.push('mutated');first.runnerFailureRules[0].fatalSignatures.length=0;const next=await p.confine(['true'],{...policy,mode:'read-only'});assert.deepEqual(next.denialSignatures,['read-only file system']);assert.deepEqual(next.runnerFailureRules,[{fatalSignatures:['bwrap: ']}]);assert.equal(next.argv.includes('--bind'),false);assert.ok(sandboxProfile('seatbelt',{...policy,workspaceRoot:'/workspace/"quoted\\name'}).join(' ').includes('\\"quoted\\\\name'))})
test('Windows capability contract keeps workspace grant shared and session temp grants isolated',async t=>{const grants=[];t.mock.method(AclWriteGrant,'create',sid=>{const grant={sid,adds:[],disposed:0,add(path,standing){this.adds.push({path,standing})},dispose(){this.disposed++}};grants.push(grant);return grant});const p=fixture(t),workspaceRoot=mkdtempSync(join(tmpdir(),'night-sandbox-workspace-'));t.after(()=>rmSync(workspaceRoot,{recursive:true,force:true}));p.internals={chain:['windows-acl'],windowsAclRunnerArgs:['fixture-windows']};const a=await p.confine(['true'],{...policy,workspaceRoot,sessionId:'a'}),again=await p.confine(['true'],{...policy,workspaceRoot,sessionId:'a'}),b=await p.confine(['true'],{...policy,workspaceRoot,sessionId:'b'});assert.deepEqual(a,again);const arg=(v,key)=>v.argv[v.argv.indexOf(key)+1];assert.equal(arg(a,'--write-sid'),arg(b,'--write-sid'));assert.notEqual(arg(a,'--temp-write-sid'),arg(b,'--temp-write-sid'));assert.notEqual(arg(a,'--temp'),arg(b,'--temp'));assert.equal(grants.length,3);assert.equal(grants[0].adds[0].standing,true);const temps=[arg(a,'--temp'),arg(b,'--temp')];for(const dir of temps)assert.equal(existsSync(dir),true);p.close();for(const grant of grants)assert.equal(grant.disposed,1);for(const dir of temps)assert.equal(existsSync(dir),false)})
test('Windows temp capability failure cleans private directory before propagating',async t=>{let tempPath,disposed=0;t.mock.method(AclWriteGrant,'create',()=>({add(path,standing){if(!standing){tempPath=path;throw Error('grant failed')}},dispose(){disposed++}}));const p=fixture(t),workspaceRoot=mkdtempSync(join(tmpdir(),'night-sandbox-workspace-'));t.after(()=>rmSync(workspaceRoot,{recursive:true,force:true}));p.internals={chain:['windows-acl'],windowsAclRunnerArgs:['fixture-windows']};await assert.rejects(p.confine(['true'],{...policy,workspaceRoot,sessionId:'a'}),/grant failed/);assert.equal(existsSync(tempPath),false);assert.equal(disposed,1);assert.equal(p.temps.size,0);p.close();assert.equal(disposed,2)})

test('Windows privacy intersects requested task writes and unwraps the original argv exactly once',{skip:process.platform!=='win32'?'Uses native Windows path canonicalisation':false},t=>{
 const root=mkdtempSync(join(tmpdir(),'night-lpac-policy-')),task=join(root,'data','workspaces','tasks','fixture'),work=join(task,'work'),tmp=join(task,'tmp'),nested=join(work,'nested')
 t.after(()=>rmSync(root,{recursive:true,force:true}));for(const path of [nested,tmp,join(task,'sessions')])mkdirSync(path,{recursive:true})
 const privacy={installRoot:root,tempRoot:join(root,'data','temp'),roots:[join(root,'data','secrets'),join(root,'data','temp')],taskRoot:()=>task},argv=['fixture-program','literal $value','--']
 for(const [workspace,fileRoot,mode,expected] of [[task,task,'workspace-write',[work,tmp]],[task,work,'workspace-write',[work]],[nested,task,'workspace-write',[nested]],[task,task,'read-only',[]]]){
  const input=bindWindowsFileRequest({argv:['old-acl-wrapper','--',...argv],cwd:work},argv,{mode,workspaceRoot:fileRoot})
  const output=windowsPrivateProcessSpec(input,privacy,workspace),policy=windowsLaunchPolicy(output)
  assert.deepEqual(output.argv,argv);assert.notEqual(output.argv,argv);assert.deepEqual(windowsFileRequest(output).argv,argv)
  assert.deepEqual(policy.writeRoots,expected);assert.equal(policy.workspaceRoot,task);assert.equal(policy.taskRoot,task)
  assert.deepEqual(policy.readRoots,['materials','work','outputs','tmp'].map(name=>join(task,name)).concat(expected.filter(path=>![work,tmp].includes(path))))
  assert.equal(policy.tempRoot,privacy.tempRoot);assert.deepEqual(policy.privateRoots,[...privacy.roots,join(task,'sessions'),join(task,'reviews')]);assert.deepEqual(policy.networkCapabilities,[])
  assert.equal(Object.hasOwn(output,'lpac'),false);assert.equal(JSON.stringify(output).includes('windows-lpac'),false)
 }
 const unrelated=bindWindowsFileRequest({argv,cwd:work},argv,{mode:'workspace-write',workspaceRoot:join(root,'data','workspaces','other')})
 assert.throws(()=>windowsPrivateProcessSpec(unrelated,privacy,task),/NIGHT_WORK_OUTSIDE_WORKSPACES/)
})
test('Windows privacy projects only Host-bound external roots and rejects neighbouring or private scopes',{skip:process.platform!=='win32'?'Uses native Windows path canonicalisation':false},t=>{
 const root=mkdtempSync(join(tmpdir(),'night-lpac-scoped-')),install=join(root,'install'),task=join(install,'data','workspaces','tasks','fixture'),work=join(task,'work'),read=join(root,'approved-read'),write=join(root,'approved-write'),neighbour=join(root,'neighbour'),secret=join(install,'data','secrets'),other=join(install,'data','workspaces','tasks','other','work')
 t.after(()=>rmSync(root,{recursive:true,force:true}));for(const path of [work,read,write,neighbour,secret,other])mkdirSync(path,{recursive:true})
 const privacy={installRoot:install,tempRoot:join(install,'data','temp'),roots:[secret,join(install,'data','temp')],taskRoot:()=>task},argv=['fixture-program','literal $value'],authorization={kind:'scoped',readRoots:[read],writeRoots:[write]}
 const input=(cwd,fileRoot=read,mode='workspace-write')=>bindWindowsFileRequest({argv:['old-wrapper','--',...argv],cwd},argv,{mode,workspaceRoot:fileRoot})
 for(const cwd of [read,write]){
  const output=windowsPrivateProcessSpec(input(cwd),privacy,task,authorization),policy=windowsLaunchPolicy(output)
  assert.equal(output.cwd,cwd);assert.deepEqual(output.argv,argv);assert.equal(policy.workspaceRoot,task)
  assert.deepEqual(policy.writeRoots,[work,join(task,'tmp'),write])
  assert.deepEqual(policy.readRoots,['materials','work','outputs','tmp'].map(name=>join(task,name)).concat(read,write))
  assert.equal(policy.tempRoot,privacy.tempRoot);assert.deepEqual(policy.privateRoots,[...privacy.roots,join(task,'sessions'),join(task,'reviews')])
  assert.equal(policy.readRoots.includes(task),false);assert.equal(windowsScopeRoots(policy).length,6)
 }
 const readOnly=windowsLaunchPolicy(windowsPrivateProcessSpec(input(read,read,'read-only'),privacy,task,authorization))
 assert.deepEqual(readOnly.writeRoots,[]);assert.deepEqual(readOnly.readRoots,['materials','work','outputs','tmp'].map(name=>join(task,name)).concat(read))
 for(const cwd of [neighbour,secret,join(task,'sessions'),join(task,'reviews'),other])assert.throws(()=>windowsPrivateProcessSpec(input(cwd),privacy,task,authorization),/Host-bound scope|private boundary/)
 assert.throws(()=>windowsPrivateProcessSpec(input(read,neighbour),privacy,task,authorization),/NIGHT_WORK_OUTSIDE_WORKSPACES/)
 for(const denied of [secret,other])assert.throws(()=>windowsPrivateProcessSpec(input(read),privacy,task,{...authorization,readRoots:[read,denied]}),/private installation|another workspace/)
})
test('Windows scope projection deduplicates case-insensitive roots and upgrades only matching reads to writes',()=>{
 const install=win32.join('C:/','night-lpac-scope'),task=win32.join(install,'data','workspaces','tasks','fixture'),[materials,work,outputs,tmp]=['materials','work','outputs','tmp'].map(name=>win32.join(task,name)),shared=win32.join('C:/','approved','shared'),read=win32.join('C:/','approved','read')
 const policy={kind:'windows-lpac',version:1,mode:'workspace-write',installRoot:install,tempRoot:win32.join(install,'data','temp'),workspaceRoot:task,taskRoot:task,readRoots:[materials,work,outputs,tmp,shared,read],writeRoots:[work.toUpperCase(),tmp,shared.toUpperCase()],privateRoots:[win32.join(task,'sessions'),win32.join(task,'reviews')],networkCapabilities:[]},before=structuredClone(policy)
 const scopes=windowsScopeRoots(policy)
 assert.deepEqual(scopes,[{path:materials,access:'read'},{path:work.toUpperCase(),access:'write'},{path:outputs,access:'read'},{path:tmp,access:'write'},{path:shared.toUpperCase(),access:'write'},{path:read,access:'read'}])
 assert.equal(scopes.length,6);assert.equal(new Set(scopes.map(scope=>scope.path.toUpperCase())).size,6);assert.deepEqual(policy,before)
 const missing={...policy};delete missing.tempRoot;assert.throws(()=>windowsScopeRoots(missing),/Invalid Windows LPAC policy record/)
 assert.throws(()=>windowsScopeRoots({...policy,tempRoot:win32.join(install,'data','cache')}),/trusted standard temporary root/)
 assert.deepEqual(windowsScopeRoots({...policy,tempRoot:policy.tempRoot.toUpperCase()}),scopes)
 for(const field of ['readRoots','writeRoots'])assert.throws(()=>windowsScopeRoots({...policy,[field]:[policy.tempRoot]}),/private installation|another workspace/)
})
const scopedFixtureSid=Buffer.from('010800000000000f0200000001000000020000000300000004000000050000000600000007000000','hex')
const scopedFixtureOther=Buffer.from('010100000000000520000000','hex')
const scopedFixtureOwner=Buffer.from('010100000000000521000000','hex')
const scopedFixtureHostSid='S-1-5-42',scopedFixtureHostBytes=Buffer.from('01010000000000052a000000','hex')
function scopedFixtureAce(sid,mask,flags=0,type=0){const ace=Buffer.alloc(8+sid.length);ace[0]=type;ace[1]=flags;ace.writeUInt16LE(ace.length,2);ace.writeUInt32LE(mask,4);sid.copy(ace,8);return ace}
function scopedFixtureAcl(entries){const header=Buffer.alloc(8);header[0]=2;header.writeUInt16LE(8+entries.reduce((sum,ace)=>sum+ace.length,0),2);header.writeUInt16LE(entries.length,4);return Buffer.concat([header,...entries])}
function scopedFixtureSd(entries,{control=0x8c14,owner=scopedFixtureOwner,group=scopedFixtureOther,sacl=scopedFixtureAcl([scopedFixtureAce(Buffer.from('010100000000001000200000','hex'),1,0,17)])}={}){
 const header=Buffer.alloc(20);header[0]=1;header.writeUInt16LE(control,2);const parts=[header];let offset=20
 for(const [field,part]of [[4,owner],[8,group],[12,sacl],[16,scopedFixtureAcl(entries)]])if(part!==null){header.writeUInt32LE(offset,field);parts.push(part);offset+=part.length}
 return Buffer.concat(parts)
}
function scopedFixtureParts(sd){const parts={control:sd.readUInt16LE(2)};for(const [field,name]of [[4,'owner'],[8,'group'],[12,'sacl'],[16,'dacl']]){const at=sd.readUInt32LE(field);parts[name]=at?Buffer.from(sd.subarray(at,at+(field>=12?sd.readUInt16LE(at+2):8+4*sd[at+1]))):null}return parts}
function scopedFixtureEntries(sd){const acl=scopedFixtureParts(sd).dacl,entries=[];let at=8;for(let n=0;n<acl.readUInt16LE(4);n++){const size=acl.readUInt16LE(at+2);entries.push(Buffer.from(acl.subarray(at,at+size)));at+=size}return entries}
// 仅计算本夹具的普通OI/CI继承，用来刺激冻结规划；不代表Native继承或ACL执行。
function scopedFixtureInherit(parent,child,directory){
 const explicit=scopedFixtureEntries(child).filter(ace=>!(ace[1]&16)),inherited=scopedFixtureEntries(parent).filter(ace=>ace[1]&3).map(ace=>{const copy=Buffer.from(ace);copy[1]=16|(directory?3:0);return copy})
 return scopedFixtureSd([...explicit,...inherited],scopedFixtureParts(child))
}
test('Windows scoped DACL grants preserve original descriptor parts and unrelated ACEs without ACL-control rights',()=>{
 const originalEntries=[scopedFixtureAce(scopedFixtureOther,2,0,1),scopedFixtureAce(scopedFixtureOther,0x1200a9,19)],original=scopedFixtureSd(originalEntries),before=Buffer.from(original),parts=scopedFixtureParts(original)
 for(const access of ['read','write'])for(const directory of [false,true]){
  const {candidate,addedAces}=addScopedFileAccess(original,scopedFixtureSid,access,directory,scopedFixtureHostSid),actual=scopedFixtureParts(candidate),entries=scopedFixtureEntries(candidate)
  for(const name of ['control','owner','group','sacl'])assert.deepEqual(actual[name],parts[name])
  assert.deepEqual(entries,[originalEntries[0],...addedAces,originalEntries[1]])
  assert.deepEqual(addedAces[0].subarray(8),scopedFixtureSid);assert.equal(addedAces[0].readUInt32LE(4),access==='read'?0x1200a9:0x1301bf)
  assert.equal(addedAces[0].readUInt32LE(4)&0xc0000,0);if(access==='read')assert.equal(addedAces[0].readUInt32LE(4)&0xd0156,0)
  assert.equal(addedAces[0][1],directory?3:0);assert.equal(addedAces[1][1],directory?3:0)
  assert.deepEqual(addedAces[1].subarray(8),Buffer.from('010100000000000304000000','hex'));assert.equal(addedAces[1].readUInt32LE(4),0x20000)
  assert.equal(addedAces.length,3);assert.deepEqual(addedAces[2],scopedFixtureAce(scopedFixtureHostBytes,0x60000,directory?3:0))
  assert.notDeepEqual(parts.owner,scopedFixtureHostBytes);assert.deepEqual(candidate.subarray(0,4),original.subarray(0,4))
  assert.deepEqual(candidate,scopedFixtureSd([originalEntries[0],...addedAces,originalEntries[1]],parts))
 }
 assert.deepEqual(original,before)
})
test('Windows scoped DACL cleanup subtracts only attributed copies and refuses insufficient ownership before mutation',()=>{
 const original=scopedFixtureSd([scopedFixtureAce(scopedFixtureOther,0x1200a9,3)]),first=addScopedFileAccess(original,scopedFixtureSid,'write',true,scopedFixtureHostSid),twice=addScopedFileAccess(first.candidate,scopedFixtureSid,'write',true,scopedFixtureHostSid),third=addScopedFileAccess(twice.candidate,scopedFixtureSid,'write',true,scopedFixtureHostSid),before=Buffer.from(third.candidate),deltas=first.addedAces.map(ace=>({ace,copies:2,minimumCopies:3}))
 const cleaned=subtractScopedFileAccess(third.candidate,deltas)
 assert.deepEqual(cleaned,first.candidate);assert.deepEqual(subtractScopedFileAccess(cleaned,first.addedAces.map(ace=>({ace,copies:1,minimumCopies:1}))),original)
 assert.throws(()=>subtractScopedFileAccess(third.candidate,[deltas[0],{...deltas[1],minimumCopies:4}]),/ownership is incomplete/)
 assert.throws(()=>subtractScopedFileAccess(third.candidate,[deltas[0],deltas[1],{...deltas[2],minimumCopies:4}]),/ownership is incomplete/)
 for(const change of [{copies:0},{copies:1.5},{minimumCopies:1}])assert.throws(()=>subtractScopedFileAccess(third.candidate,[{...deltas[0],...change}]),/ownership count/)
 assert.throws(()=>subtractScopedFileAccess(third.candidate,[deltas[0],deltas[0]]),/Duplicate exact scope cleanup delta/)
 assert.deepEqual(third.candidate,before)
 const root=win32.join('C:/','scope'),child=win32.join(root,'child'),leaf=win32.join(child,'leaf'),ownerRights=Buffer.from('010100000000000304000000','hex')
 const nativeHost=scopedFixtureAce(scopedFixtureHostBytes,0x60000,3),native=[scopedFixtureAce(scopedFixtureOther,0x1200a9,3),scopedFixtureAce(ownerRights,0x20000,3),nativeHost,Buffer.from(nativeHost)]
 const nativeOwner=scopedFixtureAce(ownerRights,0x20000,3),boundaryOriginal=scopedFixtureSd([nativeOwner,nativeHost,scopedFixtureAce(scopedFixtureOther,0x1200a9,19),nativeOwner,nativeHost]),boundaryBefore=Buffer.from(boundaryOriginal)
 const boundaryGrant=addScopedFileAccess(boundaryOriginal,scopedFixtureSid,'read',true,scopedFixtureHostSid)
 const boundaryCleaned=subtractScopedFileAccess(boundaryGrant.candidate,boundaryGrant.addedAces.map(ace=>({ace,copies:1,minimumCopies:ace.subarray(8).equals(scopedFixtureSid)?1:3})))
 assert.deepEqual(boundaryCleaned,boundaryOriginal);assert.deepEqual(boundaryOriginal,boundaryBefore)
 const inheritAce=(ace,flags)=>{const copy=Buffer.from(ace);copy[1]=flags;return copy}
 const objects=[scopedFixtureObject({name:root,descriptor:scopedFixtureSd(native)}),scopedFixtureObject({name:child,parent:root,id:2,descriptor:scopedFixtureSd(native.map(ace=>inheritAce(ace,19)))}),scopedFixtureObject({name:leaf,parent:child,id:3,directory:false,descriptor:scopedFixtureSd(native.map(ace=>inheritAce(ace,16)))})]
 const sidB=Buffer.from(scopedFixtureSid);sidB.writeUInt32LE(8,36)
 const a=freezeScopedFileAccessStages(objects,scopedFixtureSid,scopedFixtureInherit,scopedFixtureHostSid),afterA=a.targets.map(target=>({...target,descriptor:target.candidate})),b=freezeScopedFileAccessStages(afterA,sidB,scopedFixtureInherit,scopedFixtureHostSid),afterB=b.targets.map(target=>({...target,descriptor:target.candidate}))
 const history=(seed,plan,sid)=>{
  const first=plan.targets[0],entry=scopedFixtureHistory(seed,{...first,descriptor:first.original},{candidate:first.candidate,label:null});entry.resource.profileSid=entry.privateProof.profileSid=sid
  entry.privateProof.objects=plan.targets.map(target=>({kind:1,role:'scope',name:target.name,fileId:target.id.toString('hex'),directory:target.directory,parent:target.parent,original:target.original.toString('hex'),candidate:target.candidate.toString('hex'),addedAces:target.addedAces.map(ace=>ace.toString('hex')),label:null}))
  return entry
 }
 const A=history('a',a,'S-1-15-2-1-2-3-4-5-6-7'),B=history('b',b,'S-1-15-2-1-2-3-4-5-6-8')
 for(const [first,peer,firstSid,peerSid]of [[A,B,scopedFixtureSid,sidB],[B,A,sidB,scopedFixtureSid]]){
  const release=freezeScopedFileReleaseStages(afterB,[A,B],first.resource.profileName,scopedFixtureInherit,scopedFixtureHostSid)
  assert.equal(release.stages.length,3)
  for(const [depth,target]of release.targets.entries()){
   const entries=scopedFixtureEntries(target.candidate),parts=scopedFixtureParts(target.candidate),original=scopedFixtureParts(target.original)
   assert.equal(entries.some(ace=>ace.subarray(8).equals(firstSid)),false)
   assert.equal(entries.filter(ace=>ace.subarray(8).equals(peerSid)).length,depth+1)
   assert.equal(entries.filter(ace=>ace.subarray(8).equals(scopedFixtureHostBytes)&&ace.readUInt32LE(4)===0x60000).length,2+depth+1)
   assert.equal(entries.filter(ace=>ace.subarray(8).equals(ownerRights)).length,1+depth+1)
   for(const part of ['control','owner','group','sacl'])assert.deepEqual(parts[part],original[part])
   let at=-1
   for(const ace of scopedFixtureEntries(objects[depth].descriptor)){at=entries.findIndex((entry,index)=>index>at&&entry.equals(ace));assert.notEqual(at,-1)}
  }
  const released=structuredClone(first);Object.assign(released.resource,{status:'released',scopeEffects:0,scopeReleased:true,profileAbsent:true})
  const final=freezeScopedFileReleaseStages(release.targets.map(target=>({...target,descriptor:target.candidate})),[released,peer],peer.resource.profileName,scopedFixtureInherit,scopedFixtureHostSid)
  for(let n=0;n<objects.length;n++)assert.deepEqual(final.targets[n].candidate,objects[n].descriptor)
 }
 for(const bit of [0x400,0x100]){
  const unsettled=afterB.map(o=>{const descriptor=Buffer.from(o.descriptor);descriptor.writeUInt16LE(bit===0x400?descriptor.readUInt16LE(2)&~bit:descriptor.readUInt16LE(2)|bit,2);return {...o,descriptor}}),before=unsettled.map(o=>Buffer.from(o.descriptor))
  assert.throws(()=>freezeScopedFileReleaseStages(unsettled,[A,B],A.resource.profileName,()=>assert.fail('Unsettled release must reject before inheritance'),scopedFixtureHostSid),/settled auto-inherited baseline/)
  assert.deepEqual(unsettled.map(o=>o.descriptor),before)
 }
 assert.throws(()=>freezeScopedFileReleaseStages(afterB,[A,B],A.resource.profileName,(p,c,d)=>{const next=scopedFixtureInherit(p,c,d);next.writeUInt16LE(next.readUInt16LE(2)^0x400,2);return next},scopedFixtureHostSid),/cannot reproduce the current scope release baseline/)
 assert.throws(()=>freezeScopedFileReleaseStages(afterB,[],A.resource.profileName,scopedFixtureInherit,scopedFixtureHostSid),/unique active committed ownership/)
 assert.throws(()=>freezeScopedFileReleaseStages(afterB,[A],A.resource.profileName,scopedFixtureInherit,scopedFixtureHostSid),/ownership cannot be reconstructed/)
 for(const extra of [false,true]){
  const changed=afterB.map((o,n)=>n?o:{...o,descriptor:extra?scopedFixtureSd([...scopedFixtureEntries(o.descriptor),nativeHost],scopedFixtureParts(o.descriptor)):subtractScopedFileAccess(o.descriptor,[{ace:a.targets[0].addedAces[2],copies:1,minimumCopies:1}])}),before=changed.map(o=>Buffer.from(o.descriptor))
  assert.throws(()=>freezeScopedFileReleaseStages(changed,[A,B],A.resource.profileName,scopedFixtureInherit,scopedFixtureHostSid),/Scope Host maintenance ownership cannot be reconstructed/)
  assert.deepEqual(changed.map(o=>o.descriptor),before)
 }
 assert.throws(()=>freezeScopedFileReleaseStages(afterB.slice(0,2),[A,B],A.resource.profileName,scopedFixtureInherit,scopedFixtureHostSid),/original scope identity is missing/)
 assert.throws(()=>freezeScopedFileReleaseStages(afterB.map((o,n)=>n?o:{...o,id:Buffer.alloc(24,9)}),[A,B],A.resource.profileName,scopedFixtureInherit,scopedFixtureHostSid),/original scope identity is missing/)
 const drift=afterB.map((o,n)=>n?o:{...o,descriptor:subtractScopedFileAccess(o.descriptor,[{ace:a.targets[0].addedAces[1],copies:1,minimumCopies:1}])})
 assert.throws(()=>freezeScopedFileReleaseStages(drift,[A,B],A.resource.profileName,scopedFixtureInherit,scopedFixtureHostSid),/OWNER_RIGHTS ownership cannot be reconstructed/)
 for(const nativeTemplate of [scopedFixtureAce(ownerRights,0x20000,3),nativeHost]){
  const wrongBaseline=structuredClone(B)
  for(const field of ['original','candidate'])wrongBaseline.privateProof.objects[0][field]=scopedFixtureSd([...scopedFixtureEntries(Buffer.from(wrongBaseline.privateProof.objects[0][field],'hex')),nativeTemplate]).toString('hex')
  assert.throws(()=>freezeScopedFileReleaseStages(afterB,[A,wrongBaseline],A.resource.profileName,scopedFixtureInherit,scopedFixtureHostSid),/consistent original FileID baseline/)
 }
 for(const [mask,flags,sid]of [[0xe0000,3,scopedFixtureHostBytes],[0x60000,0,scopedFixtureHostBytes],[0x60000,3,scopedFixtureOwner]]){
  const bad=structuredClone(A),object=bad.privateProof.objects[0],previous=object.addedAces[2],replacement=scopedFixtureAce(sid,mask,flags),candidate=Buffer.from(object.candidate,'hex'),entries=scopedFixtureEntries(candidate),at=entries.findIndex(ace=>ace.toString('hex')===previous)
  assert.notEqual(at,-1);entries[at]=replacement;object.addedAces[2]=replacement.toString('hex');object.candidate=scopedFixtureSd(entries,scopedFixtureParts(candidate)).toString('hex')
  assert.throws(()=>freezeScopedFileReleaseStages(afterB,[bad,B],A.resource.profileName,scopedFixtureInherit,scopedFixtureHostSid),/unattributed ACE|direct ownership/)
 }
 const legacyObject=scopedFixtureObject(),legacyAdded=[scopedFixtureAce(scopedFixtureSid,0x1301bf,3),scopedFixtureAce(ownerRights,0x20000,3)]
 const legacyCandidate=scopedFixtureSd([...scopedFixtureEntries(legacyObject.descriptor),...legacyAdded],scopedFixtureParts(legacyObject.descriptor))
 const legacyPlan={targets:[{...legacyObject,original:legacyObject.descriptor,candidate:legacyCandidate,addedAces:legacyAdded}]},legacy=history('c',legacyPlan,'S-1-15-2-1-2-3-4-5-6-7'),legacyBefore=structuredClone(legacy)
 const legacyReleased=freezeScopedFileReleaseStages([{...legacyObject,descriptor:legacyCandidate}],[legacy],legacy.resource.profileName,scopedFixtureInherit,scopedFixtureHostSid)
 assert.deepEqual(legacyReleased.targets[0].candidate,legacyObject.descriptor)
 const modernPlan=freezeScopedFileAccessStages([{...legacyObject,descriptor:legacyCandidate}],sidB,scopedFixtureInherit,scopedFixtureHostSid),modern=history('d',modernPlan,'S-1-15-2-1-2-3-4-5-6-8'),mixed=modernPlan.targets.map(target=>({...target,descriptor:target.candidate}))
 for(const [first,peer]of [[legacy,modern],[modern,legacy]]){
  const release=freezeScopedFileReleaseStages(mixed,[legacy,modern],first.resource.profileName,scopedFixtureInherit,scopedFixtureHostSid)
  const candidate=release.targets[0].candidate,entries=scopedFixtureEntries(candidate),native=scopedFixtureEntries(legacyObject.descriptor),peerSid=peer===modern?sidB:scopedFixtureSid,releasedSid=first===modern?sidB:scopedFixtureSid,hostCopies=peer===modern?1:0
  assert.equal(entries.some(ace=>ace.subarray(8).equals(releasedSid)),false)
  assert.equal(entries.filter(ace=>ace.equals(scopedFixtureAce(peerSid,0x1301bf,3))).length,1)
  assert.equal(entries.filter(ace=>ace.equals(scopedFixtureAce(ownerRights,0x20000,3))).length,1)
  assert.equal(entries.filter(ace=>ace.equals(nativeHost)).length,hostCopies);assert.equal(entries.length,native.length+2+hostCopies)
  assert.deepEqual(entries.slice(0,native.length),native);assert.deepEqual(candidate.subarray(0,4),legacyObject.descriptor.subarray(0,4))
  const actual=scopedFixtureParts(candidate),original=scopedFixtureParts(legacyObject.descriptor)
  for(const part of ['control','owner','group','sacl'])assert.deepEqual(actual[part],original[part])
  if(first===modern)assert.deepEqual(candidate,legacyCandidate)
  const released=structuredClone(first);Object.assign(released.resource,{status:'released',scopeEffects:0,scopeReleased:true,profileAbsent:true})
  const final=freezeScopedFileReleaseStages(release.targets.map(target=>({...target,descriptor:target.candidate})),[released,peer],peer.resource.profileName,scopedFixtureInherit,scopedFixtureHostSid)
  assert.deepEqual(final.targets[0].candidate,legacyObject.descriptor)
 }
 assert.deepEqual(legacy,legacyBefore);assert.equal(legacy.privateProof.objects[0].addedAces.length,2)

})
test('Windows scoped inheritance inputs omit SACLs and inherited child ACEs while merge preserves private descriptor parts',()=>{
 const explicit=scopedFixtureAce(scopedFixtureOther,0x1200a9),inherited=scopedFixtureAce(scopedFixtureOther,0x1200a9,19),parent=scopedFixtureSd([scopedFixtureAce(scopedFixtureOther,0x1200a9,3)]),child=scopedFixtureSd([explicit,inherited]),before=Buffer.from(child)
 const inputs=scopedFileInheritanceInputs(parent,child)
 for(const [actual,source]of [[inputs.parent,parent],[inputs.creator,child]]){
  const parts=scopedFixtureParts(actual),original=scopedFixtureParts(source)
  assert.equal(parts.sacl,null);assert.equal(parts.control&0x2a30,0);assert.deepEqual(parts.owner,original.owner);assert.deepEqual(parts.group,original.group)
 }
 assert.deepEqual(scopedFixtureEntries(inputs.creator),[explicit]);assert.equal(scopedFixtureParts(inputs.creator).control&0x500,0)
 const native=scopedFixtureSd([inherited],{control:0x8504,sacl:null}),merged=scopedFixtureParts(mergeScopedFileInheritance(child,native)),original=scopedFixtureParts(child)
 for(const name of ['owner','group','sacl'])assert.deepEqual(merged[name],original[name])
 assert.equal(merged.control,(original.control&~0x1500)|(0x8504&0x1500));assert.deepEqual(scopedFixtureEntries(mergeScopedFileInheritance(child,native)),[inherited])
 for(const change of [{owner:scopedFixtureOther},{group:scopedFixtureOwner}])assert.throws(()=>mergeScopedFileInheritance(child,scopedFixtureSd([inherited],change)),/changed owner\/group/)
 assert.throws(()=>scopedFileInheritanceInputs(parent,scopedFixtureSd([explicit],{control:0x9c14})),/Protected scope DACL/);assert.deepEqual(child,before)
})
test('Windows scoped stage planning freezes computed descendant deltas without rebasing and stops at protected children',()=>{
 const root=win32.join('C:/','scope'),child=win32.join(root,'child'),leaf=win32.join(child,'leaf'),base=scopedFixtureAce(scopedFixtureOther,0x1200a9,3),inherited=Buffer.from(base),fileInherited=Buffer.from(base);inherited[1]=19;fileInherited[1]=16
 const objects=[{kind:1,name:leaf,parent:child,directory:false,access:'read',descriptor:scopedFixtureSd([fileInherited])},{kind:1,name:child,parent:root,directory:true,access:'write',descriptor:scopedFixtureSd([scopedFixtureAce(scopedFixtureOther,2,0,1),inherited])},{kind:1,name:root,parent:null,directory:true,access:'read',descriptor:scopedFixtureSd([base])}],before=objects.map(object=>Buffer.from(object.descriptor))
 const plan=freezeScopedFileAccessStages(objects,scopedFixtureSid,scopedFixtureInherit,scopedFixtureHostSid),[r,c,g]=plan.targets
 assert.deepEqual(plan.targets.map(target=>target.name),[root,child,leaf]);assert.deepEqual(plan.targets.map(target=>target.addedAces.length),[3,6,9]);assert.equal(plan.stages.length,3)
 assert.deepEqual(plan.stages[0].before.get(plan.key(c)),before[1]);assert.deepEqual(plan.stages[1].before.get(plan.key(c)),plan.stages[0].after.get(plan.key(c)));assert.deepEqual(plan.stages[2].before.get(plan.key(g)),plan.stages[1].after.get(plan.key(g)))
 const prior=scopedFixtureEntries(plan.stages[1].before.get(plan.key(c))).filter(ace=>ace.subarray(8).equals(scopedFixtureSid));assert.equal(prior.length,1);assert.equal(prior[0].readUInt32LE(4),0x1200a9)
 assert.deepEqual(plan.stages[0].after.get(plan.key(r)),r.candidate)
 const owners=scopedFixtureEntries(g.candidate).filter(ace=>ace.subarray(8).equals(Buffer.from('010100000000000304000000','hex')));assert.equal(owners.length,3);assert.equal(owners.filter(ace=>ace[1]===16).length,2)
 for(const [depth,target]of plan.targets.entries()){
  const host=scopedFixtureEntries(target.candidate).filter(ace=>ace.subarray(8).equals(scopedFixtureHostBytes))
  assert.equal(host.length,depth+1);assert.equal(host.filter(ace=>!(ace[1]&16)).length,1)
  for(const ace of host){assert.equal(ace.readUInt32LE(4),0x60000);assert.equal(ace[1],ace[1]&16?target.directory?19:16:target.directory?3:0)}
  const original=scopedFixtureParts(target.original),actual=scopedFixtureParts(target.candidate)
  for(const part of ['control','owner','group','sacl'])assert.deepEqual(actual[part],original[part])
 }
 for(let n=0;n<objects.length;n++)assert.deepEqual(objects[n].descriptor,before[n])
 objects[2].descriptor.fill(0);assert.deepEqual(r.original,before[2]);assert.deepEqual(plan.stages[0].before.get(plan.key(r)),before[2])
 const protectedChild={kind:1,name:win32.join(root,'protected'),parent:root,directory:true,access:'read',descriptor:scopedFixtureSd([base],{control:0x9c14})};let inheritedCalls=0
 const protectedPlan=freezeScopedFileAccessStages([{...objects[2],descriptor:before[2]},protectedChild],scopedFixtureSid,()=>{inheritedCalls++;assert.fail('Protected child must not reach inheritance callback')},scopedFixtureHostSid)
 assert.equal(inheritedCalls,0);assert.deepEqual(protectedPlan.stages[0].after.get(protectedPlan.key(protectedChild)),protectedChild.descriptor);assert.equal(protectedPlan.targets[1].addedAces.length,3)
})
test('Windows scoped stage planning rejects unreproducible baselines and propagation that changes unrelated ACEs',()=>{
 const root=win32.join('C:/','scope'),child=win32.join(root,'child'),base=scopedFixtureAce(scopedFixtureOther,0x1200a9,3),inherited=Buffer.from(base);inherited[1]=19
 const hostOther=scopedFixtureAce(scopedFixtureHostBytes,0x1200a9,3),hostInherited=Buffer.from(hostOther);hostInherited[1]=19
 const objects=[{kind:1,name:root,parent:null,directory:true,access:'read',descriptor:scopedFixtureSd([base,hostOther])},{kind:1,name:child,parent:root,directory:true,access:'write',descriptor:scopedFixtureSd([inherited,hostInherited])}],before=objects.map(object=>Buffer.from(object.descriptor))
 assert.throws(()=>freezeScopedFileAccessStages(objects,scopedFixtureSid,(_parent,original)=>scopedFixtureSd([],scopedFixtureParts(original)),scopedFixtureHostSid),/cannot reproduce the original/)
 for(const mutation of ['change','remove'])for(const sid of [scopedFixtureOther,scopedFixtureHostBytes]){
  let calls=0
  assert.throws(()=>freezeScopedFileAccessStages(objects,scopedFixtureSid,(parent,original,directory)=>{
   const calculated=scopedFixtureInherit(parent,original,directory);if(++calls===1)return calculated
   const entries=scopedFixtureEntries(calculated),at=entries.findIndex(ace=>ace.subarray(8).equals(sid))
   assert.notEqual(at,-1);if(mutation==='remove')entries.splice(at,1);else entries[at].writeUInt32LE(2,4)
   return scopedFixtureSd(entries,scopedFixtureParts(calculated))
  },scopedFixtureHostSid),mutation==='change'?/changed an unrelated ACE/:/removed an original ACE/)
  assert.equal(calls,2)
 }
 for(let n=0;n<objects.length;n++)assert.deepEqual(objects[n].descriptor,before[n])
 for(const directory of [false,true])for(const control of [0x8014,0x8814,0x8514,0x8d14]){
  const pair=[scopedFixtureObject({name:root,descriptor:scopedFixtureSd([base],{control})}),scopedFixtureObject({name:child,parent:root,id:2,directory,descriptor:scopedFixtureSd([scopedFixtureAce(scopedFixtureOther,0x1200a9,directory?19:16)],{control})})],before=pair.map(o=>Buffer.from(o.descriptor))
  assert.throws(()=>freezeScopedFileAccessStages(pair,scopedFixtureSid,()=>assert.fail('Unsettled DACL must reject before inheritance'),scopedFixtureHostSid),/settled auto-inherited baseline/)
  assert.deepEqual(pair.map(o=>o.descriptor),before)
 }
 for(const control of [0x8414,0x8c14]){
  const target=scopedFixtureObject({descriptor:scopedFixtureSd([base],{control})}),plan=freezeScopedFileAccessStages([target],scopedFixtureSid,()=>assert.fail('One root has no inherited child'),scopedFixtureHostSid)
  assert.equal(plan.stages.length,1);assert.equal(plan.targets[0].candidate.readUInt16LE(2),control)
 }
 const protectedNode=scopedFixtureObject({name:child,parent:root,id:2,descriptor:scopedFixtureSd([base],{control:0x9814})}),grand=scopedFixtureObject({name:win32.join(child,'leaf'),parent:child,id:3,directory:false,descriptor:scopedFixtureSd([scopedFixtureAce(scopedFixtureOther,0x1200a9,16)])})
 assert.throws(()=>freezeScopedFileAccessStages([objects[0],protectedNode,grand],scopedFixtureSid,()=>assert.fail('Direct protected target still needs a settled DACL'),scopedFixtureHostSid),/settled auto-inherited baseline/)
 const stableProtected={...protectedNode,descriptor:scopedFixtureSd([base],{control:0x9c14})},protectedPlan=freezeScopedFileAccessStages([objects[0],stableProtected,grand],scopedFixtureSid,(p,c,d)=>{assert.equal(c.readUInt16LE(2)&0x1000,0);return scopedFixtureInherit(p,c,d)},scopedFixtureHostSid)
 assert.deepEqual(protectedPlan.stages[0].after.get(protectedPlan.key(stableProtected)),stableProtected.descriptor);assert.notDeepEqual(protectedPlan.stages[1].after.get(protectedPlan.key(grand)),grand.descriptor)
 const outcomes={
  'inherited-drop':['inherited',{explicit:1,inherited:1}],
  'inherited-extra':['inherited',{explicit:1,inherited:3}],
  'explicit-drop':['explicit',{explicit:0,inherited:2}],
  'explicit-extra':['explicit',{explicit:2,inherited:2}],
  'both-extra':['both',{explicit:2,inherited:3}]
 }
 for(const directory of [false,true]){
  const maintenance=scopedFixtureAce(scopedFixtureHostBytes,0x60000,3),childMaintenance=scopedFixtureAce(scopedFixtureHostBytes,0x60000,directory?3:0),inheritedMaintenance=Buffer.from(maintenance);inheritedMaintenance[1]=directory?19:16
  const hostObjects=[scopedFixtureObject({name:root,descriptor:scopedFixtureSd([maintenance])}),scopedFixtureObject({name:child,parent:root,id:2,directory,descriptor:scopedFixtureSd([childMaintenance,inheritedMaintenance])})],hostBefore=hostObjects.map(o=>Buffer.from(o.descriptor))
  for(const [kind,[branch,childAfter]]of Object.entries(outcomes)){
   let calls=0,parentBefore,observed
   assert.throws(()=>freezeScopedFileAccessStages(hostObjects,scopedFixtureSid,(parent,original,directory)=>{
    const calculated=scopedFixtureInherit(parent,original,directory);if(++calls===1){parentBefore=Buffer.from(parent);return calculated}
    const entries=scopedFixtureEntries(calculated)
    for(const inherited of kind==='both-extra'?[false,true]:[kind.startsWith('inherited')]){
     const at=entries.findIndex(ace=>ace.subarray(8).equals(scopedFixtureHostBytes)&&Boolean(ace[1]&16)===inherited)
     assert.notEqual(at,-1);if(kind.endsWith('drop'))entries.splice(at,1);else entries.push(Buffer.from(entries[at]))
    }
    const next=scopedFixtureSd(entries,scopedFixtureParts(calculated))
    observed={parentBefore:parentBefore.toString('hex'),parentAfter:parent.toString('hex'),childBefore:original.toString('hex'),childAfter:next.toString('hex')}
    return next
   },scopedFixtureHostSid),error=>{
    assert.equal(error.name,'Error');assert.equal(error.code,undefined);assert.equal(error.message,'Native scope inheritance changed Host maintenance ownership')
    assert.deepEqual(error.cause,{kind:'scope-host-inheritance',directory,branch,inheritedChange:1,counts:{parentBefore:{explicit:1,inherited:0},parentAfter:{explicit:2,inherited:0},childBefore:{explicit:1,inherited:1},childAfter},descriptors:observed})
    assert.deepEqual(Object.getOwnPropertyDescriptor(error,'cause'),{value:error.cause,writable:true,enumerable:false,configurable:true})
    assert.equal(JSON.stringify(error),'{}');assert.deepEqual(Object.keys(error),[])
    for(const value of [error.message,String(error),JSON.stringify({name:error.name,message:error.message}),JSON.stringify(error)])for(const descriptor of Object.values(observed))assert.equal(value.includes(descriptor),false)
    return true
   })
   assert.equal(calls,2);assert.deepEqual(hostObjects.map(o=>o.descriptor),hostBefore)
  }
 }
 for(const control of [0x8014,0x8514])assert.throws(()=>freezeOwnedPackageWriteStages([scopedFixtureObject({descriptor:scopedFixtureSd([base],{control})})],scopedFixtureSid,()=>assert.fail('Guard must precede package mask mapping')),/settled auto-inherited baseline/)

})
function scopedFixtureLabel(level,flags=0,mask=1){const sid=Buffer.from('010100000000001000000000','hex');sid.writeUInt32LE(level,8);return scopedFixtureAcl([scopedFixtureAce(sid,mask,flags,17)])}
function scopedFixtureObject({descriptor=scopedFixtureSd([scopedFixtureAce(scopedFixtureOther,0x1200a9,3)]),id=1,name=win32.join('C:/','scope'),parent=null,directory=true,access='write'}={}){return {kind:1,name,parent,directory,access,id:Buffer.alloc(24,id),descriptor}}
function scopedFixtureHistory(seed,object,planned,{released=false}={}){
 const profileName='nightbot-'+seed.repeat(32),profileSid='S-1-15-2-1-2-3-4-5-6-7'
 return {owner:'fixture-owner-'+seed,jobId:'fixture-job-'+seed,entryId:'fixture-entry-'+seed,resource:{kind:'windows-lpac',version:1,status:released?'released':'planned',profileName,profileSid,scopeCount:1,scopeEffects:released?0:1,retainedHandles:0,retainedAllocations:0,preparationPending:false,threadRestored:true,childSettled:true,jobEmpty:true,nativeHandlesClosed:true,scopeReleased:released,profileAbsent:released},privateProof:{kind:'windows-lpac-private-proof',version:1,profileName,profileSid,scopeCount:1,phase:'scope-frozen',profile:{moniker:'00',classesLink:'00',registryRoot:null},roots:[{path:object.name,fileId:object.id.toString('hex'),access:object.access}],objects:[{kind:1,role:'scope',name:object.name,fileId:object.id.toString('hex'),directory:object.directory,parent:object.parent,original:object.descriptor.toString('hex'),candidate:planned.candidate.toString('hex'),addedAces:[],label:structuredClone(planned.label)}]}}
}
// 只计算本夹具单条ML的脚本继承；不证明Native控制位、有效权限或生产Low准入。
function scopedFixtureLabelInherit(parent,child,directory){
 const p=scopedFixtureParts(parent),c=scopedFixtureParts(child),facts=scopedLabelFacts(c.sacl)
 let sacl=c.sacl
 if(facts===null||facts.flags&16){const source=scopedLabelFacts(p.sacl);sacl=source&&(source.flags&(directory?2:1))?scopedFixtureLabel(source.level,directory?19:16,source.mask):null}
 return scopedFixtureSd(scopedFixtureEntries(child),{...c,sacl})
}
test('Windows scoped Low labels preserve native Low Untrusted and readonly descriptors while lowering only write labels',()=>{
 for(const level of [0,4096])for(const flags of [0,3]){
  const object=scopedFixtureObject({descriptor:scopedFixtureSd([scopedFixtureAce(scopedFixtureOther,2,0,1)],{sacl:scopedFixtureLabel(level,flags,7)})}),before=Buffer.from(object.descriptor),[planned]=planScopedFileLabels([object],[],'nightbot-'+ 'c'.repeat(32))
  assert.equal(planned.labelChanged,false);assert.equal(planned.label.borrowedFrom,null);assert.deepEqual(planned.candidate,before);assert.deepEqual(object.descriptor,before)
 }
 for(const sacl of [null,scopedFixtureLabel(8192,3,5)]){
  const descriptor=scopedFixtureSd([scopedFixtureAce(scopedFixtureOther,0x1200a9,3)],{sacl,control:sacl===null?0x8c04:0x8c14}),object=scopedFixtureObject({descriptor}),[write]=planScopedFileLabels([object],[],'nightbot-'+'a'.repeat(32)),[read]=planScopedFileLabels([{...object,access:'read'}],[],'nightbot-'+'a'.repeat(32)),original=scopedFixtureParts(descriptor),actual=scopedFixtureParts(write.candidate)
  assert.deepEqual(scopedLabelFacts(write.labelAcl),{level:4096,mask:sacl===null?1:5,flags:3});assert.equal(write.labelChanged,true)
  for(const field of ['owner','group','dacl'])assert.deepEqual(actual[field],original[field]);assert.equal(actual.control&~0x30,original.control&~0x30)
  assert.equal(read.label,null);assert.deepEqual(read.candidate,descriptor)
 }
 for(const acl of [scopedFixtureAcl([scopedFixtureAce(scopedFixtureOther,1,0,17)]),scopedFixtureLabel(4096,8),scopedFixtureLabel(4096,0,8)])assert.throws(()=>scopedLabelFacts(acl),/Unsupported exact scope mandatory label/)
})
test('Windows scoped Low shared release retains active borrowers then restores the original label through a released source',()=>{
 for(const sacl of [null,scopedFixtureLabel(8192,3)]){
  const object=scopedFixtureObject({descriptor:scopedFixtureSd([scopedFixtureAce(scopedFixtureOther,0x1200a9,3)],{sacl,control:sacl===null?0x8c04:0x8c14})}),[a]=planScopedFileLabels([object],[],'nightbot-'+'a'.repeat(32)),A=scopedFixtureHistory('a',object,a),live={...object,descriptor:a.candidate},[b]=planScopedFileLabels([live],[A],'nightbot-'+'b'.repeat(32)),B=scopedFixtureHistory('b',live,b)
  assert.deepEqual(b.label.borrowedFrom,{owner:A.owner,jobId:A.jobId,entryId:A.entryId,fileId:object.id.toString('hex')});assert.equal(b.labelChanged,false)
  const [firstRelease]=planScopedFileLabelRelease([live],[A,B],A.resource.profileName);assert.equal(firstRelease.labelChanged,false);assert.deepEqual(firstRelease.candidate,a.candidate)
  const releasedA=scopedFixtureHistory('a',object,a,{released:true}),[lastRelease]=planScopedFileLabelRelease([live],[releasedA,B],B.resource.profileName)
  assert.equal(lastRelease.labelChanged,true);assert.deepEqual(lastRelease.candidate,object.descriptor)
  assert.throws(()=>planScopedFileLabels([live],[A,B],A.resource.profileName),/cannot be replayed/)
  const releasedB=scopedFixtureHistory('b',live,b,{released:true});assert.throws(()=>planScopedFileLabelRelease([live],[releasedA,releasedB],B.resource.profileName),/cannot be replayed/)
 }
})
test('Windows scoped Low origin rejects missing anchors wrong FileID cycles drift conflicts and unproven inherited new identities',()=>{
 const object=scopedFixtureObject(),[a]=planScopedFileLabels([object],[],'nightbot-'+'a'.repeat(32)),A=scopedFixtureHistory('a',object,a),live={...object,descriptor:a.candidate},[b]=planScopedFileLabels([live],[A],'nightbot-'+'b'.repeat(32)),B=scopedFixtureHistory('b',live,b),profile='nightbot-'+'c'.repeat(32)
 assert.throws(()=>planScopedFileLabels([live],[B],profile),/Borrowed scope label does not bind its source/)
 const wrong=structuredClone(B);wrong.privateProof.objects[0].label.borrowedFrom.fileId='02'.repeat(24);assert.throws(()=>planScopedFileLabels([live],[A,wrong],profile),/Borrowed scope label does not bind its source/)
 assert.throws(()=>planScopedFileLabels([object],[A,B],profile),/differs from the observed FileID label/)
 const [native]=planScopedFileLabels([live],[],profile),C=scopedFixtureHistory('c',live,native)
 assert.throws(()=>planScopedFileLabels([live],[A,C],'nightbot-'+'d'.repeat(32)),/Conflicting committed scope label origins/)
 assert.throws(()=>planScopedFileLabelRelease([live],[A,C],A.resource.profileName),/conflicting origin/)
 const cycleA=scopedFixtureHistory('a',live,native),cycleB=scopedFixtureHistory('b',live,native),ref=e=>({owner:e.owner,jobId:e.jobId,entryId:e.entryId,fileId:object.id.toString('hex')})
 cycleA.privateProof.objects[0].label.borrowedFrom=ref(cycleB);cycleB.privateProof.objects[0].label.borrowedFrom=ref(cycleA)
 assert.throws(()=>planScopedFileLabels([live],[cycleA,cycleB],profile),/Cyclic scope label origin/)
 const inherited=scopedFixtureObject({id:2,name:win32.join(object.name,'new-child'),parent:object.name,descriptor:scopedFixtureSd([scopedFixtureAce(scopedFixtureOther,0x1200a9,19)],{sacl:scopedFixtureLabel(4096,19)})})
 assert.throws(()=>planScopedFileLabels([inherited],[A],profile),/Inherited Low label lacks an exact same-FileID origin/)
})
test('Windows scoped Low read borrowers retain NRU NXU labels until the final reader exits',()=>{
 for(const mask of [2,4,3,7]){
  const object=scopedFixtureObject({descriptor:scopedFixtureSd([scopedFixtureAce(scopedFixtureOther,0x1200a9,3)],{sacl:scopedFixtureLabel(8192,3,mask)})}),[a]=planScopedFileLabels([object],[],'nightbot-'+'a'.repeat(32)),A=scopedFixtureHistory('a',object,a),read={...object,access:'read',descriptor:a.candidate},[b]=planScopedFileLabels([read],[A],'nightbot-'+'b'.repeat(32)),B=scopedFixtureHistory('b',read,b)
  assert.deepEqual(b.label.borrowedFrom,{owner:A.owner,jobId:A.jobId,entryId:A.entryId,fileId:object.id.toString('hex')});assert.equal(b.labelChanged,false);assert.deepEqual(scopedLabelFacts(b.labelAcl),{level:4096,mask,flags:3})
  const [first]=planScopedFileLabelRelease([read],[A,B],A.resource.profileName);assert.equal(first.labelChanged,false);assert.deepEqual(first.candidate,a.candidate)
  const releasedA=scopedFixtureHistory('a',object,a,{released:true}),[last]=planScopedFileLabelRelease([read],[releasedA,B],B.resource.profileName);assert.equal(last.labelChanged,true);assert.deepEqual(last.candidate,object.descriptor)
  const child=scopedFixtureObject({access:'read',id:2,name:win32.join(object.name,'new-read-child'),parent:object.name,descriptor:scopedFixtureSd([scopedFixtureAce(scopedFixtureOther,0x1200a9,19)],{sacl:scopedFixtureLabel(4096,19,mask)})})
  assert.throws(()=>planScopedFileLabels([child],[A],'nightbot-'+'c'.repeat(32)),/Inherited Low label lacks an exact same-FileID origin/)
  const [heldChild]=planScopedFileLabelRelease([child],[A,B],A.resource.profileName);assert.equal(heldChild.allowInheritedLabelPropagation,false);assert.deepEqual(heldChild.candidate,child.descriptor)
 }
 for(const [level,mask]of [[4096,1],[8192,7]]){
  const object=scopedFixtureObject({access:'read',descriptor:scopedFixtureSd([],{sacl:scopedFixtureLabel(level,3,mask)})}),[planned]=planScopedFileLabels([object],[],'nightbot-'+'c'.repeat(32));assert.equal(planned.label,null);assert.deepEqual(planned.candidate,object.descriptor)
 }
})
test('Windows scoped Low inheritance strips only inherited labels and preserves DACL owner group during merge',()=>{
 const parent=scopedFixtureSd([scopedFixtureAce(scopedFixtureOther,0x1200a9,3)],{sacl:scopedFixtureLabel(8192,3)}),child=scopedFixtureSd([scopedFixtureAce(scopedFixtureOther,2,0,1)],{sacl:scopedFixtureLabel(8192,19)}),inputs=scopedFileLabelInheritanceInputs(parent,child),original=scopedFixtureParts(child),creator=scopedFixtureParts(inputs.creator)
 assert.deepEqual(inputs.parent,parent);assert.equal(creator.sacl,null);assert.equal(creator.control&0xa30,0)
 for(const key of ['owner','group','dacl'])assert.deepEqual(creator[key],original[key])
 const explicit=scopedFixtureSd([],{sacl:scopedFixtureLabel(8192,3)});assert.deepEqual(scopedFixtureParts(scopedFileLabelInheritanceInputs(parent,explicit).creator).sacl,scopedFixtureParts(explicit).sacl)
 const native=scopedFixtureSd([],{sacl:scopedFixtureLabel(4096,19),control:0x8a14}),merged=scopedFixtureParts(mergeScopedFileLabelInheritance(child,native))
 for(const key of ['owner','group','dacl'])assert.deepEqual(merged[key],original[key]);assert.deepEqual(merged.sacl,scopedFixtureParts(native).sacl);assert.equal(merged.control,(original.control&~0x2a30)|(0x8a14&0x2a30))
 for(const change of [{owner:scopedFixtureOther},{group:scopedFixtureOwner}])assert.throws(()=>mergeScopedFileLabelInheritance(child,scopedFixtureSd([],change)),/changed owner\/group/)
 assert.throws(()=>scopedFileLabelInheritanceInputs(parent,scopedFixtureSd([],{control:0xac14})),/Protected scope label/)
})
test('Windows scoped Low stages freeze label propagation and reject nonlabel changes protected inheritance and unreproducible controls',()=>{
 const root=win32.join('C:/','scope'),child=win32.join(root,'child'),objects=[scopedFixtureObject({name:root,descriptor:scopedFixtureSd([scopedFixtureAce(scopedFixtureOther,0x1200a9,3)],{sacl:scopedFixtureLabel(8192,3)})}),scopedFixtureObject({name:child,parent:root,id:2,descriptor:scopedFixtureSd([scopedFixtureAce(scopedFixtureOther,0x1200a9,19)],{sacl:scopedFixtureLabel(8192,19)})})],before=objects.map(o=>Buffer.from(o.descriptor)),labels=planScopedFileLabels(objects,[],'nightbot-'+'a'.repeat(32)),plan=freezeScopedFileLabelStages(labels.toReversed(),scopedFixtureLabelInherit)
 assert.equal(plan.stages.length,2);assert.ok(plan.stages.every(stage=>stage.component==='label'));assert.deepEqual(plan.targets.map(t=>t.name),[root,child]);assert.deepEqual(plan.stages[1].before.get(plan.key(labels[1])),plan.stages[0].after.get(plan.key(labels[1])))
 for(let n=0;n<objects.length;n++){assert.deepEqual(scopedFixtureParts(plan.targets[n].candidate).dacl,scopedFixtureParts(before[n]).dacl);assert.deepEqual(scopedFixtureParts(plan.targets[n].candidate).sacl,labels[n].labelAcl);assert.deepEqual(objects[n].descriptor,before[n])}
 let calls=0
 assert.throws(()=>freezeScopedFileLabelStages(labels,(p,c,d)=>{const calculated=scopedFixtureLabelInherit(p,c,d);if(++calls===1)return calculated;return scopedFixtureSd([],{...scopedFixtureParts(calculated)})}),/changed non-label security/);assert.equal(calls,2)
 assert.throws(()=>freezeScopedFileLabelStages(labels,(p,c,d)=>{const calculated=scopedFixtureLabelInherit(p,c,d);calculated.writeUInt16LE(calculated.readUInt16LE(2)^0x800,2);return calculated}),/cannot reproduce the original exact scope label/)
 const protectedChild={...objects[1],access:'read',descriptor:scopedFixtureSd([],{control:0xac14,sacl:scopedFixtureLabel(8192,3)})},protectedLabels=planScopedFileLabels([objects[0],protectedChild],[],'nightbot-'+'a'.repeat(32))
 const protectedPlan=freezeScopedFileLabelStages(protectedLabels,()=>assert.fail('Protected label must not inherit'));assert.equal(protectedPlan.stages.length,1);assert.deepEqual(protectedPlan.targets[1].candidate,protectedChild.descriptor)
 const mismatched=labels.map((o,n)=>n?{...o,labelChanged:false,labelAcl:scopedFixtureLabel(8192,19)}:o)
 assert.throws(()=>freezeScopedFileLabelStages(mismatched,scopedFixtureLabelInherit),/differs from its committed source plan/)
 for(const directory of [false,true])for(const control of [0x8004,0x8404,0x8a04,0x8e04]){
  const pair=[scopedFixtureObject({name:root,descriptor:scopedFixtureSd([],{control,sacl:null})}),scopedFixtureObject({name:child,parent:root,id:2,directory,descriptor:scopedFixtureSd([],{control,sacl:null})})],labels=planScopedFileLabels(pair,[],'nightbot-'+'a'.repeat(32)),before=pair.map(o=>Buffer.from(o.descriptor))
  assert.throws(()=>freezeScopedFileLabelStages(labels,()=>assert.fail('Unsettled label must reject before inheritance')),/settled auto-inherited baseline/)
  assert.deepEqual(pair.map(o=>o.descriptor),before)
 }
 for(const control of [0x8804,0x8c04]){
  const target=scopedFixtureObject({descriptor:scopedFixtureSd([],{control,sacl:null})}),labels=planScopedFileLabels([target],[],'nightbot-'+'a'.repeat(32))
  assert.throws(()=>freezeScopedFileLabelStages(labels,()=>assert.fail('One root has no inherited label')),/cannot restore an absent SACL baseline/)
  const history=scopedFixtureHistory('a',target,labels[0]),release=planScopedFileLabelRelease([{...target,descriptor:labels[0].candidate}],[history],history.resource.profileName)
  assert.throws(()=>freezeScopedFileLabelStages(release,()=>assert.fail('One root has no inherited label')),/cannot restore an absent SACL baseline/)
  assert.equal(target.descriptor.readUInt16LE(2),control)
 }
 // 无继承标记的显式根不向 NULL 子项传播；降为可继承 Low 后子项才真实改变。
 const nonInheriting={...objects[0],descriptor:scopedFixtureSd([],{sacl:scopedFixtureLabel(8192,0)})},nullChild={...objects[1],access:'read',descriptor:scopedFixtureSd([],{control:0x8c04,sacl:null})},nullLabels=planScopedFileLabels([nonInheriting,nullChild],[],'nightbot-'+'a'.repeat(32))
 let inheritedCalls=0
 assert.throws(()=>freezeScopedFileLabelStages(nullLabels,(p,c,d)=>{inheritedCalls++;return scopedFixtureLabelInherit(p,c,d)}),/cannot restore an absent SACL baseline/);assert.equal(inheritedCalls,2)
 let controlCalls=0
 assert.throws(()=>freezeScopedFileLabelStages(nullLabels,(p,c,d)=>{const next=scopedFixtureLabelInherit(p,c,d);if(++controlCalls===1)return next;return scopedFixtureSd(scopedFixtureEntries(c),{...scopedFixtureParts(c),control:c.readUInt16LE(2)^0x10,sacl:null})}),/cannot restore an absent SACL baseline/);assert.equal(controlCalls,2)
 for(const branch of [scopedFixtureObject({name:win32.join('C:/','unrelated'),id:3,access:'read',descriptor:scopedFixtureSd([],{control:0x8c04,sacl:null})}),{...nullChild,descriptor:scopedFixtureSd([],{control:0xac04,sacl:null})}]){
  const untouched=freezeScopedFileLabelStages(planScopedFileLabels([objects[0],branch],[],'nightbot-'+'a'.repeat(32)),()=>assert.fail('Unrelated or protected NULL branch must not inherit'))
  assert.equal(untouched.stages.length,1);assert.deepEqual(untouched.targets.find(target=>target.name===branch.name).candidate,branch.descriptor)
 }
 const readonlyNull={...nullChild,parent:null},unchanged=freezeScopedFileLabelStages(planScopedFileLabels([readonlyNull],[],'nightbot-'+'a'.repeat(32)),()=>assert.fail('Unchanged NULL root has no inheritance'))
 assert.equal(unchanged.stages.length,0);assert.deepEqual(unchanged.targets[0].candidate,readonlyNull.descriptor)
 const [explicit]=planScopedFileLabels([objects[0]],[],'nightbot-'+'a'.repeat(32)),explicitPlan=freezeScopedFileLabelStages([explicit],()=>assert.fail('One explicit root has no inherited label')),explicitHistory=scopedFixtureHistory('a',objects[0],explicit),explicitRelease=planScopedFileLabelRelease([{...objects[0],descriptor:explicitPlan.targets[0].candidate}],[explicitHistory],explicitHistory.resource.profileName),restored=freezeScopedFileLabelStages(explicitRelease,()=>assert.fail('One explicit root has no inherited label'))
 assert.equal(explicitPlan.stages.length,1);assert.equal(restored.stages.length,1);assert.deepEqual(restored.targets[0].candidate,objects[0].descriptor)
 const protectedWrite={...objects[1],descriptor:scopedFixtureSd([],{control:0xac14,sacl:scopedFixtureLabel(8192,3)})},grand=scopedFixtureObject({name:win32.join(child,'leaf'),parent:child,id:3,directory:false,descriptor:scopedFixtureSd([],{sacl:scopedFixtureLabel(8192,16)})}),protectedWriteLabels=planScopedFileLabels([objects[0],protectedWrite,grand],[],'nightbot-'+'a'.repeat(32)),descendants=freezeScopedFileLabelStages(protectedWriteLabels,(p,c,d)=>{assert.equal(c.readUInt16LE(2)&0x2000,0);return scopedFixtureLabelInherit(p,c,d)})
 assert.deepEqual(descendants.stages[0].after.get(descendants.key(protectedWrite)),protectedWrite.descriptor);assert.notDeepEqual(descendants.stages[1].after.get(descendants.key(grand)),grand.descriptor)
})

test('Windows LPAC rejects async and generator preparation before any native API access',()=>{
 const forbiddenApi=new Proxy({}, {get(){assert.fail('Native API must not be touched before synchronous preparation validation')}})
 for(const prepareBeforeResume of [undefined,async()=>{},function*(){},async function*(){}]){
  assert.throws(()=>spawnLpacJobProcess(forbiddenApi,{prepareBeforeResume}),/synchronous non-generator/)
 }
})
test('Windows owned ACL candidate refuses inherit-only OWNER RIGHTS without mutating the source',()=>{
 const sid=Buffer.from('010100000000000304000000','hex'),ace=Buffer.alloc(8+sid.length),acl=Buffer.alloc(8+ace.length)
 ace[1]=8;ace.writeUInt16LE(ace.length,2);ace.writeUInt32LE(0x20000,4);sid.copy(ace,8)
 acl[0]=2;acl.writeUInt16LE(acl.length,2);acl.writeUInt16LE(1,4);ace.copy(acl,8)
 const before=Buffer.from(acl)
 assert.throws(()=>subtractOwnedPackageWrites(acl,Buffer.from('010100000000000520000000','hex'),1,mask=>mask),/INHERIT_ONLY OWNER_RIGHTS/)
 assert.deepEqual(acl,before)
})

test('Windows custom runners refuse both confined modes before wrapper or capability grants',async t=>{
 const p=fixture(t,NativeSandbox,{runnerCommand:['operator','prefix'],runnerFailureSignatures:['custom-fatal: ']})
 p.internals={platform:'win32'};p.windowsArgv=()=>assert.fail('No Windows wrapper may be constructed');p.grant=()=>assert.fail('No capability grant may be acquired')
 for(const mode of ['read-only','workspace-write'])await assert.rejects(p.confine(['literal-program'],{...policy,mode}),error=>error.code==='SANDBOX_UNAVAILABLE'&&/Custom Windows runners/.test(error.message))
 assert.equal(p.workspaceGrants.size,0);assert.equal(p.temps.size,0)
})
test('Windows privacy recognises TASKS casing through real installation paths and POSIX stays case sensitive',async t=>{
 const root=mkdtempSync(join(tmpdir(),'night-lpac-case-')),data=join(root,'data'),workspaces=join(data,'workspaces'),upper=join(workspaces,'TASKS','one'),work=join(upper,'work')
 t.after(()=>rmSync(root,{recursive:true,force:true}));mkdirSync(work,{recursive:true})
 const paths={mode:'portable',installRoot:root,data,temp:join(data,'temp'),workspaces,state:join(data,'state'),memory:join(data,'memory'),credentials:join(data,'secrets','credentials.json'),attachmentsHome:join(data,'workspaces','channel'),cache:join(data,'cache'),logs:join(data,'logs'),spills:join(data,'cache','spills')}
 await assert.rejects(createPrivacy({...paths,temp:undefined}),{code:'NIGHT_PROCESS_TEMP_ROOT_UNAVAILABLE'})
 const privacy=await createPrivacy(paths);assert.equal(privacy.tempRoot,paths.temp);assert.ok(privacy.roots.includes(paths.temp));assert.equal(privacy.denied(join(paths.temp,'other-job','output')),true)
 t.after(()=>privacy.spills.close())
 assert.equal(privacy.taskRoot(join(workspaces,'tasks','two','work')),join(workspaces,'tasks','two'))
 if(process.platform==='win32'){
  assert.equal(privacy.taskRoot(work),upper);assert.equal(privacy.denied(join(upper,'sessions','journal.jsonl')),true)
  const prepared=windowsPrivateProcessSpec({argv:['fixture-program'],cwd:work},privacy,upper)
  assert.equal(windowsLaunchPolicy(prepared).taskRoot,upper);assert.deepEqual(windowsLaunchPolicy(prepared).writeRoots,[work,join(upper,'tmp')])
 }else assert.equal(privacy.taskRoot(work),undefined)
})

test('ConPTY dimensions reject invalid signed SHORT values before native API access',()=>{
 const forbiddenApi=new Proxy({}, {get(){assert.fail('Invalid dimensions must not reach native bindings')}})
 for(const [cols,rows] of [[0,25],[-1,25],[1.5,25],[80,32768],[undefined,25]]){
  assert.throws(()=>createPseudoConsole(forbiddenApi,{input:1n,output:2n,cols,rows}),/positive signed SHORT integers/)
 }
})

for(const failureKind of ['return-zero','throw'])test('Windows LPAC job configuration '+failureKind+' retains the exact allocated handle without native child creation',()=>{
 const job=0x12345678n,calls=[],configurationFailure=new Error('scripted Job configuration failure')
 const methods={
  createJobObjectW(...args){calls.push('allocate');assert.deepEqual(args,[null,null]);return job},
  setInformationJobObject(handle,kind,buffer,bytes){calls.push('configure');assert.equal(handle,job);assert.equal(kind,9);assert.equal(bytes,144);assert.equal(buffer.readUInt32LE(16),0x2000);if(failureKind==='throw')throw configurationFailure;return 0},
  getLastError(){calls.push('error');return 5},
  formatMessageW(){calls.push('format');return 0},
 }
 const api=new Proxy(methods,{get(target,name){assert.ok(Object.hasOwn(target,name),'Unexpected native API access: '+String(name));return target[name]}})
 const options={prepareBeforeResume(){assert.fail('Preparation must not run after Job configuration failure')},get stdio(){assert.fail('Target carrier must not be read before Job configuration succeeds')}}
 assert.throws(()=>spawnLpacJobProcess(api,options),error=>{
  assert.ok(error instanceof AggregateError);assert.equal(error.code,'WINDOWS_LPAC_OWNERSHIP_RETAINED');assert.equal(error.payloadResumed,false)
  assert.equal(error.nativeOwnership.job,job);assert.equal(error.nativeOwnership.jobConfigured,false);assert.equal(error.nativeOwnership.childCreated,false);assert.equal(error.nativeOwnership.preparationReleased,true)
  assert.equal(error.nativeOwnership.assigned,false);assert.equal(error.nativeOwnership.process,null);assert.equal(error.nativeOwnership.initialThread,null);assert.equal(error.nativeOwnership.childSettled,true);assert.equal(error.nativeOwnership.jobEmpty,true)
  if(failureKind==='throw')assert.equal(error.errors[0],configurationFailure)
  return true
 })
 assert.deepEqual(calls,failureKind==='throw'?['allocate','configure']:['allocate','configure','error','format'])
})
