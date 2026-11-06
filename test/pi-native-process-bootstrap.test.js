import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,writeFileSync,readFileSync,symlinkSync,unlinkSync,chmodSync,linkSync,existsSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {execFile} from 'node:child_process'
import {promisify} from 'node:util'
import {createLinuxLaunchFiles as create,consumeLinuxLaunchRequest as consume,cleanupLinuxLaunchFiles as cleanup,readLinuxStartupError as readError} from '../src/process/linux-launch.js'
import {replaceLinuxTarget} from '../src/process/linux-bootstrap.js'
import {o as environment,l as invocation} from '../src/process/runner-launch-B2zsQ1Dz.js'
const fixture = t => {const files=create({cwd:process.cwd(),env:{}});t.after(()=>cleanup(files));return files}

test('owned Linux request is one-shot and rejects unexpected environment/transport fields',{skip:process.platform!=='linux'?'Requires Linux private /proc/self/fd transport and POSIX permissions':false},t=>{
  const files=fixture(t)
  assert.deepEqual(consume(files.requestPath),{cwd:process.cwd(),env:{}})
  assert.throws(()=>consume(files.requestPath),{code:'ENOENT'})
  for(const request of [{cwd:'/',env:{'BAD=KEY':'x'}},{cwd:'/',env:{a:'\0'}},{cwd:'/',env:{},control:'ipc'},{cwd:'/',env:{},extra:true}]) assert.throws(()=>create(request),/invalid Linux launch request/)
})
test('owned Linux request rejects symlink, hardlink and permissive files without consuming targets',{skip:process.platform!=='linux'?'Requires Linux private /proc/self/fd transport and POSIX permissions':false},t=>{
  const root=mkdtempSync(join(tmpdir(),'night-bootstrap-test-'));t.after(()=>rmSync(root,{recursive:true,force:true}))
  const target=join(root,'target');writeFileSync(target,'private',{mode:0o600})
  for(const kind of ['symlink','hardlink','permissions']) {
    const files=fixture(t);unlinkSync(files.requestPath)
    if(kind==='symlink')symlinkSync(target,files.requestPath)
    else if(kind==='hardlink')linkSync(target,files.requestPath)
    else writeFileSync(files.requestPath,'{}',{mode:0o644})
    assert.throws(()=>consume(files.requestPath))
    assert.equal(readFileSync(target,'utf8'),'private')
    cleanup(files)
  }
})
test('owned Linux transport refuses replaced directory and malformed startup errors',{skip:process.platform!=='linux'?'Requires Linux private /proc/self/fd transport and POSIX permissions':false},t=>{
  const files=fixture(t)
  chmodSync(files.directory,0o755);assert.throws(()=>consume(files.requestPath),/unsafe/);chmodSync(files.directory,0o700)
  writeFileSync(files.startupErrorPath,JSON.stringify({type:'error',error:{name:'Error',message:'x',authority:true}}),{mode:0o600})
  assert.throws(()=>readError(files.startupErrorPath),/invalid/)
  unlinkSync(files.startupErrorPath);symlinkSync(files.requestPath,files.startupErrorPath)
  assert.throws(()=>readError(files.startupErrorPath))
})
test('owned Linux PATH search preserves original argv and denies before not-found; ENOEXEC uses literal shell argv',()=>{
  const calls=[];const request={cwd:'/work',env:{PATH:':relative:/last'},control:'pipe'}
  assert.throws(()=>replaceLinuxTarget(['literal','a b','$(no)'],request,(...args)=>{calls.push(args);throw Object.assign(new Error('denied'),{code:calls.length===1?'EACCES':'ENOENT'})}),{code:'EACCES'})
  assert.deepEqual(calls.map(call=>call[0]),['/work/literal','/work/relative/literal','/last/literal'])
  assert.deepEqual(calls[0].slice(1),[['literal','a b','$(no)'],request.env,'pipe'])
  calls.length=0
  replaceLinuxTarget(['/script','a b'],request,(...args)=>{calls.push(args);if(calls.length===1)throw Object.assign(new Error('format'),{code:'ENOEXEC'})})
  assert.deepEqual(calls[1],['/bin/sh',['/bin/sh','/script','a b'],request.env,'pipe'])
})
test('real Linux bootstrap isolates target NODE_OPTIONS until exec and preserves exact argv',async t=>{
  if(process.platform!=='linux')return t.skip('Linux only')
  const files=create({cwd:process.cwd(),env:{NODE_OPTIONS:'--no-warnings',LITERAL:'$(never)'}});t.after(()=>cleanup(files))
  const prefix=invocation();const env=environment(files.requestPath,prefix)
  assert.equal(env.NODE_OPTIONS,undefined)
  const result=await promisify(execFile)(prefix[0],[...prefix.slice(1),'--',process.execPath,'-e','process.stdout.write(JSON.stringify({argv:process.argv.slice(1),env:process.env}))','--','a b','$(literal)',''],{env,timeout:10000})
  assert.deepEqual(JSON.parse(result.stdout),{argv:['a b','$(literal)',''],env:{NODE_OPTIONS:'--no-warnings',LITERAL:'$(never)'}})
  assert.equal(existsSync(files.requestPath),false)
})

