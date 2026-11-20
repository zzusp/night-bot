import assert from 'node:assert/strict'
import {execFile,spawn} from 'node:child_process'
import {once} from 'node:events'
import {symlink} from 'node:fs/promises'
import {join} from 'node:path'
import {fileURLToPath} from 'node:url'
import {promisify} from 'node:util'
import {Readable} from 'node:stream'
import {pipeline} from 'node:stream/promises'

export async function unpackArchivedRouterCheckout(ref,code){
 const repo=fileURLToPath(new URL('../../',import.meta.url)),win=process.platform==='win32',legacyLink='packages/dingtalk-dsh-assistant'
 // Windows tar 无法还原这些归档中的旧目录链接；仅在历史夹具中恢复等价 junction。
 const archive=['archive',ref,...(win?['--','.',`:(exclude)${legacyLink}`]:[])]
 const {stdout}=await promisify(execFile)('git',archive,{cwd:repo,encoding:'buffer',maxBuffer:64*1024*1024})
 const tar=spawn('tar',['-xf','-'],{cwd:code,stdio:['pipe','inherit','inherit']})
 const [[status]]=await Promise.all([once(tar,'close'),pipeline(Readable.from([stdout]),tar.stdin)])
 assert.equal(status,0)
 if(win)await symlink(join(code,'packages/dingtalk-core'),join(code,legacyLink),'junction')
 await symlink(join(repo,'node_modules'),join(code,'node_modules'),win?'junction':'dir')
}

// A historical checkout must not share the current Host's named native FFI types.
export async function runArchivedRouterTest(t,moduleUrl){
 const env={...process.env};delete env.NODE_TEST_CONTEXT
 try{
  const {stdout}=await promisify(execFile)(process.execPath,['--test-reporter=tap',fileURLToPath(moduleUrl),'--archived-baseline'],{signal:t.signal,env})
  return stdout
 }catch(error){t.diagnostic(error.stdout??'');throw error}
}
