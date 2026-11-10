/** Only selected business prose reaches reports. Never render tools, reasoning,
 * credentials, provider payloads or raw technical errors. */
export function workLogText(value,secrets=[]){
 let text=typeof value==='string'?value:''
 for(const secret of secrets)if(typeof secret==='string'&&secret.length)text=text.replaceAll(secret,'[已隐藏]')
 text=text.replace(/-----BEGIN[^\n]*PRIVATE KEY-----[\s\S]*?(?:-----END[^\n]*PRIVATE KEY-----|$)/g,'[密钥已隐藏]')
  .replace(/\bBearer\s+[^\s"'<>]+/gi,'Bearer [已隐藏]')
  .replace(/\b(?:sk-[A-Za-z0-9_-]{12,}|gh[pousr]_[A-Za-z0-9_]{15,}|github_pat_[A-Za-z0-9_]+|eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)\b/g,'[凭据已隐藏]')
  .split(/\r?\n/).map(line=>/(?:password|passwd|api[_ -]?key|access[_ -]?token|refresh[_ -]?token|authorization|cookie|secret|credential|密码|密钥|令牌)\s*["']?\s*[:=：]/i.test(line)?'[敏感字段已隐藏]':line).join(' ')
  .replace(/https?:\/\/[^\s<>]+/gi,value=>{try{const url=new URL(value);url.username='';url.password='';for(const key of [...url.searchParams.keys()])if(/token|secret|password|key|credential|signature/i.test(key))url.searchParams.set(key,'[已隐藏]');return url.toString()}catch{return '[链接已隐藏]'}})
  .replace(/[\x00-\x1f\x7f]/g,' ').replace(/\s+/g,' ').trim()
 // Escape markup so source content cannot introduce HTML, remote images or links.
 return text.slice(0,800).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/[\\`*_{}[\]()#!|]/g,'\\$&')+(text.length>800?'…':'')
}
export async function workLogSecrets(config,credentials,environment=process.env){
 const values=new Set([...(await credentials?.redactionValues?.()??[]),...(environment?.redactionValues?.()??[])]),refs=new Set()
 const visit=value=>{if(!value||typeof value!=='object')return;for(const [key,child]of Object.entries(value)){if(typeof child==='string'&&/(?:Env|Ref)$/.test(key))refs.add(child);else if(child&&typeof child==='object')visit(child)}}
 visit(config)
 for(const name of refs){const resolved=await credentials?.resolve?.(name);if(resolved?.value)values.add(resolved.value);const entry=typeof environment?.get==='function'?environment.get(name):environment?.[name];const value=typeof entry==='object'?entry?.value:entry;if(value)values.add(value)}
 // Opaque authentication records are never included in evidence or reports.
 const extract=value=>{if(!value||typeof value!=='object')return;for(const [key,child]of Object.entries(value)){if(typeof child==='string'&&/token|secret|passw(?:or)?d|key|cookie|authorization|^(?:access|refresh|value)$/i.test(key))values.add(child);else if(child&&typeof child==='object')extract(child)}}
 for(const record of await credentials?.listRecords?.()??[])extract(await credentials.readRecord(record.key))
 if(environment&&typeof environment.get!=='function')for(const [key,value]of Object.entries(environment))if(/token|secret|passw(?:or)?d|credential|api.?key|private.?key|cookie|authorization/i.test(key)&&typeof value==='string'&&value)values.add(value)
 return [...values]
}