test('owned Linux group lifetime keeps uncertain observation live after direct exit and shares drain',async()=>{
  const {createLinuxGroupOwner}=await import('../src/process/linux-owner.js')
  const direct=Promise.withResolvers();let mode='unknown',live=true,polls=0;const signals=[]
  const owner=createLinuxGroupOwner({pid:123,direct:direct.promise,probe(){if(mode==='unknown')throw Object.assign(new Error('unreadable'),{code:'EIO'});if(mode==='gone')throw Object.assign(new Error('gone'),{code:'ESRCH'})},hasLiveMembers:()=>live,signal:value=>signals.push(value),poll:async()=>{polls++;await new Promise(resolve=>setImmediate(resolve))}})
  direct.resolve({exitCode:0});await direct.promise
  owner.signal('SIGTERM');assert.deepEqual(signals,['SIGTERM'])
  const first=owner.waitForExit();assert.equal(owner.waitForExit(),first)
  await new Promise(resolve=>setImmediate(resolve));assert.ok(polls>0)
  mode='present';live=false;await first
  owner.signal('SIGKILL');owner.terminateForHostExit();assert.deepEqual(signals,['SIGTERM'])
})

test('real Linux bootstrap keeps optional PTC control transport on descriptor seven',async t=>{
  if(process.platform!=='linux')return t.skip('Linux only')
  const {spawn}=await import('node:child_process')
  const {once}=await import('node:events')
  const files=create({cwd:process.cwd(),env:{DSH_SUBPROCESS_CONTROL:'pipe'},control:'pipe'});t.after(()=>cleanup(files))
  const prefix=invocation()
  const child=spawn(prefix[0],[...prefix.slice(1),'--',process.execPath,'--input-type=module','-e',`import {openInheritedControlChannel} from ${JSON.stringify(new URL('../src/process/control.js',import.meta.url).href)};const channel=openInheritedControlChannel();channel.end('fd-seven-proof');`],{env:environment(files.requestPath,prefix),stdio:['ignore','ignore','pipe','ignore','ignore','ignore','ignore','pipe']})
  let output='';child.stdio[7].on('data',chunk=>output+=chunk);let stderr='';child.stderr.on('data',chunk=>stderr+=chunk)
  const [code]=await once(child,'close')
  assert.equal(code,0,stderr);assert.equal(output,'fd-seven-proof')
})
test('real Linux bootstrap records startup failure and never restores private selector to target',async t=>{
  if(process.platform!=='linux')return t.skip('Linux only')
  const files=fixture(t),prefix=invocation()
  await assert.rejects(promisify(execFile)(prefix[0],[...prefix.slice(1),'--','/night-bot-test-absent-executable'],{env:environment(files.requestPath,prefix),timeout:10000}),{code:127})
  assert.equal(readError(files.startupErrorPath).error.code,'ENOENT')
  assert.equal(existsSync(files.requestPath),false)
})

