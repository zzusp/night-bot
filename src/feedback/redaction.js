/** Defence in depth, not a promise that arbitrary prose is safe to publish. */
export function redactFeedback(value, secrets=[]) {
 let text=String(value??'')
 for(const secret of secrets)if(typeof secret==='string'&&secret.length>0)text=text.replaceAll(secret,'[已脱敏]')
 return text.replace(/-----BEGIN[^\n]*PRIVATE KEY-----[\s\S]*?(?:-----END[^\n]*PRIVATE KEY-----|$)/g,'[密钥已脱敏]')
 .replace(/\bBearer\s+\S+/gi,'Bearer [已脱敏]')
 .replace(/\b(?:sk-[\w-]{8,}|gh[pousr]_[\w]{8,}|github_pat_[\w]+|eyJ[\w-]+\.[\w-]+\.[\w-]+)\b/g,'[凭据已脱敏]')
 .replace(/^.*(?:password|passwd|api[_ -]?key|access[_ -]?token|refresh[_ -]?token|authorization|cookie|secret|credential|密码|密钥|令牌)["']?\s*[:=：].*$/gim,'[敏感字段已脱敏]')
 .replace(/https?:\/\/[^\s<>"')]+/gi,'[链接已脱敏]')
 .replace(/(?<![A-Z0-9._%+-])[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi,'[邮箱已脱敏]')
 .replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g,'[IP已脱敏]')
 .replace(/(?:[A-Za-z]:[\\/]|\/(?:home|Users|workspace|tmp|var|mnt)\/)[^\s<>"']+/g,'[本地路径已脱敏]')
 .replace(/\b\d{7,19}\b/g,'[号码已脱敏]')
 .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g,'').slice(0,48000)
}
