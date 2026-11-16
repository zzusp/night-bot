import {readFile} from 'node:fs/promises'
import {dirname,isAbsolute} from 'node:path'
const version=JSON.parse(await readFile(new URL('../../../package.json',import.meta.url),'utf8')).version
const pathValue=value=>typeof value==='string'&&isAbsolute(value)?value:null
// Only allowlisted directory metadata. Never read files, environment values or credentials.
export async function deploymentView(paths,getInventory){
 const inventory=await getInventory?.(),p=inventory?.paths??paths
 const directories=[['install','安装',p.installRoot],['config','配置',p.config],['data','数据',p.data],['workspaces','工作区',p.workspaces],['memory','记忆',p.memory],['logs','日志',p.logs],['temp','临时',p.temp],['workLogs','工作日志',p.workLogs],['credentials','凭据目录',pathValue(p.credentials)?dirname(p.credentials):p.secrets]].map(([id,label,path])=>({id,label,path:pathValue(path)}))
 const skillDirectories=Array.isArray(inventory?.skillDirectories)?inventory.skillDirectories.filter(row=>['bundled','custom'].includes(row.kind)&&pathValue(row.path)).map(row=>({kind:row.kind,path:row.path})):null
 return {version:typeof version==='string'?version:null,runtime:`Node.js ${process.versions.node} · ${process.platform} / ${process.arch}`,mode:['portable','legacy'].includes(p.mode)?p.mode:null,pathScope:'instance',directories,skillDirectories}
}
