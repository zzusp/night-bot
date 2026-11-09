import {WebError} from '../native-capability-errors.js'

/** Public fetch syntax admission. Network admission runs independently after
 * this gate; neither URL parsing nor an allowed MIME type grants network access. */
export function validateFetchUrl(input){
 if(typeof input!=='string'||input.length>2048)throw new WebError('URL must be a string of at most 2048 characters','WEB_INVALID_URL')
 let url
 try{url=new URL(input)}catch(cause){throw new WebError('invalid HTTP fetch URL','WEB_INVALID_URL',{cause})}
 if(!['http:','https:'].includes(url.protocol))throw new WebError(`unsupported URL scheme "${url.protocol}" (only http and https are allowed)`,'WEB_INVALID_URL')
 if(url.username||url.password)throw new WebError('credentials in URLs are not allowed','WEB_BLOCKED_URL')
 return url
}
export const isSameOrigin=(left,right)=>left.origin===right.origin

export function classifyContentType(header){
 const mime=(header??'').split(';',1)[0].trim().toLowerCase()
 if(['text/html','application/xhtml+xml'].includes(mime))return 'html'
 if(mime.startsWith('text/')||['application/json','application/xml'].includes(mime)||mime.endsWith('+json')||mime.endsWith('+xml'))return 'text'
 return undefined
}

// Parameter scanner respects quoted semicolons and both quoted label forms;
// parameter names and charset labels are ASCII case insensitive.
export function parseCharset(header){
 const parameters=String(header??'').match(/(?:[^;"']|"[^"]*"|'[^']*')+/g)??[]
 for(const parameter of parameters.slice(1)){
  const equal=parameter.indexOf('=')
  if(equal<0||parameter.slice(0,equal).trim().toLowerCase()!=='charset')continue
  let label=parameter.slice(equal+1).trim()
  if((label.startsWith('"')&&label.endsWith('"'))||(label.startsWith("'")&&label.endsWith("'")))label=label.slice(1,-1)
  return label.trim().toLowerCase()
 }
 return undefined
}
export function decoderForCharset(label){
 try{return new TextDecoder(label??'utf-8')}
 catch(cause){throw new WebError(`unsupported charset "${label}"`,'WEB_UNSUPPORTED_CONTENT_TYPE',{cause})}
}
