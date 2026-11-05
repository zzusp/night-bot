import {setTimeout as wait} from 'node:timers/promises'
export const MAX_TIMER_DELAY_MS=2**31-1
const ownedReasons=new WeakSet()
class DeadlineExpired extends Error {
 constructor(code,timeoutMs){super(`${code} after ${timeoutMs}ms`);Object.defineProperties(this,{name:{value:'TimeoutReason'},code:{value:code,enumerable:true},timeoutMs:{value:timeoutMs,enumerable:true}})}
}
function delayLimit(value){if(!Number.isFinite(value)||value<=0||value>MAX_TIMER_DELAY_MS)throw new RangeError(`deadline timeoutMs must be a positive finite number no greater than ${MAX_TIMER_DELAY_MS}`)}
export function clampTimeout(requested,fallback,maximum,name='timeoutMs'){
 if(requested!==undefined&&(!Number.isFinite(requested)||requested<=0))throw new TypeError(`${name} must be a positive finite number`)
 return Math.min(requested??fallback,maximum)
}
/** A disposable clock only notifies. Its caller still owns termination/drain.
 * Stopping the clock never aborts the public signal or the upstream controller. */
export function deadline(upstream,timeoutMs,code){
 const expiration=new AbortController(),cancelClock=new AbortController()
 const signal=timeoutMs<=0?(upstream??expiration.signal):upstream===undefined?expiration.signal:AbortSignal.any([upstream,expiration.signal])
 let active=true
 if(!(timeoutMs<=0)){
  delayLimit(timeoutMs)
  void wait(timeoutMs,undefined,{signal:cancelClock.signal}).then(()=>{
   if(!active)return
   active=false;const reason=new DeadlineExpired(code,timeoutMs);ownedReasons.add(reason);expiration.abort(reason)
  },()=>{})
 }
 return Object.freeze({signal,[Symbol.dispose](){if(active){active=false;cancelClock.abort()}}})
}
/** Classification metadata, never authorization or an external-effect receipt.
 * Only reasons emitted by an actual clock in this module are recognized. */
export function timeoutOf(carrier,code){
 const reason=carrier?.reason
 return reason!==null&&typeof reason==='object'&&ownedReasons.has(reason)&&(code===undefined||reason.code===code)?reason:undefined
}
