import {watch} from 'chokidar'
import {join,isAbsolute} from 'node:path'
import {homedir} from 'node:os'
import {readRegular,failure} from '../../runtime/files.js'

/** 只观察官方 profile 登录元数据，不读取 token 或把普通查询当成重新登录。 */
export async function observeDwsLogin(environment,{onLogin,onError,platform=process.platform}={}){
  const home=(platform==='win32'?environment.USERPROFILE:environment.HOME)??homedir()
  const directory=environment.DWS_CONFIG_DIR??join(home,'.dws')
  if(!isAbsolute(directory))throw failure('DINGTALK_AUTH_OBSERVATION_PATH_INVALID')
  const file=join(directory,'profiles.json')
  const fingerprint=async()=>{
    const text=await readRegular(file)
    if(text===undefined)return '[]'
    let value;try{value=JSON.parse(text)}catch{throw failure('DINGTALK_AUTH_METADATA_INVALID')}
    if(!value||value.profiles!==undefined&&!Array.isArray(value.profiles))throw failure('DINGTALK_AUTH_METADATA_INVALID')
    return JSON.stringify((value.profiles??[]).map(row=>[row.corpId,row.userId,row.lastLoginAt]).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b))))
  }
  let previous=await fingerprint(),closed=false,tail=Promise.resolve()
  const refresh=()=>{tail=tail.then(async()=>{if(closed)return;const next=await fingerprint();if(next===previous)return;previous=next;await onLogin()}).catch(()=>onError(failure('DINGTALK_AUTH_OBSERVATION_FAILED')))}
  const watcher=watch(file,{ignoreInitial:true,persistent:false,followSymlinks:false,awaitWriteFinish:{stabilityThreshold:100,pollInterval:10}})
  watcher.on('all',refresh);watcher.on('ready',refresh)
  watcher.on('error',()=>onError(failure('DINGTALK_AUTH_OBSERVATION_FAILED')))
  return async()=>{closed=true;await watcher.close();await tail}
}
