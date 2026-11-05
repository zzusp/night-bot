// Application management failures carry detached data rather than a transport
// marker. These values never grant session, tool or process authority.
function snapshotDetails(value){
  const copy=structuredClone(value),pending=[copy],seen=new Set()
  while(pending.length){
    const item=pending.pop()
    if(item===null||typeof item!=='object'||seen.has(item))continue
    const prototype=Object.getPrototypeOf(item)
    if(prototype!==Object.prototype&&prototype!==Array.prototype&&prototype!==null)throw new TypeError('Control error details must contain plain data')
    seen.add(item)
    for(const descriptor of Object.values(Object.getOwnPropertyDescriptors(item)))if('value' in descriptor)pending.push(descriptor.value)
    Object.freeze(item)
  }
  return copy
}
export class ControlError extends Error {
  constructor(code,message,details,options){
    if(typeof code!=='string'||!code.length)throw new TypeError('Control error code must be a nonempty string')
    super(message,options)
    this.name='ControlError'
    Object.defineProperties(this,{
      code:{value:code,enumerable:true},
      details:{value:snapshotDetails(details),enumerable:true},
    })
  }
}
