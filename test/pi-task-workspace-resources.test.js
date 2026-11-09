import test, {mock, after} from 'node:test'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import {resolve, join} from 'node:path'

// 与高层替身分文件隔离：此处保留真实创建原语、资源管理、指针解码和关闭代码。
// 只替换 FFI 绑定与内存读写；在首个文件打开前停止，不创建目录、不加载 addon/DLL。
let current
const addresses=new WeakMap()
let nextAddress=0x10000n
const decode=buffer=>buffer.readBigUInt64LE()
decode.string16=()=> 'S-1-5-21-1234'
const ffi={pointer:type=>({type}),struct:name=>({size:{NightBot_COORD:4,NightBot_STARTUPINFOEXW:112,NightBot_STARTUPINFOW:104,NightBot_PROCESS_INFORMATION:24}[name]}),decode,
  address(buffer){if(!addresses.has(buffer))addresses.set(buffer,nextAddress+=0x1000n);return addresses.get(buffer)},
  load(name){current.libraries.push(name);return {mockedLibrary:name}},
}
const contracts=await import('../src/process/contracts.js')
mock.module(new URL('../src/process/contracts.js',import.meta.url),{cache:true,namedExports:{...contracts,
  createLazyRequire(specifier,parent){return specifier==='koffi'?()=>ffi:contracts.createLazyRequire(specifier,parent)},
}})
const win32=await import('../src/process/win32.js')
const call=name=>(...args)=>{
  current.calls.push({name,args})
  const fn=current.api[name]
  assert.equal(typeof fn,'function','Unexpected FFI operation: '+name)
  return fn(...args)
}
const base={getLastError:()=>current.lastError,closeHandle:call('CloseHandle')}
mock.module(new URL('../src/process/win32.js',import.meta.url),{cache:true,namedExports:{...win32,
  extendWin32ProcessBindings(create){return {...base,...create({kernel32:{},advapi32:{},bind:(_library,name)=>call(name)})}},
  loadWin32ConptyBindings:()=>base,
}})
const {createPrivateTaskWorkDirectories}=await import('../src/process/windows-acl.js')
const require=createRequire(import.meta.url)
after(()=>assert.equal(Object.keys(require.cache).some(path=>path.endsWith('koffi.node')),false))
const windows={skip:process.platform!=='win32'}
const paths={work:join(resolve('data/workspaces/tasks/resource-contract-only'),'work'),tmp:join(resolve('data/workspaces/tasks/resource-contract-only'),'tmp')}
function fixture({freeFailure=false,closeFailure=false,conversionFailure}={}){
  const stop=new Error('Stop before filesystem effects'),conversionError=new Error('Conversion failed after nonnull out')
  const state={stop,conversionError,calls:[],libraries:[],lastError:0,api:{
    GetSystemDirectoryW(buffer){const value=resolve('data/ffi-system/System32');buffer.write(value,'utf16le');return value.length},
    GetCurrentThread:()=>-2n,
    OpenThreadToken(){state.lastError=1008;return 0},
    OpenProcess:()=>101n,
    GetProcessId:()=>process.pid,
    OpenProcessToken(_process,_access,out){out.writeBigUInt64LE(102n);return 1},
    GetTokenInformation(_token,_kind,buffer,_capacity,size){
      size.writeUInt32LE(24)
      if(!buffer){state.lastError=122;return 0}
      buffer.writeBigUInt64LE(ffi.address(buffer)+8n);buffer[8]=1;buffer[9]=1
      return 1
    },
    IsValidSid:()=>1,
    ConvertSidToStringSidW(_sid,out){out.writeBigUInt64LE(400n);if(conversionFailure==='throw')throw conversionError;if(conversionFailure==='status'){state.lastError=5;return 0}return 1},
    LocalFree:()=>freeFailure?400n:0n,
    CloseHandle(handle){if(closeFailure&&handle===102n){state.lastError=6;return 0}return 1},
    CreateFileW(){throw stop},
  }}
  current=state
  return state
}
const calls=(state,name)=>state.calls.filter(row=>row.name===name)
const contains=(error,expected)=>error===expected||error?.errors?.some(child=>contains(child,expected))===true
function failure(){try{createPrivateTaskWorkDirectories(paths)}catch(error){return error}assert.fail('This boundary must not publish ready')}

test('Windows task directory resources: successful LocalFree allows a later allocation at the same address',windows,()=>{
  const f=fixture(),error=failure()
  assert.equal(error,f.stop)
  assert.equal(calls(f,'ConvertSidToStringSidW').length,2)
  assert.deepEqual(calls(f,'LocalFree').map(row=>row.args[0]),[400n,400n])
  assert.deepEqual(calls(f,'CloseHandle').map(row=>row.args[0]),[102n,101n])
  assert.deepEqual(error.nativeResources,{handles:{acquired:2,closed:2,retained:0},local:{acquired:2,closed:2,retained:0}})
  assert.deepEqual(error.nativeOwnership,{handles:[],allocations:[]})
  assert.equal(calls(f,'CreateFileW').length,1)
})

for(const mode of ['status','throw'])test('Windows task directory resources: nonnull out is owned and freed once before propagating conversion '+mode+' failure',windows,()=>{
  const f=fixture({conversionFailure:mode}),error=failure()
  if(mode==='throw')assert.equal(error,f.conversionError)
  else{assert.equal(error.api,'ConvertSidToStringSidW');assert.equal(error.win32Code,5)}
  assert.equal(calls(f,'ConvertSidToStringSidW').length,1)
  assert.deepEqual(calls(f,'LocalFree').map(row=>row.args[0]),[400n])
  assert.equal(calls(f,'CreateFileW').length,0)
  assert.deepEqual(error.nativeResources.local,{acquired:1,closed:1,retained:0})
  assert.deepEqual(error.nativeResources.handles,{acquired:2,closed:2,retained:0})
})

test('Windows task directory resources: failed LocalFree retains its attempted allocation and forbids further allocation or retry',windows,()=>{
  const f=fixture({freeFailure:true}),error=failure()
  assert.equal(calls(f,'ConvertSidToStringSidW').length,1)
  assert.deepEqual(calls(f,'LocalFree').map(row=>row.args[0]),[400n])
  assert.equal(calls(f,'CreateFileW').length,0)
  assert.deepEqual(error.nativeResources.local,{acquired:1,closed:0,retained:1})
  assert.deepEqual(error.nativeResources.handles,{acquired:2,closed:2,retained:0})
  assert.deepEqual(error.nativeOwnership.allocations,[{pointer:400n,attempted:true,closed:false}])
  assert.deepEqual(error.nativeOwnership.handles,[])
})

test('Windows task directory resources: one failed CloseHandle preserves original failure and retained ownership without retrying either handle',windows,()=>{
  const f=fixture({closeFailure:true}),error=failure()
  assert.ok(contains(error,f.stop))
  assert.deepEqual(calls(f,'CloseHandle').map(row=>row.args[0]),[102n,101n])
  assert.deepEqual(error.nativeResources.handles,{acquired:2,closed:1,retained:1})
  assert.deepEqual(error.nativeResources.local,{acquired:2,closed:2,retained:0})
  assert.deepEqual(error.nativeOwnership.handles,[{handle:102n,attempted:true,closed:false}])
  assert.deepEqual(error.nativeOwnership.allocations,[])
})