test('owned Linux owner suppresses signals and rejects drain when leader pid is reused',async()=>{
  const {createLinuxGroupOwner}=await import('../src/process/linux-owner.js')
  let identity='start-one';const signals=[]
  const owner=createLinuxGroupOwner({pid:123,direct:Promise.resolve(),identity:()=>identity,probe(){},hasLiveMembers:()=>false,signal:value=>signals.push(value)})
  identity='start-two'
  owner.signal('SIGTERM');owner.terminateForHostExit()
  assert.deepEqual(signals,[])
  await assert.rejects(owner.waitForExit(),{code:'NIGHT_PROCESS_OWNERSHIP_LOST'})
})
test('owned Linux owner treats unknown leader identity and throwing group observation as live',async()=>{
  const {createLinuxGroupOwner}=await import('../src/process/linux-owner.js')
  let readable=true,release=false;const signals=[]
  const owner=createLinuxGroupOwner({pid:123,direct:Promise.resolve(),identity:()=>readable?'original':undefined,probe(){if(release)throw Object.assign(new Error('gone'),{code:'ESRCH'})},hasLiveMembers(){throw new Error('unreadable proc')},signal:value=>signals.push(value),poll:()=>new Promise(resolve=>setImmediate(resolve))})
  readable=false;await Promise.resolve();owner.signal('SIGTERM');const wait=owner.waitForExit()
  assert.equal(await Promise.race([wait.then(()=>true),new Promise(resolve=>setImmediate(()=>resolve(false)))]),false)
  release=true;await wait;assert.deepEqual(signals,['SIGTERM'])
})
test('owned Linux request and startup error reject FIFO without blocking',{skip:process.platform!=='linux'?'Requires Linux private /proc/self/fd transport and POSIX permissions':false},async t=>{
  if(process.platform!=='linux')return t.skip('Linux only')
  const {execFileSync}=await import('node:child_process')
  for(const kind of ['request','error']) {
    const files=fixture(t),path=kind==='request'?files.requestPath:files.startupErrorPath
    if(kind==='request')unlinkSync(path)
    execFileSync('mkfifo',['-m','600',path])
    assert.throws(()=>kind==='request'?consume(path):readError(path),/unsafe/)
  }
})
test('owned Linux transport rejects inode replacement after open and cleanup refuses replaced directory',{skip:process.platform!=='linux'?'Requires Linux private /proc/self/fd transport and POSIX permissions':false},async t=>{
  const fs=await import('node:fs'),{syncBuiltinESMExports}=await import('node:module')
  let changed=false
  const original=fs.default.readSync
  const files=fixture(t)
  fs.default.readSync=function(fd,...args){const result=original(fd,...args);if(typeof fd==='number' && !changed){changed=true;unlinkSync(files.requestPath);writeFileSync(files.requestPath,'{}',{mode:0o600})}return result}
  syncBuiltinESMExports()
  try {assert.throws(()=>consume(files.requestPath),/changed while reading|unsafe private Linux launch entry/)}
  finally {fs.default.readSync=original;syncBuiltinESMExports()}
  const moved=`${files.directory}-moved`
  fs.renameSync(files.directory,moved);fs.mkdirSync(files.directory,{mode:0o700});writeFileSync(files.requestPath,'replacement',{mode:0o600})
  t.after(()=>{rmSync(moved,{recursive:true,force:true});rmSync(files.directory,{recursive:true,force:true})})
  cleanup(files);assert.equal(readFileSync(files.requestPath,'utf8'),'replacement')
})
test('target stdout cannot forge a private bootstrap startup result',async t=>{
  if(process.platform!=='linux')return t.skip('Linux only')
  const files=fixture(t),prefix=invocation(),forgery={type:'error',error:{name:'Error',message:'forged receipt',code:'EACCES'}}
  const result=await promisify(execFile)(prefix[0],[...prefix.slice(1),'--',process.execPath,'-e',`process.stdout.write(${JSON.stringify(JSON.stringify(forgery))})`],{env:environment(files.requestPath,prefix),timeout:10000})
  assert.deepEqual(JSON.parse(result.stdout),forgery)
  assert.equal(readError(files.startupErrorPath),undefined)
})

test('owned Linux error transport rejects hardlinks and post-open replacement',{skip:process.platform!=='linux'?'Requires Linux private /proc/self/fd transport and POSIX permissions':false},async t=>{
  const fs=await import('node:fs'),{syncBuiltinESMExports}=await import('node:module')
  const files=fixture(t)
  linkSync(files.requestPath,files.startupErrorPath)
  assert.throws(()=>readError(files.startupErrorPath),/unsafe/)
  unlinkSync(files.startupErrorPath)
  const record=JSON.stringify({type:'error',error:{name:'Error',message:'private startup error'}})
  writeFileSync(files.startupErrorPath,record,{mode:0o600})
  let changed=false
  const original=fs.default.readSync
  fs.default.readSync=function(fd,...args){const result=original(fd,...args);if(typeof fd==='number' && !changed){changed=true;unlinkSync(files.startupErrorPath);writeFileSync(files.startupErrorPath,record,{mode:0o600})}return result}
  syncBuiltinESMExports()
  try {assert.throws(()=>readError(files.startupErrorPath),/changed while reading|unsafe private Linux launch entry/)}
  finally {fs.default.readSync=original;syncBuiltinESMExports()}
})
test('owned Linux request read stays anchored when its directory is replaced during read',{skip:process.platform!=='linux'?'Requires Linux private /proc/self/fd transport and POSIX permissions':false},async t=>{
  const fs=await import('node:fs'),{syncBuiltinESMExports}=await import('node:module')
  let changed=false
  const files=fixture(t),moved=`${files.directory}-moved`,original=fs.default.readSync
  t.after(()=>{rmSync(moved,{recursive:true,force:true});rmSync(files.directory,{recursive:true,force:true})})
  fs.default.readSync=function(fd,...args){const result=original(fd,...args);if(typeof fd==='number' && !changed){changed=true;fs.renameSync(files.directory,moved);fs.mkdirSync(files.directory,{mode:0o700});writeFileSync(files.requestPath,'replacement',{mode:0o600})}return result}
  syncBuiltinESMExports()
  try {assert.throws(()=>consume(files.requestPath),/directory changed during operation/)}
  finally {fs.default.readSync=original;syncBuiltinESMExports()}
  assert.equal(readFileSync(files.requestPath,'utf8'),'replacement')
  assert.equal(existsSync(join(moved,'launch-request.json')),false)
})

