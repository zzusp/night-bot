import {execFileSync,spawn} from 'node:child_process'
import {readFileSync,writeFileSync,existsSync,lstatSync,createReadStream} from 'node:fs'
import {createHash} from 'node:crypto'
import {resolve} from 'node:path'
const mode=process.argv[2]
if(process.argv.length!==3||!['--check','--run'].includes(mode))throw Error('EXPECTED_CHECK_OR_RUN')
const root='docs/tmp/'
const tag='night-bot:sg11-linux-six-current'
const archive='https://mirrors.tuna.tsinghua.edu.cn/debian'
const security='https://mirrors.tuna.tsinghua.edu.cn/debian-security'
const sha=b=>createHash('sha256').update(b).digest('hex')
const dockerfile=readFileSync('Dockerfile')
if(sha(dockerfile)!=='fe541e3b02f34ede0fa157ebff229652b878b588647a45038ca2d9ada5ac753c')throw Error('DOCKERFILE_CHANGED_AFTER_HANDOFF')
for(const [path,expected] of [['.dockerignore','81a1fb8db365d2dcefb53976b04e749210ea5b586e49c4b9d1b3b54490d89268'],['scripts/docker-entrypoint.sh','def816be0b4bbf669a8a9178000355fd98527bd1e7ac2213e404089d79b8f8ad'],['docs/ops/docker-bwrap-seccomp.json','9264f1689d786e212fcfc1dc63eed5d08a2be4c236a252d5676f43f40691201f']])if(sha(readFileSync(path))!==expected)throw Error('FIXED_BUILD_OR_POLICY_INPUT_CHANGED:'+path)
for(const target of [archive,security]){
 const u=new URL(target)
 if(u.protocol!=='https:'||u.username||u.password||u.search||u.hash)throw Error('INVALID_PUBLIC_MIRROR')
}
const evidence=readFileSync('docs/acceptance/resident-conversation-routing/round-11/docker-official-mirrors-corrected.log','utf8').trim().split('\n').map(line=>JSON.parse(line))
if(!evidence.some(row=>row.comparisonPassed===true&&row.usableMirror==='mirrors.tuna.tsinghua.edu.cn'))throw Error('PREVIOUS_MIRROR_PROOF_MISSING')
const daemon=JSON.parse(execFileSync('docker',['info','--format','{{json .}}'],{encoding:'utf8',stdio:['ignore','pipe','pipe']}))
if(daemon.OSType!=='linux'||!['x86_64','amd64'].includes(daemon.Architecture))throw Error('EXPECTED_LINUX_AMD64')
try{execFileSync('docker',['image','inspect',tag],{stdio:['ignore','ignore','pipe']});throw Error('OWNED_BUILD_TAG_ALREADY_EXISTS')}catch(error){if(error.message==='OWNED_BUILD_TAG_ALREADY_EXISTS')throw error;if(!String(error.stderr).includes('No such image'))throw Error('IMAGE_EXISTENCE_CHECK_FAILED')}
const names=['sg11-linux-six-build-source-map.json','sg11-linux-six-build.log','sg11-linux-six-build-result.json','sg11-linux-six-current.iid']
for(const name of names)if(existsSync(root+name))throw Error('BUILD_EVIDENCE_ALREADY_EXISTS:'+name)
const env={...process.env},redactions=[],proxyArgs=[]
for(const name of ['HTTP_PROXY','HTTPS_PROXY']){
 const key=name==='HTTP_PROXY'?'HTTPProxy':'HTTPSProxy'
 const parse=value=>{try{const u=new URL(value);return ['http:','https:'].includes(u.protocol)?u:null}catch{return null}}
 const u=parse(daemon[key]??daemon[name==='HTTP_PROXY'?'HttpProxy':'HttpsProxy'])??parse(process.env[name])
 if(!u||u.username||u.password)throw Error('EXPECTED_CREDENTIAL_FREE_EXISTING_PROXY')
 redactions.push(u.href)
 if(u.hostname==='localhost'||u.hostname==='[::1]'||u.hostname.startsWith('127.'))u.hostname='host.docker.internal'
 for(const key of [name,name.toLowerCase()])proxyArgs.push('--build-arg',key+'='+u.href)
 redactions.push(u.href)
}
const sealed=JSON.parse(readFileSync(root+'sg11-linux-six-sealed-source.json','utf8')),before=sealed.sourceFiles,context=sealed.contextPath;if(sha(Object.entries(before).map(([name,hash])=>name+' '+hash+String.fromCharCode(10)).join(''))!==sealed.sourceMapSha256||sealed.sourceChangedWhileSealing.length)throw Error('SEALED_INPUT_CHANGED')
const args=['build','--platform','linux/amd64','--progress','plain','--build-arg','DEBIAN_ARCHIVE_URL='+archive,'--build-arg','DEBIAN_SECURITY_URL='+security,...proxyArgs,'--iidfile',resolve(root+'sg11-linux-six-current.iid'),'--tag',tag,'.']
console.log(JSON.stringify({mode,effects:mode==='--check'?0:undefined,tag,archive,security,sourceCount:Object.keys(before).length,existingCredentialFreeProxy:true,proxyValuesLogged:false,strictTls:true,aptSignatureAndDigestChecks:true,appSandboxUnchanged:true,daemonMutation:false,cliEnvironmentUnchanged:true}))
if(mode==='--check')process.exit(0)
const startedAt=new Date().toISOString()
writeFileSync(root+names[0],JSON.stringify({head:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),dirtyWorkingTree:true,tag,startedAt,driverSha256:sha(readFileSync(import.meta.filename)),publicBuildArgs:{DEBIAN_ARCHIVE_URL:archive,DEBIAN_SECURITY_URL:security},proxy:'existing credential-free proxy; values not recorded',sourceFiles:before,sourceMapSha256:sealed.sourceMapSha256,scope:'Exact sealed directory inputs; current working tree may change after sealing; Docker applies the same .dockerignore'},null,2)+'\n',{flag:'wx'})
const stage='docs/tmp/sg11-linux-six-build-context';for(const [name,hash]of Object.entries(before))if(sha(readFileSync(stage+'/'+name))!==hash)throw Error('STAGED_SOURCE_CHANGED:'+name);const child=spawn('docker',args,{env,cwd:resolve(stage),stdio:['ignore','pipe','pipe']})
let log='',spawnFailure=false
const consume=chunk=>log+=chunk
child.stdout.setEncoding('utf8');child.stderr.setEncoding('utf8');child.stdout.on('data',consume);child.stderr.on('data',consume)
const exit=await new Promise(resolve=>{child.once('error',()=>{spawnFailure=true;resolve(null)});child.once('close',resolve)})
for(const value of [...new Set(redactions)].sort((a,b)=>b.length-a.length))log=log.split(value).join('[existing-proxy]')
writeFileSync(root+names[1],log,{flag:'wx'})
const changed=Object.keys(before).filter(name=>sha(readFileSync(stage+'/'+name))!==before[name])
let image=null
if(exit===0)image=JSON.parse(execFileSync('docker',['image','inspect','--format','{{json .}}',tag],{encoding:'utf8',stdio:['ignore','pipe','pipe']}))
const result={sourceMapSha256:sealed.sourceMapSha256,sourceBoundToSealedDirectory:true,exit,spawnFailure,startedAt,finishedAt:new Date().toISOString(),tag,sourceChanged:changed,sourceCount:Object.keys(before).length,logSha256:sha(Buffer.from(log)),image:image?{id:image.Id,os:image.Os,architecture:image.Architecture,user:image.Config.User}:null,realVendorExecuted:false,applicationRuntimeValidated:false}
writeFileSync(root+names[2],JSON.stringify(result,null,2)+'\n',{flag:'wx'})
console.log(JSON.stringify(result))
process.exitCode=changed.length?3:exit??1
