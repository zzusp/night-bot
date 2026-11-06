import {stampAuditPathBindings,readAuditPathBindings} from './pi-business-path-bindings.js'
import {relative,resolve,sep} from 'node:path'
import {inside} from './paths.js'
import {failure} from './files.js'
/** Typed application paths and explicitly marked standing-business paths only.
 * User text, commands, Pi messages/signatures and effect arguments stay opaque. */
export function portablePaths(paths){
  if(paths.mode!=='portable')return undefined
  const encode=path=>{
    if(typeof path!=='string'||!inside(paths.workspaces,resolve(path)))throw failure('NIGHT_WORK_OUTSIDE_INSTALL_ROOT')
    return relative(paths.installRoot,path).split(sep).join('/')
  }
  const decode=value=>{
    if(typeof value!=='string'||value.includes('\\')||value.split('/').some(p=>p==='..'||p==='.')||value.startsWith('/'))throw failure('NIGHT_PORTABLE_PATH_INVALID')
    const path=resolve(paths.installRoot,value);if(!inside(paths.workspaces,path))throw failure('NIGHT_PORTABLE_PATH_INVALID');return path
  }
  return {encode,decode,
    auditReceipt:receipt=>stampAuditPathBindings(receipt,{originRoot:paths.installRoot,encode}),
    readAuditReceipt:(receipt,context)=>readAuditPathBindings(receipt,{decode,...context}),
    header:header=>({...header,...header.cwd!==undefined?{portableCwd:encode(header.cwd)}:{}}),
    readHeader:header=>{const {portableCwd,...rest}=header;return {...rest,...portableCwd!==undefined?{cwd:decode(portableCwd)}:{}}},
    event:event=>event.type==='working-directory/change'?{...event,data:{...event.data,portableCwd:encode(event.data.cwd)}}:event,
    readEvent:event=>{if(event.type!=='working-directory/change'||event.data.portableCwd===undefined)return event;const {portableCwd,...data}=event.data;return {...event,data:{...data,cwd:decode(portableCwd)}}},
    domain:(name,document,reading)=>{
      if(name==='dingtalk_dsh_assistant'){
        const row=document.tables.scheduler?.runtime;if(!row)return document
        const next={...row};for(const key of ['agentWorkspaceDir','taskWorkspaceDir']){const ref=key+'Relative';if(reading){if(next[ref]!==undefined)next[key]=decode(next[ref]);delete next[ref]}else if(next[key]!==undefined)next[ref]=encode(next[key])}
        return {...document,tables:{...document.tables,scheduler:{...document.tables.scheduler,runtime:next}}}
      }
      if(name!=='workspace')return document
      return {...document,tables:{...document.tables,workspaces:Object.fromEntries(Object.entries(document.tables.workspaces??{}).map(([id,row])=>{
        if(reading){const {portablePath,...rest}=row;return [id,{...rest,...portablePath!==undefined?{path:decode(portablePath)}:{}}]}
        return [id,{...row,portablePath:encode(row.path)}]
      }))}}
    }
  }
}