test('owned Linux reads are bounded to observed size plus EOF probe when files grow',{skip:process.platform!=='linux'?'Requires Linux private /proc/self/fd transport and POSIX permissions':false},async t=>{
  const fs=await import('node:fs'),{syncBuiltinESMExports}=await import('node:module')
  for(const kind of ['request','error']) {
    const files=fixture(t),path=kind==='request'?files.requestPath:files.startupErrorPath
    if(kind==='error')writeFileSync(path,JSON.stringify({type:'error',error:{name:'Error',message:'private'}}),{mode:0o600})
    const size=fs.statSync(path).size,original=fs.default.readSync
    let changed=false,requested=0
    fs.default.readSync=function(fd,buffer,offset,length,position){requested+=length;const result=original(fd,buffer,offset,length,position);if(!changed){changed=true;fs.truncateSync(path,16*1024*1024)}return result}
    syncBuiltinESMExports()
    try {assert.throws(()=>kind==='request'?consume(path):readError(path),/grew while reading/)}
    finally {fs.default.readSync=original;syncBuiltinESMExports()}
    assert.ok(requested<=size+1,`read requested ${requested}, original ${size}`)
  }
})
test('owned Linux request and startup error reject malformed UTF-8 without replacement decoding',{skip:process.platform!=='linux'?'Requires Linux private /proc/self/fd transport and POSIX permissions':false},t=>{
  for(const kind of ['request','error']) {
    const files=fixture(t),path=kind==='request'?files.requestPath:files.startupErrorPath
    const [prefix,suffix]=kind==='request'?['{"cwd":"/","env":{"VALUE":"','"}}']:['{"type":"error","error":{"name":"Error","message":"','"}}']
    writeFileSync(path,Buffer.concat([Buffer.from(prefix),Buffer.from([0xc3,0x28]),Buffer.from(suffix)]),{mode:0o600})
    assert.throws(()=>kind==='request'?consume(path):readError(path),{code:'ERR_ENCODING_INVALID_ENCODED_DATA'})
  }
})
test('owned Linux read loop handles short reads and preserves valid UTF-8 environment exactly',{skip:process.platform!=='linux'?'Requires Linux private /proc/self/fd transport and POSIX permissions':false},async t=>{
  const fs=await import('node:fs'),{syncBuiltinESMExports}=await import('node:module')
  const value={cwd:process.cwd(),env:{UNICODE:'你好🌙',LITERAL:'a\nb'}}
  const files=create(value);t.after(()=>cleanup(files))
  const original=fs.default.readSync
  fs.default.readSync=function(fd,buffer,offset,length,position){return original(fd,buffer,offset,Math.min(length,3),position)}
  syncBuiltinESMExports()
  try {assert.deepEqual(consume(files.requestPath),value)}
  finally {fs.default.readSync=original;syncBuiltinESMExports()}
})
test('owned Linux transport rejects same-size modification metadata during a read',{skip:process.platform!=='linux'?'Requires Linux private /proc/self/fd transport and POSIX permissions':false},async t=>{
  const fs=await import('node:fs'),{syncBuiltinESMExports}=await import('node:module')
  const files=fixture(t),original=fs.default.readSync
  let changed=false
  fs.default.readSync=function(...args){const result=original(...args);if(!changed){changed=true;fs.utimesSync(files.requestPath,new Date(),new Date(Date.now()+10000))}return result}
  syncBuiltinESMExports()
  try {assert.throws(()=>consume(files.requestPath),/changed while reading/)}
  finally {fs.default.readSync=original;syncBuiltinESMExports()}
})
