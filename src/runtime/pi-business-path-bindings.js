import {isAbsolute,win32} from 'node:path'
const fail=code=>Object.assign(new Error(code),{code})
const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value)
const exact=(value,names)=>plain(value)&&Object.keys(value).length===names.length&&names.every(name=>Object.hasOwn(value,name))
const slash=value=>value.replaceAll('\\','/')
const windows=value=>typeof value==='string'&&(/^[A-Za-z]:[\\/]/.test(value)||value.startsWith('\\\\'))
const same=(a,b)=>typeof a==='string'&&typeof b==='string'&&(windows(a)?slash(a).toLowerCase()===slash(b).toLowerCase():slash(a)===slash(b))
const relative=value=>typeof value==='string'&&value.length>0&&!value.includes('\\')&&!value.startsWith('/')&&value.split('/').every(part=>part&&part!=='.'&&part!=='..')
function fields(receipt){
 const kind=receipt.domain+'/'+receipt.kind
 if(kind==='directory/changed')return [['cwd',receipt.payload.cwd]]
 if(kind==='sandbox/policy'&&receipt.payload.artifactRoot!=null)return [['artifactRoot.artifactRoot',receipt.payload.artifactRoot.artifactRoot],['artifactRoot.sessionCwd',receipt.payload.artifactRoot.sessionCwd]]
 return []
}
/** Metadata for known Host business fields only, never a Pi message transform. */
export function validateAuditPathBindings(receipt,{original=true}={}){
 const binding=receipt.pathBindings
 if(binding===undefined)return
 const paths=fields(receipt)
 if(!exact(binding,['version','kind','originRoot','fields'])||binding.version!==1||binding.kind!=='install-relative'||typeof binding.originRoot!=='string'||!(isAbsolute(binding.originRoot)||win32.isAbsolute(binding.originRoot))||!exact(binding.fields,paths.map(([name])=>name))||!paths.length)throw fail('PI_SESSION_AUDIT_PATH_BINDING_INVALID')
 const base=slash(binding.originRoot).replace(/\/+$/,'')
 for(const [name,source]of paths){const value=binding.fields[name];if(!relative(value)||original&&!same(source,base+'/'+value))throw fail('PI_SESSION_AUDIT_PATH_BINDING_INVALID')}
}
export function stampAuditPathBindings(receipt,{originRoot,encode}){
 if(receipt.pathBindings!==undefined)throw fail('PI_SESSION_AUDIT_PATH_BINDING_HOST_ONLY')
 const paths=fields(receipt);if(!paths.length)return receipt
 const result={...receipt,pathBindings:{version:1,kind:'install-relative',originRoot,fields:Object.fromEntries(paths.map(([name,value])=>[name,encode(value)]))}}
 validateAuditPathBindings(result);return result
}
export function readAuditPathBindings(receipt,{decode,sourceHeader,logicalHeader}){
 validateAuditPathBindings(receipt)
 const paths=fields(receipt)
 if(!paths.length)return receipt
 if(!receipt.pathBindings){
  if(sourceHeader?.portableCwd!==undefined&&!same(sourceHeader.cwd,logicalHeader.cwd))throw fail('PI_SESSION_PORTABLE_BUSINESS_PATH_UNPROVEN')
  return receipt
 }
 const payload=structuredClone(receipt.payload)
 for(const [name]of paths){const parts=name.split('.');let owner=payload;for(const key of parts.slice(0,-1))owner=owner[key];owner[parts.at(-1)]=decode(receipt.pathBindings.fields[name])}
 return {...receipt,payload}
}
